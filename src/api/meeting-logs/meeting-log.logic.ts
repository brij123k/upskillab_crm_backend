import { Injectable, NotFoundException } from '@nestjs/common';
import { MeetingLogData } from './meeting-log.data';
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { MeetingFeedbackLogData } from './meeting-feedback.data';
import { Types } from 'mongoose';
@Injectable()
export class MeetingLogLogic {
  constructor(private readonly data: MeetingLogData,
    private readonly meetingFeedbackLog: MeetingFeedbackLogData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,
  ) {}

 async create(dto: any, userId: string) {
    const meeting_log = await this.data.create({
      ...dto,
      userId,
    });
    if(dto.feedback){
        await this.meetingFeedbackLog.create(
            {
                meetingId:meeting_log._id,
                userId:new Types.ObjectId(userId),
                feedback:dto.feedback
            }
        )
    }
    // 2️⃣ Lead History
      await this.leadHistoryLogic.log({
        leadId: meeting_log.leadId.toString(),
        actionType: LeadActionType.MEET_LOG,
        actionBy: meeting_log.userId.toString(),
        changes: meeting_log,
        reason:dto?.feedback
      });
      await this.userActivityLogic.log({
        userId: meeting_log.userId.toString(),
        action: 'MEET_LOGGED',
        referenceType: 'LEAD',
        referenceId: meeting_log.leadId.toString(),
        meta: meeting_log,
      });
      return{
        success :true,
        data :meeting_log
      }
  }

  async update(id: string, dto: any) {
    const meeting_log= await this.data.update(id, dto);
    if(!meeting_log){
        throw new NotFoundException("Meeting Log not found")
    }
     await this.leadHistoryLogic.log({
        leadId: meeting_log.leadId.toString(),
        actionType: LeadActionType.MEET_LOG,
        actionBy: meeting_log.userId.toString(),
        changes: meeting_log,
        reason:dto?.feedback
      });
      await this.userActivityLogic.log({
        userId: meeting_log.userId.toString(),
        action: 'MEET_LOGGED',
        referenceType: 'LEAD',
        referenceId: meeting_log.leadId.toString(),
        meta: meeting_log,
      });
       return{
        success :true,
        data :meeting_log
      }
  }

  delete(id: string) {
    return this.data.delete(id);
  }

  getByLeadId(leadId: number) {
    return this.data.findByLeadId(leadId);
  }

  getByUser(user: any) {
    if (user.roleName === "Admin") {
      return this.data.findByUser();
    }
    return this.data.findByUser(user.userId);
  }

  meetingsWithFeedbacks(filters:any,user:any) {
    return this.data.meetingsWithFeedbacks(filters,user);
  }
}
