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
import { ProfileData } from '../profile/profile.data';
import { ChangeUserDto } from 'src/dto/user/userupdate.dto';
import { User } from 'src/schema/user.schema';
import { RegisterUserDto } from 'src/dto/user/register-user.dto';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { SmartfloService } from '../smartflo/smartflo.service';
import { UserLogLogic } from '../user-logs/user-log.logic';
import { UserLogAction, UserLogStatus } from 'src/schema/user-log.schema';
import { AttendanceLogic } from '../attendance/attendance.logic';

@Injectable()
export class UserLogic {
  private async generateUniqueEmployeeId(): Promise<number> {
    let employeeId = 0; // ✅ initialized
    let exists = true;

    while (exists) {
      employeeId = Math.floor(100000 + Math.random() * 900000); // 6-digit

      const user = await this.userData.findByEmployeeId(employeeId);
      exists = !!user;
    }

    return employeeId;
  }
  constructor(
    private readonly userData: UserData,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly profileLogic: ProfileLogic,
    private readonly profileData: ProfileData,
    private readonly userActivityLogic: UserActivityLogic,
    private readonly smartfloService: SmartfloService,
    private readonly userLogLogic: UserLogLogic,
    private readonly attendanceLogic: AttendanceLogic,
  ) { }

  private getRequestMeta(req?: any) {
    const forwardedFor = req?.headers?.['x-forwarded-for'];
    const ipAddress =
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.toString()?.split(',')[0]?.trim() ||
      req?.ip ||
      req?.connection?.remoteAddress ||
      req?.socket?.remoteAddress ||
      null;

    return {
      ip: ipAddress,
      device: req?.headers?.['user-agent'] || req?.headers?.['device'] || 'Unknown',
    };
  }

  private async safeLog(payload: any) {
    try {
      await this.userLogLogic.logEvent(payload);
    } catch {
      // Logging must never block auth flow.
    }
  }

  async register(dto: RegisterUserDto) {
    // 1️⃣ Check email
    const exists = await this.userData.findByEmail(dto.email);
    if (exists) {
      AppError.badRequest('Email already exists');
    }

    // 2️⃣ Generate unique employeeId
    const employeeId = await this.generateUniqueEmployeeId();
    const rowPassword = dto.password;
    // 3️⃣ Hash password
    dto.password = await bcrypt.hash(dto.password, 10);

    // 4️⃣ Save user
    const user = this.userData.create({
      ...dto,
      employeeId,
      role: new Types.ObjectId(dto.role),
    });

    await this.emailService.registerDetail(dto.email, rowPassword);

    return user;
  }

