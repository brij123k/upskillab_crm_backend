import { Injectable } from '@nestjs/common';
import { LeadHistoryData } from './lead-history.data';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';

@Injectable()
export class LeadHistoryLogic {
  constructor(private readonly historyData: LeadHistoryData) {}

  log(data: {
    leadId: string;
    actionType: LeadActionType;
    fromUser?: string;
    toUser?: string;
    actionBy: string;
    changes?: Record<string, any>;
  }) {
    return this.historyData.create(data);
  }

  getHistoryByLead(leadId: string) {
    return this.historyData.findByLeadId(leadId);
  }
}
