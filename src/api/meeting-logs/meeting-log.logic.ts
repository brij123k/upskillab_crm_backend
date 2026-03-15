import { Injectable, NotFoundException } from '@nestjs/common';
import { MeetingLogData } from './meeting-log.data';
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { MeetingFeedbackLogData } from './meeting-feedback.data';
import { Types } from 'mongoose';
import { UserLogic } from '../user/user.logic';
import { LeadLogic } from '../lead_management/lead/lead.logic';
@Injectable()
export class MeetingLogLogic {
  constructor(private readonly data: MeetingLogData,
    private readonly meetingFeedbackLog: MeetingFeedbackLogData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly leadLogic:LeadLogic,
    private readonly userActivityLogic: UserActivityLogic,
    private readonly userLogic: UserLogic,
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
    if(dto.stageId){
    this.leadLogic.changeStagebyLeadId(dto.leadId,dto.stageId,userId)
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
        meta: {
          message:"meeting log created",
          meeting_log
        },
      });
      return{
        success :true,
        data :meeting_log
      }
  }

  async update(id: string, dto: any,userId:string) {
    const meeting_log= await this.data.update(id, dto);
    if(!meeting_log){
        throw new NotFoundException("Meeting Log not found")
    }
    if(dto.stageId){
    this.leadLogic.changeStagebyLeadId(dto.leadId,dto.stageId,userId)
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
        meta: {
          message:"meeting log updated",
          meeting_log},
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

async getMeetingsByUsers(filter: any, userId: string) {
  if (filter.group == 'true') {
    const users = await this.userLogic.getUsersUnder(userId);

    const accessibleUserIds = users.map(u => u._id.toString());
    accessibleUserIds.push(userId);

    if (!accessibleUserIds.length) {
      return this.data.meetingsWithFeedbacks(filter, [userId]);
    }

    return this.data.meetingsWithFeedbacks(filter, accessibleUserIds);
  }

  // 🔹 normal single user
  return this.data.meetingsWithFeedbacks(filter, [userId]);
}

async addFeedback(dto:any,userId:string){
  const res = await this.meetingFeedbackLog.create(
    {...dto,
      userId:new Types.ObjectId(userId),
      meetingId:new Types.ObjectId(dto.meetingId)
    })

    await this.leadHistoryLogic.log({
        leadId: res.leadId.toString(),
        actionType: LeadActionType.MEET_LOG_FEEDBACK,
        meet_log:res.meetingId.toString(),
        actionBy: res.userId.toString(),
        changes: res,
        reason:dto?.feedback
      });
      await this.userActivityLogic.log({
        userId: res.userId.toString(),
        action: 'MEET_LOG_FEEDBACK',
        referenceType: 'LEAD',
        referenceId: res.leadId.toString(),
        meta: {
          message:"meeting Feedback updated",
          res},
      });

      return res;
}

}
