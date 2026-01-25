import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
import { ProfileData } from '../profile/profile.data';
import { ChangeUserDto } from 'src/dto/user/userupdate.dto';
import { User } from 'src/schema/user.schema';

@Injectable()
export class UserLogic {
  constructor(
    private readonly userData: UserData,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly profileLogic: ProfileLogic,
    private readonly profileData: ProfileData,
  ) { }

  async register(dto: any) {
    const exists = await this.userData.findByEmail(dto.email);
    if (exists) AppError.badRequest('Email already exists');

    dto.password = await bcrypt.hash(dto.password, 10);
    return this.userData.create({ ...dto, role: new Types.ObjectId(dto.role) });
  }

  async login(dto: any) {
  const user = await this.userData.findByEmailWithRole(dto.email);
  if (!user) {
    throw new UnauthorizedException('User not Exist');
  }

  // ❌ Blocked / status checks
  if (user.isBlocked) {
    throw new UnauthorizedException('User is blocked');
  }

  const match = await bcrypt.compare(dto.password, user.password);
  if (!match) {
    throw new UnauthorizedException('Invalid credentials');
  }

  if (user.status.toLowerCase() !== 'active') {
    throw new UnauthorizedException('Your Account is not Active');
  }

  if (!user.isDashboardEnabled) {
    throw new UnauthorizedException("You don't have Dashboard Access");
  }

  // ✅ Update last login
  await this.userData.update(user._id, {
    lastLoginAt: new Date(),
  });

  /* -------------------------------------------------
     🔐 BUILD PERMISSIONS (ROLE + PROFILE)
  --------------------------------------------------*/

  const role = user.role as any;

  // 1️⃣ Role permissions
  let finalPermissions: {
    module: string;
    actions: string[];
  }[] = role?.permissions || [];

  // 2️⃣ Profile extra permissions (optional)
  const profile = await this.profileData.findByUserId(user._id.toString());

  if (profile?.extraAccessControls?.length) {
    for (const extra of profile.extraAccessControls) {
      const existing = finalPermissions.find(
        (p) => p.module === extra.module,
      );

      if (existing) {
        existing.actions = Array.from(
          new Set([...existing.actions, ...extra.actions]),
        );
      } else {
        finalPermissions.push({
          module: extra.module,
          actions: [...extra.actions],
        });
      }
    }
  }

  // 3️⃣ Super Admin → allow everything
  if (role?.isSuperAdmin) {
    finalPermissions = [{ module: '*', actions: ['*'] }];
  }

  /* -------------------------------------------------
     🔐 JWT PAYLOAD
  --------------------------------------------------*/

  const payload = {
    userId: user._id,
    name: user.name,
    email: user.email,
    roleId: role._id,
    roleName: role.name,
    isSuperAdmin: role.isSuperAdmin,
    permissions: finalPermissions,
    status: user.status,
    isDashboardEnabled: user.isDashboardEnabled,
  };
  console.log(payload)

  const access_token = this.jwtService.sign(payload);

  /* -------------------------------------------------
     📤 RESPONSE
  --------------------------------------------------*/

  return {
    access_token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      number: user.number,
      status: user.status,
      role: {
        id: role._id,
        name: role.name,
        isSuperAdmin: role.isSuperAdmin,
      },
      permissions: finalPermissions,
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

async updateUserAndProfile(
    userId: string,
    dto: ChangeUserDto,
  ) {
    console.log(dto)
    const user = await this.userData.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const userUpdatePayload: any = {};

    if (dto.name) userUpdatePayload.name = dto.name;
    if (dto.email) userUpdatePayload.email = dto.email;
    if (dto.number) userUpdatePayload.number = dto.number;
    if (dto.role) userUpdatePayload.role = dto.role;

    let updatedUser: User | null = user;
    if (Object.keys(userUpdatePayload).length) {
      updatedUser = await this.userData.update(
        userId,
        userUpdatePayload,
      );
    }

    /* -----------------------------
       2️⃣ UPDATE / CREATE PROFILE
    ------------------------------*/
    const profilePayload: any = {};

    if (dto.departmentId)
      profilePayload.departmentId = dto.departmentId;
    if (dto.reportingManagerId)
      profilePayload.reportingManagerId = dto.reportingManagerId;
    if (dto.education)
      profilePayload.education = dto.education;
    if (dto.salary)
      profilePayload.salary = dto.salary;
    if (dto.profileImage)
      profilePayload.profileImage = dto.profileImage;
    if (dto.extraAccessControls)
      profilePayload.extraAccessControls =
        dto.extraAccessControls;

    let profile = await this.profileData.findByUserId(
      userId,
    );

    if (Object.keys(profilePayload).length) {
      if (profile) {
        profile = await this.profileData.updateByUserId(
          userId,
          profilePayload,
        );
      } else {
        profile = await this.profileData.create({
          userId,
          ...profilePayload,
        });
      }
    }
    return {
      message: 'User and profile updated successfully',
      user: updatedUser,
      profile,
    };
  }

  
}
