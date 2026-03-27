import { json, urlencoded } from 'express';

export function payloadLimitMiddleware(configService) {
  const maxJsonSize = configService.get('MAX_JSON_SIZE', '1mb'); // configurable
  const maxFormSize = configService.get('MAX_FORM_SIZE', '1mb');

  return [
    json({ limit: maxJsonSize }),
    urlencoded({ limit: maxFormSize, extended: true }),
  ];
}
