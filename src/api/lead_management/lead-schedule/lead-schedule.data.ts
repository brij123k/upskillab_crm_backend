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

async lockOnePending(now: Date) {
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
