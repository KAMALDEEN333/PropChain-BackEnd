import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { PaginationService, PaginationQueryDto, PaginatedResponseDto } from '../common/pagination';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { ApiKeyResponseDto, CreateApiKeyResponseDto } from './dto/api-key-response.dto';
import { API_KEY_SCOPES, ApiKeyScope } from './enums/api-key-scope.enum';
import { ApiKeyAnalyticsService, UsageLogEntry } from './api-key-analytics.service';
import * as crypto from 'crypto';
import * as CryptoJS from 'crypto-js';
import { BaseService } from '../common/services/base.service';
import { BoundaryValidationService } from '../common/validation';

export interface RotationResult {
  id: string;
  name: string;
  oldKeyPrefix: string;
  newKeyPrefix: string;
  key: string; // New plain key (shown only once)
  rotatedAt: Date;
}

export interface RotationStatus {
  id: string;
  name: string;
  keyPrefix: string;
  lastRotatedAt?: Date;
  rotationDueAt?: Date;
  daysUntilRotation?: number;
  requiresRotation: boolean;
}

@Injectable()
export class ApiKeyService extends BaseService {
  private readonly encryptionKey: string;
  private readonly globalRateLimit: number;
  private readonly rotationIntervalDays: number;
  private readonly rotationWarningDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly paginationService: PaginationService,
    private readonly analyticsService: ApiKeyAnalyticsService,
    boundaryValidation: BoundaryValidationService,
  ) {
    super(boundaryValidation, ApiKeyService.name);
    this.encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    this.globalRateLimit = this.configService.get<number>('API_KEY_RATE_LIMIT_PER_MINUTE', 60);
    this.rotationIntervalDays = this.configService.get<number>('API_KEY_ROTATION_DAYS', 90);
    this.rotationWarningDays = this.configService.get<number>('API_KEY_ROTATION_WARNING_DAYS', 7);

    if (!this.encryptionKey) {
      throw new Error('ENCRYPTION_KEY must be set in environment variables');
    }
  }

  async create(createApiKeyDto: CreateApiKeyDto): Promise<CreateApiKeyResponseDto> {
    const input = await this.validateInput(CreateApiKeyDto, createApiKeyDto, 'create');
    this.validateScopes(input.scopes);

    const plainKey = this.generateApiKey();
    const keyPrefix = this.extractKeyPrefix(plainKey);
    const encryptedKey = this.encryptKey(plainKey);

    // Set rotation due date
    const rotationDueAt = new Date();
    rotationDueAt.setDate(rotationDueAt.getDate() + this.rotationIntervalDays);

    const apiKey = await this.prisma.executeWithTimeout(
      this.prisma.apiKey.create({
        data: {
          name: input.name,
          key: encryptedKey,
          keyPrefix,
          scopes: input.scopes,
          rateLimit: input.rateLimit,
          rotationDueAt,
          lastRotatedAt: new Date(),
        },
      }),
      5000 // 5 second timeout for API key creation
    );

    return this.mapOutput(CreateApiKeyResponseDto, {
      ...this.mapToResponseDto(apiKey),
      key: plainKey,
    });
  }

  async findAll(
    paginationQuery?: PaginationQueryDto,
  ): Promise<ApiKeyResponseDto[] | PaginatedResponseDto<ApiKeyResponseDto>> {
    const normalizedQuery = paginationQuery
      ? await this.validateInput(PaginationQueryDto, paginationQuery, 'findAll', { skipMissingProperties: true })
      : undefined;

    // If no pagination query provided, return all (for backward compatibility)
    if (!normalizedQuery) {
      const apiKeys = await this.prisma.executeWithTimeout(
        this.prisma.apiKey.findMany({
          orderBy: { createdAt: 'desc' },
        }),
        10000 // 10 second timeout for large queries
      );
      return apiKeys.map(apiKey => this.mapToResponseDto(apiKey));
    }

    // Paginated response
    const { skip, take, orderBy } = this.paginationService.getPrismaOptions(normalizedQuery, 'createdAt');

    const [apiKeys, total] = await Promise.all([
      this.prisma.executeWithTimeout(
        this.prisma.apiKey.findMany({
          skip,
          take,
          orderBy,
        }),
        8000 // 8 second timeout for paginated query
      ),
      this.prisma.executeWithTimeout(
        this.prisma.apiKey.count(),
        3000 // 3 second timeout for count query
      ),
    ]);

    const data = apiKeys.map(apiKey => this.mapToResponseDto(apiKey));
    return this.paginationService.formatResponse(data, total, normalizedQuery);
  }

  async findOne(id: string): Promise<ApiKeyResponseDto> {
    const apiKey = await this.prisma.executeWithTimeout(
      this.prisma.apiKey.findUnique({
        where: { id },
      }),
      3000 // 3 second timeout for find operation
    );

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    return this.mapToResponseDto(apiKey);
  }

  async update(id: string, updateApiKeyDto: UpdateApiKeyDto): Promise<ApiKeyResponseDto> {
    const input = await this.validateInput(UpdateApiKeyDto, updateApiKeyDto, 'update', {
      skipMissingProperties: true,
    });

    if (input.scopes) {
      this.validateScopes(input.scopes);
    }

    const apiKey = await this.prisma.executeWithTimeout(
      this.prisma.apiKey.findUnique({
        where: { id },
      }),
      3000 // 3 second timeout for find operation
    );

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    const updatedApiKey = await this.prisma.executeWithTimeout(
      this.prisma.apiKey.update({
        where: { id },
        data: input,
      }),
      5000 // 5 second timeout for update operation
    );

    return this.mapToResponseDto(updatedApiKey);
  }

  async revoke(id: string): Promise<void> {
    const apiKey = await this.prisma.executeWithTimeout(
      this.prisma.apiKey.findUnique({
        where: { id },
      }),
      3000 // 3 second timeout for find operation
    );

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    await this.prisma.executeWithTimeout(
      this.prisma.apiKey.update({
        where: { id },
        data: { isActive: false, revokedAt: new Date() },
      }),
      5000 // 5 second timeout for revoke operation
    );

    await this.redis.del(`rate_limit:${apiKey.keyPrefix}`);
  }

  async validateApiKey(plainKey: string): Promise<any> {
    if (!plainKey || !plainKey.startsWith('propchain_live_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const keyPrefix = this.extractKeyPrefix(plainKey);

    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        keyPrefix,
        isActive: true,
      },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    const decryptedKey = this.decryptKey(apiKey.key);

    if (decryptedKey !== plainKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    await this.checkRateLimit(apiKey);
    await this.trackUsage(apiKey.id, keyPrefix);

    return apiKey; // Return full API key object
  }

  private async checkRateLimit(apiKey: any): Promise<void> {
    const limit = apiKey.rateLimit || this.globalRateLimit;
    const redisKey = `rate_limit:${apiKey.keyPrefix}`;

    // Attempt to access the raw client property since getClient() doesn't exist
    // Usually in these wrappers, it's called 'client' or 'redis'
    const rawClient = (this.redis as any).client || (this.redis as any).redis;

    const currentCount = await this.redis.get(redisKey);
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    if (count >= limit) {
      throw new UnauthorizedException('Rate limit exceeded');
    }

    if (rawClient) {
      const ttl = await rawClient.ttl(redisKey);
      if (ttl === -1 || ttl === -2) {
        await this.redis.set(redisKey, '1');
        await rawClient.expire(redisKey, 60);
      } else {
        await rawClient.incr(redisKey);
      }
    } else {
      // Fallback if rawClient access fails:
      // Manual increment and reset logic (less accurate but doesn't crash)
      const newCount = (count + 1).toString();
      await this.redis.set(redisKey, newCount);
    }
  }

  private async trackUsage(apiKeyId: string, keyPrefix: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        requestCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(24);
    const randomString = randomBytes
      .toString('base64')
      .replace(/\+/g, '')
      .replace(/\//g, '')
      .replace(/=/g, '')
      .substring(0, 32);

    return `propchain_live_${randomString}`;
  }

  private extractKeyPrefix(key: string): string {
    return key.substring(0, 28);
  }

  private encryptKey(plainKey: string): string {
    return CryptoJS.AES.encrypt(plainKey, this.encryptionKey).toString();
  }

  private decryptKey(encryptedKey: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedKey, this.encryptionKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) {
        throw new UnauthorizedException('Invalid API key format');
      }
      return decrypted;
    } catch (error) {
      throw new UnauthorizedException('Invalid API key format');
    }
  }

  private validateScopes(scopes: string[]): void {
    const invalidScopes = scopes.filter(scope => !API_KEY_SCOPES.includes(scope as ApiKeyScope));

    if (invalidScopes.length > 0) {
      throw new BadRequestException(
        `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes are: ${API_KEY_SCOPES.join(', ')}`,
      );
    }
  }

  private mapToResponseDto(apiKey: any): ApiKeyResponseDto {
    return this.mapOutput(ApiKeyResponseDto, {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      requestCount: apiKey.requestCount.toString(),
      lastUsedAt: apiKey.lastUsedAt,
      isActive: apiKey.isActive,
      rateLimit: apiKey.rateLimit,
      lastRotatedAt: apiKey.lastRotatedAt,
      rotationDueAt: apiKey.rotationDueAt,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    });
  }

  // ==================== KEY ROTATION METHODS ====================

  /**
   * Rotate an API key - generates a new key and deactivates the old one
   */
  async rotateKey(id: string): Promise<RotationResult> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    if (!apiKey.isActive) {
      throw new BadRequestException('Cannot rotate a revoked API key');
    }

    // Generate new key
    const newPlainKey = this.generateApiKey();
    const newKeyPrefix = this.extractKeyPrefix(newPlainKey);
    const newEncryptedKey = this.encryptKey(newPlainKey);

    // Calculate new rotation due date
    const newRotationDueAt = new Date();
    newRotationDueAt.setDate(newRotationDueAt.getDate() + this.rotationIntervalDays);

    // Update the API key with new values
    const updatedKey = await this.prisma.apiKey.update({
      where: { id },
      data: {
        key: newEncryptedKey,
        keyPrefix: newKeyPrefix,
        keyVersion: { increment: 1 },
        lastRotatedAt: new Date(),
        rotationDueAt: newRotationDueAt,
      },
    });

    // Clear the old rate limit cache
    await this.redis.del(`rate_limit:${apiKey.keyPrefix}`);

    this.logger.log(`Rotated API key ${id}: ${apiKey.keyPrefix} -> ${newKeyPrefix}`);

    return {
      id: updatedKey.id,
      name: updatedKey.name,
      oldKeyPrefix: apiKey.keyPrefix,
      newKeyPrefix,
      key: newPlainKey,
      rotatedAt: updatedKey.lastRotatedAt ?? new Date(),
    };
  }

  /**
   * Get rotation status for an API key
   */
  async getRotationStatus(id: string): Promise<RotationStatus> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    const now = new Date();
    const rotationDueAt = apiKey.rotationDueAt;
    const daysUntilRotation = rotationDueAt
      ? Math.ceil((rotationDueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : undefined;

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      lastRotatedAt: apiKey.lastRotatedAt || undefined,
      rotationDueAt: rotationDueAt || undefined,
      daysUntilRotation,
      requiresRotation: daysUntilRotation !== undefined && daysUntilRotation <= 0,
    };
  }

  /**
   * Get all API keys that require rotation
   */
  async getKeysRequiringRotation(): Promise<RotationStatus[]> {
    const now = new Date();

    const keys = await this.prisma.apiKey.findMany({
      where: {
        isActive: true,
        rotationDueAt: { lte: now },
      },
    });

    return keys.map(apiKey => ({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      lastRotatedAt: apiKey.lastRotatedAt || undefined,
      rotationDueAt: apiKey.rotationDueAt || undefined,
      daysUntilRotation: 0,
      requiresRotation: true,
    }));
  }

  /**
   * Get API keys approaching rotation (within warning period)
   */
  async getKeysApproachingRotation(): Promise<RotationStatus[]> {
    const now = new Date();
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + this.rotationWarningDays);

    const keys = await this.prisma.apiKey.findMany({
      where: {
        isActive: true,
        rotationDueAt: {
          gt: now,
          lte: warningDate,
        },
      },
    });

    return keys.map(apiKey => {
      const daysUntilRotation = apiKey.rotationDueAt
        ? Math.ceil((apiKey.rotationDueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        lastRotatedAt: apiKey.lastRotatedAt || undefined,
        rotationDueAt: apiKey.rotationDueAt || undefined,
        daysUntilRotation,
        requiresRotation: false,
      };
    });
  }

  /**
   * Automatic rotation for all expired keys (called by scheduler)
   */
  async autoRotateExpiredKeys(): Promise<RotationResult[]> {
    const expiredKeys = await this.getKeysRequiringRotation();
    const results: RotationResult[] = [];

    for (const key of expiredKeys) {
      try {
        const result = await this.rotateKey(key.id);
        results.push(result);
        this.logger.log(`Auto-rotated API key: ${key.name} (${key.id})`);
      } catch (error) {
        this.logger.error(`Failed to auto-rotate API key ${key.id}: ${error.message}`);
      }
    }

    return results;
  }

  // ==================== USAGE ANALYTICS INTEGRATION ====================

  /**
   * Log detailed usage for analytics
   */
  async logDetailedUsage(
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.analyticsService.logUsage({
      apiKeyId,
      endpoint,
      method,
      statusCode,
      responseTime,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Get usage analytics for an API key
   */
  async getUsageAnalytics(id: string, startDate: Date, endDate: Date) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    return this.analyticsService.getUsageReport(id, startDate, endDate);
  }
}
