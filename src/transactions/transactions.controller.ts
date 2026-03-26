import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto, DisputeDto } from './dto/create-transaction.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Post()
  create(@Body() dto: CreateTransactionDto) {
    return this.service.createTransaction(dto);
  }

  @Post(':id/escrow')
  fundEscrow(@Param('id') id: string) {
    return this.service.fundEscrow(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.getTransaction(id);
  }

  @Get()
  findAll(@Query() query: TransactionQueryDto) {
    return this.service.findAll(query);
  }

  @Post(':id/dispute')
  dispute(@Param('id') id: string, @Body() dto: DisputeDto) {
    return this.service.raiseDispute(id, dto);
  }
}
