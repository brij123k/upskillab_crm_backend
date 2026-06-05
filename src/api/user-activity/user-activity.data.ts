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

  findRecentByUserIds(userIds?: string[], limit = 5) {
    const query: any = {};

    if (userIds?.length) {
      query.userId = { $in: userIds };
    }

    return this.model
      .find(query)
      .populate({
        path: 'userId',
        select: 'name email employeeId role',
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  findRecentBusinessActivities(userIds?: string[], limit = 5) {
    const query: any = {
      $or: [
        { referenceType: { $in: ['LEAD', 'ORDER', 'Payment', 'Payment Link', 'REVENUE'] } },
        { action: { $regex: /lead|order|payment|revenue/i } },
      ],
    };

    if (userIds?.length) {
      query.userId = { $in: userIds };
    }

    return this.model
      .find(query)
      .populate({
        path: 'userId',
        select: 'name email employeeId role',
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}
