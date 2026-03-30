import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { StructuredLoggerService } from '../../common/logging/logger.service';

export interface TransactionOptions {
  timeout?: number;
  maxWait?: number;
  maxRetries?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  enableLogging?: boolean;
  name?: string;
}

export interface CompensationAction {
  id: string;
  description: string;
  execute: () => Promise<void>;
  priority?: number;
}

export interface TransactionContext {
  tx: Prisma.TransactionClient;
  transactionId: string;
  addCompensation: (action: CompensationAction) => void;
  markForRollback: (reason?: string) => void;
  isRollbackOnly: () => boolean;
  startedAt: Date;
  name?: string;
}

export interface TransactionMetrics {
  transactionId: string;
  name?: string;
  startedAt: Date;
  endedAt?: Date;
  duration?: number;
  committed: boolean;
  rolledBack: boolean;
  compensationCount: number;
  compensationsExecuted: number;
  error?: string;
  retryAttempts: number;
}

interface TransactionState {
  id: string;
  name?: string;
  startedAt: Date;
  compensationActions: CompensationAction[];
  rollbackOnly: boolean;
  rollbackReason?: string;
}

@Injectable()
export class TransactionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TransactionManager.name);
  private readonly activeTransactions = new Map<string, TransactionState>();
  private readonly metricsHistory: TransactionMetrics[] = [];
  private readonly maxMetricsHistory = 1000;
  private isShuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly structuredLogger: StructuredLoggerService,
  ) {
    this.structuredLogger.setContext('TransactionManager');
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.logger.log('Shutting down TransactionManager, waiting for active transactions...');

    const timeout = 30000;
    const startTime = Date.now();

    while (this.activeTransactions.size > 0 && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.activeTransactions.size > 0) {
      this.logger.warn(`Forcefully terminating ${this.activeTransactions.size} active transactions during shutdown`);
      this.activeTransactions.clear();
    }
  }

  async execute<T>(
    name: string,
    fn: (ctx: TransactionContext) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    if (this.isShuttingDown) {
      throw new Error('Cannot start new transaction during shutdown');
    }

    const transactionId = this.generateTransactionId();
    const state: TransactionState = {
      id: transactionId,
      name,
      startedAt: new Date(),
      compensationActions: [],
      rollbackOnly: false,
    };

    this.activeTransactions.set(transactionId, state);

    const metrics: TransactionMetrics = {
      transactionId,
      name,
      startedAt: state.startedAt,
      committed: false,
      rolledBack: false,
      compensationCount: 0,
      compensationsExecuted: 0,
      retryAttempts: 0,
    };

    const maxRetries = options.maxRetries ?? 3;
    const timeout = options.timeout ?? 10000;
    const maxWait = options.maxWait ?? 5000;
    const enableLogging = options.enableLogging ?? true;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      metrics.retryAttempts = attempt;
      state.compensationActions = [];
      state.rollbackOnly = false;
      state.rollbackReason = undefined;

      try {
        const result = await this.prisma.$transaction(
          async tx => {
            const context: TransactionContext = {
              tx,
              transactionId,
              startedAt: state.startedAt,
              name,
              addCompensation: (action: CompensationAction) => {
                state.compensationActions.push(action);
                metrics.compensationCount = state.compensationActions.length;
              },
              markForRollback: (reason?: string) => {
                state.rollbackOnly = true;
                state.rollbackReason = reason;
              },
              isRollbackOnly: () => state.rollbackOnly,
            };

            const fnResult = await fn(context);

            if (state.rollbackOnly) {
              throw new TransactionRollbackError(state.rollbackReason || 'Transaction marked for rollback');
            }

            return fnResult;
          },
          {
            timeout,
            maxWait,
            isolationLevel: options.isolationLevel,
          },
        );

        metrics.endedAt = new Date();
        metrics.duration = metrics.endedAt.getTime() - metrics.startedAt.getTime();
        metrics.committed = true;

        this.recordMetrics(metrics);
        this.activeTransactions.delete(transactionId);

        return result;
      } catch (error) {
        lastError = error as Error;

        if (this.isRetryableError(error) && attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 100;
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        metrics.endedAt = new Date();
        metrics.duration = metrics.endedAt.getTime() - metrics.startedAt.getTime();
        metrics.rolledBack = true;
        metrics.error = lastError.message;

        await this.executeCompensations(state, metrics);

        this.recordMetrics(metrics);
        this.activeTransactions.delete(transactionId);

        throw new TransactionFailedError(
          `Transaction '${name}' failed: ${lastError.message}`,
          lastError,
          transactionId,
        );
      }
    }

    throw new TransactionFailedError(
      `Transaction '${name}' failed after ${maxRetries} attempts: ${lastError?.message}`,
      lastError,
      transactionId,
    );
  }

  async readOnly<T>(
    name: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return this.execute(name, async ctx => fn(ctx.tx), {
      ...options,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  async serializable<T>(
    name: string,
    fn: (ctx: TransactionContext) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return this.execute(name, fn, {
      ...options,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  getActiveCount(): number {
    return this.activeTransactions.size;
  }

  getMetrics(limit = 100): TransactionMetrics[] {
    return this.metricsHistory.slice(-limit);
  }

  getStatistics(): {
    active: number;
    totalCompleted: number;
    committed: number;
    rolledBack: number;
    averageDuration: number;
    errorRate: number;
  } {
    const total = this.metricsHistory.length;
    const committed = this.metricsHistory.filter(m => m.committed).length;
    const rolledBack = this.metricsHistory.filter(m => m.rolledBack).length;
    const durations = this.metricsHistory.filter(m => m.duration !== undefined).map(m => m.duration!);
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const errorRate = total > 0 ? rolledBack / total : 0;

    return {
      active: this.activeTransactions.size,
      totalCompleted: total,
      committed,
      rolledBack,
      averageDuration,
      errorRate,
    };
  }

  private async executeCompensations(state: TransactionState, metrics: TransactionMetrics): Promise<void> {
    if (state.compensationActions.length === 0) {
      return;
    }

    // Sort by priority (lower = higher priority) and reverse order
    const sortedActions = [...state.compensationActions]
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
      .reverse();

    for (const action of sortedActions) {
      try {
        await action.execute();
        metrics.compensationsExecuted++;
      } catch (error) {
        this.logger.error(`Compensation '${action.id}' failed: ${(error as Error).message}`);
      }
    }
  }

  private isRetryableError(error: unknown): boolean {
    const err = error as Error;
    const message = err.message?.toLowerCase() || '';

    const retryablePatterns = [
      'deadlock',
      'lock wait timeout',
      'connection terminated',
      'transaction failed',
      'write conflict',
      'could not serialize',
      'p2034',
      'p2036',
      'p2024',
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private recordMetrics(metrics: TransactionMetrics): void {
    this.metricsHistory.push(metrics);

    if (this.metricsHistory.length > this.maxMetricsHistory) {
      this.metricsHistory.shift();
    }
  }
}

export class TransactionRollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionRollbackError';
  }
}

export class TransactionFailedError extends Error {
  constructor(
    message: string,
    public readonly cause: Error | undefined,
    public readonly transactionId: string,
  ) {
    super(message);
    this.name = 'TransactionFailedError';
  }
}
