import { Injectable } from '@nestjs/common';
import {
  NotFoundException,
  UserNotFoundException,
  InvalidInputException,
  BusinessRuleViolationException,
  TransactionRollbackException,
} from '../common/errors/custom.exceptions';
import { PrismaService } from '../database/prisma/prisma.service';
import { TransactionManager } from '../database/prisma/transaction-manager.service';
import { CreatePropertyDto, PropertyStatus as DTOPropertyStatus } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyQueryDto } from './dto/property-query.dto';
import { ConfigService } from '@nestjs/config';
import { MultiLevelCacheService } from '../common/cache/multi-level-cache.service';
import { BaseService } from '../common/services/base.service';
import { BoundaryValidationService } from '../common/validation';

/**
 * Properties Service
 *
 * Manages the lifecycle of real estate properties including:
 * - Creation and address formatting
 * - Search with complex filtering (price, area, bedrooms, etc.)
 * - Caching and cache invalidation
 * - Property statistics and analytics
 *
 * @class PropertiesService
 */
@Injectable()
export class PropertiesService extends BaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionManager: TransactionManager,
    private readonly configService: ConfigService,
    private readonly cacheService: MultiLevelCacheService,
    boundaryValidation: BoundaryValidationService,
  ) {
    super(boundaryValidation, PropertiesService.name);
  }

  /**
   * Create a new property listing
   *
   * Validates the owner existence, formats the address, and persists the property.
   * Automatically invalidates relevant search and list caches.
   *
   * @param {CreatePropertyDto} createPropertyDto - Property details
   * @param {string} ownerId - ID of the user owning the property
   * @returns {Promise<Property>} The created property with owner info
   *
   * @throws {UserNotFoundException} If the owner ID is invalid
   * @throws {InvalidInputException} If creation fails
   *
   * @example
   * ```typescript
   * const property = await propertiesService.create({
   *   title: 'Luxury Penthouse',
   *   description: 'Spacious 3-bedroom penthouse with city views',
   *   address: { street: '123 Main St', city: 'London', country: 'UK' },
   *   price: 1500000,
   *   areaSqFt: 2500,
   *   type: 'PENTHOUSE'
   * }, 'user_uuid_123');
   * ```
   */
  async create(createPropertyDto: CreatePropertyDto, ownerId: string) {
    const input = await this.validateInput(CreatePropertyDto, createPropertyDto, 'create');

    try {
      return await this.transactionManager.execute(
        'create-property',
        async ctx => {
          // Verify owner exists within transaction
          const owner = await (ctx.tx as any).user.findUnique({
            where: { id: ownerId },
          });

          if (!owner) {
            ctx.markForRollback(`Owner ${ownerId} not found`);
            throw new UserNotFoundException(ownerId);
          }

          const location = this.formatAddress(input.address);

          const property = await (ctx.tx as any).property.create({
            data: {
              title: input.title,
              description: input.description,
              location,
              price: input.price,
              status: this.mapPropertyStatus(input.status || DTOPropertyStatus.AVAILABLE),
              ownerId,
              bedrooms: input.bedrooms,
              bathrooms: input.bathrooms,
              squareFootage: input.areaSqFt,
              propertyType: input.type,
            },
            include: {
              owner: {
                select: { id: true, email: true, role: true },
              },
            },
          });


          this.logger.log(`Property created: ${property.id} by user ${ownerId}`);
          return property;

      const location = this.formatAddress(input.address);

      const property = await (this.prisma as any).property.create({
        data: {
          title: input.title,
          description: input.description,
          location,
          price: input.price,
          status: this.mapPropertyStatus(input.status || DTOPropertyStatus.AVAILABLE),
          ownerId,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          squareFootage: input.areaSqFt,
          propertyType: input.type,
          // SEO metadata fields for issue #260
          metaTitle: input.metaTitle,
          metaDescription: input.metaDescription,
          metaKeywords: input.metaKeywords,
        },
        include: {
          owner: {
            select: { id: true, email: true, role: true },
          },

        },
        { timeout: 10000, maxRetries: 3 },
      );

      // Invalidate caches after successful commit
      await this.invalidatePropertyReadCaches(property.id);
    } catch (error) {
      if (error instanceof UserNotFoundException || error instanceof InvalidInputException) {
        throw error;
      }
      this.logger.error('Failed to create property', error);
      throw new InvalidInputException(undefined, 'Failed to create property');
    }
  }

  /**
   * Search and filter properties with pagination
   *
   * Supports advanced filtering by:
   * - Text search (title, description, location)
   * - Numeric ranges (price, bedrooms, bathrooms, area)
   * - Property status and type
   *
   * Results are cached for 5 minutes by query fingerprint.
   *
   * @param {PropertyQueryDto} query - Search and pagination parameters
   * @returns {Promise<PaginatedPropertyResponse>} Properties and metadata
   *
   * @example
   * ```typescript
   * const result = await propertiesService.findAll({
   *   page: 1,
   *   limit: 10,
   *   minPrice: 500000,
   *   maxPrice: 2000000,
   *   type: 'PENTHOUSE',
   *   search: 'London'
   * });
   * ```
   */
  async findAll(query?: PropertyQueryDto) {
    const normalizedQuery = query
      ? await this.validateInput(PropertyQueryDto, query, 'findAll', { skipMissingProperties: true })
      : undefined;

    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      type,
      status,
      city,
      country,
      minPrice,
      maxPrice,
      minBedrooms,
      maxBedrooms,
      minBathrooms,
      maxBathrooms,
      minArea,
      maxArea,
      ownerId,
    } = normalizedQuery || {};

    const skip = (page - 1) * limit;
    const where: Record<string, any> = {};

    // Exclude soft-deleted properties
    where.isDeleted = false;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (type) {
      where.propertyType = type;
    }

    if (status) {
      where.status = this.mapPropertyStatus(status);
    }

    if (city || country) {
      const locationParts: string[] = [];
      if (city) {
        locationParts.push(city);
      }
      if (country) {
        locationParts.push(country);
      }
      where.location = { contains: locationParts.join(', '), mode: 'insensitive' };
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) {
        where.price.gte = minPrice;
      }
      if (maxPrice !== undefined) {
        where.price.lte = maxPrice;
      }
    }

    if (minBedrooms !== undefined || maxBedrooms !== undefined) {
      where.bedrooms = {};
      if (minBedrooms !== undefined) {
        where.bedrooms.gte = minBedrooms;
      }
      if (maxBedrooms !== undefined) {
        where.bedrooms.lte = maxBedrooms;
      }
    }

    if (minBathrooms !== undefined || maxBathrooms !== undefined) {
      where.bathrooms = {};
      if (minBathrooms !== undefined) {
        where.bathrooms.gte = minBathrooms;
      }
      if (maxBathrooms !== undefined) {
        where.bathrooms.lte = maxBathrooms;
      }
    }

    if (minArea !== undefined || maxArea !== undefined) {
      where.squareFootage = {};
      if (minArea !== undefined) {
        where.squareFootage.gte = minArea;
      }
      if (maxArea !== undefined) {
        where.squareFootage.lte = maxArea;
      }
    }

    if (ownerId) {
      where.ownerId = ownerId;
    }

    const cacheKey = this.buildPropertyListCacheKey(normalizedQuery);

    try {
      return await this.cacheService.wrap(
        cacheKey,
        async () =>
          this.monitorQuery('properties.findAll', { cacheKey, page, limit }, async () => {
            const [properties, total] = await Promise.all([
              (this.prisma as any).property.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: sortOrder },
                relationLoadStrategy: 'join',
                include: {
                  owner: { select: { id: true, email: true, role: true } },
                },
              }),
              (this.prisma as any).property.count({ where }),
            ]);

            return {
              properties,
              total,
              page,
              limit,
              totalPages: Math.ceil(total / limit),
            };
          }),
        { l1Ttl: 60, l2Ttl: 300, tags: ['property', 'property:list'] },
      );
    } catch (error) {
      this.logger.error('Failed to fetch properties', error);
      throw new InvalidInputException(undefined, 'Failed to fetch properties');
    }
  }

  async findOne(id: string) {
    const cacheKey = `property:detail:${id}`;

    try {
      const property = await this.cacheService.wrap(
        cacheKey,
        async () =>
          this.monitorQuery('properties.findOne', { propertyId: id }, async () =>
            (this.prisma as any).property.findFirst({
              where: { id, isDeleted: false },
              relationLoadStrategy: 'join',
              include: {
                owner: { select: { id: true, email: true, role: true } },
                documents: { select: { id: true, name: true, type: true, status: true, createdAt: true } },
                valuations: { orderBy: { valuationDate: 'desc' }, take: 5 },
              },
            }),
          ),
        { l1Ttl: 60, l2Ttl: 300, tags: ['property', `property:${id}`] },
      );

      if (!property) {
        throw new NotFoundException(`Property with ID ${id} not found`);
      }

      return property;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch property ${id}`, error);
      throw new InvalidInputException(undefined, 'Failed to fetch property');
    }
  }

  async update(id: string, updatePropertyDto: UpdatePropertyDto) {
    const input = await this.validateInput(UpdatePropertyDto, updatePropertyDto, 'update', {
      skipMissingProperties: true,
    });

    try {
      return await this.transactionManager.execute(
        'update-property',
        async ctx => {
          const existingProperty = await (ctx.tx as any).property.findUnique({
            where: { id },
          });

          if (!existingProperty) {
            ctx.markForRollback(`Property ${id} not found`);
            throw new NotFoundException(`Property with ID ${id} not found`);
          }

          const updateData: any = {};

          if (input.title !== undefined) {
            updateData.title = input.title;
          }
          if (input.description !== undefined) {
            updateData.description = input.description;
          }
          if (input.price !== undefined) {
            updateData.price = input.price;
          }
          if (input.address) {
            updateData.location = this.formatAddress(input.address);
          }
          if (input.status !== undefined) {
            updateData.status = this.mapPropertyStatus(input.status);
          }
          if (input.bedrooms !== undefined) {
            updateData.bedrooms = input.bedrooms;
          }
          if (input.bathrooms !== undefined) {
            updateData.bathrooms = input.bathrooms;
          }
          if (input.areaSqFt !== undefined) {
            updateData.squareFootage = input.areaSqFt;
          }
          if (input.type !== undefined) {
            updateData.propertyType = input.type;
          }

          const property = await (ctx.tx as any).property.update({
            where: { id },
            data: updateData,
            relationLoadStrategy: 'join',
            include: {
              owner: { select: { id: true, email: true, role: true } },
            },
          });

          this.logger.log(`Property updated: ${property.id}`);
          return property;
        },
        { timeout: 10000, maxRetries: 3 },
      );


      // Invalidate caches after successful commit

      // After successful update, save the old state as a version
      await this.savePropertyVersion(id, existingProperty, input.versionReason || 'Update');


      await this.invalidatePropertyReadCaches(id);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof InvalidInputException) {
        throw error;
      }
      this.logger.error(`Failed to update property ${id}`, error);
      throw new InvalidInputException(undefined, 'Failed to update property');
    }
  }

  async remove(id: string): Promise<void> {
    try {

      await this.transactionManager.execute(
        'delete-property',
        async ctx => {
          const existingProperty = await (ctx.tx as any).property.findUnique({
            where: { id },
          });

          if (!existingProperty) {
            ctx.markForRollback(`Property ${id} not found`);
            throw new NotFoundException(`Property with ID ${id} not found`);
          }

          await (ctx.tx as any).property.delete({
            where: { id },
          });

          this.logger.log(`Property deleted: ${id}`);
        },
        { timeout: 10000, maxRetries: 3 },
      );

      const existingProperty = await (this.prisma as any).property.findUnique({
        where: { id },
      });

      if (!existingProperty) {
        throw new NotFoundException(`Property with ID ${id} not found`);
      }

      // Soft delete for issues #258 and #259
      await (this.prisma as any).property.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });


      // Invalidate caches after successful commit
      await this.invalidatePropertyReadCaches(id);



      this.logger.log(`Property soft deleted: ${id}`);

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to soft delete property ${id}`, error);
      throw new InvalidInputException(undefined, 'Failed to delete property');
    }
  }

  // Restore functionality for issue #259
  async restore(id: string): Promise<any> {
    try {
      const existingProperty = await (this.prisma as any).property.findFirst({
        where: { 
          id,
          isDeleted: true 
        },
      });

      if (!existingProperty) {
        throw new NotFoundException(`Soft deleted property with ID ${id} not found`);
      }

      const restoredProperty = await (this.prisma as any).property.update({
        where: { id },
        data: {
          isDeleted: false,
          deletedAt: null,
        },
        include: {
          owner: {
            select: { id: true, email: true, role: true },
          },
        },
      });

      await this.invalidatePropertyReadCaches(id);

      this.logger.log(`Property restored: ${id}`);
      return restoredProperty;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to restore property ${id}`, error);
      throw new InvalidInputException(undefined, 'Failed to restore property');
    }
  }

  // Get soft deleted properties for admin purposes
  async getSoftDeleted(): Promise<any[]> {
    try {
      return await (this.prisma as any).property.findMany({
        where: { isDeleted: true },
        include: {
          owner: {
            select: { id: true, email: true, role: true },
          },
        },
        orderBy: { deletedAt: 'desc' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch soft deleted properties', error);
      throw new InvalidInputException(undefined, 'Failed to fetch soft deleted properties');
    }
  }

  async searchNearby(latitude: number, longitude: number, _radiusKm: number = 10, query?: PropertyQueryDto) {
    try {
      const where: Record<string, any> = {
        location: { contains: '', mode: 'insensitive' },
      };

      if (query?.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      if (query?.type) {
        where.propertyType = query.type;
      }
      if (query?.status) {
        where.status = this.mapPropertyStatus(query.status);
      }
      if (query?.minPrice !== undefined || query?.maxPrice !== undefined) {
        where.price = {};
        if (query.minPrice !== undefined) {
          where.price.gte = query.minPrice;
        }
        if (query.maxPrice !== undefined) {
          where.price.lte = query.maxPrice;
        }
      }
      if (query?.minBedrooms !== undefined || query?.maxBedrooms !== undefined) {
        where.bedrooms = {};
        if (query.minBedrooms !== undefined) {
          where.bedrooms.gte = query.minBedrooms;
        }
        if (query.maxBedrooms !== undefined) {
          where.bedrooms.lte = query.maxBedrooms;
        }
      }
      if (query?.minBathrooms !== undefined || query?.maxBathrooms !== undefined) {
        where.bathrooms = {};
        if (query.minBathrooms !== undefined) {
          where.bathrooms.gte = query.minBathrooms;
        }
        if (query.maxBathrooms !== undefined) {
          where.bathrooms.lte = query.maxBathrooms;
        }
      }
      if (query?.minArea !== undefined || query?.maxArea !== undefined) {
        where.squareFootage = {};
        if (query.minArea !== undefined) {
          where.squareFootage.gte = query.minArea;
        }
        if (query.maxArea !== undefined) {
          where.squareFootage.lte = query.maxArea;
        }
      }

      const cacheKey = this.buildPropertyNearbyCacheKey(latitude, longitude, _radiusKm, query);

      return await this.cacheService.wrap(
        cacheKey,
        async () =>
          this.monitorQuery('properties.searchNearby', { cacheKey }, async () => {
            const properties = await (this.prisma as any).property.findMany({
              where,
              relationLoadStrategy: 'join',
              include: {
                owner: { select: { id: true, email: true, role: true } },
              },
            });

            return { properties, total: properties.length };
          }),
        { l1Ttl: 60, l2Ttl: 180, tags: ['property', 'property:nearby'] },
      );
    } catch (error) {
      this.logger.error('Failed to search nearby properties', error);
      throw new InvalidInputException(undefined, 'Failed to search nearby properties');
    }
  }

  async updateStatus(id: string, newStatus: DTOPropertyStatus, userId?: string) {
    try {
      const property = await (this.prisma as any).property.findUnique({
        where: { id },
      });

      if (!property) {
        throw new NotFoundException(`Property with ID ${id} not found`);
      }

      const currentStatus = property.status;
      const targetStatus = this.mapPropertyStatus(newStatus);

      if (!this.isValidStatusTransition(property.status, targetStatus)) {
        throw new BusinessRuleViolationException(`Invalid status transition from ${currentStatus} to ${targetStatus}`);
      }

      const updatedProperty = await (this.prisma as any).property.update({
        where: { id },
        data: { status: targetStatus },
        relationLoadStrategy: 'join',
        include: {
          owner: { select: { id: true, email: true, role: true } },
        },
      });

      await this.invalidatePropertyReadCaches(id);

      this.logger.log(
        `Property status updated: ${id} from ${currentStatus} to ${targetStatus}${userId ? ` by user ${userId}` : ''}`,
      );

      return updatedProperty;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BusinessRuleViolationException) {
        throw error;
      }
      this.logger.error(`Failed to update property status ${id}`, error);
      throw new InvalidInputException(undefined, 'Failed to update property status');
    }
  }

  async findByOwner(ownerId: string, query?: PropertyQueryDto) {
    try {
      const ownerQuery = { ...query, ownerId };
      const result = await this.findAll(ownerQuery);
      return { properties: result.properties, total: result.total };
    } catch (error) {
      this.logger.error(`Failed to fetch properties for owner ${ownerId}`, error);
      throw new InvalidInputException(undefined, 'Failed to fetch owner properties');
    }
  }

  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    averagePrice: number;
  }> {
    const cacheKey = 'property:stats';

    try {
      return await this.cacheService.wrap(
        cacheKey,
        async () =>
          this.monitorQuery('properties.getStatistics', { cacheKey }, async () => {
            const [total, avgPrice, statusResult, typeResult] = await Promise.all([
              (this.prisma as any).property.count(),
              (this.prisma as any).property.aggregate({ _avg: { price: true } }),
              (this.prisma as any).property.groupBy({
                by: ['status'],
                _count: { id: true },
              }),
              (this.prisma as any).property.groupBy({
                by: ['propertyType'],
                _count: { id: true },
              }),
            ]);

            const byStatus = (statusResult || []).reduce(
              (acc: Record<string, number>, item: { status: string; _count: { id: number } | number }) => {
                acc[item.status] = typeof item._count === 'number' ? item._count : item._count.id;
                return acc;
              },
              {} as Record<string, number>,
            );

            const byType = (typeResult || []).reduce(
              (acc: Record<string, number>, item: { propertyType: string; _count: { id: number } | number }) => {
                acc[item.propertyType] = typeof item._count === 'number' ? item._count : item._count.id;
                return acc;
              },
              {} as Record<string, number>,
            );

            return { total, byStatus, byType, averagePrice: Number(avgPrice._avg.price || 0) };
          }),
        { l1Ttl: 120, l2Ttl: 600, tags: ['property', 'property:stats'] },
      );
    } catch (error) {
      this.logger.error('Failed to fetch property statistics', error);
      throw new InvalidInputException(undefined, 'Failed to fetch property statistics');
    }
  }

  private formatAddress(address: any): string {
    const parts = [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean);
    return parts.join(', ');
  }

  private mapPropertyStatus(status: DTOPropertyStatus): string {
    const statusMap: Record<DTOPropertyStatus, string> = {
      [DTOPropertyStatus.AVAILABLE]: 'LISTED',
      [DTOPropertyStatus.PENDING]: 'PENDING',
      [DTOPropertyStatus.SOLD]: 'SOLD',
      [DTOPropertyStatus.RENTED]: 'SOLD',
    };
    return statusMap[status] || 'DRAFT';
  }

  private isValidStatusTransition(currentStatus: string, targetStatus: string): boolean {
    const validTransitions: Record<string, string[]> = {
      DRAFT: ['DRAFT', 'PENDING', 'APPROVED'],
      PENDING: ['PENDING', 'APPROVED', 'DRAFT'],
      APPROVED: ['APPROVED', 'LISTED', 'DRAFT'],
      LISTED: ['LISTED', 'SOLD', 'REMOVED'],
      SOLD: ['SOLD'],
      REMOVED: ['REMOVED', 'DRAFT'],
    };
    return validTransitions[currentStatus]?.includes(targetStatus) || false;
  }

  private async monitorQuery<T>(
    operation: string,
    metadata: Record<string, unknown>,
    query: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();

    try {
      const result = await query();
      const duration = Date.now() - startedAt;
      const slowThreshold = this.configService.get<number>('SLOW_QUERY_THRESHOLD', 500);

      if (duration >= slowThreshold) {
        this.logger.warn(`Slow query detected for ${operation}: ${duration}ms ${JSON.stringify(metadata)}`);
      } else {
        this.logger.debug(`Query completed for ${operation}: ${duration}ms`);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;
      this.logger.error(`Query failed for ${operation} after ${duration}ms`, error instanceof Error ? error.stack : '');
      throw error;
    }
  }

  private buildPropertyListCacheKey(query?: PropertyQueryDto): string {
    return `property:list:${this.serializeCacheInput(query || {})}`;
  }

  private buildPropertyNearbyCacheKey(
    latitude: number,
    longitude: number,
    radiusKm: number,
    query?: PropertyQueryDto,
  ): string {
    return `property:nearby:${latitude}:${longitude}:${radiusKm}:${this.serializeCacheInput(query || {})}`;
  }

  private serializeCacheInput(input: PropertyQueryDto | Record<string, unknown>): string {
    return Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
      .join('|');
  }

  private async invalidatePropertyReadCaches(propertyId?: string): Promise<void> {
    const invalidations: Promise<unknown>[] = [
      this.cacheService.invalidateByPattern('property:list:*'),
      this.cacheService.invalidateByPattern('property:nearby:*'),
      this.cacheService.del('property:stats'),
    ];

    if (propertyId) {
      invalidations.push(this.cacheService.del(`property:detail:${propertyId}`));
    }


    await Promise.all(invalidations);
  }

  // --- Admin Moderation (#261) ---

  async approve(id: string, userId: string) {
    return this.updateStatus(id, DTOPropertyStatus.AVAILABLE, userId);
  }

  async reject(id: string, reason: string, userId: string) {
    try {
      const property = await (this.prisma as any).property.findUnique({ where: { id } });
      if (!property) throw new NotFoundException(`Property with ID ${id} not found`);

      const updatedProperty = await (this.prisma as any).property.update({
        where: { id },
        data: {
          status: 'REMOVED',
          rejectionReason: reason,
        },
        include: { owner: true },
      });

      await this.invalidatePropertyReadCaches(id);
      this.logger.log(`Property rejected: ${id} by admin ${userId}. Reason: ${reason}`);
      return updatedProperty;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to reject property ${id}`, error);
      throw new InvalidInputException(undefined, 'Failed to reject property');
    }
  }

  // --- Listing Report System (#262) ---

  async reportProperty(propertyId: string, reporterId: string, data: { reason: string; details?: string }) {
    try {
      const property = await (this.prisma as any).property.findUnique({ where: { id: propertyId } });
      if (!property) throw new NotFoundException(`Property with ID ${propertyId} not found`);

      const report = await (this.prisma as any).propertyReport.create({
        data: {
          propertyId,
          reporterId,
          reason: data.reason,
          details: data.details,
        },
      });

      this.logger.log(`Property reported: ${propertyId} by user ${reporterId}`);
      return report;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to report property', error);
      throw new InvalidInputException(undefined, 'Failed to report property');
    }
  }

  async getReports(query?: { status?: string; propertyId?: string }) {
    try {
      return await (this.prisma as any).propertyReport.findMany({
        where: {
          ...(query?.status && { status: query.status }),
          ...(query?.propertyId && { propertyId: query.propertyId }),
        },
        include: {
          property: { select: { id: true, title: true } },
          reporter: { select: { id: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch reports', error);
      throw new InvalidInputException(undefined, 'Failed to fetch reports');
    }
  }

  // --- Listing Versioning System (#263) ---

  private async savePropertyVersion(propertyId: string, data: any, reason?: string) {
    try {
      const latestVersion = await (this.prisma as any).propertyVersion.findFirst({
        where: { propertyId },
        orderBy: { versionNumber: 'desc' },
      });

      const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;

      // Extract only data fields to avoid saving relations or metadata
      const cleanData = JSON.parse(JSON.stringify(data));
      delete cleanData.id;
      delete cleanData.owner;
      delete cleanData.createdAt;
      delete cleanData.updatedAt;

      await (this.prisma as any).propertyVersion.create({
        data: {
          propertyId,
          versionNumber: nextVersionNumber,
          data: cleanData,
          changedById: data.ownerId, // For now assuming owner changed it
          changeReason: reason,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to save version for property ${propertyId}`, error);
      // We don't want to throw here if versioning fails, to allow update to proceed
    }
  }

  async getVersions(propertyId: string) {
    try {
      return await (this.prisma as any).propertyVersion.findMany({
        where: { propertyId },
        orderBy: { versionNumber: 'desc' },
      });
    } catch (error) {
      this.logger.error(`Failed to fetch versions for property ${propertyId}`, error);
      throw new InvalidInputException(undefined, 'Failed to fetch property versions');
    }
  }

  // --- Listing Availability Scheduling (#264) ---

  async createAvailabilitySlots(propertyId: string, slots: { startTime: Date; endTime: Date }[]) {
    try {
      const property = await (this.prisma as any).property.findUnique({ where: { id: propertyId } });
      if (!property) throw new NotFoundException(`Property with ID ${propertyId} not found`);

      const createdSlots = await (this.prisma as any).availabilitySlot.createMany({
        data: slots.map(slot => ({
          propertyId,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      });

      return createdSlots;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to create availability slots for property ${propertyId}`, error);
      throw new InvalidInputException(undefined, 'Failed to create availability slots');
    }
  }

  async getAvailability(propertyId: string) {
    try {
      return await (this.prisma as any).availabilitySlot.findMany({
        where: {
          propertyId,
          startTime: { gte: new Date() },
        },
        orderBy: { startTime: 'asc' },
      });
    } catch (error) {
      this.logger.error(`Failed to fetch availability for property ${propertyId}`, error);
      throw new InvalidInputException(undefined, 'Failed to fetch availability');
    }
  }

  async reserveSlot(slotId: string, userId: string) {
    try {
      const slot = await (this.prisma as any).availabilitySlot.findUnique({ where: { id: slotId } });
      if (!slot) throw new NotFoundException(`Slot with ID ${slotId} not found`);
      if (slot.isReserved) throw new BusinessRuleViolationException('Slot is already reserved');

      const updatedSlot = await (this.prisma as any).availabilitySlot.update({
        where: { id: slotId },
        data: {
          isReserved: true,
          reservedById: userId,
        },
      });

      return updatedSlot;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BusinessRuleViolationException) throw error;
      this.logger.error(`Failed to reserve slot ${slotId}`, error);
      throw new InvalidInputException(undefined, 'Failed to reserve slot');
    }
  }
}
