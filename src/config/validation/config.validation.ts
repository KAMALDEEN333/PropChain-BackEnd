import * as Joi from 'joi';

/**
 * Custom validation for CORS origins
 * - '*' is only allowed in development/test environments
 * - Production/staging must use specific domains
 */
const corsOriginValidation = (value: string, helpers: Joi.CustomHelpers) => {
  const nodeEnv = Joi.ref('$NODE_ENV');

  // If no value provided, error
  if (!value || value.trim() === '') {
    return helpers.error('cors.origin.required');
  }

  // Allow '*' only in development and test
  if (value === '*') {
    const env = helpers.prefs?.context?.NODE_ENV || 'development';
    if (env !== 'development' && env !== 'test') {
      return helpers.error('cors.origin.wildcard.notAllowed');
    }
    return value;
  }

  // Validate individual origins (comma-separated)
  const origins = value.split(',').map(o => o.trim());
  const urlPattern = /^https?:\/\/[\w.-]+(:\d+)?(\/.*)?$/;

  for (const origin of origins) {
    if (origin === '*') {
      return helpers.error('cors.origin.wildcard.notAllowed');
    }

    // Allow 'http://localhost' and 'http://localhost:*' variants
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      const env = helpers.prefs?.context?.NODE_ENV || 'development';
      if (env !== 'development' && env !== 'test') {
        return helpers.error('cors.origin.localhost.notAllowed');
      }
      continue;
    }

    // Validate URL format
    if (!urlPattern.test(origin)) {
      return helpers.error('cors.origin.invalidFormat', { origin });
    }
  }

  return value;
};

/**
 * Joi validation schema for application configuration
 */
