import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadSchedule } from 'src/schema/lead_management/lead-schedule.schema';

// @Injectable()
export class LeadScheduleData {
  constructor(
    @InjectModel(LeadSchedule.name)
    private readonly model: Model<LeadSchedule>,
  ) {}

  create(data: Partial<LeadSchedule>) {
    return this.model.create(data);
  }
getFutureScheduleLead(leadId: number) {
  const now = new Date();

  return this.model.find({
    leadId,
    scheduledAt: { $gt: now }, // only future schedules
  }).sort({ scheduledAt: 1 }); // optional: earliest first
}

async getScheduledLeadIds(leadIds: number[]) {
  const now = new Date();

  const result = await this.model.distinct("leadId", {
    leadId: { $in: leadIds },
    scheduledAt: { $gt: now },
  });

  return result;
}



async lockOnePending(now: Date) {
  console.log(now)
  return this.model.findOneAndUpdate(
    {
      scheduledAt: { $lte: now },
      isTriggered: false,
    },
    {
      $set: { isTriggered: true },
    },
    {
      new: true,
    },
  );
}


  markTriggered(id: string) {
    return this.model.updateOne(
      { _id: id },
      { isTriggered: true },
    );
  }
}
