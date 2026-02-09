import { Injectable, NotFoundException } from '@nestjs/common';
import { CallLogData } from './call-log.data';
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { CallLogReview } from 'src/schema/all-log-review.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadLogic } from '../lead_management/lead/lead.logic';

@Injectable()
export class CallLogLogic {
  constructor(
    private readonly callLogData: CallLogData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,
    private readonly leadLogic:LeadLogic,

    @InjectModel(CallLogReview.name)
    private readonly model: Model<CallLogReview>,
  ) {}

  async create(dto: any, currentUserId: string) {
    const { remark, ...callLogData } = dto;
     const callLog = await this.callLogData.create({
    ...callLogData,
    userId: dto.userId || currentUserId,
    startedAt: dto.startedAt || new Date(),
  });

  // 2️⃣ Lead History
  await this.leadHistoryLogic.log({
    leadId: callLog.leadId.toString(),
    actionType: LeadActionType.CALL_LOG,
    actionBy: callLog.userId.toString(),
    changes: callLogData,
    reason:remark
  });

  // 3️⃣ User Activity
  await this.userActivityLogic.log({
    userId: callLog.userId.toString(),
    action: 'CALL_LOGGED',
    referenceType: 'LEAD',
    referenceId: callLog.leadId.toString(),
    meta: callLogData,
  });

  // 4️⃣ Create Review IF provided
  if (remark) {
    await this.createreview({
      leadId: callLog.leadId,
      callLogId: callLog._id,
      userId: callLog.userId,
      remark,
    });
  }

  return {
    message: 'Call log created successfully',
    callLogId: callLog._id,
    reviewAdded: !!remark,
  };
  }

async getByLead(leadId: number) {
  // 1️⃣ Get call logs
  const callLogs = await this.callLogData.findByLeadId(leadId);

  if (!callLogs.length) return [];

  // 2️⃣ Get remarks for all callLogs
  const callLogIds = callLogs.map((c) => c._id);

  const remarks = await this.findByCallLogIds(callLogIds);
  const remarkMap = new Map(
    remarks.map((r) => [
      r.callLogId.toString(),
      r.remark,
    ]),
  );

  // 3️⃣ Get lead info (name + phone)
  const lead = await this.leadLogic.getLeadByLeadId(leadId);

  // 4️⃣ Attach everything
  return callLogs.map((log) => ({
    ...log.toObject(),
    remark: remarkMap.get(log._id.toString()) || null,
    leadName: lead?.name || null,
    leadNumber:lead?.phone || null,
  }));
}

  async getByUser(filter: any, userId: string) {
  const result = await this.callLogData.findWithPagination(
    filter,
    userId,
  );

  if (!result.data.length) {
    return result;
  }

  // 1️⃣ Collect unique leadIds
  const leadIds = [
    ...new Set(result.data.map((log) => log.leadId)),
  ];

  // 2️⃣ Fetch all leads in one query
  const leads = await this.leadLogic.getLeadsByLeadIds(
    leadIds,
  );

  // 3️⃣ Create lookup map
  const leadMap = new Map(
    leads.map((l) => [
      l.leadId,
      { name: l.name, phone: l.phone },
    ]),
  );

  // 4️⃣ Attach lead info (NO toObject)
  const enrichedData = result.data.map((log) => {
    const lead = leadMap.get(log.leadId);

    return {
      ...log, // ✅ aggregation result = plain object
      leadName: lead?.name || null,
      leadNumber: lead?.phone || null,
    };
  });

  return {
    ...result,
    data: enrichedData,
  };
}

async getByUsers(filter: any, userId: string){
  const result = await this.callLogData.findCallLogWithPagination(
    filter,
    userId,
  );
  return result
}


  async update(id: string, dto: any, currentUserId: string) {
    const existing = await this.callLogData.findById(id);
    if (!existing) throw new NotFoundException('Call log not found');

    const updated = await this.callLogData.update(id, dto);
    await this.userActivityLogic.log({
      userId: currentUserId,
      action: 'CALL_LOG_UPDATED',
      referenceType: 'CALL_LOG',
      referenceId: id,
      meta: { from: existing, to: updated },
    });


    return updated;
  }

  async delete(id: string, currentUserId: string) {
    const deleted = await this.callLogData.delete(id);
    if (!deleted) throw new NotFoundException('Call log not found');

    await this.userActivityLogic.log({
      userId: currentUserId,
      action: 'CALL_LOG_DELETED',
      referenceType: 'CALL_LOG',
      referenceId: id,
    });

    return { message: 'Call log deleted successfully' };
  }



  createreview(data: any) {
    return this.model.create(data);
  }

  findByCallLogIds(callLogIds: any) {
    return this.model.find({
      callLogId: { $in: callLogIds },
    });
  }
//   async getWithReviews(filters: any, userId?: string) {
//   const result = await this.callLogData.findWithPagination(
//     filters,
//     userId,
//   );

//   const callLogIds = result.data.map((c) => c._id.toString());

//   const reviews =
//     await this.callLogReviewData.findByCallLogIds(
//       callLogIds,
//     );

//   const reviewMap = new Map(
//     reviews.map((r) => [
//       r.callLogId.toString(),
//       r,
//     ]),
//   );

//   const finalData = result.data.map((log) => ({
//     ...log.toObject(),
//     review: reviewMap.get(log._id.toString()) || null,
//   }));

//   return {
//     ...result,
//     data: finalData,
//   };
// }
}
