import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadScheduleData } from './lead-schedule.data';
import { CreateLeadScheduleDTO } from 'src/dto/lead-management/lead-schedule.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { Model } from 'mongoose';
import { LeadHistoryLogic } from '../lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';

@Injectable()
export class LeadScheduleLogic {
  constructor(
    private readonly data: LeadScheduleData,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
    private readonly leadHistoryLogic: LeadHistoryLogic,
  ) {}

  async create(dto: CreateLeadScheduleDTO,user:any) {
    const exist = await this.leadModel.findOne({leadId:dto.leadId})
    if(!exist){
      throw new NotFoundException("Lead Not found")
    }
    const result = this.data.create({
      leadId: dto.leadId,
      scheduledAt: dto.scheduledAt,
      message: `You have a scheduled follow-up for Lead #${dto.leadId}`,
    });

      await this.leadHistoryLogic.log({
          leadId: dto.leadId.toString(),
          actionType: LeadActionType.LEAD_SCHEDULE,
          actionBy: user.userId,
          changes: {
            message:"Lead Scheduled",
            scheduler: dto.scheduledAt,
          },
        });
    return result;
  }
}
