import { SetMetadata } from '@nestjs/common';
import { SensitiveRateLimitOptions } from '../guards/sensitive-endpoint-rate-limit.guard';

export const SensitiveRateLimit = (options?: SensitiveRateLimitOptions) =>
  SetMetadata('sensitiveRateLimitOptions', options || {});
