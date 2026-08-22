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

  // =========================================================
  // DEFAULT DATE RANGE
  // Current calendar month
  // =========================================================

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0,
  );

  let endDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  // =========================================================
  // DATE FILTER
  // =========================================================

  if (query.dateFilter) {
    const filter =
      String(query.dateFilter).toLowerCase();

    // -------------------------------------------------------
    // TODAY
    // -------------------------------------------------------

    if (filter === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    // -------------------------------------------------------
    // WEEK
    // Last 7 days
    // -------------------------------------------------------

    else if (filter === 'week') {
      startDate = new Date(now);
      startDate.setDate(
        startDate.getDate() - 7,
      );

      endDate = new Date(now);
    }

    // -------------------------------------------------------
    // MONTH
    // Current calendar month
    // -------------------------------------------------------

    else if (filter === 'month') {
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    }

    // -------------------------------------------------------
    // YEAR
    // Current calendar year
    // -------------------------------------------------------

    else if (filter === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    }
  }

  // =========================================================
  // REGISTRATION & ADMISSION STAGE IDS
  // =========================================================

  const stages =
    await this.leadStageModel.find({
      name: {
        $in: [
          'Registration Done',
          'Admission Done',
        ],
      },
    });

  const stageIds =
    stages.map(
      (s) => s._id,
    );

  // =========================================================
  // ALL LEADS ASSIGNED TO THIS COUNSELLOR
  // =========================================================

  const assignedLeads =
    await this.leadModel
      .find({
        assignedTo: user.userId,
        isActive: true,
      })
      .select(
        '_id leadId',
      );

  const leadObjectIds =
    assignedLeads.map(
      (lead) => lead._id,
    );

  const leadIds =
    assignedLeads.map(
      (lead) => lead.leadId,
    );

  // =========================================================
  // STATS
  // =========================================================

  const [
    todayFollowUps,
    stageConversions,
    revenue,
  ] = await Promise.all([

    // =======================================================
    // TODAY'S FOLLOWUPS
    // Always today regardless of selected dateFilter
    // =======================================================

    this.leadScheduleModel.countDocuments({
      leadId: {
        $in: leadIds,
      },

      scheduledAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    }),

    // =======================================================
    // REGISTRATION / ADMISSION CONVERSIONS
    // Uses selected date filter
    // =======================================================

    this.leadStageHistoryModel.countDocuments({
      leadId: {
        $in: leadObjectIds,
      },

      stageId: {
        $in: stageIds,
      },

      changedAt: {
        $gte: startDate,
        $lte: endDate,
      },
    }),

    // =======================================================
    // REVENUE
    //
    // Lumpsum -> lumpsumDetails.totalReceived
    // Loan    -> loanDetails.disbursementAmount
    // Subscription -> ignored for now
    //
    // Uses selected date filter
    // =======================================================

    this.orderModel.aggregate([
      {
        $match: {
          counsellorId: user.userId,

          Approved: true,

          orderDate: {
            $gte: startDate,
            $lte: endDate,
          },

          // Only orders with actual revenue
          $or: [
            {
              paymentMode: 'Lumpsum',

              'lumpsumDetails.totalReceived': {
                $gt: 0,
              },
            },

            {
              paymentMode: 'Loan',

              'loanDetails.disbursementAmount': {
                $gt: 0,
              },
            },

            // Subscription intentionally excluded
            // until its revenue calculation is added.
          ],
        },
      },

      // =====================================================
      // CALCULATE ACTUAL REVENUE
      // =====================================================

      {
        $addFields: {
          calculatedRevenue: {
            $switch: {
              branches: [

                // -------------------------------------------
                // LUMPSUM
                // -------------------------------------------

                {
                  case: {
                    $eq: [
                      '$paymentMode',
                      'Lumpsum',
                    ],
                  },

                  then: {
                    $ifNull: [
                      '$lumpsumDetails.totalReceived',
                      0,
                    ],
                  },
                },

                // -------------------------------------------
                // LOAN
                // -------------------------------------------

                {
                  case: {
                    $eq: [
                      '$paymentMode',
                      'Loan',
                    ],
                  },

                  then: {
                    $ifNull: [
                      '$loanDetails.disbursementAmount',
                      0,
                    ],
                  },
                },

                // -------------------------------------------
                // SUBSCRIPTION
                // -------------------------------------------

                // TODO:
                // Subscription revenue calculation later.
              ],

              default: 0,
            },
          },
        },
      },

      // =====================================================
      // SAFETY CHECK
      // =====================================================

      {
        $match: {
          calculatedRevenue: {
            $gt: 0,
          },
        },
      },

      // =====================================================
      // TOTAL
      // =====================================================

      {
        $group: {
          _id: null,

          orders: {
            $sum: 1,
          },

          revenue: {
            $sum: '$calculatedRevenue',
          },
        },
      },
    ]),
  ]);

  // =========================================================
  // RESPONSE
  // =========================================================

  return {
    totalLeads:
      assignedLeads.length,

    todayFollowUps,

    monthlyConversions:
      stageConversions,

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