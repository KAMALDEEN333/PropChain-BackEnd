import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AvatarUploadController } from './avatar-upload.controller';
import { AvatarUploadService } from './avatar-upload.service';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController, AvatarUploadController],
  providers: [UsersService, AvatarUploadService],
  exports: [UsersService, AvatarUploadService],
})
export class UsersModule {}
