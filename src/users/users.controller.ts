import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { DeactivateAccountDto, ReactivateAccountDto } from './dto/deactivation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUserPayload } from '../auth/types/auth-user.type';
import { UserRole } from '../types/prisma.types';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  // Public endpoint for user registration
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/block')
  block(@Param('id') id: string) {
    return this.usersService.block(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/unblock')
  unblock(@Param('id') id: string) {
    return this.usersService.unblock(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  // User self-service deactivation
  @UseGuards(JwtAuthGuard)
  @Post('me/deactivate')
  deactivateAccount(
    @CurrentUser() user: AuthUserPayload,
    @Body() deactivateDto: DeactivateAccountDto,
  ) {
    return this.usersService.deactivate(user.sub, deactivateDto);
  }

  // User self-service reactivation
  @Post('me/reactivate')
  reactivateAccount(
    @Body() data: { email: string; token?: string },
    @Body() reactivateDto: ReactivateAccountDto,
  ) {
    // Find user by email first
    return this.usersService.findByEmail(data.email).then((foundUser) => {
      if (!foundUser) {
        throw new Error('User not found');
      }
      return this.usersService.reactivate(foundUser.id, reactivateDto);
    });
  }

  // Admin endpoints for deactivation management
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/deactivate')
  adminDeactivateAccount(@Param('id') id: string, @Body() deactivateDto: DeactivateAccountDto) {
    return this.usersService.deactivate(id, deactivateDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/reactivate')
  adminReactivateAccount(@Param('id') id: string, @Body() reactivateDto: ReactivateAccountDto) {
    return this.usersService.reactivate(id, reactivateDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('scheduled-deletion')
  getScheduledForDeletion() {
    return this.usersService.findScheduledForDeletion();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('delete-scheduled')
  deleteScheduledUsers() {
    return this.usersService.deleteDeactivatedUsers();
  }
}
