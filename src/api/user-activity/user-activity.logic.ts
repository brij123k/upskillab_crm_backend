import { Injectable } from '@nestjs/common';
import { UserActivityData } from './user-activity.data';

@Injectable()
export class UserActivityLogic {
  constructor(private readonly data: UserActivityData) {}

  log(data: any) {
    return this.data.create(data);
  }

  getByUser(userId: string) {
    return this.data.findByUser(userId);
  }

  getRecentByUserIds(userIds?: string[], limit = 5) {
    return this.data.findRecentByUserIds(userIds, limit);
  }

  getRecentBusinessActivities(userIds?: string[], limit = 5) {
    return this.data.findRecentBusinessActivities(userIds, limit);
  }
}
