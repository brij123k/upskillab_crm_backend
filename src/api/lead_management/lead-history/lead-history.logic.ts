import { Injectable } from '@nestjs/common';
import { LeadHistoryData } from './lead-history.data';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class LeadHistoryLogic {
  constructor(
    private readonly historyData: LeadHistoryData,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
  ) {}

  async log(data: {
    leadId: string;
    actionType: LeadActionType;
    fromUser?: string;
    meet_log?:string;
    toUser?: string;
    actionBy: string;
    changes?: Record<string, any>;
    reason?:string;
  }) {
    const lead = await this.leadModel.findOne({leadId:Number(data.leadId)})
    console.log(lead)
    if(!lead){
      return false
    }
    return this.historyData.create(data);
  }

  getHistoryByLead(leadId: string) {
    return this.historyData.findByLeadId(leadId).populate('meet_log').populate('changes.stageId');
  }
}
