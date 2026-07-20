import { Injectable } from '@nestjs/common';
import { UserActivityData } from './user-activity.data';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class UserActivityLogic {
  constructor(
    private readonly data: UserActivityData,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
  ) {}

  async log(data: any) {
    if(data.referenceId){
     const lead = await this.leadModel.findOne({leadId:Number(data.referenceId)})
    if(!lead){
      return false
    }
     }
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
