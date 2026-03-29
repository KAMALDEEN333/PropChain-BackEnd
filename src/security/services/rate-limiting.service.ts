import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';

export enum UserTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests allowed in window
  keyPrefix?: string; // Redis key prefix
  tier?: UserTier; // User tier for tiered rate limiting
  burstAllowance?: number; // Additional burst capacity beyond the base limit
  scope?: string; // Endpoint scope for headers/analytics
}

export interface RateLimitInfo {
  remaining: number;
  resetTime: number;
  limit: number;
  window: number;
  tier?: UserTier;
  retryAfterSeconds?: number;
  scope?: string;
}

export type EndpointRateLimitTier = 'auth' | 'admin' | 'read' | 'write' | 'api';

export interface RateLimitAnalytics {
  totalRequests: number;
  blockedRequests: number;
  topUsers: Array<{ userId: string; requests: number }>;
  tierDistribution: Record<UserTier, number>;
  windowStart: number;
  windowEnd: number;
}

export interface TieredRateLimits {
  [UserTier.FREE]: { windowMs: number; maxRequests: number };
  [UserTier.BASIC]: { windowMs: number; maxRequests: number };
  [UserTier.PREMIUM]: { windowMs: number; maxRequests: number };
  [UserTier.ENTERPRISE]: { windowMs: number; maxRequests: number };
}

@Injectable()
export class RateLimitingService {
  private readonly logger = new Logger(RateLimitingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Check if a request is within rate limits
   * @param key Unique identifier (IP, user ID, API key)
   * @param config Rate limit configuration
   * @returns Rate limit info and whether request is allowed
   */
  async checkRateLimit(key: string, config: RateLimitConfig): Promise<{ allowed: boolean; info: RateLimitInfo }> {
    try {
      const finalConfig = this.applyTieredLimits(config);
      const effectiveLimit = finalConfig.maxRequests + (finalConfig.burstAllowance || 0);
      const redisKey = `${finalConfig.keyPrefix || 'rate_limit'}:${key}`;
      const currentTime = Date.now();
      const windowStart = currentTime - finalConfig.windowMs;

      // Remove expired entries
      await this.redisService.getRedisInstance().zremrangebyscore(redisKey, 0, windowStart);

      // Get current count
      const currentCount = await this.redisService.getRedisInstance().zcard(redisKey);

      // Check if limit exceeded
      const allowed = currentCount < effectiveLimit;

      // Add current request timestamp if allowed
      if (allowed) {
        await this.redisService.getRedisInstance().zadd(redisKey, currentTime, currentTime.toString());
        // Set expiration to clean up old data
        await this.redisService.expire(redisKey, Math.ceil(finalConfig.windowMs / 1000) + 60);
        
        // Track analytics
        await this.trackAnalytics(key, finalConfig, false);
      } else {
        // Track blocked request
        await this.trackAnalytics(key, finalConfig, true);
      }

      const info: RateLimitInfo = {
        remaining: Math.max(0, effectiveLimit - currentCount - (allowed ? 1 : 0)),
        resetTime: currentTime + finalConfig.windowMs,
        limit: effectiveLimit,
        window: finalConfig.windowMs,
        tier: finalConfig.tier,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(finalConfig.windowMs / 1000)),
        scope: finalConfig.scope,
      };

      return { allowed, info };
    } catch (error) {
      this.logger.error(`Rate limit check failed for key ${key}:`, error);
      // Fail open - allow request if Redis is unavailable
      return {
        allowed: true,
        info: {
          remaining: config.maxRequests,
          resetTime: Date.now() + config.windowMs,
          limit: config.maxRequests + (config.burstAllowance || 0),
          window: config.windowMs,
          tier: config.tier,
          retryAfterSeconds: 0,
          scope: config.scope,
        },
      };
    }
  }

  /**
   * Apply tiered rate limits based on user tier
   */
  private applyTieredLimits(config: RateLimitConfig): RateLimitConfig {
    if (!config.tier) {
      return config;
    }

    const tieredLimits = this.getTieredLimits();
    const tierConfig = tieredLimits[config.tier];
    
    return {
      ...config,
      windowMs: tierConfig.windowMs,
      maxRequests: tierConfig.maxRequests,
    };
  }

