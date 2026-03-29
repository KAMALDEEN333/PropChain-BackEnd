import { NestMiddleware } from '@nestjs/common';
import { LoggingMiddleware } from '../../src/common/logging/logging.middleware';
import { HeaderValidationMiddleware } from '../../src/security/middleware/header-validation.middleware';
import {
  CircuitBreakerMiddleware,
  CircuitBreakerService,
} from '../../src/middleware/advanced/circuit-breaker.middleware';

export interface MemoryProfileScenario {
  name: string;
  description: string;
  middleware: NestMiddleware[];
  leakRiskNotes: string[];
}

export const MEMORY_PROFILE_SCENARIOS: Record<string, MemoryProfileScenario> = {
  baseline: {
    name: 'baseline',
    description: 'No middleware, only the terminal request handler',
    middleware: [],
    leakRiskNotes: ['Use this as the control profile for snapshot diffs.'],
  },
  'header-validation': {
    name: 'header-validation',
    description: 'Logging middleware plus header validation',
    middleware: [new LoggingMiddleware(), new HeaderValidationMiddleware()],
    leakRiskNotes: [
      'Confirms header sanitization does not retain per-request header objects.',
      'Verifies correlation-id context does not leak across requests.',
    ],
  },
  'circuit-breaker': {
    name: 'circuit-breaker',
    description: 'Circuit breaker middleware with in-memory state tracking',
    middleware: [
      new CircuitBreakerMiddleware(
        new CircuitBreakerService({
          failureThreshold: 5,
          retryInterval: 1000,
          paths: ['/'],
        }),
      ),
    ],
    leakRiskNotes: [
      'Tracks whether response.end wrapping leaves lingering closures.',
      'Confirms circuit state counters remain bounded under sustained traffic.',
    ],
  },
  combined: {
    name: 'combined',
    description: 'Logging, header validation, and circuit breaker together',
    middleware: [
      new LoggingMiddleware(),
      new HeaderValidationMiddleware(),
      new CircuitBreakerMiddleware(
        new CircuitBreakerService({
          failureThreshold: 5,
          retryInterval: 1000,
          paths: ['/'],
        }),
      ),
    ],
    leakRiskNotes: [
      'Approximates a realistic middleware chain for cumulative retention analysis.',
      'Useful for spotting interaction leaks between request wrapping and response mutation.',
    ],
  },
};

export function getScenario(name: string): MemoryProfileScenario {
  return MEMORY_PROFILE_SCENARIOS[name] || MEMORY_PROFILE_SCENARIOS.combined;
}
