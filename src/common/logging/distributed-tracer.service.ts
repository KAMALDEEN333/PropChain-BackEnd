import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  service: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'active' | 'completed' | 'error';
  tags: Record<string, string>;
  error?: string;
}

export interface CorrelatedLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  correlationId: string;
  traceId?: string;
  spanId?: string;
  service: string;
  metadata?: Record<string, unknown>;
}

export interface LogAnalysisResult {
  totalEntries: number;
  errorCount: number;
  warnCount: number;
  averageResponseTimeMs: number;
  slowOperations: Array<{ operation: string; durationMs: number }>;
  errorRate: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * DistributedTracerService
 *
 * Provides distributed tracing across services, request correlation tracking,
 * intelligent log analysis, and performance impact reporting.
 */
@Injectable()
export class DistributedTracerService {
  private readonly logger = new Logger(DistributedTracerService.name);
  private readonly activeSpans = new Map<string, TraceSpan>();
  private readonly completedSpans: TraceSpan[] = [];
  private readonly logBuffer: CorrelatedLogEntry[] = [];

  private readonly MAX_LOG_BUFFER = 1000;
  private readonly SLOW_THRESHOLD_MS = 500;

  // ── Tracing ──────────────────────────────────────────────────────────────

  /**
   * Start a new trace span, optionally as a child of an existing span.
   */
  startSpan(
    operation: string,
    service: string,
    traceId?: string,
    parentSpanId?: string,
    tags: Record<string, string> = {},
  ): TraceSpan {
    const span: TraceSpan = {
      traceId: traceId ?? uuidv4(),
      spanId: uuidv4(),
      parentSpanId,
      operation,
      service,
      startTime: Date.now(),
      status: 'active',
      tags,
    };

    this.activeSpans.set(span.spanId, span);
    this.logger.debug(`Span started: ${span.spanId} [${service}] ${operation}`);
    return span;
  }

  /**
   * Finish a span and move it to the completed pool.
   */
  finishSpan(spanId: string, error?: string): TraceSpan | null {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;

    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = error ? 'error' : 'completed';
    if (error) span.error = error;

    this.activeSpans.delete(spanId);
    this.completedSpans.push(span);

    if (span.durationMs > this.SLOW_THRESHOLD_MS) {
      this.logger.warn(
        `Slow span detected: ${span.operation} took ${span.durationMs}ms`,
      );
    }

    return span;
  }

  /**
   * Retrieve all active spans across services.
   */
  getActiveSpans(): TraceSpan[] {
    return Array.from(this.activeSpans.values());
  }

  /**
   * Get all spans belonging to a trace.
   */
  getTrace(traceId: string): TraceSpan[] {
    return this.completedSpans.filter((s) => s.traceId === traceId);
  }

  // ── Correlation ──────────────────────────────────────────────────────────

  /**
   * Generate a new correlation ID for an incoming request.
   */
  generateCorrelationId(): string {
    return uuidv4();
  }

  /**
   * Emit a correlated log entry tied to a correlation/trace context.
   */
  log(entry: Omit<CorrelatedLogEntry, 'timestamp'>): void {
    const full: CorrelatedLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    if (this.logBuffer.length >= this.MAX_LOG_BUFFER) {
      this.logBuffer.shift(); // drop oldest to stay within buffer limit
    }
    this.logBuffer.push(full);

    const prefix = `[${full.correlationId}]${full.traceId ? ` trace=${full.traceId}` : ''}`;
    switch (full.level) {
      case 'error':
        this.logger.error(`${prefix} ${full.message}`);
        break;
      case 'warn':
        this.logger.warn(`${prefix} ${full.message}`);
        break;
      case 'debug':
        this.logger.debug(`${prefix} ${full.message}`);
        break;
      default:
        this.logger.log(`${prefix} ${full.message}`);
    }
  }

  /**
   * Retrieve all log entries matching a correlation ID.
   */
  getLogsByCorrelationId(correlationId: string): CorrelatedLogEntry[] {
    return this.logBuffer.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Retrieve all log entries belonging to a trace.
   */
  getLogsByTraceId(traceId: string): CorrelatedLogEntry[] {
    return this.logBuffer.filter((e) => e.traceId === traceId);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────

  /**
   * Analyse completed spans for performance and error trends.
   */
  analyzePerformance(): LogAnalysisResult {
    const completed = this.completedSpans;
    const logs = this.logBuffer;

    const errorCount = logs.filter((l) => l.level === 'error').length;
    const warnCount = logs.filter((l) => l.level === 'warn').length;

    const durations = completed
      .filter((s) => s.durationMs !== undefined)
      .map((s) => s.durationMs as number);

    const averageResponseTimeMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    const slowOperations = completed
      .filter((s) => (s.durationMs ?? 0) > this.SLOW_THRESHOLD_MS)
      .map((s) => ({ operation: s.operation, durationMs: s.durationMs as number }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10);

    const errorRate =
      logs.length > 0 ? Math.round((errorCount / logs.length) * 100) / 100 : 0;

    return {
      totalEntries: logs.length,
      errorCount,
      warnCount,
      averageResponseTimeMs,
      slowOperations,
      errorRate,
    };
  }

  /**
   * Filter log entries by level and optional time range.
   */
  filterLogs(
    level?: CorrelatedLogEntry['level'],
    fromIso?: string,
    toIso?: string,
  ): CorrelatedLogEntry[] {
    return this.logBuffer.filter((entry) => {
      if (level && entry.level !== level) return false;
      if (fromIso && entry.timestamp < fromIso) return false;
      if (toIso && entry.timestamp > toIso) return false;
      return true;
    });
  }

  /**
   * Clear internal buffers (useful for testing or scheduled cleanup).
   */
  clearBuffers(): void {
    this.completedSpans.length = 0;
    this.logBuffer.length = 0;
    this.logger.log('Tracer buffers cleared');
  }
}
