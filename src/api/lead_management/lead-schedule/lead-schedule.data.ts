import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadSchedule, LeadScheduleStatus } from 'src/schema/lead_management/lead-schedule.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';

// @Injectable()
export class LeadScheduleData {
  constructor(
    @InjectModel(LeadSchedule.name)
    private readonly model: Model<LeadSchedule>,

    @InjectModel(Lead.name)
        private readonly leadModel: Model<Lead>,
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
  const now = new Date();

  // 🎯 Lead filtering
  if (filters.leadId) {
    if (!leadIds.includes(Number(filters.leadId))) {
      return [];
    }
    query.leadId = Number(filters.leadId);
  } else {
    query.leadId = { $in: leadIds };
  }

  // 🚨 STEP 1: FIX DB (upcoming → overdue)
  await this.model.updateMany(
  {
    leadId: { $in: leadIds },
    scheduledAt: { $lt: now },
    status: {
      $in: [
        LeadScheduleStatus.UPCOMING,
        null,
        "",
      ]
    }
  },
  {
    $set: { status: LeadScheduleStatus.OVERDUE },
  }
);
  // 🎯 Status filters (AFTER DB FIX)
  if (filters.status === 'upcoming') {
    query.status = LeadScheduleStatus.UPCOMING;
    query.scheduledAt = { $gt: now };
  }

  if (filters.status === 'overdue') {
    query.status = LeadScheduleStatus.OVERDUE;
    query.scheduledAt = { $lt: now };
  }

  if (filters.status === 'completed') {
    query.status = LeadScheduleStatus.COMPLETED;
  }

  // 📅 Today filter
  if (filters.dateFilter === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    query.scheduledAt = {
      $gte: start,
      $lte: end,
    };
  }

  // 📅 Custom filter
  if (filters.dateFilter === 'custom') {
    query.scheduledAt = {
      $gte: new Date(filters.from),
      $lte: new Date(filters.to),
    };
  }

  // ❗ Default: DO NOT return completed
  if (!filters.status) {
    query.status = { $ne: LeadScheduleStatus.COMPLETED };
  }

  // 🚀 FETCH UPDATED DATA
  const schedules = await this.model
    .find(query)
    .sort({ scheduledAt: 1 })
    .lean();

  // 🧠 FETCH LEADS
  const uniqueLeadIds = [...new Set(schedules.map(s => s.leadId))];

  const leadsData = await this.leadModel.find(
    { leadId: { $in: uniqueLeadIds } },
    { leadId: 1, name: 1, phone: 1 }
  ).lean();

  // 🔄 MAP
  const leadMap = {};
  leadsData.forEach(l => {
    leadMap[l.leadId] = l;
  });

  // 🎯 FINAL RESPONSE (NO FAKE STATUS NOW)
  const data = schedules.map(s => ({
    ...s,
    leadName: leadMap[s.leadId]?.name || null,
    leadNumber: leadMap[s.leadId]?.phone || null,
  }));

  return data;
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
