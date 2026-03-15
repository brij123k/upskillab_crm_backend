import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadSchedule } from 'src/schema/lead_management/lead-schedule.schema';

// @Injectable()
export class LeadScheduleData {
  constructor(
    @InjectModel(LeadSchedule.name)
    private readonly model: Model<LeadSchedule>,
  ) { }

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
    return this.model.findOneAndUpdate(
      {
        scheduledAt: { $lte: now },
        isTriggered: false,
      },
      {
        $set: { isTriggered: true,status:"overdue" },
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

  async getSchedules(filters: any, leads: any) {

    const query: any = {};
    const leadIds = leads.map((l) => l.leadId);
    if (filters.leadId) {
      query.leadId = filters.leadId;
    }
    query.leadId = { $in: leadIds };
    if (filters.leadId) {
      if (!leadIds.includes(Number(filters.leadId))) {
        return []; // prevent access to other user's lead
      }

      query.leadId = filters.leadId;
    }

    if (filters.status === 'upcoming') {
      query.scheduledAt = { $gt: new Date() };
      query.status = 'pending';
    }

    if (filters.status === 'overdue') {
      query.scheduledAt = { $lt: new Date() };
      query.status = 'pending';
    }

    if (filters.status === 'completed') {
      query.status = 'completed';
    }

    // today filter
    if (filters.dateFilter === 'today') {

      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const end = new Date();
      end.setHours(23, 59, 59, 999);

      query.scheduledAt = {
        $gte: start,
        $lte: end
      };

    }

    // custom date
    if (filters.dateFilter === 'custom') {

      query.scheduledAt = {
        $gte: new Date(filters.from),
        $lte: new Date(filters.to)
      };

    }
    query.status = { $ne: 'completed' };
    return this.model
      .find(query)
      .sort({ scheduledAt: 1 });

  }

  async markCompleted(id: string) {

    return this.model.updateOne(
      { _id: id },
      {
        status: "completed",
        completedAt: new Date(),
      },
    );

  }
}
