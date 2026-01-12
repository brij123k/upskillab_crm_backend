import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserData } from './user.data';
import { EmailService } from 'src/common/services/email.service';
import { AppError } from 'src/common/constants/error.constants';
import { Types } from 'mongoose';
import { ToggleDashboardDto } from 'src/dto/user/toggle-dashboard.dto';
import { ProfileLogic } from '../profile/profile.logic';
import { profile } from 'console';
@Injectable()
export class UserLogic {
  constructor(
    private readonly userData: UserData,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly profileLogic: ProfileLogic,
  ) { }

  async register(dto: any) {
    const exists = await this.userData.findByEmail(dto.email);
    if (exists) AppError.badRequest('Email already exists');

    dto.password = await bcrypt.hash(dto.password, 10);
    return this.userData.create({ ...dto, role: new Types.ObjectId(dto.role) });
  }

  async login(dto: any) {
    const user = await this.userData.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('User not Exist');
    }

    // ❌ Blocked user check
    if (user.isBlocked) {
      throw new UnauthorizedException('User is blocked');
    }

    const match = await bcrypt.compare(dto.password, user.password);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status.toLocaleLowerCase() !== 'active') {
      throw new UnauthorizedException('Your Account is not Active');
    }
    if (user.isBlocked) {
      throw new UnauthorizedException('Your Account is blocked');
    }
    if (!user.isDashboardEnabled) {
      throw new UnauthorizedException("You Don't have Dashboard Access");
    }

    // ✅ Update last login
    await this.userData.update(user._id, {
      lastLoginAt: new Date(),
    });
    const role = user.role as any;
    const payload = {
      userId: user._id,
      name: user.name,
      email: user.email,
      roleId: role._id,
      roleName: role.name,
      status: user.status,
      isDashboardEnabled: user.isDashboardEnabled,
    };

    const access_token = this.jwtService.sign(payload);
    return {
      access_token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        number: user.number,
        status: user.status,
        role: user.role,
        isBlocked: user.isBlocked,
        lastLoginAt: user.lastLoginAt,
        isDashboardEnabled: user.isDashboardEnabled,
        createdAt: user.createdAt,
      },
    };
  }

  async sendOtp(email: string) {
    const user = await this.userData.findByEmail(email);
    if (!user) throw new BadRequestException('User not found');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.userData.update(user._id, {
      otp,
      otpExpiry: new Date(Date.now() + 5 * 60 * 1000),
    });
    await this.emailService.sendOtpEmail(user.email, otp);
    // 🔥 integrate mail service here
    return { message: 'OTP sent to email' };
  }

  async verifyOtp(email: string, otp: string) {
    const user = await this.userData.findByEmail(email);
    if (!user || user.otp !== otp || user.otpExpiry < new Date()) {
      throw new BadRequestException('Invalid or expired OTP');
    }
    return { valid: true };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    const user = await this.userData.findByEmail(email);
    if (!user || user.otp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.userData.update(user._id, {
      password: hashed,
      otp: null,
      otpExpiry: null,
    });

    return { message: 'Password updated successfully' };
  }
  async changeStatus(userId: string, status: string) {
  const user = await this.userData.updateStatus(userId, status);
  if (!user) {
    throw new BadRequestException('User not found');
  }

  return {
    message: 'User status updated successfully',
    user,
  };
}

async toggleBlock(userId: string) {
  const user = await this.userData.findById(userId);
  if (!user) {
    throw new BadRequestException('User not found');
  }

  const updatedUser = await this.userData.toggleBlock(
    userId,
    !user.isBlocked,
  );
  if(!updatedUser){
    return AppError.badRequest('Faild to Block')
  }

  return {
    message: `User ${updatedUser.isBlocked ? 'blocked' : 'unblocked'} successfully`,
    user: updatedUser,
  };
}

async toggleDashboard(
  userId: string,
  dto: ToggleDashboardDto,
) {
  const user = await this.userData.findById(userId);
  if (!user) {
    throw new BadRequestException('User not found');
  }

  // If already enabled → block duplicate profile creation
  if (user.isDashboardEnabled) {
    throw new BadRequestException(
      'Dashboard already enabled for this user',
    );
  }

  // 1️⃣ Enable dashboard
  const updatedUser = await this.userData.update(userId, {
    isDashboardEnabled: true,
  });

  // 2️⃣ Create profile with admin-provided data
  await this.profileLogic.createProfile({
    userId,
    departmentId: dto.departmentId,
    reportingManagerId: dto.reportingManagerId,
    education: dto.education,
    salary: dto.salary,
    extraAccessControls: dto.extraAccessControls,
    profileImage: dto.profileImage,
  });

  return {
    message: 'Dashboard enabled and profile created successfully',
    user: updatedUser,
  };
}

async getAllUsersWithProfile() {
    const users = await this.userData.getAllUsers();

    const userIds = users.map((u) => u._id);

    const profiles =
      await this.profileLogic.getProfilesByUserIds(userIds);

    const profileMap = new Map(
      profiles.map((p) => [p.userId.toString(), p]),
    );

    return users.map((user) => ({
      ...user,
      profile: profileMap.get(user._id.toString()) || null,
    }));
  }

  
}
