import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { UserLogic } from '../user/user.logic';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { Order } from 'src/schema/order_Management/order.schema';
import { LeadSchedule } from 'src/schema/lead_management/lead-schedule.schema';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';
import { LeadStageHistory } from 'src/schema/lead_management/LeadStageHistory.schema';
@Injectable()
export class LeadStatsService {
constructor(
  @InjectModel(Lead.name)
  private readonly leadModel: Model<Lead>,

  @InjectModel(Order.name)
  private readonly orderModel: Model<Order>,

  @InjectModel(LeadSchedule.name)
  private readonly leadScheduleModel: Model<LeadSchedule>,

  @InjectModel(LeadStage.name)
  private readonly leadStageModel: Model<LeadStage>,

  @InjectModel(LeadStageHistory.name)
  private readonly leadStageHistoryModel: Model<LeadStageHistory>,

  private readonly userLogic: UserLogic,
) {}

async getLeadStats(query: any, user: any) {
  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  );

  const endOfMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  // Registration & Admission stage ids
  const stages = await this.leadStageModel.find({
    name: {
      $in: ['Registration Done', 'Admission Done'],
    },
  });

  const stageIds = stages.map((s) => s._id);

  // All leads assigned to this counsellor
  const assignedLeads = await this.leadModel
    .find({
      assignedTo: user.userId,
      isActive: true,
    })
    .select('_id leadId');

  const leadObjectIds = assignedLeads.map(
    (lead) => lead._id,
  );

  const leadIds = assignedLeads.map(
    (lead) => lead.leadId,
  );

  const [
    todayFollowUps,
    stageConversions,
    revenue,
  ] = await Promise.all([
    // Today's followups of this user's leads
    this.leadScheduleModel.countDocuments({
      leadId: {
        $in: leadIds,
      },
      scheduledAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    }),

    // Registration Done / Admission Done this month
    this.leadStageHistoryModel.countDocuments({
      leadId: {
        $in: leadObjectIds,
      },
      stageId: {
        $in: stageIds,
      },
      changedAt: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    }),

    // Revenue this month
    this.orderModel.aggregate([
      {
        $match: {
          counsellorId: user.userId,
          Approved: true,
          orderDate: {
            $gte: startOfMonth,
            $lte: endOfMonth,
          },
        },
      },
      {
        $group: {
          _id: null,
          orders: {
            $sum: 1,
          },
          revenue: {
            $sum: {
              $ifNull: [
                '$countedRevenue',
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  return {
    totalLeads: assignedLeads.length,

    todayFollowUps,

    monthlyConversions: stageConversions,

    approvedOrders:
      revenue.length > 0
        ? revenue[0].orders
        : 0,

    monthlyRevenue:
      revenue.length > 0
        ? revenue[0].revenue
        : 0,
  };
}
}