  async login(dto: any, req?: any) {
    const requestMeta = this.getRequestMeta(req);
    let user: any = null;

    try {
      user = await this.userData.findByEmailWithRole(dto.email);
      if (!user) {
        throw new UnauthorizedException('User not Exist');
      }
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
      await this.userActivityLogic.log({
        userId: user._id.toString(),
        action: 'USER_LOGIN',
        referenceType: 'Login',
        referenceId: null,
        meta: { LoginAt: new Date() },
      });
      await this.attendanceLogic.recordLogin(user._id.toString(), new Date());

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
        number: user.number,
        email: user.email,
        roleId: role._id,
        roleRealName: role.name,
        roleLevel: role.level ?? 1,
        roleName: (role.name === 'Admin' || role.name === 'hr')
          ? role.name
          : 'bd',
        isSuperAdmin: role.isSuperAdmin,
        permissions: finalPermissions,
        status: user.status,
        isDashboardEnabled: user.isDashboardEnabled,
      };

      const access_token = this.jwtService.sign(payload);

      await this.safeLog({
        userId: user._id.toString(),
        ip: requestMeta.ip,
        device: requestMeta.device,
        action: UserLogAction.LOGIN,
        status: UserLogStatus.SUCCESS,
        log: 'User logged in successfully',
        meta: {
          email: user.email,
        },
      });

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
            name: (role.name === 'Admin' || role.name === 'hr')
              ? role.name
              : 'bd',
            roleRealName: role.name,
            level: role.level ?? 1,
            isSuperAdmin: role.isSuperAdmin,
          },
          CallerIds: user.CallerIds,
          IVREnabled: user.IVREnabled,
          permissions: finalPermissions,
          isBlocked: user.isBlocked,
          lastLoginAt: user.lastLoginAt,
          isDashboardEnabled: user.isDashboardEnabled,
          createdAt: user.createdAt,
        },
      };
    } catch (error: any) {
      await this.safeLog({
        userId: user?._id?.toString(),
        ip: requestMeta.ip,
        device: requestMeta.device,
        action: UserLogAction.LOGIN,
        status: UserLogStatus.FAILED,
        log: 'User login failed',
        reason: error?.message || 'Login failed',
        meta: {
          email: dto.email,
        },
      });
      throw error;
    }
  }

  async logout(user: any, req?: any) {
    const requestMeta = this.getRequestMeta(req);
    const authHeader = req?.headers?.authorization || req?.headers?.Authorization;
    const token = typeof authHeader === 'string' ? authHeader.split(' ')[1] : null;

    try {
      const decoded: any = token ? this.jwtService.verify(token) : null;
      const userId = user?.userId?.toString() || decoded?.userId?.toString();

      if (!userId) {
        throw new UnauthorizedException('Invalid logout token');
      }

      await this.userActivityLogic.log({
        userId,
        action: 'USER_Logout',
        referenceType: 'Logout',
        referenceId: null,
        meta: {
          logoutAt: new Date()
        },
      });
      await this.attendanceLogic.recordLogout(userId, new Date());
      await this.safeLog({
        userId,
        ip: requestMeta.ip,
        device: requestMeta.device,
        action: UserLogAction.LOGOUT,
        status: UserLogStatus.SUCCESS,
        log: 'User logged out successfully',
        meta: {
          logoutAt: new Date(),
        },
      });
      return { success: true, message: "Logged Out Successfully" }
    } catch (error: any) {
      await this.safeLog({
        userId: user?.userId?.toString(),
        ip: requestMeta.ip,
        device: requestMeta.device,
        action: UserLogAction.LOGOUT,
        status: UserLogStatus.FAILED,
        log: 'User logout failed',
        reason: error?.message || 'Logout failed',
      });
      throw new UnauthorizedException(error?.message || 'Logout failed');
    }
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

  async resetPassword(email: string, otp: string, newPassword: string, req?: any) {
    const requestMeta = this.getRequestMeta(req);
    let user: any = null;

    try {
      user = await this.userData.findByEmail(email);
      if (!user || user.otp !== otp) {
        throw new BadRequestException('Invalid OTP');
      }

      if (user.otpExpiry && user.otpExpiry < new Date()) {
        throw new BadRequestException('OTP expired');
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await this.userData.update(user._id, {
        password: hashed,
        otp: null,
        otpExpiry: null,
      });

      await this.safeLog({
        userId: user._id.toString(),
        ip: requestMeta.ip,
        device: requestMeta.device,
        action: UserLogAction.RESET_PASSWORD,
        status: UserLogStatus.SUCCESS,
        log: 'Password reset successfully',
        meta: {
          email: user.email,
        },
      });

      return { message: 'Password updated successfully' };
    } catch (error: any) {
      await this.safeLog({
        userId: user?._id?.toString(),
        ip: requestMeta.ip,
        device: requestMeta.device,
        action: UserLogAction.RESET_PASSWORD,
        status: UserLogStatus.FAILED,
        log: 'Password reset failed',
        reason: error?.message || 'Password reset failed',
        meta: {
          email,
        },
      });
      throw error;
    }
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
    if (!updatedUser) {
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
    const poolIds = dto.poolIds?.length
      ? dto.poolIds.map((id) => new Types.ObjectId(id))
      : [];
    // 2️⃣ Create profile with admin-provided data
    await this.profileLogic.createProfile({
      userId,
      departmentId: new Types.ObjectId(dto.departmentId),
      reportingSeniorId: new Types.ObjectId(dto.reportingSeniorId),
      education: dto.education,
      salary: dto.salary,
      extraAccessControls: dto.extraAccessControls,
      profileImage: dto.profileImage,
      address:dto.address,
      bankDetails:dto.bankDetails,
      educationalDetails:dto.educationalDetails,
      documents:dto.documents,
      poolIds
    });
    await this.emailService.dashboardUpdate(user.email, user.employeeId);
    return {
      message: 'Dashboard enabled and profile created successfully',
      user: updatedUser,
    };
  }

  async getAllUsersWithProfile(user: any, status?: string | string[]) {
    if (user.roleName.toLowerCase() == "admin") {
      const users = await this.userData.getAllUsers(status);

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
    const users = await this.getUsersUnder(user, status);
    const userIds = users.map((u) => u._id);

    const profiles =
      await this.profileLogic.getProfilesByUserIds(userIds);

    const profileMap = new Map(
      profiles.map((p) => [p.userId.toString(), p]),
    );

    const res = users.map((user) => ({
      ...user,
      profile: profileMap.get(user._id.toString()) || null,
    }));
    return res;
  }

  async updateUserAndProfile(
    userId: string,
    dto: ChangeUserDto,
  ) {
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
      profilePayload.departmentId = new Types.ObjectId(dto.departmentId);
    if (dto.reportingSeniorId)
      profilePayload.reportingSeniorId = new Types.ObjectId(dto.reportingSeniorId);
    if (dto.education)
      profilePayload.education = dto.education;
    if (dto.salary)
      profilePayload.salary = dto.salary;
    if (dto.profileImage)
      profilePayload.profileImage = dto.profileImage;
    if (dto.extraAccessControls)
      profilePayload.extraAccessControls =
        dto.extraAccessControls;
    if (dto.poolIds) {
      const poolIds = dto.poolIds?.length
        ? dto.poolIds.map((id) => new Types.ObjectId(id))
        : [];
      profilePayload.poolIds = poolIds
    }
    if (dto.address)
      profilePayload.address = dto.address;

    if (dto.bankDetails)
      profilePayload.bankDetails = dto.bankDetails;

    if (dto.educationalDetails)
      profilePayload.educationalDetails = dto.educationalDetails;

    if (dto.documents)
      profilePayload.documents = dto.documents;

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

  // async addIVRUser()


  async getUsersUnder(user: any, status?: string | string[]) {
    if (user.roleName.toLowerCase() == "admin") {
      return this.userData.getAllUsers(status);
    }
    const userId = user._id || user.userId;
    // 1️⃣ Get profile of requested user
    const profile = await this.profileData.findByUserId(userId);
    if (!profile || !profile.departmentId) {
      throw new NotFoundException(
        'Profile or department not found',
      );
    }

    // 2️⃣ Get all subordinate profiles
    const subordinates =
      await this.userData.findAllSubordinates(
        userId,
        profile?.departmentId.toString(),
      );
    if (!subordinates.length) return [];

    // 3️⃣ Extract userIds
    const userIds = subordinates.map((p) =>
      p.userId.toString(),
    );
    userIds.push(userId);

    const uniqueUserIds = [...new Set(userIds)];
    // 4️⃣ Fetch user details
    const users = await this.userData.findByIds(uniqueUserIds, status);
    return users;
  }

  async getUsersAbove(userId: string, status?: string | string[]) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const seniors: any[] = [];
    const visited = new Set<string>();
    let currentProfile = await this.profileData.findByUserId(userId);

    while (currentProfile?.reportingSeniorId) {
      const seniorId = currentProfile.reportingSeniorId.toString();
      if (!seniorId || visited.has(seniorId)) break;
      visited.add(seniorId);
      seniors.push(seniorId);
      currentProfile = await this.profileData.findByUserId(seniorId);
      if (!currentProfile) break;
    }

    if (!seniors.length) return [];

    const uniqueSeniorIds = [...new Set(seniors)];
    const seniorUsers = await this.userData.findByIds(uniqueSeniorIds, status);
    const profileMap = new Map(
      (await this.profileLogic.getProfilesByUserIds(uniqueSeniorIds)).map((p) => [p.userId.toString(), p]),
    );

    return seniorUsers.map((senior) => ({
      ...senior,
      profile: profileMap.get(senior._id.toString()) || null,
    }));
  }

  async getLastActivities(user: any, limitParam?: string) {
    const limitValue = Number.parseInt(limitParam ?? '5', 10);
    const limit = Number.isFinite(limitValue) && limitValue > 0
      ? Math.min(limitValue, 20)
      : 5;

    const isAdmin = user?.roleName?.toLowerCase() === 'admin';
    let userIds: string[] | undefined;

    if (!isAdmin) {
      const visibleUsers = await this.getUsersUnder(user);
      userIds = visibleUsers
        .map((item: any) => item?._id?.toString())
        .filter(Boolean);

      const currentUserId = user?._id?.toString() || user?.userId?.toString();
      if (currentUserId && !userIds.includes(currentUserId)) {
        userIds.push(currentUserId);
      }
    }

    const activities = await this.userActivityLogic.getRecentByUserIds(userIds, limit);

    return activities.map((activity: any) => ({
      ...activity,
      userName: activity?.userId?.name || 'Unknown',
      userEmployeeId: activity?.userId?.employeeId || null,
    }));
  }

  async findbyEmpId(empId: number) {
    return this.userData.findbyEmpId(empId)
  }
  async findById(id: string) {
    return this.userData.findById(id);
  }
  async getUserByDepartmentId(departmentId: string, status?: string | string[]) {
    return this.profileData.getBydepId(departmentId, status)
  }

  async createIVRUser(dto: any) {
    const user = await this.smartfloService.createIVRUser({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      login_id: dto.login_id,
      password: dto.password,
      caller_ids: dto.caller_ids
    });
    await this.userData.update(new Types.ObjectId(dto.UserId), { IVREnabled: true, CallerIds: dto.caller_ids })
    return user
  }


}
