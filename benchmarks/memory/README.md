# Memory Profiling Benchmarks

This directory contains in-process middleware memory profiling tools for leak detection.

## What It Captures

- Heap snapshot before the stress run
- Heap snapshot after the stress run
- Summary JSON with RSS, heap, and external memory deltas
- 10k request stress runs by default

## Available Scenarios

- `baseline`: terminal handler only
- `header-validation`: logging + header validation
- `circuit-breaker`: circuit breaker middleware
- `combined`: logging + header validation + circuit breaker

## Usage

```bash
npm run bench:memory
npm run bench:memory -- --scenario=header-validation
npm run bench:memory -- --scenario=circuit-breaker --requests=10000 --concurrency=50
```

## Output

Each run writes to `benchmarks/memory/output/<scenario>-<timestamp>/`:

- `before.heapsnapshot`
- `after.heapsnapshot`
- `summary.json`

Open the `.heapsnapshot` files in Chrome DevTools or Node heap analysis tooling to inspect retained objects.

## Current Cleanup Targets

- `StaticCacheMiddleware`: response monkey-patching and cache metadata retention risk
- `CircuitBreakerMiddleware`: response-end wrapping and long-lived breaker state
- `TimeoutMiddleware`: per-request timer lifecycle and rejection paths
- `HeaderValidationMiddleware`: sanitized header attachment on every request
