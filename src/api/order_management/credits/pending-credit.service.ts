import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreditStatus, Order } from 'src/schema/order_Management/order.schema';
import { UserLogic } from 'src/api/user/user.logic';
import { isAdminUser } from 'src/common/utils/has-permission.util';
import { PendingCreditReportQueryDto } from 'src/dto/order_management/order-payment.dto';
import {
  diffDateKeys,
  getBusinessTimezone,
  toDateKey,
} from '../financial/order-financial.util';

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches an id stored either as ObjectId or as string. */
const idIn = (ids: string[]) => ({
  $in: [
    ...ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id)),
    ...ids,
  ],
});

/**
 * counsellorId / courseVertical are stored as strings on orders (the
 * @Prop paths behave as Mixed), so they are converted before joining.
 */
export const counsellorAndPoolLookups =
  (): PipelineStage.FacetPipelineStage[] => [
    {
      $addFields: {
        _counsellorObjectId: {
          $convert: {
            input: '$counsellorId',
            to: 'objectId',
            onError: null,
            onNull: null,
          },
        },
        _courseObjectId: {
          $convert: {
            input: '$courseVertical',
            to: 'objectId',
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_counsellorObjectId',
        foreignField: '_id',
        as: 'counsellor',
      },
    },
    {
      $lookup: {
        from: 'pools',
        localField: '_courseObjectId',
        foreignField: '_id',
        as: 'pool',
      },
    },
  ];

export interface CreditRowsOptions {
  todayKey: string;
  timeZone: string;
}

/**
 * Pending-credit reporting. Everything is computed in MongoDB (unwind of the
 * embedded credits, effective status relative to "today" in the business
 * timezone, facet for rows/total/summary) – nothing is loaded into Node.js
 * beyond the requested page.
 */
@Injectable()
export class PendingCreditService {
  private readonly logger = new Logger(PendingCreditService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    private readonly userLogic: UserLogic,
  ) {}

  private async getAccessibleCounsellorIds(
    user: any,
  ): Promise<string[] | null> {
    if (isAdminUser(user)) return null; // admins see everything
    const userId = String(user?.userId || user?._id || '');
    try {
      const users = await this.userLogic.getUsersUnder({
        userId,
        roleName: 'user',
      });
      const ids = users.map((u: any) => u?._id?.toString?.()).filter(Boolean);
      return [...new Set([userId, ...ids])];
    } catch {
      return [userId];
    }
  }

  /**
   * Shared stages: approved orders → one document per credit with
   * dueDateKey, effectiveStatus (Paid / Overdue / Pending) and timing
   * (past / today / upcoming).
   */
  static buildCreditStages(
    orderMatch: Record<string, any>,
    { todayKey, timeZone }: CreditRowsOptions,
  ): PipelineStage[] {
    return [
      {
        $match: {
          Approved: true,
          'credits.0': { $exists: true },
          ...orderMatch,
        },
      },
      {
        $project: {
          studentName: 1,
          email: 1,
          mobile: 1,
          courseName: 1,
          courseVertical: 1,
          counsellorId: 1,
          counsellorName: 1,
          finalFee: 1,
          orderDate: 1,
          credits: 1,
        },
      },
      { $unwind: '$credits' },
      {
        $addFields: {
          dueDateKey: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$credits.dueDate',
              timezone: timeZone,
            },
          },
        },
      },
      {
        $addFields: {
          isPaid: { $eq: ['$credits.status', CreditStatus.PAID] },
          timing: {
            $cond: [
              { $lt: ['$dueDateKey', todayKey] },
              'past',
              {
                $cond: [
                  { $eq: ['$dueDateKey', todayKey] },
                  'today',
                  'upcoming',
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          effectiveStatus: {
            $cond: [
              '$isPaid',
              CreditStatus.PAID,
              {
                $cond: [
                  { $eq: ['$timing', 'past'] },
                  CreditStatus.OVERDUE,
                  CreditStatus.PENDING,
                ],
              },
            ],
          },
        },
      },
    ];
  }

  static categoryMatch(category: string): Record<string, any> {
    switch (category) {
      case 'pastDue':
        return { isPaid: false, timing: 'past' };
      case 'dueToday':
        return { isPaid: false, timing: 'today' };
      case 'upcoming':
        return { isPaid: false, timing: 'upcoming' };
      case 'paid':
        return { isPaid: true };
      case 'all':
        return {};
      case 'pending':
      default:
        return { isPaid: false };
    }
  }

  async getReport(query: PendingCreditReportQueryDto, user: any) {
    const timeZone = getBusinessTimezone();
    const now = new Date();
    const todayKey = toDateKey(now, timeZone);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 20));
    const category = query.category || 'pending';

    const orderMatch: Record<string, any> = {};
    const accessible = await this.getAccessibleCounsellorIds(user);
    if (accessible) {
      if (query.counsellorId && !accessible.includes(query.counsellorId)) {
        throw new ForbiddenException(
          'You cannot view credits of this counsellor',
        );
      }
      orderMatch.counsellorId = idIn(accessible);
    }
    if (query.counsellorId)
      orderMatch.counsellorId = idIn([query.counsellorId]);
    if (query.courseVertical)
      orderMatch.courseVertical = idIn([query.courseVertical]);
    if (query.courseName) {
      orderMatch.courseName = {
        $regex: escapeRegex(query.courseName),
        $options: 'i',
      };
    }
    if (query.search) {
      const regex = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
      orderMatch.$or = [
        { studentName: regex },
        { email: regex },
        { mobile: regex },
      ];
    }

    const stages = PendingCreditService.buildCreditStages(orderMatch, {
      todayKey,
      timeZone,
    });

    const dueRange: Record<string, string> = {};
    if (query.fromDate)
      dueRange.$gte = toDateKey(new Date(query.fromDate), timeZone);
    if (query.toDate)
      dueRange.$lte = toDateKey(new Date(query.toDate), timeZone);
    if (Object.keys(dueRange).length)
      stages.push({ $match: { dueDateKey: dueRange } });

    const unpaid = { $eq: ['$isPaid', false] };
    const sumIf = (cond: any) => ({
      $sum: { $cond: [cond, '$credits.amount', 0] },
    });
    const countIf = (cond: any) => ({ $sum: { $cond: [cond, 1, 0] } });
    const overdue = { $and: [unpaid, { $eq: ['$timing', 'past'] }] };
    const today = { $and: [unpaid, { $eq: ['$timing', 'today'] }] };
    const upcoming = { $and: [unpaid, { $eq: ['$timing', 'upcoming'] }] };

    const filtered = PendingCreditService.categoryMatch(category);
    const sort: Record<string, 1 | -1> =
      category === 'paid'
        ? { 'credits.paymentDate': -1, _id: 1 }
        : { 'credits.dueDate': 1, _id: 1 };

    stages.push({
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalPendingCreditAmount: sumIf(unpaid),
              totalPendingCreditRecords: countIf(unpaid),
              totalOverdueCreditAmount: sumIf(overdue),
              totalOverdueCreditRecords: countIf(overdue),
              totalDueTodayAmount: sumIf(today),
              totalDueTodayRecords: countIf(today),
              totalUpcomingAmount: sumIf(upcoming),
              totalUpcomingRecords: countIf(upcoming),
              totalPaidAmount: sumIf('$isPaid'),
              totalPaidRecords: countIf('$isPaid'),
            },
          },
        ],
        total: [{ $match: filtered }, { $count: 'count' }],
        rows: [
          { $match: filtered },
          { $sort: sort },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          ...counsellorAndPoolLookups(),
          {
            $project: {
              _id: 0,
              orderId: '$_id',
              creditId: '$credits._id',
              studentName: 1,
              studentEmail: '$email',
              mobile: 1,
              courseName: {
                $ifNull: ['$courseName', { $arrayElemAt: ['$pool.name', 0] }],
              },
              courseVertical: 1,
              counsellorId: 1,
              counsellorName: {
                $ifNull: [
                  { $arrayElemAt: ['$counsellor.name', 0] },
                  '$counsellorName',
                ],
              },
              finalFee: 1,
              orderDate: 1,
              creditAmount: '$credits.amount',
              creditDueDate: '$credits.dueDate',
              dueDateKey: 1,
              creditStatus: '$effectiveStatus',
              paymentReferenceId: '$credits.paymentReferenceId',
              paymentDate: '$credits.paymentDate',
              paymentMode: '$credits.paymentMode',
              remarks: '$credits.remarks',
            },
          },
        ],
      },
    });

    const [result] = await this.orderModel.aggregate(stages);
    const summaryRow = result?.summary?.[0] || {};
    const total = result?.total?.[0]?.count || 0;

    const data = (result?.rows || []).map((row: any) => {
      const daysOverdue =
        row.creditStatus === CreditStatus.OVERDUE
          ? diffDateKeys(row.dueDateKey, todayKey)
          : 0;
      const rest = { ...row };
      delete rest.dueDateKey; // internal helper field
      return { ...rest, daysOverdue };
    });

    const summary = {
      totalPendingCreditAmount: summaryRow.totalPendingCreditAmount || 0,
      totalOverdueCreditAmount: summaryRow.totalOverdueCreditAmount || 0,
      totalDueTodayAmount: summaryRow.totalDueTodayAmount || 0,
      totalUpcomingAmount: summaryRow.totalUpcomingAmount || 0,
      totalPaidAmount: summaryRow.totalPaidAmount || 0,
      totalPendingCreditRecords: summaryRow.totalPendingCreditRecords || 0,
      totalOverdueCreditRecords: summaryRow.totalOverdueCreditRecords || 0,
      totalDueTodayRecords: summaryRow.totalDueTodayRecords || 0,
      totalUpcomingRecords: summaryRow.totalUpcomingRecords || 0,
      totalPaidRecords: summaryRow.totalPaidRecords || 0,
    };

    return {
      data,
      summary,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      today: todayKey,
      timezone: timeZone,
      filters: { ...query, category },
    };
  }
}
