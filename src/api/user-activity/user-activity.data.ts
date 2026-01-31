import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserActivity } from 'src/schema/user-activity.schema';

export class UserActivityData {
  constructor(
    @InjectModel(UserActivity.name)
    private readonly model: Model<UserActivity>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findByUser(userId: string) {
    return this.model
      .find({ userId })
      .sort({ createdAt: -1 });
  }
}
