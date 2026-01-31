import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserAppHistory } from 'src/schema/App_management/user-app-history.schema';

export class UserAppHistoryData {
  constructor(
    @InjectModel(UserAppHistory.name)
    private readonly model: Model<UserAppHistory>,
  ) {}

  log(data: any) {
    return this.model.create(data);
  }

  logoutAll(userId: string) {
    return this.model.updateMany(
      { userId, isActive: true },
      { isActive: false, logoutAt: new Date() },
    );
  }
}
