import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from './schemas/user.schema';

interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  lastLoginAt: Date | null;
  createdAt: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async createUser(input: CreateUserInput): Promise<UserDocument> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await this.userModel.findOne({ email: normalizedEmail }).exec();

    if (existingUser) {
      throw new ConflictException('An account already exists for this email address.');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    return this.userModel.create({
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: input.role ?? UserRole.USER,
    });
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.trim().toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByIdOrThrow(id: string): Promise<UserDocument> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  async listUsers(): Promise<SafeUser[]> {
    const users = await this.userModel.find().sort({ createdAt: -1, email: 1 }).exec();
    return users.map((user) => this.toSafeUser(user));
  }

  async validatePassword(user: Pick<User, 'passwordHash'>, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { lastLoginAt: new Date() }).exec();
  }

  async getRoleCounts(): Promise<Record<UserRole, number>> {
    const [adminUsers, standardUsers] = await Promise.all([
      this.userModel.countDocuments({ role: UserRole.ADMIN }).exec(),
      this.userModel.countDocuments({ role: UserRole.USER }).exec(),
    ]);

    return {
      [UserRole.ADMIN]: adminUsers,
      [UserRole.USER]: standardUsers,
    };
  }

  async countUsers(): Promise<number> {
    return this.userModel.countDocuments().exec();
  }

  async updateUserRole(userId: string, role: UserRole, currentUserId: string): Promise<UserDocument> {
    const user = await this.findByIdOrThrow(userId);

    if (user.id === currentUserId) {
      throw new ForbiddenException('You cannot change your own role from the admin dashboard.');
    }

    if (user.role === role) {
      return user;
    }

    if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
      const adminCount = await this.userModel.countDocuments({ role: UserRole.ADMIN }).exec();
      if (adminCount <= 1) {
        throw new ForbiddenException('You cannot demote the last admin user.');
      }
    }

    user.role = role;
    await user.save();
    return user;
  }

  async changeUserPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.findByIdOrThrow(userId);
    const isValid = await this.validatePassword(user, currentPassword);

    if (!isValid) {
      throw new ForbiddenException('Current password is incorrect.');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    await user.save();
  }

  async createPasswordResetToken(email: string): Promise<string | null> {
    const user = await this.findByEmail(email);

    if (!user) {
      return null;
    }

    const rawToken = randomBytes(24).toString('hex');
    user.passwordResetTokenHash = this.hashResetToken(rawToken);
    user.passwordResetExpiresAt = new Date(Date.now() + 1000 * 60 * 15);
    await user.save();

    return rawToken;
  }

  async resetPasswordWithToken(rawToken: string, newPassword: string): Promise<UserDocument> {
    const tokenHash = this.hashResetToken(rawToken);
    const user = await this.userModel.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    }).exec();

    if (!user) {
      throw new ForbiddenException('Reset token is invalid or has expired.');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    await user.save();
    return user;
  }

  async deleteUser(userId: string, currentUserId: string): Promise<void> {
    if (userId === currentUserId) {
      throw new ForbiddenException('You cannot delete your own admin account.');
    }

    const user = await this.findByIdOrThrow(userId);

    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.userModel.countDocuments({ role: UserRole.ADMIN }).exec();
      if (adminCount <= 1) {
        throw new ForbiddenException('You cannot delete the last admin user.');
      }
    }

    await this.userModel.findByIdAndDelete(userId).exec();
  }

  async ensureAdminUser(): Promise<void> {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL')?.trim().toLowerCase();
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');
    const adminName = this.configService.get<string>('ADMIN_NAME')?.trim() || 'Platform Admin';

    if (!adminEmail || !adminPassword) {
      return;
    }

    const existingAdmin = await this.userModel.findOne({ email: adminEmail }).exec();
    if (existingAdmin) {
      if (existingAdmin.role !== UserRole.ADMIN) {
        existingAdmin.role = UserRole.ADMIN;
        await existingAdmin.save();
      }
      return;
    }

    await this.createUser({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: UserRole.ADMIN,
    });
  }

  toSafeUser(user: { id: string; name: string; email: string; role: UserRole; lastLoginAt?: Date | null; createdAt?: Date | null }): SafeUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      lastLoginAt: user.lastLoginAt || null,
      createdAt: user.createdAt || null,
    };
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
