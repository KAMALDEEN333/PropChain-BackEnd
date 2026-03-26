import { PartialType } from '@nestjs/swagger';
import { CreateTransactionDto } from './create-transaction.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { TransactionStatus } from '../enums/transaction-status.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {
  @ApiPropertyOptional({ description: 'Update transaction status', enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus, { message: 'Invalid transaction status' })
  status?: TransactionStatus;
}
