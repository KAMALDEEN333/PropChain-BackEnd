import { RateLimitMiddleware } from '../../src/security/middleware/rate-limit.middleware';
import { RateLimitingService } from '../../src/security/services/rate-limiting.service';
import { IpBlockingService } from '../../src/security/services/ip-blocking.service';

describe('RateLimitMiddleware', () => {
  let middleware: RateLimitMiddleware;
  let rateLimitingService: jest.Mocked<RateLimitingService>;
  let ipBlockingService: jest.Mocked<IpBlockingService>;

  beforeEach(() => {
    rateLimitingService = {
      getEndpointConfiguration: jest.fn().mockReturnValue({
        windowMs: 60000,
        maxRequests: 10,
        burstAllowance: 2,
        keyPrefix: 'auth_rate_limit',
        scope: 'auth',
      }),
      checkRateLimit: jest.fn(),
      getWhitelistedIpsFromConfig: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<RateLimitingService>;

    ipBlockingService = {
      isIpWhitelisted: jest.fn(),
    } as unknown as jest.Mocked<IpBlockingService>;

    middleware = new RateLimitMiddleware(rateLimitingService, ipBlockingService);
  });

  it('skips rate limiting for whitelisted IPs', async () => {
    const next = jest.fn();
    const req = {
      method: 'GET',
      path: '/auth/login',
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;

    ipBlockingService.isIpWhitelisted.mockResolvedValue(true);

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(rateLimitingService.checkRateLimit).not.toHaveBeenCalled();
  });

  it('tracks both user and IP identities when user is authenticated', async () => {
    const next = jest.fn();
    const req = {
      method: 'POST',
      path: '/properties',
      headers: {},
      ip: '127.0.0.1',
      user: { id: 'user-123' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    ipBlockingService.isIpWhitelisted.mockResolvedValue(false);
    rateLimitingService.checkRateLimit.mockResolvedValue({
      allowed: true,
      info: {
        remaining: 5,
        resetTime: Date.now() + 60000,
        limit: 12,
        window: 60000,
        retryAfterSeconds: 0,
        scope: 'write',
      },
    });
    rateLimitingService.getEndpointConfiguration.mockReturnValue({
      windowMs: 60000,
      maxRequests: 10,
      burstAllowance: 2,
      keyPrefix: 'write_rate_limit',
      scope: 'write',
    });

    await middleware.use(req, res, next);

    expect(rateLimitingService.checkRateLimit).toHaveBeenCalledTimes(2);
    expect(rateLimitingService.checkRateLimit).toHaveBeenNthCalledWith(
      1,
      'user:user-123',
      expect.objectContaining({ keyPrefix: 'write_rate_limit:user' }),
    );
    expect(rateLimitingService.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      'ip:127.0.0.1',
      expect.objectContaining({ keyPrefix: 'write_rate_limit:ip' }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('returns 429 with rate limit headers when any identity exceeds the limit', async () => {
    const next = jest.fn();
    const req = {
      method: 'POST',
      path: '/auth/login',
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as any;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    ipBlockingService.isIpWhitelisted.mockResolvedValue(false);
    rateLimitingService.checkRateLimit.mockResolvedValue({
      allowed: false,
      info: {
        remaining: 0,
        resetTime: Date.now() + 60000,
        limit: 6,
        window: 60000,
        retryAfterSeconds: 60,
        scope: 'auth',
      },
    });

    await middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 6);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        retryAfter: 60,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
