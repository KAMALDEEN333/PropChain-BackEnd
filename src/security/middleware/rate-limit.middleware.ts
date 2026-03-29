import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { IpBlockingService } from '../services/ip-blocking.service';
import { RateLimitConfig, RateLimitInfo, RateLimitingService } from '../services/rate-limiting.service';

type RateLimitIdentity = {
  key: string;
  type: 'ip' | 'user';
};

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(
    private readonly rateLimitingService: RateLimitingService,
    private readonly ipBlockingService: IpBlockingService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.isEnabled()) {
      next();
      return;
    }

    if (req.method.toUpperCase() === 'OPTIONS') {
      next();
      return;
    }

    try {
      const ip = this.getClientIp(req);

      if (await this.isWhitelisted(ip)) {
        next();
        return;
      }

      const config = this.rateLimitingService.getEndpointConfiguration(req.path, req.method);
      const identities = this.getTrackedIdentities(req, ip);
      const results = await Promise.all(
        identities.map(identity =>
          this.rateLimitingService.checkRateLimit(
            `${identity.type}:${identity.key}`,
            this.buildScopedConfig(config, identity.type),
          ),
        ),
      );

      const selectedInfo = this.selectHeaderInfo(results.map(result => result.info));
      this.setRateLimitHeaders(res, selectedInfo);

      const deniedIndex = results.findIndex(result => !result.allowed);
      if (deniedIndex >= 0) {
        const deniedIdentity = identities[deniedIndex];
        const retryAfter = results[deniedIndex].info.retryAfterSeconds || 1;

        this.logger.warn(
          `Rate limit exceeded for ${deniedIdentity.type}:${deniedIdentity.key} on ${req.method} ${req.path}`,
        );

        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please try again later.',
          error: 'Too Many Requests',
          retryAfter,
        });
        return;
      }

      next();
    } catch (error) {
      this.logger.error('Distributed rate limit middleware failed', error instanceof Error ? error.stack : undefined);
      next();
    }
  }

  private isEnabled(): boolean {
    return process.env.RATE_LIMIT_ENABLED !== 'false';
  }

  private buildScopedConfig(config: RateLimitConfig, identityType: 'ip' | 'user'): RateLimitConfig {
    return {
      ...config,
      keyPrefix: `${config.keyPrefix || 'rate_limit'}:${identityType}`,
    };
  }

  private getTrackedIdentities(request: Request, ip: string): RateLimitIdentity[] {
    const identities: RateLimitIdentity[] = [{ key: ip, type: 'ip' }];
    const userId = (request as any).user?.id;

    if (userId) {
      identities.unshift({ key: String(userId), type: 'user' });
    }

    return identities;
  }

  private getClientIp(request: Request): string {
    return (
      request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      request.headers['x-real-ip']?.toString() ||
      request.ip ||
      request.socket?.remoteAddress ||
      request.connection?.remoteAddress ||
      'unknown'
    );
  }

  private async isWhitelisted(ip: string): Promise<boolean> {
    const configuredIps = this.rateLimitingService.getWhitelistedIpsFromConfig();
    if (configuredIps.includes(ip)) {
      return true;
    }

    return this.ipBlockingService.isIpWhitelisted(ip);
  }

  private selectHeaderInfo(infos: RateLimitInfo[]): RateLimitInfo {
    return infos.reduce((selected, current) => {
      if (!selected) {
        return current;
      }

      if (current.remaining < selected.remaining) {
        return current;
      }

      if (current.remaining === selected.remaining && current.limit < selected.limit) {
        return current;
      }

      return selected;
    });
  }

  private setRateLimitHeaders(response: Response, info: RateLimitInfo): void {
    response.setHeader('X-RateLimit-Limit', info.limit);
    response.setHeader('X-RateLimit-Remaining', info.remaining);
    response.setHeader('X-RateLimit-Reset', Math.floor(info.resetTime / 1000));
    response.setHeader('X-RateLimit-Window', info.window);
    response.setHeader('Retry-After', info.retryAfterSeconds || Math.max(1, Math.ceil(info.window / 1000)));

    if (info.scope) {
      response.setHeader('X-RateLimit-Scope', info.scope);
    }

    if (info.tier) {
      response.setHeader('X-RateLimit-Tier', info.tier);
    }
  }
}
