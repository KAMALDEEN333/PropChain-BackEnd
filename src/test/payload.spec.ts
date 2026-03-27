import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Payload Handling (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject oversized JSON payloads', async () => {
    const bigPayload = {
      data: 'x'.repeat(2 * 1024 * 1024), // 2MB
    };

    const res = await request(app.getHttpServer())
      .post('/api/test')
      .send(bigPayload);

    expect(res.status).toBe(413); // Payload Too Large
  });

  it('should validate payload format', async () => {
    const res = await request(app.getHttpServer())
      .post('/transactions')
      .send({});

    expect(res.status).toBe(422);
  });

  it('should stream large file uploads safely', async () => {
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .attach(
        'file',
        Buffer.alloc(5 * 1024 * 1024), // 5MB
        'test.bin',
      );

    expect(res.status).toBe(201);
  });
});