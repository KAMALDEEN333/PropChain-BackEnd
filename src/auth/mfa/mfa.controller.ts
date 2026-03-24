import { Controller, Post, Get, Delete, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { MfaService } from './mfa.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { SensitiveEndpointRateLimitGuard } from '../../security/guards/sensitive-endpoint-rate-limit.guard';
import { SensitiveRateLimit } from '../../security/decorators/sensitive-rate-limit.decorator';

@ApiTags('mfa')
@Controller('mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate MFA setup QR code' })
  @ApiResponse({ status: 200, description: 'MFA setup initiated successfully.' })
  @HttpCode(HttpStatus.OK)
  async setupMfa(@Req() req: Request) {
    const user = req['user'] as any;
    return this.mfaService.generateMfaSecret(user.id, user.email);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard, SensitiveEndpointRateLimitGuard)
  @SensitiveRateLimit({
    windowMs: 300000,
    maxRequests: 5,
    keyPrefix: 'mfa_verify',
    enableProgressiveDelay: true,
    blockOnExceed: true,
    blockDurationMs: 1800000,
  })
  @ApiOperation({ summary: 'Verify and complete MFA setup. Rate limit: 5 attempts per 5 minutes.' })
  @ApiResponse({ status: 200, description: 'MFA setup completed successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid MFA token.' })
  @HttpCode(HttpStatus.OK)
  async verifyMfa(@Req() req: Request, @Body('token') token: string) {
    const user = req['user'] as any;
    const verified = await this.mfaService.verifyMfaSetup(user.id, token);

    if (verified) {
      // Generate backup codes after successful setup
      const backupCodes = await this.mfaService.generateBackupCodes(user.id);
      return {
        message: 'MFA setup completed successfully',
        backupCodes,
      };
    }

    throw new Error('Invalid MFA token');
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get MFA status for current user' })
  @ApiResponse({ status: 200, description: 'MFA status retrieved successfully.' })
  @HttpCode(HttpStatus.OK)
  async getMfaStatus(@Req() req: Request) {
    const user = req['user'] as any;
    return this.mfaService.getMfaStatus(user.id);
  }

  @Delete('disable')
  @UseGuards(JwtAuthGuard, SensitiveEndpointRateLimitGuard)
  @SensitiveRateLimit({
    windowMs: 3600000,
    maxRequests: 3,
    keyPrefix: 'mfa_disable',
    enableProgressiveDelay: false,
    blockOnExceed: false,
  })
  @ApiOperation({ summary: 'Disable MFA for current user. Rate limit: 3 requests per hour.' })
  @ApiResponse({ status: 200, description: 'MFA disabled successfully.' })
  @HttpCode(HttpStatus.OK)
  async disableMfa(@Req() req: Request) {
    const user = req['user'] as any;
    await this.mfaService.disableMfa(user.id);
    return { message: 'MFA disabled successfully' };
  }

  @Post('backup-codes')
  @UseGuards(JwtAuthGuard, SensitiveEndpointRateLimitGuard)
  @SensitiveRateLimit({
    windowMs: 3600000,
    maxRequests: 3,
    keyPrefix: 'mfa_backup_gen',
    enableProgressiveDelay: false,
    blockOnExceed: false,
  })
  @ApiOperation({ summary: 'Generate new backup codes. Rate limit: 3 requests per hour.' })
  @ApiResponse({ status: 200, description: 'Backup codes generated successfully.' })
  @HttpCode(HttpStatus.OK)
  async generateBackupCodes(@Req() req: Request) {
    const user = req['user'] as any;
    const backupCodes = await this.mfaService.generateBackupCodes(user.id);
    return { backupCodes };
  }

  @Post('verify-backup')
  @UseGuards(JwtAuthGuard, SensitiveEndpointRateLimitGuard)
  @SensitiveRateLimit({
    windowMs: 300000,
    maxRequests: 10,
    keyPrefix: 'mfa_backup_verify',
    enableProgressiveDelay: true,
    blockOnExceed: true,
    blockDurationMs: 3600000,
  })
  @ApiOperation({ summary: 'Verify backup code. Rate limit: 10 attempts per 5 minutes.' })
  @ApiResponse({ status: 200, description: 'Backup code verified successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid backup code.' })
  @HttpCode(HttpStatus.OK)
  async verifyBackupCode(@Req() req: Request, @Body('code') code: string) {
    const user = req['user'] as any;
    const verified = await this.mfaService.verifyBackupCode(user.id, code);

    if (!verified) {
      throw new Error('Invalid backup code');
    }

    return { message: 'Backup code verified successfully' };
  }
}
