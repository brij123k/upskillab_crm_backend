import { Injectable, NotFoundException } from '@nestjs/common';
import { CallLogData } from './call-log.data';
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { UserActivityLogic } from '../user-activity/user-activity.logic';

@Injectable()
export class CallLogLogic {
  constructor(
    private readonly callLogData: CallLogData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,
  ) {}

  async create(dto: any, currentUserId: string) {
    const callLog = await this.callLogData.create({
      ...dto,
      userId: dto.userId || currentUserId,
    });

    // 🧾 Lead history
    await this.leadHistoryLogic.log({
      leadId: callLog.leadId.toString(),
      actionType: LeadActionType.CALL_LOG,
      actionBy: callLog.userId.toString(),
      changes: dto,
    });

    // 👤 User activity
    await this.userActivityLogic.log({
      userId: callLog.userId.toString(),
      action: 'CALL_LOGGED',
      referenceType: 'LEAD',
      referenceId: callLog.leadId.toString(),
      meta: dto,
    });

    return callLog;
  }

  getByLead(leadId: number) {
    return this.callLogData.findByLeadId(leadId);
  }

  getByUser(userId: string) {
    return this.callLogData.findByUserId(userId);
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
}
