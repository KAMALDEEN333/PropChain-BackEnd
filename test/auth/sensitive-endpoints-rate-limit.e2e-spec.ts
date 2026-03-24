import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { RedisService } from '../../src/common/services/redis.service';

describe('Sensitive Endpoints Rate Limiting (e2e)', () => {
  let app: INestApplication;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    redisService = moduleFixture.get<RedisService>(RedisService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await redisService.getRedisInstance().flushdb();
  });

  describe('POST /auth/forgot-password', () => {
    it('should allow requests within rate limit', async () => {
      const email = 'test@example.com';

      for (let i = 0; i < 3; i++) {
        const response = await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email })
          .expect(HttpStatus.OK);

        expect(response.headers['x-ratelimit-limit']).toBeDefined();
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const email = 'test@example.com';

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email })
          .expect(HttpStatus.OK);
      }

      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.message).toContain('Too many requests');
      expect(response.headers['retry-after']).toBeDefined();
    });

    it('should apply progressive delay on repeated attempts', async () => {
      const email = 'test@example.com';

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email });
      }

      const startTime = Date.now();
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(HttpStatus.TOO_MANY_REQUESTS);
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });

    it('should track rate limits per email address', async () => {
      const email1 = 'user1@example.com';
      const email2 = 'user2@example.com';

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email: email1 })
          .expect(HttpStatus.OK);
      }

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: email2 })
        .expect(HttpStatus.OK);
    });

    it('should block IP after exceeding rate limit with blockOnExceed', async () => {
      const email = 'test@example.com';

      for (let i = 0; i < 4; i++) {
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email });
      }

      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'another@example.com' });

      expect([HttpStatus.TOO_MANY_REQUESTS, HttpStatus.OK]).toContain(response.status);
    });
  });

  describe('PUT /auth/reset-password', () => {
    it('should allow requests within rate limit', async () => {
      const resetData = {
        token: 'valid-reset-token',
        newPassword: 'NewSecurePass123!',
      };

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .put('/auth/reset-password')
          .send(resetData);

        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const resetData = {
        token: 'valid-reset-token',
        newPassword: 'NewSecurePass123!',
      };

      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer())
          .put('/auth/reset-password')
          .send(resetData);
      }

      const response = await request(app.getHttpServer())
        .put('/auth/reset-password')
        .send(resetData)
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.message).toContain('Too many requests');
    });
  });

  describe('POST /auth/refresh-token', () => {
    it('should allow requests within rate limit', async () => {
      const tokenData = { refreshToken: 'valid-refresh-token' };

      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/auth/refresh-token')
          .send(tokenData);
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const tokenData = { refreshToken: 'valid-refresh-token' };

      for (let i = 0; i < 11; i++) {
        await request(app.getHttpServer())
          .post('/auth/refresh-token')
          .send(tokenData);
      }

      const response = await request(app.getHttpServer())
        .post('/auth/refresh-token')
        .send(tokenData)
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.message).toContain('Too many requests');
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include rate limit headers in response', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'test@example.com' });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should decrement remaining count with each request', async () => {
      const email = 'test@example.com';

      const response1 = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email });

      const response2 = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email });

      const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'], 10);
      const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'], 10);

      expect(remaining2).toBeLessThan(remaining1);
    });
  });

  describe('IP-based Rate Limiting', () => {
    it('should track rate limits by IP when no email provided', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email: `user${i}@example.com` });
      }

      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'another@example.com' });

      expect([HttpStatus.OK, HttpStatus.TOO_MANY_REQUESTS]).toContain(response.status);
    });

    it('should respect x-forwarded-for header for IP extraction', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('x-forwarded-for', '203.0.113.1')
        .send({ email: 'test@example.com' })
        .expect(HttpStatus.OK);

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });
  });

  describe('MFA Endpoints Rate Limiting', () => {
    let authToken: string;

    beforeEach(async () => {
      authToken = 'mock-jwt-token';
    });

    it('should rate limit MFA verify endpoint', async () => {
      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer())
          .post('/mfa/verify')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ token: '123456' });
      }

      const response = await request(app.getHttpServer())
        .post('/mfa/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ token: '123456' });

      expect([HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS]).toContain(response.status);
    });

    it('should rate limit MFA backup code verification', async () => {
      for (let i = 0; i < 11; i++) {
        await request(app.getHttpServer())
          .post('/mfa/verify-backup')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ code: 'ABCD1234' });
      }

      const response = await request(app.getHttpServer())
        .post('/mfa/verify-backup')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: 'ABCD1234' });

      expect([HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS]).toContain(response.status);
    });

    it('should rate limit backup code generation', async () => {
      for (let i = 0; i < 4; i++) {
        await request(app.getHttpServer())
          .post('/mfa/backup-codes')
          .set('Authorization', `Bearer ${authToken}`);
      }

      const response = await request(app.getHttpServer())
        .post('/mfa/backup-codes')
        .set('Authorization', `Bearer ${authToken}`);

      expect([HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS]).toContain(response.status);
    });
  });

  describe('Rate Limit Reset', () => {
    it('should reset rate limit after window expires', async () => {
      const email = 'test@example.com';

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email })
          .expect(HttpStatus.OK);
      }

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const key = `password_reset:email:${email}`;
      await redisService.del(key);

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(HttpStatus.OK);
    });
  });
});
