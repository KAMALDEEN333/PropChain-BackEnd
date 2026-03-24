# Rate Limiting Implementation for Sensitive Endpoints

## Overview

This document describes the implementation of enhanced rate limiting for sensitive authentication endpoints in the PropChain backend. The implementation addresses security issue #92 by adding stricter rate limits, IP-based blocking, and progressive delay mechanisms to prevent brute-force attacks and abuse.

## Features Implemented

### 1. Sensitive Endpoint Rate Limit Guard

A new guard (`SensitiveEndpointRateLimitGuard`) has been created specifically for protecting sensitive endpoints with enhanced security features:

- **Stricter rate limits** compared to standard API endpoints
- **Progressive delay mechanism** that increases delay time with repeated violations
- **IP-based blocking** after exceeding rate limits
- **Automatic IP blocking** with configurable duration
- **Whitelist support** to bypass rate limiting for trusted IPs
- **Comprehensive rate limit headers** in responses

**Location:** `src/security/guards/sensitive-endpoint-rate-limit.guard.ts`

### 2. Enhanced Rate Limiting on Authentication Endpoints

#### Password Reset Endpoints

**POST /auth/forgot-password**
- Rate limit: 3 requests per 15 minutes
- Progressive delay enabled
- IP blocking after exceeding limit (30 minutes block)
- Key prefix: `password_reset`

**PUT /auth/reset-password**
- Rate limit: 5 requests per 15 minutes
- Progressive delay enabled
- IP blocking after exceeding limit (1 hour block)
- Key prefix: `password_reset_confirm`

#### Token Refresh Endpoint

**POST /auth/refresh-token**
- Rate limit: 10 requests per minute
- No progressive delay (to avoid impacting legitimate use)
- No automatic IP blocking
- Key prefix: `token_refresh`

### 3. Enhanced Rate Limiting on MFA Endpoints

**POST /mfa/verify**
- Rate limit: 5 attempts per 5 minutes
- Progressive delay enabled
- IP blocking after exceeding limit (30 minutes block)
- Key prefix: `mfa_verify`

**POST /mfa/verify-backup**
- Rate limit: 10 attempts per 5 minutes
- Progressive delay enabled
- IP blocking after exceeding limit (1 hour block)
- Key prefix: `mfa_backup_verify`

**POST /mfa/backup-codes**
- Rate limit: 3 requests per hour
- No progressive delay
- No automatic IP blocking
- Key prefix: `mfa_backup_gen`

**DELETE /mfa/disable**
- Rate limit: 3 requests per hour
- No progressive delay
- No automatic IP blocking
- Key prefix: `mfa_disable`

## Technical Implementation

### Rate Limiting Strategy

The implementation uses a **sliding window algorithm** with Redis for distributed rate limiting:

1. Each request is tracked with a timestamp in a Redis sorted set
2. Expired entries are automatically removed before checking limits
3. Current count is compared against the configured maximum
4. Rate limit information is returned in response headers

### Progressive Delay Mechanism

When enabled, the progressive delay mechanism:

1. Calculates excess attempts beyond the rate limit
2. Applies a delay of `attempts * 1000ms` (capped at 10 seconds)
3. Forces attackers to slow down their attempts
4. Does not impact legitimate users within limits

### IP Blocking Integration

The guard integrates with the existing `IpBlockingService`:

1. Checks if IP is blocked before processing request
2. Checks if IP is whitelisted (bypasses all rate limiting)
3. Records failed attempts for tracking
4. Automatically blocks IPs when `blockOnExceed` is enabled
5. Configurable block duration per endpoint

### Rate Limit Headers

All rate-limited responses include the following headers:

- `X-RateLimit-Limit`: Maximum requests allowed in the window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when the limit resets
- `Retry-After`: Seconds to wait before retrying (when blocked)

## Configuration

### Decorator Usage

Apply rate limiting to any endpoint using the `@SensitiveRateLimit` decorator:

```typescript
@Post('sensitive-operation')
@UseGuards(SensitiveEndpointRateLimitGuard)
@SensitiveRateLimit({
  windowMs: 300000,           // 5 minutes
  maxRequests: 5,             // 5 requests max
  keyPrefix: 'custom_prefix', // Redis key prefix
  enableProgressiveDelay: true,
  blockOnExceed: true,
  blockDurationMs: 1800000,   // 30 minutes block
})
async sensitiveOperation() {
  // Your implementation
}
```

### Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `windowMs` | number | Time window in milliseconds | 60000 (1 min) |
| `maxRequests` | number | Maximum requests in window | 5 |
| `keyPrefix` | string | Redis key prefix | 'sensitive' |
| `enableProgressiveDelay` | boolean | Enable progressive delays | true |
| `blockOnExceed` | boolean | Block IP after exceeding | false |
| `blockDurationMs` | number | Block duration in ms | 3600000 (1 hour) |

## Rate Limit Key Generation

The guard generates rate limit keys in the following priority order:

1. **User ID** (if authenticated): `user:{userId}`
2. **Email** (from request body): `email:{email}`
3. **IP Address** (fallback): `ip:{ipAddress}`

This ensures:
- Authenticated users are tracked by user ID
- Password reset/registration tracked by email
- Anonymous requests tracked by IP

## IP Address Extraction

The guard extracts client IP addresses from:

1. `x-forwarded-for` header (first IP in chain)
2. `x-real-ip` header
3. `connection.remoteAddress`
4. `socket.remoteAddress`

This ensures correct IP detection behind proxies and load balancers.

## Security Considerations

### Fail-Open Design

The guard is designed to fail open (allow requests) when:
- Redis connection fails
- Rate limiting service throws an error
- IP blocking service is unavailable

This prevents security features from causing service outages while logging errors for investigation.

### Protection Against Enumeration

Password reset endpoints return generic messages regardless of whether the email exists, preventing user enumeration attacks.

### Distributed Rate Limiting

Using Redis ensures rate limits work correctly across multiple application instances in a distributed deployment.

## Testing

### Unit Tests

Comprehensive unit tests cover:
- Rate limit enforcement
- IP blocking integration
- Whitelist functionality
- Progressive delay mechanism
- Header generation
- Key generation strategies
- Fail-open behavior

**Location:** `test/security/guards/sensitive-endpoint-rate-limit.guard.spec.ts`

### Integration Tests

End-to-end tests verify:
- Password reset rate limiting
- MFA endpoint rate limiting
- Token refresh rate limiting
- Rate limit header accuracy
- IP-based tracking
- Rate limit reset behavior

**Location:** `test/auth/sensitive-endpoints-rate-limit.e2e-spec.ts`

## Monitoring and Logging

All rate limit violations are logged with:
- Severity: WARN
- IP address
- Rate limit key
- Endpoint path
- Timestamp

IP blocking events are logged with:
- Severity: WARN
- IP address
- Reason for blocking
- Block duration
- Timestamp

## Migration Notes

### Backward Compatibility

The implementation is fully backward compatible:
- Existing endpoints continue to work
- No database migrations required
- No breaking API changes
- Existing rate limiting infrastructure is reused

### Deployment Considerations

1. Ensure Redis is available and configured
2. Review and adjust rate limit thresholds for your use case
3. Configure IP whitelisting for trusted sources
4. Monitor rate limit logs after deployment
5. Adjust block durations based on attack patterns

## Performance Impact

- **Minimal overhead**: Single Redis query per request
- **Efficient storage**: Automatic cleanup of expired entries
- **Scalable**: Distributed across Redis cluster
- **Non-blocking**: Async operations throughout

## Future Enhancements

Potential improvements for future iterations:

1. **Adaptive rate limiting** based on user reputation
2. **Geographic IP blocking** for high-risk regions
3. **CAPTCHA integration** after multiple violations
4. **Machine learning** for anomaly detection
5. **Rate limit analytics dashboard**
6. **Customizable response messages** per endpoint
7. **Account-level rate limit overrides** for premium users

## Related Files

- Guard: `src/security/guards/sensitive-endpoint-rate-limit.guard.ts`
- Decorator: `src/security/decorators/sensitive-rate-limit.decorator.ts`
- Auth Controller: `src/auth/auth.controller.ts`
- MFA Controller: `src/auth/mfa/mfa.controller.ts`
- Security Module: `src/security/security.module.ts`
- Unit Tests: `test/security/guards/sensitive-endpoint-rate-limit.guard.spec.ts`
- E2E Tests: `test/auth/sensitive-endpoints-rate-limit.e2e-spec.ts`

## Support

For issues or questions regarding rate limiting:
1. Check logs for rate limit violations
2. Review Redis connection status
3. Verify IP whitelist configuration
4. Consult security team for threshold adjustments
