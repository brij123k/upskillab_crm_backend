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
        $set: { isTriggered: true, status: "overdue" },
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
    const {
      page = 1,
      limit = 10,
      status,
      dateFilter,
      from,
      to,
      leadId
    } = filters;

    const query: any = {};
    const leadIds = leads.map(l => l.leadId);
    const now = new Date();

    const skip = (page - 1) * limit;

    // 🎯 Lead filter
    if (leadId) {
      if (!leadIds.includes(Number(leadId))) return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0
      };

      query.leadId = Number(leadId);
    } else {
      query.leadId = { $in: leadIds };
    }

    // 🚨 FIX DB
    await this.model.updateMany(
      {
        leadId: { $in: leadIds },
        scheduledAt: { $lt: now },
        status: { $in: [LeadScheduleStatus.UPCOMING, null, ""] }
      },
      {
        $set: { status: LeadScheduleStatus.OVERDUE }
      }
    );

    // 🎯 STATUS FILTER
    if (status === 'upcoming') {
      query.status = LeadScheduleStatus.UPCOMING;
      query.scheduledAt = { $gt: now };
    }

    if (status === 'overdue') {
      query.status = LeadScheduleStatus.OVERDUE;
      query.scheduledAt = { $lt: now };
    }

    if (status === 'completed') {
      query.status = LeadScheduleStatus.COMPLETED;
    }

    // 📅 DATE FILTER
    if (dateFilter === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const end = new Date();
      end.setHours(23, 59, 59, 999);

      query.scheduledAt = { $gte: start, $lte: end };
    }

    if (dateFilter === 'custom') {
      query.scheduledAt = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    }

    // ❗ DEFAULT
    if (!status) {
      query.status = { $ne: LeadScheduleStatus.COMPLETED };
    }

    const sortOrder = 1;

    // 🚀 AGGREGATION (🔥 LIKE CALL LOGS)
    const pipeline: any[] = [
      { $match: query },

      // 🎯 stage lookup
      {
        $lookup: {
          from: "leads",
          let: { lead: "$leadId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$leadId", "$$lead"] }
              }
            },
            {
              $project: {
                _id: 0,
                leadId: 1,
                name: 1,
                phone: 1,
                stageId: 1   // ✅ IMPORTANT
              }
            }
          ],
          as: "lead"
        }
      },
      {
        $unwind: {
          path: "$lead",
          preserveNullAndEmptyArrays: true
        }
      },

      // 🎯 STEP 2: LOOKUP STAGE FROM LEAD
      {
        $lookup: {
          from: "leadstages",
          localField: "lead.stageId",
          foreignField: "_id",
          as: "stage"
        }
      },
      {
        $unwind: {
          path: "$stage",
          preserveNullAndEmptyArrays: true
        }
      },

      // 🎯 STEP 3: FLATTEN
      {
        $addFields: {
          leadName: "$lead.name",
          leadNumber: "$lead.phone",
          stageName: "$stage.name"
        }
      },

      {
        $project: {
          lead: 0,
          stage: 0
        }
      },

      { $sort: { scheduledAt: sortOrder } },

      // 🔥 pagination
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: Number(limit) }],
          total: [{ $count: "count" }]
        }
      }
    ];

    const result = await this.model.aggregate(pipeline);

    const data = result[0].data;
    const total = result[0].total[0]?.count || 0;

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    };
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
