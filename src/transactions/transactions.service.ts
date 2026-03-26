import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database';
import { BlockchainService } from '../blockchain/blockchain.service';
import { TransactionStatus, TransactionType } from 'src/models/transaction.entity';

import { CreateTransactionDto, DisputeDto } from './dto/create-transaction.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainService: BlockchainService,
  ) {}

  private async calculateFees(amount: number) {
    const platformFee = amount * 0.02; // 2%
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

    return this.prisma.transaction.create({
      data: {
        ...dto,
        type: dto.type as any,
        status: 'PENDING',
        platformFee: fees.platformFee,
        gasFee: fees.estimatedGas,
      },
    });
  }

  async fundEscrow(transactionId: string) {
    const tx = await this.getTransaction(transactionId);

    const escrowWallet = await this.blockchainService.createEscrowWallet();

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        escrowWallet,
        status: 'ESCROW_FUNDED',
      },
    });

    return escrowWallet;
  }

  async monitorBlockchain(transactionId: string) {
    const tx = await this.getTransaction(transactionId);

    if (!tx.blockchainHash) {
      return;
    }

    const receipt = await this.blockchainService.getTransactionReceipt(tx.blockchainHash);

    if (receipt.confirmations >= 6) {
      await this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          confirmations: receipt.confirmations,
          status: 'CONFIRMED',
        },
      });
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
      orderBy: { createdAt: 'desc' }
    });
  }

  async raiseDispute(id: string, dto: DisputeDto) {
    return this.prisma.transaction.update({
      where: { id },
      data: { status: 'DISPUTED' },
    });
  }
}
