import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from './schemas/user.schema';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers() {
    return this.usersService.listUsers();
  }

  @Post()
  async createUser(@Body() dto: CreateManagedUserDto) {
    const user = await this.usersService.createUser(dto);
    return this.usersService.toSafeUser(user);
  }

  @Patch(':userId/role')
  async updateUserRole(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const user = await this.usersService.updateUserRole(userId, dto.role, currentUser.sub);
    return this.usersService.toSafeUser(user);
  }

  @Delete(':userId')
  async deleteUser(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    await this.usersService.deleteUser(userId, currentUser.sub);
    return { ok: true };
  }
}