  /**
   * Track rate limit analytics
   */
  private async trackAnalytics(key: string, config: RateLimitConfig, blocked: boolean): Promise<void> {
    try {
      const analyticsKey = `rate_limit_analytics:${Date.now()}`;
      const analyticsData = {
        key,
        tier: config.tier || UserTier.FREE,
        blocked,
        timestamp: Date.now(),
        window: config.windowMs,
        limit: config.maxRequests,
      };
      
      await this.redisService.getRedisInstance().hset(analyticsKey, analyticsData);
      await this.redisService.expire(analyticsKey, 3600); // Keep for 1 hour
    } catch (error) {
      this.logger.error('Failed to track analytics:', error);
    }
  }

  /**
   * Get rate limit information without consuming a request
   */
  async getRateLimitInfo(key: string, config: RateLimitConfig): Promise<RateLimitInfo> {
    try {
      const finalConfig = this.applyTieredLimits(config);
      const redisKey = `${finalConfig.keyPrefix || 'rate_limit'}:${key}`;
      const currentTime = Date.now();
      const windowStart = currentTime - finalConfig.windowMs;

      // Remove expired entries
      await this.redisService.getRedisInstance().zremrangebyscore(redisKey, 0, windowStart);

      // Get current count
      const currentCount = await this.redisService.getRedisInstance().zcard(redisKey);

      return {
        remaining: Math.max(0, finalConfig.maxRequests + (finalConfig.burstAllowance || 0) - currentCount),
        resetTime: currentTime + finalConfig.windowMs,
        limit: finalConfig.maxRequests + (finalConfig.burstAllowance || 0),
        window: finalConfig.windowMs,
        tier: finalConfig.tier,
        retryAfterSeconds: Math.max(0, Math.ceil(finalConfig.windowMs / 1000)),
        scope: finalConfig.scope,
      };
    } catch (error) {
      this.logger.error(`Failed to get rate limit info for key ${key}:`, error);
      return {
        remaining: config.maxRequests,
        resetTime: Date.now() + config.windowMs,
        limit: config.maxRequests + (config.burstAllowance || 0),
        window: config.windowMs,
        tier: config.tier,
        retryAfterSeconds: 0,
        scope: config.scope,
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async resetRateLimit(key: string, prefix?: string): Promise<void> {
    try {
      const redisKey = `${prefix || 'rate_limit'}:${key}`;
      await this.redisService.del(redisKey);
      this.logger.log(`Rate limit reset for key: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to reset rate limit for key ${key}:`, error);
    }
  }

  /**
   * Get default configurations for different use cases
   */
  getDefaultConfigurations() {
    return {
      // Standard API rate limiting
      api: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_API_PER_MINUTE', 100),
        keyPrefix: 'api_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_API_BURST', 20),
        scope: 'api',
      },
      // Auth endpoints (stricter)
      auth: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_AUTH_PER_MINUTE', 5),
        keyPrefix: 'auth_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_AUTH_BURST', 1),
        scope: 'auth',
      },
      // Admin endpoints (strict but usable)
      admin: {
        windowMs: 60000,
        maxRequests: this.configService.get<number>('RATE_LIMIT_ADMIN_PER_MINUTE', 30),
        keyPrefix: 'admin_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_ADMIN_BURST', 5),
        scope: 'admin',
      },
      // Read-heavy endpoints
      read: {
        windowMs: 60000,
        maxRequests: this.configService.get<number>('RATE_LIMIT_READ_PER_MINUTE', 120),
        keyPrefix: 'read_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_READ_BURST', 30),
        scope: 'read',
      },
      // Mutating endpoints
      write: {
        windowMs: 60000,
        maxRequests: this.configService.get<number>('RATE_LIMIT_WRITE_PER_MINUTE', 60),
        keyPrefix: 'write_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_WRITE_BURST', 10),
        scope: 'write',
      },
      // Expensive operations (very strict)
      expensive: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_EXPENSIVE_PER_MINUTE', 10),
        keyPrefix: 'expensive_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_EXPENSIVE_BURST', 2),
        scope: 'expensive',
      },
      // User-based rate limiting
      user: {
        windowMs: 3600000, // 1 hour
        maxRequests: this.configService.get<number>('RATE_LIMIT_USER_PER_HOUR', 1000),
        keyPrefix: 'user_rate_limit',
        burstAllowance: this.configService.get<number>('RATE_LIMIT_USER_BURST', 100),
        scope: 'user',
      },
    };
  }

  getEndpointConfiguration(path: string, method: string): RateLimitConfig {
    const normalizedPath = path.toLowerCase();
    const normalizedMethod = method.toUpperCase();
    const defaults = this.getDefaultConfigurations();

    if (normalizedPath.includes('/auth')) {
      return defaults.auth;
    }

    if (
      normalizedPath.includes('/admin') ||
      normalizedPath.includes('/security') ||
      normalizedPath.includes('/audit')
    ) {
      return defaults.admin;
    }

    if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) {
      return defaults.read;
    }

    return defaults.write;
  }

  getWhitelistedIpsFromConfig(): string[] {
    const value = this.configService.get<string>('RATE_LIMIT_WHITELIST_IPS', '');
    return value
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean);
  }

  /**
   * Get tiered rate limits for different user tiers
   */
  getTieredLimits(): TieredRateLimits {
    return {
      [UserTier.FREE]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_FREE_PER_MINUTE', 10),
      },
      [UserTier.BASIC]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_BASIC_PER_MINUTE', 50),
      },
      [UserTier.PREMIUM]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_PREMIUM_PER_MINUTE', 200),
      },
      [UserTier.ENTERPRISE]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_ENTERPRISE_PER_MINUTE', 1000),
      },
    };
  }

  /**
   * Get rate limit analytics for a time window
   */
  async getRateLimitAnalytics(windowMs: number = 3600000): Promise<RateLimitAnalytics> {
    try {
      const currentTime = Date.now();
      const windowStart = currentTime - windowMs;
      
      // Get all analytics keys in the window
      const keys = await this.redisService.getRedisInstance().keys('rate_limit_analytics:*');
      
      let totalRequests = 0;
      let blockedRequests = 0;
      const userRequests = new Map<string, number>();
      const tierCounts: Record<UserTier, number> = {
        [UserTier.FREE]: 0,
        [UserTier.BASIC]: 0,
        [UserTier.PREMIUM]: 0,
        [UserTier.ENTERPRISE]: 0,
      };

      for (const key of keys) {
        const data = await this.redisService.getRedisInstance().hgetall(key);
        if (data.timestamp && parseInt(data.timestamp) >= windowStart) {
          totalRequests++;
          if (data.blocked === 'true') {
            blockedRequests++;
          }
          
          // Track user requests
          const userKey = data.key;
          userRequests.set(userKey, (userRequests.get(userKey) || 0) + 1);
          
          // Track tier distribution
          const tier = data.tier as UserTier;
          if (tierCounts[tier] !== undefined) {
            tierCounts[tier]++;
          }
        }
      }

      // Get top users
      const topUsers = Array.from(userRequests.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([userId, requests]) => ({ userId, requests }));

      return {
        totalRequests,
        blockedRequests,
        topUsers,
        tierDistribution: tierCounts,
        windowStart,
        windowEnd: currentTime,
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit analytics:', error);
      return {
        totalRequests: 0,
        blockedRequests: 0,
        topUsers: [],
        tierDistribution: {
          [UserTier.FREE]: 0,
          [UserTier.BASIC]: 0,
          [UserTier.PREMIUM]: 0,
          [UserTier.ENTERPRISE]: 0,
        },
        windowStart: Date.now() - windowMs,
        windowEnd: Date.now(),
      };
    }
  }

  /**
   * Get user tier from user ID (this would typically integrate with a user service)
   */
  async getUserTier(userId: string): Promise<UserTier> {
    try {
      // In a real implementation, this would query the database or user service
      // For now, we'll use Redis to store user tiers
      const tier = await this.redisService.getRedisInstance().get(`user_tier:${userId}`);
      return tier as UserTier || UserTier.FREE;
    } catch (error) {
      this.logger.error(`Failed to get user tier for ${userId}:`, error);
      return UserTier.FREE;
    }
  }

  /**
   * Set user tier
   */
  async setUserTier(userId: string, tier: UserTier): Promise<void> {
    try {
      await this.redisService.getRedisInstance().set(`user_tier:${userId}`, tier);
      this.logger.log(`Set user tier for ${userId} to ${tier}`);
    } catch (error) {
      this.logger.error(`Failed to set user tier for ${userId}:`, error);
    }
  }
}
