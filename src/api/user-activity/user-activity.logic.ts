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
}
