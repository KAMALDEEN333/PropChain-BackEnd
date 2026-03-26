import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsPositive,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../enums/transaction-type.enum';
import { IsEthereumAddress } from '../../common/validators/is-ethereum-address.validator';
import { IsXssSafe } from '../../common/validators/xss.validator';
import { IsNotSqlInjection } from '../../common/validators/sql-injection.validator';

export class CreateTransactionDto {
  @ApiProperty({ description: 'Sender wallet address', example: '0x123...' })
  @IsNotEmpty({ message: 'From address is required' })
  @IsEthereumAddress({ message: 'Invalid sender wallet address' })
  fromAddress: string;

  @ApiProperty({ description: 'Receiver wallet address', example: '0x456...' })
  @IsNotEmpty({ message: 'To address is required' })
  @IsEthereumAddress({ message: 'Invalid receiver wallet address' })
  toAddress: string;

  @ApiProperty({ description: 'Amount for the transaction', example: 100.5, minimum: 0 })
  @IsNumber({}, { message: 'Amount must be a number' })
  @IsPositive({ message: 'Amount must be positive' })
  @Min(0.000001, { message: 'Amount is too small' })
  amount: number;

  @ApiProperty({ description: 'Type of transaction', enum: TransactionType })
  @IsEnum(TransactionType, { message: 'Invalid transaction type' })
  type: TransactionType;

  @ApiProperty({ description: 'Buyer user ID', example: 'user-123' })
  @IsString({ message: 'Buyer ID must be a string' })
  @IsNotEmpty({ message: 'Buyer ID is required' })
  buyerId: string;

  @ApiProperty({ description: 'Seller user ID', example: 'user-456' })
  @IsString({ message: 'Seller ID must be a string' })
  @IsNotEmpty({ message: 'Seller ID is required' })
  sellerId: string;

  @ApiProperty({ description: 'Currency code', example: 'USD' })
  @IsString({ message: 'Currency must be a string' })
  @IsNotEmpty({ message: 'Currency is required' })
  @IsXssSafe({ message: 'Currency contains potentially malicious content' })
  @IsNotSqlInjection({ message: 'Currency contains potential SQL injection' })
  currency: string;

  @ApiPropertyOptional({ description: 'Property ID related to this transaction', example: 'prop-123' })
  @IsOptional()
  @IsString({ message: 'Property ID must be a string' })
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Transaction hash if already submitted', example: '0xabc...' })
  @IsOptional()
  @IsString({ message: 'Transaction hash must be a string' })
  txHash?: string;
}

export class PaginationParamsDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1, minimum: 1 })
  @IsOptional()
  @IsNumber({}, { message: 'Page must be a number' })
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Limit items per page', example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber({}, { message: 'Limit must be a number' })
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DisputeDto {
  @ApiProperty({ description: 'Reason for dispute', example: 'Property not as described' })
  @IsString({ message: 'Reason must be a string' })
  @IsNotEmpty({ message: 'Reason is required' })
  @IsXssSafe({ message: 'Reason contains potentially malicious content' })
  @IsNotSqlInjection({ message: 'Reason contains potential SQL injection' })
  reason: string;

  @ApiPropertyOptional({ description: 'Details about the dispute', example: 'The roof has a leak...' })
  @IsOptional()
  @IsString({ message: 'Details must be a string' })
  @IsXssSafe({ message: 'Details contains potentially malicious content' })
  @IsNotSqlInjection({ message: 'Details contains potential SQL injection' })
  details?: string;
}
