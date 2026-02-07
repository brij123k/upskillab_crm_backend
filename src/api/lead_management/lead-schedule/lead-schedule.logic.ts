import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadScheduleData } from './lead-schedule.data';
import { CreateLeadScheduleDTO } from 'src/dto/lead-management/lead-schedule.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { Model } from 'mongoose';

@Injectable()
export class LeadScheduleLogic {
  constructor(
    private readonly data: LeadScheduleData,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
  ) {}

  async create(dto: CreateLeadScheduleDTO) {
    const exist = await this.leadModel.findOne({leadId:dto.leadId})
    if(!exist){
      throw new NotFoundException("Lead Not found")
    }
    return this.data.create({
      leadId: dto.leadId,
      scheduledAt: dto.scheduledAt,
      message: `You have a scheduled follow-up for Lead #${dto.leadId}`,
    });
  }
}
