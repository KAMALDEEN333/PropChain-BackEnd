#!/usr/bin/env ts-node

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { writeHeapSnapshot } from './heap-snapshot';
import { getScenario, MEMORY_PROFILE_SCENARIOS } from './scenarios';

interface MemoryProfileArgs {
  scenario: string;
  requests: number;
  concurrency: number;
  outputDir: string;
}

interface MemorySnapshotSummary {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
}

function parseArgs(): MemoryProfileArgs {
  const args = process.argv.slice(2);
  const config: MemoryProfileArgs = {
    scenario: 'combined',
    requests: 10000,
    concurrency: 50,
    outputDir: 'benchmarks/memory/output',
  };

  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key === '--scenario' && value) config.scenario = value;
    if (key === '--requests' && value) config.requests = parseInt(value, 10);
    if (key === '--concurrency' && value) config.concurrency = parseInt(value, 10);
    if (key === '--output-dir' && value) config.outputDir = value;
  }

  return config;
}

function toMemorySummary(): MemorySnapshotSummary {
  const usage = process.memoryUsage();

  return {
    rssMb: Number((usage.rss / 1024 / 1024).toFixed(2)),
    heapTotalMb: Number((usage.heapTotal / 1024 / 1024).toFixed(2)),
    heapUsedMb: Number((usage.heapUsed / 1024 / 1024).toFixed(2)),
    externalMb: Number((usage.external / 1024 / 1024).toFixed(2)),
  };
}

function addExpressLikeHelpers(req: IncomingMessage, res: ServerResponse): void {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
  (req as IncomingMessage & { path?: string; body?: Record<string, never> }).path = parsedUrl.pathname;
  (req as IncomingMessage & { body?: Record<string, never> }).body = {};

  const responseWithHelpers = res as ServerResponse & {
    status: (code: number) => ServerResponse;
    json: (payload: unknown) => ServerResponse;
  };

  responseWithHelpers.status = function status(code: number) {
    this.statusCode = code;
    return this;
  };

  responseWithHelpers.json = function json(payload: unknown) {
    this.setHeader('content-type', 'application/json');
    this.end(JSON.stringify(payload));
    return this;
  };
}

async function runScenarioRequests(baseUrl: string, requests: number, concurrency: number): Promise<void> {
  let completed = 0;

  const worker = async () => {
    while (completed < requests) {
      completed += 1;
      const requestNumber = completed;
      if (requestNumber > requests) {
        return;
      }

      const response = await fetch(`${baseUrl}/profile`, {
        headers: {
          'x-profile-request': String(requestNumber),
          'x-profile-scenario': 'memory',
        },
      });

      if (!response.ok) {
        throw new Error(`Unexpected response status ${response.status}`);
      }

      await response.arrayBuffer();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function executeMiddlewareChain(
  req: IncomingMessage,
  res: ServerResponse,
  middleware: Array<{ use: (req: any, res: any, next: (error?: unknown) => void) => void | Promise<void> }>,
): Promise<void> {
  let index = 0;

  const runNext = async (): Promise<void> => {
    if (res.writableEnded) {
      return;
    }

    const current = middleware[index];
    index += 1;

    if (!current) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    await new Promise<void>((resolve, reject) => {
      try {
        const maybePromise = current.use(req as any, res as any, (error?: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });

        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          (maybePromise as Promise<void>).then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });

    if (!res.writableEnded) {
      await runNext();
    }
  };

  await runNext();
}

async function main() {
  const args = parseArgs();
  const scenario = getScenario(args.scenario);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(args.outputDir, `${scenario.name}-${timestamp}`);

  await mkdir(outputDir, { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      addExpressLikeHelpers(req, res);
      await executeMiddlewareChain(req, res, scenario.middleware as any);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    global.gc?.();
    const before = toMemorySummary();
    await writeHeapSnapshot(join(outputDir, 'before.heapsnapshot'));

    await runScenarioRequests(baseUrl, args.requests, args.concurrency);

    global.gc?.();
    const after = toMemorySummary();
    await writeHeapSnapshot(join(outputDir, 'after.heapsnapshot'));

    const summary = {
      scenario: scenario.name,
      description: scenario.description,
      requests: args.requests,
      concurrency: args.concurrency,
      outputDir,
      before,
      after,
      delta: {
        rssMb: Number((after.rssMb - before.rssMb).toFixed(2)),
        heapTotalMb: Number((after.heapTotalMb - before.heapTotalMb).toFixed(2)),
        heapUsedMb: Number((after.heapUsedMb - before.heapUsedMb).toFixed(2)),
        externalMb: Number((after.externalMb - before.externalMb).toFixed(2)),
      },
      leakRiskNotes: scenario.leakRiskNotes,
    };

    await writeFile(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

    console.log('Memory profiling completed');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

main().catch(error => {
  console.error('Memory profiling failed', error);
  process.exit(1);
});
