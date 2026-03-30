import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionManager } from './transaction-manager.service';
import { PerformanceMonitorService, QueryOptimizerService } from '../optimization';

@Global()
@Module({
  providers: [PrismaService, TransactionManager, PerformanceMonitorService, QueryOptimizerService],
  exports: [PrismaService, TransactionManager, PerformanceMonitorService, QueryOptimizerService],
})
export class PrismaModule {}
