import { Histogram } from 'prom-client';

export const payloadSizeHistogram = new Histogram({
  name: 'http_request_payload_bytes',
  help: 'Size of incoming request payloads',
  buckets: [1024, 10 * 1024, 100 * 1024, 1024 * 1024, 10 * 1024 * 1024],
});
