import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppAuthToken } from 'src/schema/App_management/app-auth-token.schema';

export class AppAuthData {
  constructor(
    @InjectModel(AppAuthToken.name)
    private readonly model: Model<AppAuthToken>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findValidToken(token: string) {
    return this.model.findOne({
      token,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });
  }

  deactivateAll(userId: string) {
    return this.model.updateMany(
      { userId },
      { isActive: false },
    );
  }
}
