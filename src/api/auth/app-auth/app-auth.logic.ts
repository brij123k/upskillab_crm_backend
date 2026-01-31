import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AppAuthData } from './app-auth.data';
import { UserAppHistoryData } from './user-app-history.data';
import { UserData } from 'src/api/user/user.data';
import { ProfileData } from 'src/api/profile/profile.data';

@Injectable()
export class AppAuthLogic {
  constructor(
    private readonly appAuthData: AppAuthData,
    private readonly userData: UserData,
    private readonly userAppHistoryData: UserAppHistoryData,
    private readonly jwtService: JwtService,
    private readonly profileData: ProfileData,
  ) {}

  // CMS → generate pairing token
  async generate(userId: string) {
    const token = randomBytes(6)
      .toString('hex')
      .toUpperCase()
      .slice(0, 12);

    return this.appAuthData.create({
      userId,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }

  // Mobile → verify token
  async verify(dto: any, ip: string) {
     
    const record = await this.appAuthData.findValidToken(dto.token);
    if (!record) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const user = await this.userData.findById(record.userId.toString());
        if (!user) {
            throw new UnauthorizedException('User not Exist');
        }
    

    if (user.isBlocked) {
        throw new UnauthorizedException('User is blocked');
      }
    
    
      if (user.status.toLowerCase() !== 'active') {
        throw new UnauthorizedException('Your Account is not Active');
      }
    
      if (!user.isDashboardEnabled) {
        throw new UnauthorizedException("You don't have Dashboard Access");
      }
    
const role = user.role as any;
let finalPermissions: {
    module: string;
    actions: string[];
  }[] = role?.permissions || [];

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

    if (role?.isSuperAdmin) {
    finalPermissions = [{ module: '*', actions: ['*'] }];
  }

  const payload = {
    userId: user._id,
    name: user.name,
    email: user.email,
    roleId: role._id,
    roleRealName: role.name,
     roleName: (role.name === 'Admin' || role.name === 'hr')
    ? role.name
    : 'bd',
    isSuperAdmin: role.isSuperAdmin,
    permissions: finalPermissions,
    status: user.status,
    isDashboardEnabled: user.isDashboardEnabled,
  };



    const accessToken = this.jwtService.sign(payload,{ expiresIn: '24h' },
    );

    await this.userAppHistoryData.log({
      userId: record.userId,
      deviceId: dto.deviceId,
      platform: dto.platform,
      ipAddress: ip,
    });

    return { access_token: accessToken };
  }

  // CMS logout → revoke app access
  async revoke(userId: string) {
    await this.appAuthData.deactivateAll(userId);
    await this.userAppHistoryData.logoutAll(userId);
    return { message: 'App access revoked' };
  }
}
