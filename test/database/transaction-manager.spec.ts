import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  TransactionManager,
  TransactionFailedError,
  TransactionRollbackError,
} from '../../src/database/prisma/transaction-manager.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { StructuredLoggerService } from '../../src/common/logging/logger.service';

describe('TransactionManager', () => {
  let service: TransactionManager;
  let prisma: PrismaService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      providers: [PrismaService, TransactionManager, StructuredLoggerService],
    }).compile();

    service = module.get<TransactionManager>(TransactionManager);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    await prisma.onModuleDestroy();
    await module.close();
  });

  describe('execute', () => {
    it('should execute a transaction successfully', async () => {
      const result = await service.execute('test-transaction', async ctx => {
        const count = await (ctx.tx as any).user.count();
        return { count };
      });

      expect(result).toBeDefined();
      expect(typeof result.count).toBe('number');
    });

    it('should commit changes on success', async () => {
      const testEmail = `test-${Date.now()}@example.com`;

      const user = await service.execute('create-test-user', async ctx => {
        return (ctx.tx as any).user.create({
          data: {
            email: testEmail,
            role: 'USER',
          },
        });
      });

      expect(user).toBeDefined();
      expect(user.email).toBe(testEmail);

      // Verify user exists after transaction
      const foundUser = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(foundUser).toBeDefined();

      // Cleanup
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('should rollback on error', async () => {
      const testEmail = `rollback-${Date.now()}@example.com`;

      await expect(
        service.execute('rollback-test', async ctx => {
          // Create a user
          await (ctx.tx as any).user.create({
            data: {
              email: testEmail,
              role: 'USER',
            },
          });

          // Then throw an error to trigger rollback
          throw new Error('Intentional error for rollback test');
        }),
      ).rejects.toThrow(TransactionFailedError);

      // Verify user was rolled back
      const foundUser = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(foundUser).toBeNull();
    });

    it('should rollback when marked for rollback', async () => {
      const testEmail = `marked-rollback-${Date.now()}@example.com`;

      await expect(
        service.execute('marked-rollback-test', async ctx => {
          // Create a user
          await (ctx.tx as any).user.create({
            data: {
              email: testEmail,
              role: 'USER',
            },
          });

          // Mark for rollback
          ctx.markForRollback('User requested rollback');

          // This should trigger rollback
          return 'should not reach here';
        }),
      ).rejects.toThrow();

      // Verify user was rolled back
      const foundUser = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(foundUser).toBeNull();
    });

    it('should execute compensation actions on rollback', async () => {
      const compensationSpy = jest.fn();
      const testEmail = `compensation-${Date.now()}@example.com`;

      await expect(
        service.execute('compensation-test', async ctx => {
          // Create a user
          await (ctx.tx as any).user.create({
            data: {
              email: testEmail,
              role: 'USER',
            },
          });

          // Add compensation action
          ctx.addCompensation({
            id: 'test-compensation',
            description: 'Test compensation',
            execute: compensationSpy,
          });

          // Throw to trigger rollback
          throw new Error('Trigger rollback');
        }),
      ).rejects.toThrow();

      // Verify compensation was executed
      expect(compensationSpy).toHaveBeenCalled();
    });

    it('should retry on transient failures', async () => {
      let attempts = 0;

      const result = await service.execute(
        'retry-test',
        async ctx => {
          attempts++;
          if (attempts < 2) {
            // Simulate a transient error
            const error = new Error('deadlock detected');
            throw error;
          }
          return { success: true, attempts };
        },
        { maxRetries: 3 },
      );

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it('should throw after max retries exhausted', async () => {
      let attempts = 0;

      await expect(
        service.execute(
          'max-retries-test',
          async () => {
            attempts++;
            throw new Error('deadlock detected');
          },
          { maxRetries: 3 },
        ),
      ).rejects.toThrow(TransactionFailedError);

      expect(attempts).toBe(3);
    });

    it('should track transaction metrics', async () => {
      await service.execute('metrics-test', async ctx => {
        await (ctx.tx as any).user.count();
        return 'done';
      });

      const metrics = service.getMetrics(1);
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].committed).toBe(true);
      expect(metrics[0].rolledBack).toBe(false);
      expect(metrics[0].duration).toBeDefined();
    });

    it('should track rollback metrics', async () => {
      await expect(
        service.execute('metrics-rollback-test', async () => {
          throw new Error('Test error');
        }),
      ).rejects.toThrow();

      const metrics = service.getMetrics(1);
      const lastMetric = metrics[metrics.length - 1];
      expect(lastMetric.rolledBack).toBe(true);
      expect(lastMetric.committed).toBe(false);
      expect(lastMetric.error).toBeDefined();
    });
  });

  describe('getStatistics', () => {
    it('should return transaction statistics', async () => {
      // Execute a few transactions
      await service.execute('stats-test-1', async ctx => {
        await (ctx.tx as any).user.count();
      });

      await service.execute('stats-test-2', async ctx => {
        await (ctx.tx as any).user.count();
      });

      const stats = service.getStatistics();

      expect(stats).toBeDefined();
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.totalCompleted).toBe('number');
      expect(typeof stats.committed).toBe('number');
      expect(typeof stats.rolledBack).toBe('number');
      expect(typeof stats.averageDuration).toBe('number');
      expect(typeof stats.errorRate).toBe('number');
    });
  });

  describe('getActiveCount', () => {
    it('should return the count of active transactions', async () => {
      expect(service.getActiveCount()).toBe(0);
    });
  });

  describe('isRollbackOnly', () => {
    it('should return false initially', async () => {
      await service.execute('rollback-only-test', async ctx => {
        expect(ctx.isRollbackOnly()).toBe(false);
      });
    });

    it('should return true after markForRollback', async () => {
      await expect(
        service.execute('rollback-only-marked-test', async ctx => {
          ctx.markForRollback('Test reason');
          expect(ctx.isRollbackOnly()).toBe(true);
        }),
      ).rejects.toThrow();
    });
  });

  describe('transaction context', () => {
    it('should provide transaction ID', async () => {
      await service.execute('tx-id-test', async ctx => {
        expect(ctx.transactionId).toBeDefined();
        expect(ctx.transactionId).toMatch(/^tx_\d+_[a-z0-9]+$/);
      });
    });

    it('should provide transaction name', async () => {
      await service.execute('named-tx-test', async ctx => {
        expect(ctx.name).toBe('named-tx-test');
      });
    });

    it('should track startedAt timestamp', async () => {
      const beforeStart = new Date();

      await service.execute('started-at-test', async ctx => {
        expect(ctx.startedAt).toBeInstanceOf(Date);
        expect(ctx.startedAt.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      });
    });
  });
});
