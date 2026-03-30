import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database';
import { TransactionManager } from '../database/prisma/transaction-manager.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { TransactionStatus, TransactionType } from 'src/models/transaction.entity';
import { TransactionRollbackException, TransactionRetryExhaustedException } from '../common/errors/custom.exceptions';

import { CreateTransactionDto, DisputeDto } from './dto/create-transaction.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionManager: TransactionManager,
    private readonly blockchainService: BlockchainService,
  ) {}

  private async calculateFees(amount: number) {
    const platformFee = amount * 0.02;
    const estimatedGas = await this.blockchainService.estimateGas();

    return {
      platformFee,
      estimatedGas,
    };
  }

  private validateTransition(current: TransactionStatus, next: TransactionStatus) {
    const allowedTransitions = {
      PENDING: ['ESCROW_FUNDED', 'CANCELLED'],
      ESCROW_FUNDED: ['BLOCKCHAIN_SUBMITTED'],
      BLOCKCHAIN_SUBMITTED: ['CONFIRMING'],
      CONFIRMING: ['CONFIRMED', 'FAILED'],
      CONFIRMED: ['COMPLETED'],
    };

    if (!allowedTransitions[current]?.includes(next)) {
      throw new Error(`Invalid transition from ${current} to ${next}`);
    }
  }
  async createTransaction(dto: CreateTransactionDto) {
    const fees = await this.calculateFees(dto.amount);

    return this.transactionManager.execute(
      'create-transaction',
      async ctx => {
        return (ctx.tx as any).transaction.create({
          data: {
            ...dto,
            type: dto.type as any,
            status: 'PENDING',
            platformFee: fees.platformFee,
            gasFee: fees.estimatedGas,
          },
        });
      },
      { timeout: 10000, maxRetries: 3 },
    );
  }

  async fundEscrow(transactionId: string) {
    const tx = await this.getTransaction(transactionId);

    this.validateTransition(tx.status as TransactionStatus, 'ESCROW_FUNDED' as TransactionStatus);

    try {
      return await this.transactionManager.execute(
        'fund-escrow',
        async ctx => {
          const escrowWallet = await this.blockchainService.createEscrowWallet();

          ctx.addCompensation({
            id: 'revert-escrow-wallet',
            description: `Escrow wallet ${escrowWallet} created but DB update failed. Manual review required.`,
            priority: 1,
            execute: async () => {
              this.logger.warn(
                `Compensation: Escrow wallet ${escrowWallet} was created but transaction ${transactionId} was rolled back. Manual blockchain reconciliation may be required.`,
              );
            },
          });

          const updatedTx = await (ctx.tx as any).transaction.update({
            where: { id: transactionId },
            data: {
              escrowWallet,
              status: 'ESCROW_FUNDED',
            },
          });

          this.logger.log(`Escrow funded for transaction ${transactionId}`);
          return escrowWallet;
        },
        { timeout: 15000, maxRetries: 3 },
      );
    } catch (error) {
      this.logger.error(`Failed to fund escrow for transaction ${transactionId}: ${(error as Error).message}`);
      throw new TransactionRollbackException('Failed to fund escrow. Transaction was rolled back.');
    }
  }

  async monitorBlockchain(transactionId: string) {
    const tx = await this.getTransaction(transactionId);

    if (!tx.blockchainHash) {
      return;
    }

    const receipt = await this.blockchainService.getTransactionReceipt(tx.blockchainHash);

    if (receipt.confirmations >= 6) {
      await this.transactionManager.execute(
        'update-blockchain-confirmation',
        async ctx => {
          return (ctx.tx as any).transaction.update({
            where: { id: tx.id },
            data: {
              confirmations: receipt.confirmations,
              status: 'CONFIRMED',
            },
          });
        },
        { timeout: 10000, maxRetries: 3 },
      );
    }
  }

  async getTransaction(id: string) {
    return this.prisma.transaction.findUnique({ where: { id } });
  }

  async findAll(query: TransactionQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.buyerId) where.buyerId = query.buyerId;
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.propertyId) where.propertyId = query.propertyId;

    return this.prisma.transaction.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async raiseDispute(id: string, dto: DisputeDto) {
    return this.transactionManager.execute(
      'raise-dispute',
      async ctx => {
        const tx = await (ctx.tx as any).transaction.findUnique({ where: { id } });
        if (!tx) {
          ctx.markForRollback(`Transaction ${id} not found`);
          return null;
        }

        return (ctx.tx as any).transaction.update({
          where: { id },
          data: {
            status: 'DISPUTED',
            disputeReason: dto.reason,
          },
        });
      },
      { timeout: 10000, maxRetries: 3 },
    );
  }
}