export const configValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test', 'staging').default('development'),
  PORT: Joi.number().default(3000),
  HOST: Joi.string().default('0.0.0.0'),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGIN: Joi.string().custom(corsOriginValidation).default('*').messages({
    'cors.origin.required': 'CORS_ORIGIN is required',
    'cors.origin.wildcard.notAllowed':
      'Wildcard (*) origin is not allowed in production/staging. Specify explicit allowed origins.',
    'cors.origin.localhost.notAllowed': 'Localhost origins are not allowed in production/staging',
    'cors.origin.invalidFormat': 'Invalid origin format: "{{origin}}". Must be a valid URL (e.g., https://example.com)',
  }),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  API_VERSIONING_ENABLED: Joi.boolean().default(true),

  // Database
  DATABASE_URL: Joi.string().uri().required(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_DB: Joi.number().default(0),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // API Keys
  API_KEY: Joi.string().optional(),
  ENCRYPTION_KEY: Joi.string().length(32).required(), // 32 characters for AES-256

  // Blockchain/Web3
  BLOCKCHAIN_NETWORK: Joi.string().default('sepolia'),
  RPC_URL: Joi.string().uri().required(),
  PRIVATE_KEY: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .required(), // Ethereum private key format
  ETHERSCAN_API_KEY: Joi.string().optional(),
  WEB3_STORAGE_TOKEN: Joi.string().optional(),
  ETH_RPC: Joi.string().uri().optional(),
  POLYGON_RPC: Joi.string().uri().optional(),
  BSC_RPC: Joi.string().uri().optional(),

  // IPFS
  IPFS_GATEWAY_URL: Joi.string().uri().default('https://ipfs.io/ipfs/'),
  IPFS_API_URL: Joi.string().uri().default('https://ipfs.infura.io:5001'),
  IPFS_PROJECT_ID: Joi.string().optional(),
  IPFS_PROJECT_SECRET: Joi.string().optional(),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(10),
  API_KEY_RATE_LIMIT_PER_MINUTE: Joi.number().default(60),
  RATE_LIMIT_ENABLED: Joi.boolean().default(true),

  // Advanced Rate Limiting
  RATE_LIMIT_API_PER_MINUTE: Joi.number().default(100),
  RATE_LIMIT_AUTH_PER_MINUTE: Joi.number().default(5),
  RATE_LIMIT_ADMIN_PER_MINUTE: Joi.number().default(30),
  RATE_LIMIT_READ_PER_MINUTE: Joi.number().default(120),
  RATE_LIMIT_WRITE_PER_MINUTE: Joi.number().default(60),
  RATE_LIMIT_EXPENSIVE_PER_MINUTE: Joi.number().default(10),
  RATE_LIMIT_USER_PER_HOUR: Joi.number().default(1000),
  RATE_LIMIT_API_BURST: Joi.number().default(20),
  RATE_LIMIT_AUTH_BURST: Joi.number().default(1),
  RATE_LIMIT_ADMIN_BURST: Joi.number().default(5),
  RATE_LIMIT_READ_BURST: Joi.number().default(30),
  RATE_LIMIT_WRITE_BURST: Joi.number().default(10),
  RATE_LIMIT_EXPENSIVE_BURST: Joi.number().default(2),
  RATE_LIMIT_USER_BURST: Joi.number().default(100),
  RATE_LIMIT_WHITELIST_IPS: Joi.string().allow('').default(''),

  // IP Blocking
  MAX_FAILED_ATTEMPTS: Joi.number().default(5),
  FAILED_ATTEMPT_WINDOW_MS: Joi.number().default(900000), // 15 minutes
  AUTO_BLOCK_DURATION_MS: Joi.number().default(3600000), // 1 hour

  // DDoS Protection
  DDOS_THRESHOLD_PER_MINUTE: Joi.number().default(100),
  DDOS_MITIGATION_ACTION: Joi.string().valid('block_ip', 'rate_limit', 'challenge').default('block_ip'),
  DDOS_BLOCK_DURATION_MS: Joi.number().default(3600000), // 1 hour
  DDOS_ATTACK_RETENTION_HOURS: Joi.number().default(168), // 1 week

  // Security Headers
  SECURITY_HEADERS_ENABLED: Joi.boolean().default(true),
  CSP_REPORT_URI: Joi.string().uri().optional(),
  HSTS_MAX_AGE: Joi.number().default(31536000), // 1 year
  HSTS_INCLUDE_SUBDOMAINS: Joi.boolean().default(true),
  HSTS_PRELOAD: Joi.boolean().default(true),

  // File Upload
  MAX_FILE_SIZE: Joi.number().default(10 * 1024 * 1024), // 10MB
  ALLOWED_FILE_TYPES: Joi.string().default('image/jpeg,image/png,image/webp,application/pdf'),

  // Email
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  EMAIL_FROM: Joi.string().email().default('noreply@propchain.io'),

  // Monitoring
  SENTRY_DSN: Joi.string().uri().optional(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').default('info'),
  LOG_ERROR_RETENTION_DAYS: Joi.string().default('30d'),
  LOG_APP_RETENTION_DAYS: Joi.string().default('14d'),

  // External Services
  COINGECKO_API_KEY: Joi.string().optional(),
  OPENSEA_API_KEY: Joi.string().optional(),

  // Smart Contracts
  PROPERTY_NFT_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .optional(), // Ethereum address format
  ESCROW_CONTRACT_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  GOVERNANCE_CONTRACT_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // Security
  BCRYPT_ROUNDS: Joi.number().min(10).max(15).default(12),
  SESSION_SECRET: Joi.string().min(32).required(),

  // Development
  MOCK_BLOCKCHAIN: Joi.boolean().default(false),
  ENABLE_SEED_DATA: Joi.boolean().default(false),

  // Storage Configuration
  STORAGE_PROVIDER: Joi.string().valid('s3', 'memory').default('s3'),
  STORAGE_SIGNED_URL_EXPIRES_IN: Joi.number().default(900),
  STORAGE_SIGNING_SECRET: Joi.string().min(16).default('local-storage-signing-secret'),
  THUMBNAIL_WIDTH: Joi.number().default(320),
  THUMBNAIL_HEIGHT: Joi.number().default(320),
  THUMBNAIL_FORMAT: Joi.string().valid('jpeg', 'png', 'webp').default('webp'),
  THUMBNAIL_QUALITY: Joi.number().min(1).max(100).default(80),
  MOCK_STORAGE_BASE_URL: Joi.string().uri().default('http://localhost/mock-storage'),

  // S3 Configuration
  S3_BUCKET: Joi.string().default('propchain-documents'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: Joi.string().optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  S3_ENDPOINT: Joi.string().uri().optional(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(false),

  // Valuation Configuration
  ZILLOW_API_KEY: Joi.string().optional(),
  ZILLOW_BASE_URL: Joi.string().uri().default('https://api.zillow.com/v1'),
  REDFIN_API_KEY: Joi.string().optional(),
  REDFIN_BASE_URL: Joi.string().uri().default('https://api.redfin.com/v1'),
  CORE_LOGIC_API_KEY: Joi.string().optional(),
  CORE_LOGIC_BASE_URL: Joi.string().uri().default('https://api.corelogic.com/v1'),
  MAXMIND_LICENSE_KEY: Joi.string().optional(),
  MAXMIND_API_URL: Joi.string().uri().default('https://geolite.maxmind.com/geoip/v2.1'),
  VALUATION_CONFIDENCE_THRESHOLD: Joi.number().min(0).max(1).default(0.7),
  VALUATION_CACHE_TTL: Joi.number().default(86400), // 24 hours
  VALUATION_MAX_RETRIES: Joi.number().default(3),
  VALUATION_TIMEOUT: Joi.number().default(10000), // 10 seconds
  MARKET_TRENDS_API_ENDPOINT: Joi.string().uri().optional(),
  MARKET_TRENDS_API_KEY: Joi.string().optional(),
  MARKET_TRENDS_UPDATE_FREQ: Joi.number().default(3600), // 1 hour
  VALUATION_RATE_LIMIT_PER_MINUTE: Joi.number().default(10),
  VALUATION_RATE_LIMIT_PER_HOUR: Joi.number().default(100),
  LOCATION_WEIGHT: Joi.number().min(0).max(1).default(0.3),
  SIZE_WEIGHT: Joi.number().min(0).max(1).default(0.25),
  AGE_WEIGHT: Joi.number().min(0).max(1).default(0.15),
  AMENITIES_WEIGHT: Joi.number().min(0).max(1).default(0.2),
  MARKET_CONDITIONS_WEIGHT: Joi.number().min(0).max(1).default(0.1),

  // Compression Configuration
  COMPRESSION_ENABLED: Joi.boolean().default(true),
  COMPRESSION_LEVEL: Joi.number().min(1).max(9).default(6),
  COMPRESSION_THRESHOLD: Joi.number().min(0).default(1024), // 1KB
  COMPRESSION_CONTENT_TYPES: Joi.string().default(
    'text/,application/json,application/javascript,application/xml,application/rss+xml,application/x-javascript,image/svg+xml,font/,application/wasm'
  ),

  // Health Checks
  HEALTH_CHECK_URL_TEMPLATE: Joi.string().default('http://{{region}}-api.propchain.local/health'),
  LOCAL_HEALTH_CHECK_URL: Joi.string().uri().default('http://localhost:3000/health'),

  // Stellar Configuration
  STELLAR_NETWORK: Joi.string().valid('public', 'testnet').default('testnet'),
  STELLAR_SECRET_KEY: Joi.string().optional(), // Encrypted platform secret key
  STELLAR_BASE_FEE: Joi.number().default(100), // Base fee in stroops
  STELLAR_TIMEOUT: Joi.number().default(30000), // Transaction timeout in ms
});
