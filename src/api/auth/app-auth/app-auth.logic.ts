import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AppAuthData } from './app-auth.data';
import { UserAppHistoryData } from './user-app-history.data';

@Injectable()
export class AppAuthLogic {
  constructor(
    private readonly appAuthData: AppAuthData,
    private readonly userAppHistoryData: UserAppHistoryData,
    private readonly jwtService: JwtService,
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

    const accessToken = this.jwtService.sign(
      {
        userId: record.userId,
        scope: 'APP',
      },
      { expiresIn: '24h' },
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
