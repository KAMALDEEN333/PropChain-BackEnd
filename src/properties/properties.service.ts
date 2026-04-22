import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/property.dto';
import { Decimal } from '@prisma/client/runtime/library';

interface FindAllParams {
  skip?: number;
  take?: number;
  where?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  async create(createPropertyDto: CreatePropertyDto, ownerId: string) {
    const { price, squareFeet, lotSize, ...rest } = createPropertyDto;

    return this.prisma.property.create({
      data: {
        ...rest,
        price: new Decimal(price.toString()),
        squareFeet: squareFeet ? new Decimal(squareFeet.toString()) : null,
        lotSize: lotSize ? new Decimal(lotSize.toString()) : null,
        owner: {
          connect: { id: ownerId },
        },
      },
    });
  }

  async findAll(params?: FindAllParams) {
    const { skip, take, where, orderBy } = params || {};
    return this.prisma.property.findMany({
      skip,
      take,
      where,
      orderBy,
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.property.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        documents: true,
      },
    });
  }

  async update(id: string, updatePropertyDto: UpdatePropertyDto) {
    const { price, squareFeet, lotSize, ...rest } = updatePropertyDto;

    return this.prisma.property.update({
      where: { id },
      data: {
        ...rest,
        price: price ? new Decimal(price.toString()) : undefined,
        squareFeet: squareFeet ? new Decimal(squareFeet.toString()) : undefined,
        lotSize: lotSize ? new Decimal(lotSize.toString()) : undefined,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.property.delete({
      where: { id },
    });
  }

  async findByOwnerId(ownerId: string) {
    return this.prisma.property.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
