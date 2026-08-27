import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderStatus, PaymentMode } from 'src/schema/order_Management/order.schema';
import { CreateOrderDto, UpdateOrderDto } from 'src/dto/order_management/create-order.dto';
import { Pool } from 'src/schema/Pool.schema';
import { LoanEmi } from 'src/schema/order_Management/loan-emi.schema';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { UserLogic } from '../user/user.logic';
import { EmailService } from 'src/common/services/email.service';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { CallLog } from 'src/schema/call-log.schema';
import { Role } from 'src/schema/role.schema';
import { User, UserStatus } from 'src/schema/user.schema';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Pool.name) private poolModel: Model<Pool>,
    @InjectModel(LoanEmi.name) private emiModel: Model<LoanEmi>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<Subscription>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(CallLog.name) private readonly callLogModel: Model<CallLog>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(LeadStage.name)
    private readonly leadStageModel: Model<LeadStage>,
    private readonly userLogic: UserLogic,
    private readonly emailService: EmailService,
    private readonly userActivityLogic: UserActivityLogic,
  ) { }

  private resolveLevel(level: any): number | null {
    if (level === undefined || level === null || String(level).trim() === '') {
      return 1;
    }

    const levelNumber = Number(level);
    return Number.isNaN(levelNumber) ? null : levelNumber;
  }

  private async getRoleIdsByLevel(level: any): Promise<Types.ObjectId[]> {
    const levelNumber = this.resolveLevel(level);
    if (levelNumber === null) return [];

    const roles = await this.roleModel.find({ level: levelNumber }).select('_id').lean();
    return roles.map((role) => role._id);
  }

  private async getUserIdsByRoleLevel(level: any): Promise<Types.ObjectId[]> {
    const roleIds = await this.getRoleIdsByLevel(level);
    if (!roleIds.length) return [];

    const roleIdStrings = roleIds.map((roleId) => roleId.toString());

    const users = await this.userModel.aggregate([
      {
        $addFields: {
          normalizedRoleId: {
            $convert: {
              input: '$role',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $match: {
          status: UserStatus.ACTIVE,
          isBlocked: false,
          $or: [
            { role: { $in: roleIds } },
            { normalizedRoleId: { $in: roleIdStrings } },
          ],
        },
      },
      {
        $project: {
          _id: 1,
        },
      },
    ]);

    return users.map((user) => user._id);
  }

  private async getUserAndSubordinateIds(userId: string): Promise<string[]> {
    try {
      const users = await this.userLogic.getUsersUnder({
        userId,
        roleName: 'user',
      });

      const ids = users
        .map((user: any) => user?._id?.toString?.())
        .filter(Boolean);

      ids.push(userId);
      return [...new Set(ids)];
    } catch {
      return [userId];
    }
  }

  async createOrder(dto: CreateOrderDto, userId: string) {
    try {
      const user = await this.userLogic.findById(userId);
      if (!user) throw new BadRequestException('Invalid counsellorId');
      const pool = await this.poolModel.findById(dto.courseVertical);
      if (!pool) throw new BadRequestException('Invalid pool');
      let finalFee:number
      if(dto.finalFee && dto.finalFee > 0){
        finalFee = dto.finalFee
      }else{
        finalFee = dto.totalFee - (dto.discount || 0);
      }
      let status = OrderStatus.PARTIALLY_PAID;
      let countedRevenue = Number(pool.revenue_percentage) * finalFee / 100;
      // 🔥 STEP 1: CREATE ORDER FIRST
      if (dto.GSTEnabled) {
        finalFee += dto.GSTAmount;
      }
      const order = await this.orderModel.create({
        ...dto,
        counsellorId: userId,
        counsellorName: user.name,
        countedRevenue: countedRevenue,
        finalFee,
        status,
      });

      // ================= LOAN =================
      if (dto.paymentMode === PaymentMode.LOAN) {
        const firstDate = new Date(dto.loanDetails.firstEmiDate);

        const secondDate = new Date(firstDate);
        secondDate.setMonth(secondDate.getMonth() + 1);

        const thirdDate = new Date(firstDate);
        thirdDate.setMonth(thirdDate.getMonth() + 2);

        const emi = await this.emiModel.create({
          orderId: order._id,
          learnerName: dto.studentName,
          mobile: dto.mobile,
          email: dto.email,
          couselorId: userId,
          counselorName: user.name,
          LoanPartner: dto.loanDetails.loanPartner,
          loanAmount: dto.loanDetails.loanAmount,
          disbursementAmount: dto.loanDetails.disbursementAmount,
          loanDate: dto.loanDetails.loanDate,
          firstEmiDate: firstDate,
          secondEmiDate: secondDate,
          thirdEmiDate: thirdDate,
        });

        order.loanDetails = {
          ...dto.loanDetails,
          loanId: emi._id,

        };
        order.status = OrderStatus.FULLY_PAID;

        await order.save();
      }

      // ================= LUMPSUM =================
      if (dto.paymentMode === PaymentMode.LUMPSUM) {
        let pendingAmount = finalFee;

        if (dto.lumpsumDetails?.totalReceived >= finalFee) {
          status = OrderStatus.FULLY_PAID;
          pendingAmount = 0;
        } else {
          pendingAmount =
            finalFee - (dto.lumpsumDetails?.totalReceived || 0);
        }

        order.status = status;

        order.lumpsumDetails = {
          ...dto.lumpsumDetails,
          pendingAmount,
        };

        await order.save();
      }

      // ================= SUBSCRIPTION =================
      if (dto.paymentMode === PaymentMode.SUBSCRIPTION) {
        const installments: any[] = [];

        const firstDate = new Date(
          dto.subscriptionDetails.firstInstallmentDate,
        );

        const totalInstallments =
          dto.subscriptionDetails.numberOfInstallments;

        const installmentAmount =
          dto.subscriptionDetails.installmentAmount;

        for (let i = 0; i < totalInstallments; i++) {
          const dueDate = new Date(firstDate);
          dueDate.setMonth(dueDate.getMonth() + i);

          installments.push({
            installmentNo: i + 1,
            dueDate,
            amount: installmentAmount,
          });
        }

        // await this.subscriptionModel.create({
        //   orderId: order._id,
        //   studentName: order.studentName,
        //   mobile: order.mobile,
        //   email: order.email,
        //   counselorName: order.counsellorName,
        //   totalAmount: order.finalFee,
        //   installmentAmount,
        //   numberOfInstallments: totalInstallments,
        //   firstInstallmentDate: firstDate,
        //   lastInstallmentDate:
        //     installments[installments.length - 1].dueDate,
        //   installments,
        // });
      }
      await this.userActivityLogic.log({
        userId: userId,
        action: 'Order Created',
        referenceType: 'ORDER',
        meta: {
          message: dto.remarks,
          PaymentMode: dto.paymentMode,
          order
        },
      });

      return order;
    } catch (error: any) {
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern || {})[0];
        throw new BadRequestException(`${field} already exists`);
      }

      throw error;
    }
  }

  async applySubscriptionPayment(orderId: string, amount: number) {
    const sub = await this.subscriptionModel.findOne({ orderId });

    if (!sub) return;

    for (const inst of sub.installments) {
      if (!inst.isPaid) {
        inst.isPaid = true;
        inst.paidAt = new Date();
        break;
      }
    }

    const allPaid = sub.installments.every(i => i.isPaid);
    if (allPaid) sub.status = 'COMPLETED';

    await sub.save();

    await this.applyPayment(orderId, amount);
  }

  async findAll(filters: any, user: any) {
    const {
      search,
      paymentMode,
      status,
      dateFilter,
      fromDate,
      toDate,
      counsellorId,
      group,
      page = 1,
      limit = 10,
    } = filters;

    const query: any = {};

    /* ================= GROUP FILTER ================= */

    let accessibleUserIds: string[] = [];

    if (group === true || group === 'true') {
      const users = await this.userLogic.getUsersUnder(user);
      accessibleUserIds = users.map((u) => u._id.toString());
      accessibleUserIds.push(user.userId);

      query.counsellorId = { $in: accessibleUserIds };
    } else if (user.roleName === 'bd') {
      query.counsellorId = user.userId;
    }

    /* ================= COUNSELLOR FILTER ================= */

    if (counsellorId) {
      query.counsellorId = counsellorId;
    }

    /* ================= SEARCH ================= */

    if (search) {
      query.$or = [
        { studentName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    /* ================= PAYMENT & STATUS ================= */

    if (paymentMode) query.paymentMode = paymentMode;
    if (status) query.status = status;

    /* ================= DATE FILTER ================= */

    const now = new Date();

if (dateFilter) {
  const filter = String(dateFilter).toLowerCase();

  if (filter === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    query.orderDate = {
      $gte: start,
      $lte: end,
    };
  }

  else if (filter === 'week') {
    // Last 7 days - same rolling logic
    // used by the Leads API
    const start = new Date();
    start.setDate(start.getDate() - 7);

    const end = new Date();

    query.orderDate = {
      $gte: start,
      $lte: end,
    };
  }

  else if (filter === 'month') {
    // Current calendar month
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );

    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    query.orderDate = {
      $gte: start,
      $lte: end,
    };
  }

  else if (filter === 'year') {
    // Current calendar year
    const start = new Date(
      now.getFullYear(),
      0,
      1,
      0,
      0,
      0,
      0,
    );

    const end = new Date(
      now.getFullYear(),
      11,
      31,
      23,
      59,
      59,
      999,
    );

    query.orderDate = {
      $gte: start,
      $lte: end,
    };
  }
}

/* ================= CUSTOM DATE ================= */

if (fromDate && toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);

  if (
    !Number.isNaN(from.getTime()) &&
    !Number.isNaN(to.getTime())
  ) {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    query.orderDate = {
      $gte: from,
      $lte: to,
    };
  }
}

    /* ================= PAGINATION ================= */

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.orderModel
        .find(query)
        .populate('courseVertical', 'name revenue_percentage')
        .populate('counsellorId', 'name email')
        .populate('approvedBy', 'name email')
        .populate('loanDetails.loanPartner', 'name type submissionCharge')
        .populate('loanDetails.loanId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      this.orderModel.countDocuments(query),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    return this.orderModel
      .findById(id)
      .populate('courseVertical', 'name revenue_percentage')
      .populate('counsellorId', 'name email')
      .populate('approvedBy', 'name email')
      .populate('loanDetails.loanPartner', 'name type submissionCharge')
      .populate('loanDetails.loanId');

  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.orderModel.findById(id);
    if (!existing) throw new BadRequestException('Order not found');
    if (existing.Approved) throw new BadRequestException('Cannot update approved order');
    await this.userActivityLogic.log({
      userId: userId,
      action: 'Order Updated',
      referenceType: 'ORDER',
      meta: {
        message: "Order updated",
        order: existing
      },
    });
    return this.orderModel.findByIdAndUpdate(id, dto, { new: true });
  }

  async approveOrder(id: string, approvedBy: string) {
    const order = await this.orderModel.findByIdAndUpdate(
      id,
      { Approved: true, approvedBy },
      { new: true },
    );
    await this.userActivityLogic.log({
      userId: approvedBy,
      action: 'Order Approved',
      referenceType: 'ORDER',
      meta: {
        message: "Order approved",
        order: order
      },
    });
    return order;

  }

  async paymentReport() {
    return this.orderModel.aggregate([
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$totalReceived' },
          count: { $sum: 1 },
        },
      },
    ]);
  }

async consultantPerformanceReport(query: any) {
  const now = new Date();

  const getFilterRange = (filter: any) => {
    const value = String(
      filter || '',
    ).toLowerCase();

    let startDate: Date;
    let endDate: Date;

    if (value === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (value === 'week') {
      startDate = new Date(now);
      startDate.setDate(
        startDate.getDate() - 6,
      );
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'month') {
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
    } else if (value === 'year') {
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
    } else {
      throw new BadRequestException(
        `Invalid date filter: ${filter}`,
      );
    }

    return {
      $gte: startDate,
      $lte: endDate,
    };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
    name: string,
  ) => {
    if (!fromValue || !toValue) {
      throw new BadRequestException(
        `${name}From and ${name}To are both required`,
      );
    }

    const from = new Date(fromValue);
    const to = new Date(toValue);

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime())
    ) {
      throw new BadRequestException(
        `Invalid ${name} date`,
      );
    }

    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    if (from > to) {
      throw new BadRequestException(
        `${name}From cannot be greater than ${name}To`,
      );
    }

    const diffDays =
      Math.floor(
        (to.getTime() -
          from.getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        `${name} date range cannot be more than 31 days`,
      );
    }

    return {
      $gte: from,
      $lte: to,
    };
  };

  const getDateRange = (
    filter: any,
    from: any,
    to: any,
    name: string,
  ) => {
    if (from || to) {
      return getCustomRange(
        from,
        to,
        name,
      );
    }

    if (filter) {
      return getFilterRange(filter);
    }

    return null;
  };

  const leadCreatedRange =
    getDateRange(
      query.leadCreatedDateFilter,
      query.leadCreatedDateFrom,
      query.leadCreatedDateTo,
      'leadCreatedDate',
    );

  const leadAssignedRange =
    getDateRange(
      query.leadAssignedDateFilter,
      query.leadAssignedDateFrom,
      query.leadAssignedDateTo,
      'leadAssignedDate',
    );

  const orderCreatedRange =
    getDateRange(
      query.orderCreatedDateFilter,
      query.orderCreatedDateFrom,
      query.orderCreatedDateTo,
      'orderCreatedDate',
    );

  const hasCreatedFilter =
    !!leadCreatedRange;

  const hasAssignedFilter =
    !!leadAssignedRange;

  const hasOrderFilter =
    !!orderCreatedRange;

  const hasLeadFilter =
    hasCreatedFilter ||
    hasAssignedFilter;

  const levelNumber =
    this.resolveLevel(
      query.level,
    );

  if (levelNumber === null) {
    return [];
  }

  const levelUserIds =
    await this.getUserIdsByRoleLevel(
      levelNumber,
    );

  if (!levelUserIds.length) {
    return [];
  }

  const selectedCounsellorId =
    query.counsellorId
      ? String(query.counsellorId)
      : null;

  let rootUsers =
    await this.userModel
      .find({
        _id: {
          $in: levelUserIds,
        },
        status: 'active',
      })
      .select(
        'name email employeeId role createdAt',
      )
      .lean();

  if (selectedCounsellorId) {
    const selectedCounsellor =
      await this.userModel
        .findOne({
          _id: selectedCounsellorId,
          status: 'active',
        })
        .populate(
          'role',
          'level',
        )
        .select(
          'name email employeeId role createdAt',
        )
        .lean();

    if (
      !selectedCounsellor ||
      Number(
        (selectedCounsellor as any)
          ?.role?.level,
      ) !== levelNumber
    ) {
      return [];
    }

    rootUsers = [
      selectedCounsellor,
    ];
  }

  const teamFilter =
    query.team === true ||
    query.team === 'true';

  const teamMap =
    new Map<string, string[]>();

  for (const user of rootUsers) {
    const rootId =
      user._id.toString();

    if (!teamFilter) {
      teamMap.set(
        rootId,
        [rootId],
      );

      continue;
    }

    const subordinateIds =
      await this.getUserAndSubordinateIds(
        rootId,
      );

    const allIds = [
      rootId,
      ...subordinateIds.map(
        (id: any) =>
          id.toString(),
      ),
    ];

    const uniqueIds = [
      ...new Set(allIds),
    ];

    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: uniqueIds,
          },
          status: 'active',
        })
        .select('_id')
        .lean();

    const activeIds =
      activeUsers.map(
        (user) =>
          user._id.toString(),
      );

    if (
      !activeIds.includes(rootId)
    ) {
      activeIds.push(rootId);
    }

    teamMap.set(
      rootId,
      [...new Set(activeIds)],
    );
  }

  const allAllowedUserIds = [
    ...new Set(
      Array.from(
        teamMap.values(),
      ).flat(),
    ),
  ];

  if (!allAllowedUserIds.length) {
    return [];
  }

  // =========================================================
  // ADMISSION DONE STAGE
  // =========================================================

  const admissionStage =
    await this.leadStageModel
      .findOne({
        name: {
          $regex: /^admission done$/i,
        },
      })
      .select('_id')
      .lean();

  const admissionStageId =
    admissionStage?._id
      ? admissionStage._id.toString()
      : null;

  // =========================================================
  // GET SELECTED LEADS
  //
  // created filter   -> created leads
  // assigned filter  -> assigned leads
  // both             -> leads satisfying BOTH
  // order-only       -> leads assigned in same order range
  // =========================================================

  let selectedLeads: any[] = [];

  const leadMatch: any = {
    normalizedAssignedTo: {
      $in: allAllowedUserIds,
    },
  };

  if (hasCreatedFilter) {
    leadMatch.createdAt =
      leadCreatedRange;
  }

  if (hasAssignedFilter) {
    leadMatch.assignedDate =
      leadAssignedRange;
  }

  if (hasLeadFilter) {
    selectedLeads =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input: '$assignedTo',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
          },
        },

        {
          $match: leadMatch,
        },

        {
          $project: {
            _id: 1,
            leadId: 1,
            name: 1,
            phone: 1,
            mobile: 1,
            email: 1,
            assignedTo: 1,
            assignedDate: 1,
            createdAt: 1,
            stageId: 1,
          },
        },
      ]);
  } else if (hasOrderFilter) {
    selectedLeads =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input: '$assignedTo',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
          },
        },

        {
          $match: {
            normalizedAssignedTo: {
              $in: allAllowedUserIds,
            },

            assignedDate:
              orderCreatedRange,
          },
        },

        {
          $project: {
            _id: 1,
            leadId: 1,
            name: 1,
            phone: 1,
            mobile: 1,
            email: 1,
            assignedTo: 1,
            assignedDate: 1,
            createdAt: 1,
            stageId: 1,
          },
        },
      ]);
  }

  // =========================================================
  // LEAD STATS
  //
  // IMPORTANT:
  // Admission Done is calculated directly from LEAD stageId.
  // It does NOT depend on orders.
  // =========================================================

  const leadStats =
    new Map<string, any>();

  const ensureLeadStats =
    (userId: string) => {
      if (
        !leadStats.has(userId)
      ) {
        leadStats.set(
          userId,
          {
            totalLeadAssigned: 0,
            admDone: 0,
          },
        );
      }

      return leadStats.get(userId);
    };

  selectedLeads.forEach(
    (lead: any) => {
      const assignedTo =
        lead.assignedTo
          ? String(
              lead.assignedTo,
            )
          : null;

      if (!assignedTo) {
        return;
      }

      const stats =
        ensureLeadStats(
          assignedTo,
        );

      stats.totalLeadAssigned += 1;

      if (
        admissionStageId &&
        lead.stageId &&
        String(lead.stageId) ===
          admissionStageId
      ) {
        stats.admDone += 1;
      }
    },
  );

  // =========================================================
  // LEAD CONTACTS FOR ORDER MATCH
  // =========================================================

  const leadMobiles = [
    ...new Set(
      selectedLeads
        .flatMap(
          (lead: any) => [
            lead.phone,
            lead.mobile,
          ],
        )
        .filter(Boolean)
        .map(
          (value: any) =>
            String(value),
        ),
    ),
  ];

  const leadEmails = [
    ...new Set(
      selectedLeads
        .map(
          (lead: any) =>
            lead.email,
        )
        .filter(Boolean)
        .map(
          (value: any) =>
            String(value)
              .toLowerCase(),
        ),
    ),
  ];

  // =========================================================
  // ORDERS
  // =========================================================

  let orderMatch: any = {
    Approved: true,
  };

  if (hasLeadFilter) {
    if (
      !leadMobiles.length &&
      !leadEmails.length
    ) {
      orderMatch._id = {
        $in: [],
      };
    } else {
      orderMatch.$or = [
        ...(leadMobiles.length
          ? [
              {
                mobile: {
                  $in: leadMobiles,
                },
              },
            ]
          : []),

        ...(leadEmails.length
          ? [
              {
                email: {
                  $in: leadEmails,
                },
              },
            ]
          : []),
      ];
    }
  } else if (hasOrderFilter) {
    orderMatch.orderDate =
      orderCreatedRange;

    orderMatch.normalizedCounsellorId = {
      $in: allAllowedUserIds,
    };
  }

  if (
    hasLeadFilter &&
    hasOrderFilter
  ) {
    orderMatch.orderDate =
      orderCreatedRange;
  }

  let orderStats: any[] = [];

  if (
    hasLeadFilter ||
    hasOrderFilter
  ) {
    orderStats =
      await this.orderModel.aggregate([
        {
          $addFields: {
            normalizedCounsellorId: {
              $convert: {
                input: '$counsellorId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },

            calculatedRevenue: {
              $switch: {
                branches: [
                  {
                    case: {
                      $eq: [
                        '$paymentMode',
                        PaymentMode.LOAN,
                      ],
                    },

                    then: {
                      $ifNull: [
                        '$loanDetails.disbursementAmount',
                        0,
                      ],
                    },
                  },

                  {
                    case: {
                      $eq: [
                        '$paymentMode',
                        PaymentMode.LUMPSUM,
                      ],
                    },

                    then: {
                      $ifNull: [
                        '$lumpsumDetails.totalReceived',
                        0,
                      ],
                    },
                  },
                ],

                default: 0,
              },
            },

            calculatedUnrealisedRevenue: {
              $switch: {
                branches: [
                  {
                    case: {
                      $eq: [
                        '$paymentMode',
                        PaymentMode.LOAN,
                      ],
                    },

                    then: 0,
                  },

                  {
                    case: {
                      $eq: [
                        '$paymentMode',
                        PaymentMode.LUMPSUM,
                      ],
                    },

                    then: {
                      $ifNull: [
                        '$lumpsumDetails.pendingAmount',
                        0,
                      ],
                    },
                  },
                ],

                default: 0,
              },
            },
          },
        },

        {
          $match: orderMatch,
        },

        {
          $sort: {
            feeDepositDate: -1,
            orderDate: -1,
            createdAt: -1,
          },
        },

        {
          $group: {
            _id:
              '$normalizedCounsellorId',

            registrationDone: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      '$registrationAmount',
                      0,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            bookedRevenue: {
              $sum:
                '$calculatedRevenue',
            },

            realisedRevenue: {
              $sum:
                '$calculatedRevenue',
            },

            unrealisedRevenue: {
              $sum:
                '$calculatedUnrealisedRevenue',
            },

            lastSalePunchDate: {
              $first:
                '$feeDepositDate',
            },

            lastRevenuePunched: {
              $first:
                '$calculatedRevenue',
            },
          },
        },
      ]);
  }

  // =========================================================
  // LAST MONTH
  // =========================================================

  const monthStart =
    new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
      0,
      0,
      0,
      0,
    );

  const monthEnd =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );

  const lastMonthStats =
    await this.orderModel.aggregate([
      {
        $addFields: {
          normalizedCounsellorId: {
            $convert: {
              input: '$counsellorId',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },

          calculatedRevenue: {
            $switch: {
              branches: [
                {
                  case: {
                    $eq: [
                      '$paymentMode',
                      PaymentMode.LOAN,
                    ],
                  },

                  then: {
                    $ifNull: [
                      '$loanDetails.disbursementAmount',
                      0,
                    ],
                  },
                },

                {
                  case: {
                    $eq: [
                      '$paymentMode',
                      PaymentMode.LUMPSUM,
                    ],
                  },

                  then: {
                    $ifNull: [
                      '$lumpsumDetails.totalReceived',
                      0,
                    ],
                  },
                },
              ],

              default: 0,
            },
          },
        },
      },

      {
        $match: {
          orderDate: {
            $gte: monthStart,
            $lte: monthEnd,
          },

          normalizedCounsellorId: {
            $in: allAllowedUserIds,
          },
        },
      },

      {
        $group: {
          _id:
            '$normalizedCounsellorId',

          tillDateRealisedInLastMonth: {
            $sum:
              '$calculatedRevenue',
          },
        },
      },
    ]);

  // =========================================================
  // COMBINE STATS
  // =========================================================

  const statsByConsultant =
    new Map<string, any>();

  const ensureStats =
    (id: string) => {
      if (
        !statsByConsultant.has(id)
      ) {
        statsByConsultant.set(
          id,
          {
            consultantId: id,

            totalLeadAssigned: 0,

            registrationDone: 0,

            // Admission Done comes ONLY from selected leads
            admDone: 0,

            bookedRevenue: 0,

            unrealisedRevenue: 0,

            realisedRevenue: 0,

            lastSalePunchDate: null,

            lastRevenuePunched: 0,

            tillDateRealisedInLastMonth: 0,
          },
        );
      }

      return statsByConsultant.get(id);
    };

  leadStats.forEach(
    (leadStat, id) => {
      const current =
        ensureStats(id);

      current.totalLeadAssigned +=
        leadStat.totalLeadAssigned || 0;

      current.admDone +=
        leadStat.admDone || 0;
    },
  );

  orderStats.forEach(
    (item) => {
      if (!item._id) {
        return;
      }

      const current =
        ensureStats(
          item._id.toString(),
        );

      current.registrationDone +=
        item.registrationDone || 0;

      current.bookedRevenue +=
        item.bookedRevenue || 0;

      current.realisedRevenue +=
        item.realisedRevenue || 0;

      current.unrealisedRevenue +=
        item.unrealisedRevenue || 0;

      if (
        item.lastSalePunchDate &&
        (
          !current.lastSalePunchDate ||
          new Date(
            item.lastSalePunchDate,
          ) >
            new Date(
              current.lastSalePunchDate,
            )
        )
      ) {
        current.lastSalePunchDate =
          item.lastSalePunchDate;

        current.lastRevenuePunched =
          item.lastRevenuePunched || 0;
      }
    },
  );

  lastMonthStats.forEach(
    (item) => {
      if (!item._id) {
        return;
      }

      const current =
        ensureStats(
          item._id.toString(),
        );

      current.tillDateRealisedInLastMonth +=
        item.tillDateRealisedInLastMonth ||
        0;
    },
  );

  // =========================================================
  // RESPONSE
  // =========================================================

  const report =
    rootUsers
      .map((user) => {
        const rootId =
          user._id.toString();

        const memberIds =
          teamMap.get(rootId) ||
          [rootId];

        const item =
          memberIds.reduce(
            (acc, memberId) => {
              const memberStats =
                statsByConsultant.get(
                  memberId,
                );

              if (!memberStats) {
                return acc;
              }

              acc.totalLeadAssigned +=
                memberStats.totalLeadAssigned || 0;

              acc.registrationDone +=
                memberStats.registrationDone || 0;

              acc.admDone +=
                memberStats.admDone || 0;

              acc.bookedRevenue +=
                memberStats.bookedRevenue || 0;

              acc.realisedRevenue +=
                memberStats.realisedRevenue || 0;

              acc.unrealisedRevenue +=
                memberStats.unrealisedRevenue || 0;

              acc.tillDateRealisedInLastMonth +=
                memberStats.tillDateRealisedInLastMonth ||
                0;

              if (
                memberStats.lastSalePunchDate &&
                (
                  !acc.lastSalePunchDate ||
                  new Date(
                    memberStats.lastSalePunchDate,
                  ) >
                    new Date(
                      acc.lastSalePunchDate,
                    )
                )
              ) {
                acc.lastSalePunchDate =
                  memberStats.lastSalePunchDate;

                acc.lastRevenuePunched =
                  memberStats.lastRevenuePunched || 0;
              }

              return acc;
            },
            {
              totalLeadAssigned: 0,
              registrationDone: 0,
              admDone: 0,
              bookedRevenue: 0,
              realisedRevenue: 0,
              unrealisedRevenue: 0,
              tillDateRealisedInLastMonth: 0,
              lastSalePunchDate: null,
              lastRevenuePunched: 0,
            },
          );

        const lastSalePunchDate =
          item.lastSalePunchDate
            ? new Date(
                item.lastSalePunchDate,
              )
            : null;

        const numberOfDaysOnZero =
          lastSalePunchDate
            ? Math.max(
                0,
                Math.floor(
                  (
                    now.getTime() -
                    lastSalePunchDate.getTime()
                  ) /
                    (1000 * 60 * 60 * 24),
                ),
              )
            : null;

        const monthlyRevenueTarget =
          null;

        const achievementPercentage =
          monthlyRevenueTarget
            ? Number(
                (
                  (
                    item.realisedRevenue /
                    monthlyRevenueTarget
                  ) *
                  100
                ).toFixed(2),
              )
            : null;

        return {
          consultantId: rootId,

          consultantName:
            user.name || 'Unknown',

          consultantEmail:
            user.email || null,

          employeeId:
            user.employeeId || null,

          totalLeadAssigned:
            item.totalLeadAssigned,

          monthlyRevenueTarget,

          registrationDone:
            item.registrationDone,

          // NOW COMPLETELY INDEPENDENT OF ORDERS
          admDone:
            item.admDone,

          bookedRevenue:
            item.bookedRevenue,

          unrealisedRevenue:
            item.unrealisedRevenue,

          realisedRevenue:
            item.realisedRevenue,

          achievementPercentage,

          tillDateRealisedInLastMonth:
            item.tillDateRealisedInLastMonth,

          lastSalePunchDate,

          lastRevenuePunched:
            item.lastRevenuePunched,

          numberOfDaysOnZero,

          team:
            teamFilter,

          teamSize:
            memberIds.length,
        };
      })
      .sort((a, b) =>
        a.consultantName.localeCompare(
          b.consultantName,
        ),
      );

  return report;
}


async consultantPerformanceDetails(query: any) {
  const now = new Date();

  const getFilterRange = (filter: any) => {
    const value = String(filter || '').toLowerCase();

    let from: Date;
    let to: Date;

    if (value === 'today') {
      from = new Date(now);
      from.setHours(0, 0, 0, 0);

      to = new Date(now);
      to.setHours(23, 59, 59, 999);
    } else if (value === 'week') {
      from = new Date(now);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);

      to = new Date(now);
      to.setHours(23, 59, 59, 999);
    } else if (value === 'month') {
      from = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      to = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (value === 'year') {
      from = new Date(
        now.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0,
      );

      to = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    } else {
      throw new BadRequestException(
        `Invalid date filter: ${filter}`,
      );
    }

    return { from, to };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
    name: string,
  ) => {
    if (!fromValue || !toValue) {
      throw new BadRequestException(
        `${name}From and ${name}To are both required`,
      );
    }

    const from = new Date(fromValue);
    const to = new Date(toValue);

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime())
    ) {
      throw new BadRequestException(
        `Invalid ${name} date`,
      );
    }

    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    if (from > to) {
      throw new BadRequestException(
        `${name}From cannot be greater than ${name}To`,
      );
    }

    const diffDays =
      Math.floor(
        (to.getTime() - from.getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        `${name} date range cannot be more than 31 days`,
      );
    }

    return {
      from,
      to,
    };
  };

  const getDateRange = (
    filter: any,
    from: any,
    to: any,
    name: string,
  ) => {
    if (from || to) {
      return getCustomRange(
        from,
        to,
        name,
      );
    }

    if (filter) {
      return getFilterRange(filter);
    }

    return null;
  };

  const leadCreatedRange =
    getDateRange(
      query.leadCreatedDateFilter,
      query.leadCreatedDateFrom,
      query.leadCreatedDateTo,
      'leadCreatedDate',
    );

  const leadAssignedRange =
    getDateRange(
      query.leadAssignedDateFilter,
      query.leadAssignedDateFrom,
      query.leadAssignedDateTo,
      'leadAssignedDate',
    );

  const orderCreatedRange =
    getDateRange(
      query.orderCreatedDateFilter,
      query.orderCreatedDateFrom,
      query.orderCreatedDateTo,
      'orderCreatedDate',
    );

  const hasLeadFilter =
    !!leadCreatedRange ||
    !!leadAssignedRange;

  const hasOrderFilter =
    !!orderCreatedRange;

  if (!query.counsellorId) {
    throw new BadRequestException(
      'counsellorId is required',
    );
  }

  const counsellorId =
    String(query.counsellorId);

  if (
    !Types.ObjectId.isValid(
      counsellorId,
    )
  ) {
    throw new BadRequestException(
      'Invalid counsellorId',
    );
  }

  const counsellor =
    await this.userModel
      .findById(counsellorId)
      .select(
        'name email employeeId role',
      )
      .lean();

  if (!counsellor) {
    throw new NotFoundException(
      'Counsellor not found',
    );
  }

  const type =
    String(
      query.type ||
        'assigned-leads',
    ).toLowerCase();

  const isTeam =
    query.team === true ||
    query.team === 'true';

  // =========================================================
  // USERS
  // =========================================================

  let userIds = [
    counsellorId,
  ];

  if (isTeam) {
    const subordinateIds =
      await this.getUserAndSubordinateIds(
        counsellorId,
      );

    userIds = [
      counsellorId,
      ...subordinateIds.map(
        (id: any) =>
          id.toString(),
      ),
    ];

    userIds = [
      ...new Set(userIds),
    ];

    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: userIds,
          },
          status: 'active',
        })
        .select('_id')
        .lean();

    userIds =
      activeUsers.map(
        (user) =>
          user._id.toString(),
      );

    if (
      !userIds.includes(
        counsellorId,
      )
    ) {
      userIds.push(
        counsellorId,
      );
    }
  }

  // =========================================================
  // SELECT LEADS
  // =========================================================

  let selectedLeads: any[] = [];

  if (hasLeadFilter) {
    const leadMatch: any = {
      assignedTo: {
        $in: userIds,
      },
    };

    if (leadCreatedRange) {
      leadMatch.createdAt = {
        $gte: leadCreatedRange.from,
        $lte: leadCreatedRange.to,
      };
    }

    if (leadAssignedRange) {
      leadMatch.assignedDate = {
        $gte: leadAssignedRange.from,
        $lte: leadAssignedRange.to,
      };
    }

    selectedLeads =
      await this.leadModel
        .find(leadMatch)
        .sort({
          assignedDate: -1,
          createdAt: -1,
        })
        .lean();
  }

  // =========================================================
  // ONLY ORDER DATE
  // =========================================================

  if (
    !hasLeadFilter &&
    hasOrderFilter
  ) {
    selectedLeads =
      await this.leadModel
        .find({
          assignedTo: {
            $in: userIds,
          },

          assignedDate: {
            $gte:
              orderCreatedRange.from,
            $lte:
              orderCreatedRange.to,
          },
        })
        .sort({
          assignedDate: -1,
          createdAt: -1,
        })
        .lean();
  }

  // =========================================================
  // LEAD CONTACT MAP
  // =========================================================

  const leadByMobile =
    new Map<string, any>();

  const leadByEmail =
    new Map<string, any>();

  selectedLeads.forEach(
    (lead: any) => {
      const mobile =
        lead.mobile ||
        lead.phone;

      if (mobile) {
        leadByMobile.set(
          String(mobile),
          lead,
        );
      }

      if (lead.email) {
        leadByEmail.set(
          String(
            lead.email,
          ).toLowerCase(),
          lead,
        );
      }
    },
  );

  const leadMobiles = [
    ...new Set(
      selectedLeads
        .map(
          (lead: any) =>
            lead.mobile ||
            lead.phone,
        )
        .filter(Boolean)
        .map(
          (value: any) =>
            String(value),
        ),
    ),
  ];

  const leadEmails = [
    ...new Set(
      selectedLeads
        .map(
          (lead: any) =>
            lead.email,
        )
        .filter(Boolean)
        .map(
          (value: any) =>
            String(value)
              .toLowerCase(),
        ),
    ),
  ];

  // =========================================================
  // ORDER MATCH
  // SAME CONDITIONS AS REPORT
  // =========================================================

  const orderMatch: any = {
    Approved: true,
    $or: [
      {
        paymentMode:
          PaymentMode.LUMPSUM,

        'lumpsumDetails.totalReceived':
          {
            $gt: 0,
          },
      },

      {
        paymentMode:
          PaymentMode.LOAN,

        'loanDetails.disbursementAmount':
          {
            $gt: 0,
          },
      },
    ],
  };

  // Lead filters mean orders MUST belong
  // to the selected leads.
  if (hasLeadFilter) {
    if (
      !leadMobiles.length &&
      !leadEmails.length
    ) {
      orderMatch._id = {
        $in: [],
      };
    } else {
      orderMatch.$and = [
        {
          $or: [
            ...(leadMobiles.length
              ? [
                  {
                    mobile: {
                      $in:
                        leadMobiles,
                    },
                  },
                ]
              : []),

            ...(leadEmails.length
              ? [
                  {
                    email: {
                      $in:
                        leadEmails,
                    },
                  },
                ]
              : []),
          ],
        },
      ];
    }
  }

  // Order date is applied AFTER
  // lead selection.
  if (hasOrderFilter) {
    orderMatch.orderDate = {
      $gte:
        orderCreatedRange.from,
      $lte:
        orderCreatedRange.to,
    };
  }

  // Only order filter:
  // orders belong to selected employee/team.
  if (
    !hasLeadFilter &&
    hasOrderFilter
  ) {
    orderMatch.counsellorId = {
      $in: userIds,
    };
  }

  // =========================================================
  // GET ORDERS
  // =========================================================

  let orders: any[] = [];

  if (
    hasLeadFilter ||
    hasOrderFilter
  ) {
    orders =
      await this.orderModel
        .find(orderMatch)
        .sort({
          createdAt: -1,
          orderDate: -1,
        })
        .lean();
  }

  // =========================================================
  // FORMAT ORDER
  // SAME REVENUE LOGIC AS REPORT
  // =========================================================
  console.log(orders,"2")
  const formattedOrders =
    orders.map(
      (order: any) => {
        let revenue = 0;

        if (
          order.paymentMode ===
          PaymentMode.LOAN
        ) {
          revenue =
            Number(
              order.loanDetails
                ?.disbursementAmount,
            ) || 0;
        }

        if (
          order.paymentMode ===
          PaymentMode.LUMPSUM
        ) {
          revenue =
            Number(
              order.lumpsumDetails
                ?.totalReceived,
            ) || 0;
        }

        let lead: any = null;

        if (order.mobile) {
          lead =
            leadByMobile.get(
              String(
                order.mobile,
              ),
            ) || null;
        }

        if (
          !lead &&
          order.email
        ) {
          lead =
            leadByEmail.get(
              String(
                order.email,
              ).toLowerCase(),
            ) || null;
        }

        return {
          ...order,

          revenue,

          lead:
            lead || null,

          leadId:
            lead?._id ||
            null,

          leadCreatedAt:
            lead?.createdAt ||
            null,

          leadAssignedDate:
            lead?.assignedDate ||
            null,
        };
      },
    );

  // =========================================================
  // ASSIGNED LEADS
  // =========================================================

  if (
    type === 'assigned-leads' ||
    type === 'assigned' ||
    type === 'leads'
  ) {
    return {
      type: 'assigned-leads',

      counsellor: {
        id: counsellor._id,
        name: counsellor.name,
        email: counsellor.email,
        employeeId:
          counsellor.employeeId,
      },

      team: isTeam,

      teamUserIds:
        userIds,

      leadCreatedDateRange:
        leadCreatedRange,

      leadAssignedDateRange:
        leadAssignedRange,

      orderCreatedDateRange:
        orderCreatedRange,

      total:
        selectedLeads.length,

      data:
        selectedLeads,
    };
  }

  // =========================================================
  // ADMISSION LEADS
  // EXACT SAME ORDERS AS admDone
  // =========================================================

if (
  type === 'admission-leads' ||
  type === 'admission' ||
  type === 'adm'
) {
  const admiStage =
    await this.leadStageModel
      .findOne({
        name: 'Admission Done',
      })
      .select('_id')
      .lean();

  if (!admiStage) {
    return {
      message: 'Admission Done stage is missing',
    };
  }

  const admissionStageId =
    admiStage._id.toString();

  const admissionLeads =
    selectedLeads.filter(
      (lead: any) =>
        lead.stageId &&
        lead.stageId.toString() ===
          admissionStageId,
    );

  console.log(
    'Admission Stage:',
    admissionStageId,
  );

  console.log(
    'Selected Leads:',
    selectedLeads.length,
  );

  console.log(
    'Admission Leads:',
    admissionLeads.length,
  );

  return {
    type: 'admission-leads',

    counsellor: {
      id: counsellor._id,
      name: counsellor.name,
      email: counsellor.email,
      employeeId:
        counsellor.employeeId,
    },

    team: isTeam,

    teamUserIds:
      userIds,

    leadCreatedDateRange:
      leadCreatedRange,

    leadAssignedDateRange:
      leadAssignedRange,

    orderCreatedDateRange:
      orderCreatedRange,

    total:
      admissionLeads.length,

    data:
      admissionLeads,
  };
}

  // =========================================================
  // ORDERS
  // EXACT SAME ORDERS USED FOR REVENUE
  // =========================================================

  if (type === 'orders') {
    return {
      type: 'orders',

      counsellor: {
        id: counsellor._id,
        name: counsellor.name,
        email: counsellor.email,
        employeeId:
          counsellor.employeeId,
      },

      team: isTeam,

      teamUserIds:
        userIds,

      leadCreatedDateRange:
        leadCreatedRange,

      leadAssignedDateRange:
        leadAssignedRange,

      orderCreatedDateRange:
        orderCreatedRange,

      total:
        formattedOrders.length,

      data:
        formattedOrders,
    };
  }

  throw new BadRequestException(
    'Invalid type. Use assigned-leads, admission-leads, or orders',
  );
}



async employeePoolUtilizationReport(query: any) {
  const now = new Date();

  const getDateRange = (filter?: string) => {
    const type = String(filter || 'month').toLowerCase();

    let startDate: Date;
    let endDate: Date;

    if (type === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (type === 'week') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (type === 'month') {
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
    } else {
      throw new BadRequestException(
        'Invalid date filter. Allowed values: today, week, month',
      );
    }

    return {
      startDate,
      endDate,
    };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
    fieldName: string,
  ) => {
    if (!fromValue || !toValue) {
      throw new BadRequestException(
        `${fieldName}From and ${fieldName}To are both required`,
      );
    }

    const startDate = new Date(fromValue);
    const endDate = new Date(toValue);

    if (Number.isNaN(startDate.getTime())) {
      throw new BadRequestException(
        `Invalid ${fieldName}From`,
      );
    }

    if (Number.isNaN(endDate.getTime())) {
      throw new BadRequestException(
        `Invalid ${fieldName}To`,
      );
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    if (startDate > endDate) {
      throw new BadRequestException(
        `${fieldName}From cannot be greater than ${fieldName}To`,
      );
    }

    const diffDays =
      Math.floor(
        (endDate.getTime() - startDate.getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        `${fieldName} date range cannot be more than 31 days`,
      );
    }

    return {
      startDate,
      endDate,
    };
  };

  // =========================================================
  // DATE RANGES
  // =========================================================

  let assignedStartDate: Date | null = null;
  let assignedEndDate: Date | null = null;

  let createdStartDate: Date | null = null;
  let createdEndDate: Date | null = null;

  if (
    query.assignedDateFrom ||
    query.assignedDateTo
  ) {
    const range = getCustomRange(
      query.assignedDateFrom,
      query.assignedDateTo,
      'assignedDate',
    );

    assignedStartDate = range.startDate;
    assignedEndDate = range.endDate;
  } else if (query.assignedDateFilter) {
    const range = getDateRange(
      query.assignedDateFilter,
    );

    assignedStartDate = range.startDate;
    assignedEndDate = range.endDate;
  }

  if (
    query.createdDateFrom ||
    query.createdDateTo
  ) {
    const range = getCustomRange(
      query.createdDateFrom,
      query.createdDateTo,
      'createdDate',
    );

    createdStartDate = range.startDate;
    createdEndDate = range.endDate;
  } else if (query.createdDateFilter) {
    const range = getDateRange(
      query.createdDateFilter,
    );

    createdStartDate = range.startDate;
    createdEndDate = range.endDate;
  }

  // No filter = current month
  if (
    !assignedStartDate &&
    !createdStartDate
  ) {
    const range = getDateRange('month');

    assignedStartDate = range.startDate;
    assignedEndDate = range.endDate;

    createdStartDate = range.startDate;
    createdEndDate = range.endDate;
  }

  // =========================================================
  // LEVEL
  // =========================================================

  const levelNumber =
    this.resolveLevel(query.level);

  if (levelNumber === null) {
    return {
      assignedStartDate,
      assignedEndDate,
      createdStartDate,
      createdEndDate,
      employees: [],
    };
  }

  const levelUserIds =
    await this.getUserIdsByRoleLevel(
      levelNumber,
    );

  if (!levelUserIds.length) {
    return {
      assignedStartDate,
      assignedEndDate,
      createdStartDate,
      createdEndDate,
      employees: [],
    };
  }

  // =========================================================
  // TEAM
  // =========================================================

  const teamFilter =
    query.team === true ||
    query.team === 'true';

  const rootUsers =
    await this.userModel
      .find({
        _id: {
          $in: levelUserIds,
        },
        status: 'active',
      })
      .select(
        'name email number employeeId role createdAt',
      )
      .lean();

  if (!rootUsers.length) {
    return {
      assignedStartDate,
      assignedEndDate,
      createdStartDate,
      createdEndDate,
      employees: [],
    };
  }

  const teamMap =
    new Map<string, string[]>();

  for (const rootUser of rootUsers) {
    const rootId =
      rootUser._id.toString();

    if (!teamFilter) {
      teamMap.set(rootId, [rootId]);
      continue;
    }

    const subordinateIds =
      await this.getUserAndSubordinateIds(
        rootId,
      );

    const memberIds = [
      rootId,
      ...subordinateIds.map(
        (id: any) => id.toString(),
      ),
    ];

    const uniqueMemberIds = [
      ...new Set(memberIds),
    ];

    const activeMembers =
      await this.userModel
        .find({
          _id: {
            $in: uniqueMemberIds,
          },
          status: 'active',
        })
        .select('_id')
        .lean();

    const activeMemberIds =
      activeMembers.map(
        (member) =>
          member._id.toString(),
      );

    if (
      !activeMemberIds.includes(rootId)
    ) {
      activeMemberIds.push(rootId);
    }

    teamMap.set(
      rootId,
      [
        ...new Set(activeMemberIds),
      ],
    );
  }

  // =========================================================
  // GET ALL LEADS
  // =========================================================

  const allRootTeamUserIds = [
    ...new Set(
      Array.from(teamMap.values()).flat(),
    ),
  ];

  const leadMatch: any = {
    assignedTo: {
      $in: allRootTeamUserIds,
    },
  };

  /*
   * If both filters exist:
   * assignedDate AND createdAt must match.
   *
   * If only one exists:
   * only that field is checked.
   */

  if (
    assignedStartDate &&
    assignedEndDate &&
    createdStartDate &&
    createdEndDate
  ) {
    leadMatch.assignedDate = {
      $gte: assignedStartDate,
      $lte: assignedEndDate,
    };

    leadMatch.createdAt = {
      $gte: createdStartDate,
      $lte: createdEndDate,
    };
  } else if (
    assignedStartDate &&
    assignedEndDate
  ) {
    leadMatch.assignedDate = {
      $gte: assignedStartDate,
      $lte: assignedEndDate,
    };
  } else if (
    createdStartDate &&
    createdEndDate
  ) {
    leadMatch.createdAt = {
      $gte: createdStartDate,
      $lte: createdEndDate,
    };
  }

  const allLeads =
    await this.leadModel.aggregate([
      {
        $match: leadMatch,
      },

      {
        $lookup: {
          from: 'leadstages',
          localField: 'stageId',
          foreignField: '_id',
          as: 'stage',
        },
      },

      {
        $unwind: {
          path: '$stage',
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $addFields: {
          normalizedAssignedTo: {
            $convert: {
              input: '$assignedTo',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      },

      {
        $project: {
          _id: 1,
          assignedTo: 1,
          normalizedAssignedTo: 1,
          assignedDate: 1,
          createdAt: 1,
          stageId: 1,
          stageName: {
            $ifNull: [
              '$stage.name',
              'Unknown',
            ],
          },
        },
      },
    ]);

  // =========================================================
  // CALL DATA
  // =========================================================

  const callDateMatch: any = {};

  if (
    createdStartDate &&
    createdEndDate
  ) {
    callDateMatch.createdAt = {
      $gte: createdStartDate,
      $lte: createdEndDate,
    };
  } else if (
    assignedStartDate &&
    assignedEndDate
  ) {
    callDateMatch.createdAt = {
      $gte: assignedStartDate,
      $lte: assignedEndDate,
    };
  }

  const callStats =
    await this.callLogModel.aggregate([
      {
        $match: {
          ...callDateMatch,

          $expr: {
            $in: [
              {
                $convert: {
                  input: '$userId',
                  to: 'string',
                  onError: null,
                  onNull: null,
                },
              },
              allRootTeamUserIds,
            ],
          },
        },
      },

      {
        $group: {
          _id: {
            userId: {
              $convert: {
                input: '$userId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            customerNumber:
              '$customerNumber',
          },

          dialCount: {
            $sum: 1,
          },

          answeredCount: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    '$duration',
                    0,
                  ],
                },
                1,
                0,
              ],
            },
          },

          talkTime: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    '$duration',
                    0,
                  ],
                },
                '$duration',
                0,
              ],
            },
          },
        },
      },

      {
        $group: {
          _id:
            '$_id.userId',

          totalDial: {
            $sum: '$dialCount',
          },

          uniqDial: {
            $sum: 1,
          },

          answeredCall: {
            $sum: '$answeredCount',
          },

          answeredTalkTime: {
            $sum: '$talkTime',
          },
        },
      },
    ]);

  const callStatsMap =
    new Map<string, any>();

  callStats.forEach((item) => {
    if (!item._id) return;

    callStatsMap.set(
      item._id.toString(),
      {
        totalDial:
          item.totalDial || 0,
        uniqDial:
          item.uniqDial || 0,
        answeredCall:
          item.answeredCall || 0,
        answeredTalkTime:
          item.answeredTalkTime || 0,
      },
    );
  });

  // =========================================================
  // ROLES
  // =========================================================

  const roleIds = [
    ...new Set(
      rootUsers
        .map(
          (user) =>
            user.role?.toString(),
        )
        .filter(Boolean),
    ),
  ];

  const roles =
    roleIds.length
      ? await this.roleModel
          .find({
            _id: {
              $in: roleIds.map(
                (id) =>
                  new Types.ObjectId(id),
              ),
            },
          })
          .select('name')
          .lean()
      : [];

  const rolesById =
    new Map(
      roles.map((role) => [
        role._id.toString(),
        role.name,
      ]),
    );

  // =========================================================
  // EMPLOYEES
  // =========================================================

  const employees =
    rootUsers
      .map((user) => {
        const employeeId =
          user._id.toString();

        const memberIds =
          teamMap.get(employeeId) ||
          [employeeId];

        const employeeLeads =
          allLeads.filter((lead) =>
            memberIds.includes(
              lead.normalizedAssignedTo,
            ),
          );

        // Every selected lead
        const leadAssigned =
          employeeLeads.length;

        // New Lead from SAME selected leads
        const newLead =
          employeeLeads.filter(
            (lead) =>
              String(
                lead.stageName || '',
              ).toLowerCase() ===
              'new lead',
          ).length;

        // ===================================================
        // STAGES FROM SAME LEADS
        // ===================================================

        const stageMap =
          new Map<
            string,
            {
              stageId: string;
              stageName: string;
              count: number;
            }
          >();

        employeeLeads.forEach(
          (lead) => {
            const stageName =
              lead.stageName ||
              'Unknown';

            const key =
              lead.stageId?.toString() ||
              stageName;

            const existing =
              stageMap.get(key);

            if (existing) {
              existing.count++;
            } else {
              stageMap.set(
                key,
                {
                  stageId:
                    lead.stageId?.toString(),
                  stageName,
                  count: 1,
                },
              );
            }
          },
        );

        const allStages =
          Array.from(
            stageMap.values(),
          ).sort((a, b) =>
            a.stageName.localeCompare(
              b.stageName,
            ),
          );

        // ===================================================
        // STAGE COUNTS
        // ===================================================

        const pcatScheduled =
          employeeLeads.filter(
            (lead) =>
              /pcat.*schedul/i.test(
                lead.stageName || '',
              ),
          ).length;

        const pcatDone =
          employeeLeads.filter(
            (lead) =>
              /pcat.*done|pcat.*complete/i.test(
                lead.stageName || '',
              ),
          ).length;

        const registrationDone =
          employeeLeads.filter(
            (lead) =>
              String(
                lead.stageName || '',
              ).toLowerCase() ===
              'registration done',
          ).length;

        const admissionDone =
          employeeLeads.filter(
            (lead) =>
              String(
                lead.stageName || '',
              ).toLowerCase() ===
              'admission done',
          ).length;

        // ===================================================
        // CALLS
        // ===================================================

        const callData =
          memberIds.reduce(
            (acc, memberId) => {
              const calls =
                callStatsMap.get(
                  memberId,
                );

              if (calls) {
                acc.totalDial +=
                  calls.totalDial || 0;

                acc.uniqDial +=
                  calls.uniqDial || 0;

                acc.answeredCall +=
                  calls.answeredCall || 0;

                acc.answeredTalkTime +=
                  calls.answeredTalkTime || 0;
              }

              return acc;
            },
            {
              totalDial: 0,
              uniqDial: 0,
              answeredCall: 0,
              answeredTalkTime: 0,
            },
          );

        const vintage = user.createdAt
          ? `${Math.floor(
              (
                now.getTime() -
                new Date(
                  user.createdAt,
                ).getTime()
              ) /
                (1000 *
                  60 *
                  60 *
                  24),
            )}d`
          : null;

        return {
          employeeId,

          employeeName:
            user.name || 'Unknown',

          designation:
            user.role
              ? rolesById.get(
                  user.role.toString(),
                ) || null
              : null,

          vintage,

          leadAssigned,

          newLead,

          totalDial:
            callData.totalDial,

          uniqDial:
            callData.uniqDial,

          answeredCall:
            callData.answeredCall,

          answeredTalkTime:
            callData.answeredTalkTime,

          pcatScheduled,

          pcatDone,

          registrationDone,

          admissionDone,

          allStages,

          employeeEmail:
            user.email || null,

          employeeNumber:
            user.number || null,

          employeeEmployeeId:
            user.employeeId || null,

          team:
            teamFilter,

          teamSize:
            memberIds.length,
        };
      })
      .sort((a, b) =>
        a.employeeName.localeCompare(
          b.employeeName,
        ),
      );

  return {
    assignedStartDate,
    assignedEndDate,

    createdStartDate,
    createdEndDate,

    assignedDateFilter:
      query.assignedDateFilter ||
      null,

    createdDateFilter:
      query.createdDateFilter ||
      null,

    team:
      teamFilter,

    level:
      levelNumber,

    employees,
  };
}

async employeeStageLeads(query: any) {
  const {
    employeeId,
    stageId,

    assignedDateFilter,
    assignedDateFrom,
    assignedDateTo,

    createdDateFilter,
    createdDateFrom,
    createdDateTo,

    // Backward compatibility
    startDate,
    endDate,
    dateType = 'assigned',

    team,
    page = 1,
    limit = 20,
  } = query;

  if (!employeeId) {
    throw new BadRequestException(
      'employeeId is required',
    );
  }

  if (!stageId) {
    throw new BadRequestException(
      'stageId is required',
    );
  }

  if (!Types.ObjectId.isValid(employeeId)) {
    throw new BadRequestException(
      'Invalid employeeId',
    );
  }

  if (!Types.ObjectId.isValid(stageId)) {
    throw new BadRequestException(
      'Invalid stageId',
    );
  }

  const isTeam =
    team === true ||
    team === 'true';

  // =========================================================
  // DATE HELPERS
  // =========================================================

  const getFilterRange = (
    filter: string,
  ) => {
    const type =
      String(filter).toLowerCase();

    const now = new Date();

    let from: Date;
    let to: Date;

    if (type === 'today') {
      from = new Date(now);
      from.setHours(
        0,
        0,
        0,
        0,
      );

      to = new Date(now);
      to.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (type === 'week') {
      from = new Date(now);

      from.setDate(
        from.getDate() - 6,
      );

      from.setHours(
        0,
        0,
        0,
        0,
      );

      to = new Date(now);

      to.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (type === 'month') {
      from = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      to = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else {
      throw new BadRequestException(
        `Invalid date filter: ${filter}`,
      );
    }

    return {
      from,
      to,
    };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
    name: string,
  ) => {
    if (!fromValue || !toValue) {
      throw new BadRequestException(
        `${name}From and ${name}To are both required`,
      );
    }

    const from =
      new Date(fromValue);

    const to =
      new Date(toValue);

    if (
      Number.isNaN(
        from.getTime(),
      )
    ) {
      throw new BadRequestException(
        `Invalid ${name}From`,
      );
    }

    if (
      Number.isNaN(
        to.getTime(),
      )
    ) {
      throw new BadRequestException(
        `Invalid ${name}To`,
      );
    }

    from.setHours(
      0,
      0,
      0,
      0,
    );

    to.setHours(
      23,
      59,
      59,
      999,
    );

    if (from > to) {
      throw new BadRequestException(
        `${name}From cannot be greater than ${name}To`,
      );
    }

    const diffDays =
      Math.floor(
        (
          to.getTime() -
          from.getTime()
        ) /
          (
            1000 *
            60 *
            60 *
            24
          ),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        `${name} date range cannot be more than 31 days`,
      );
    }

    return {
      from,
      to,
    };
  };

  // =========================================================
  // ASSIGNED DATE RANGE
  // =========================================================

  let assignedRange:
    | {
        from: Date;
        to: Date;
      }
    | null = null;

  if (
    assignedDateFrom ||
    assignedDateTo
  ) {
    assignedRange =
      getCustomRange(
        assignedDateFrom,
        assignedDateTo,
        'assignedDate',
      );
  } else if (
    assignedDateFilter
  ) {
    assignedRange =
      getFilterRange(
        assignedDateFilter,
      );
  }

  // =========================================================
  // CREATED DATE RANGE
  // =========================================================

  let createdRange:
    | {
        from: Date;
        to: Date;
      }
    | null = null;

  if (
    createdDateFrom ||
    createdDateTo
  ) {
    createdRange =
      getCustomRange(
        createdDateFrom,
        createdDateTo,
        'createdDate',
      );
  } else if (
    createdDateFilter
  ) {
    createdRange =
      getFilterRange(
        createdDateFilter,
      );
  }

  // =========================================================
  // OLD FORMAT SUPPORT
  // =========================================================

  if (
    !assignedRange &&
    !createdRange &&
    startDate &&
    endDate
  ) {
    const oldRange =
      getCustomRange(
        startDate,
        endDate,
        dateType === 'created'
          ? 'createdDate'
          : 'assignedDate',
      );

    if (
      String(dateType).toLowerCase() ===
      'created'
    ) {
      createdRange = oldRange;
    } else {
      assignedRange = oldRange;
    }
  }

  // =========================================================
  // DEFAULT
  // =========================================================

  if (
    !assignedRange &&
    !createdRange
  ) {
    assignedRange =
      getFilterRange('month');
    createdRange =
      getFilterRange('month');
  }

  // =========================================================
  // USERS
  // =========================================================

  let assignedUserIds: string[] = [
    employeeId.toString(),
  ];

  if (isTeam) {
    const employee =
      await this.userModel
        .findOne({
          _id: employeeId,
          status: 'active',
        })
        .lean();

    if (!employee) {
      throw new BadRequestException(
        'Active employee not found',
      );
    }

    const subordinateIds =
      await this.getUserAndSubordinateIds(
        employeeId.toString(),
      );

    assignedUserIds = [
      employeeId.toString(),

      ...subordinateIds.map(
        (id: any) =>
          id.toString(),
      ),
    ];

    assignedUserIds = [
      ...new Set(
        assignedUserIds,
      ),
    ];

    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: assignedUserIds,
          },
          status: 'active',
        })
        .select('_id')
        .lean();

    assignedUserIds =
      activeUsers.map(
        (user) =>
          user._id.toString(),
      );

    if (
      !assignedUserIds.includes(
        employeeId.toString(),
      )
    ) {
      assignedUserIds.push(
        employeeId.toString(),
      );
    }
  }

  // =========================================================
  // MATCH
  // =========================================================

  const match: any = {
    assignedTo: {
      $in: assignedUserIds,
    },

    stageId:
      new Types.ObjectId(stageId),
  };

  /*
   * If both are supplied:
   *
   * assignedDate MUST match
   * AND
   * createdAt MUST match
   */

  if (assignedRange) {
    match.assignedDate = {
      $gte: assignedRange.from,
      $lte: assignedRange.to,
    };
  }

  if (createdRange) {
    match.createdAt = {
      $gte: createdRange.from,
      $lte: createdRange.to,
    };
  }

  // =========================================================
  // PAGINATION
  // =========================================================

  const pageNumber =
    Math.max(
      1,
      Number(page) || 1,
    );

  const limitNumber =
    Math.max(
      1,
      Number(limit) || 20,
    );

  const skip =
    (pageNumber - 1) *
    limitNumber;

  // =========================================================
  // DATA + TOTAL
  // =========================================================

  const [data, total] =
    await Promise.all([
      this.leadModel.aggregate([
        {
          $match: match,
        },

        // Stage
        {
          $lookup: {
            from: 'leadstages',

            localField:
              'stageId',

            foreignField:
              '_id',

            as: 'stage',
          },
        },

        {
          $unwind: {
            path: '$stage',

            preserveNullAndEmptyArrays:
              true,
          },
        },

        // Employee
        {
          $lookup: {
            from: 'users',

            let: {
              assignedToId: {
                $convert: {
                  input:
                    '$assignedTo',

                  to: 'objectId',

                  onError: null,

                  onNull: null,
                },
              },
            },

            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      '$_id',
                      '$$assignedToId',
                    ],
                  },
                },
              },

              {
                $project: {
                  _id: 1,
                  name: 1,
                  employeeId: 1,
                  email: 1,
                  number: 1,
                },
              },
            ],

            as: 'employee',
          },
        },

        {
          $unwind: {
            path: '$employee',

            preserveNullAndEmptyArrays:
              true,
          },
        },

        // Root employee
        {
          $lookup: {
            from: 'users',

            let: {
              rootEmployeeId: {
                $convert: {
                  input:
                    employeeId,

                  to: 'objectId',

                  onError: null,

                  onNull: null,
                },
              },
            },

            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      '$_id',
                      '$$rootEmployeeId',
                    ],
                  },
                },
              },

              {
                $project: {
                  _id: 1,
                  name: 1,
                  employeeId: 1,
                  email: 1,
                  number: 1,
                },
              },
            ],

            as: 'rootEmployee',
          },
        },

        {
          $unwind: {
            path: '$rootEmployee',

            preserveNullAndEmptyArrays:
              true,
          },
        },

        // Response
        {
          $project: {
            _id: 1,

            leadId: 1,

            name: 1,

            phone: 1,

            email: 1,

            source: 1,

            assignedTo: 1,

            stageName:
              '$stage.name',

            employeeName:
              '$employee.name',

            employeeEmployeeId:
              '$employee.employeeId',

            employeeEmail:
              '$employee.email',

            employeeNumber:
              '$employee.number',

            rootEmployeeName:
              '$rootEmployee.name',

            rootEmployeeId:
              '$rootEmployee._id',

            assignedDate: 1,

            createdAt: 1,
          },
        },

        {
          $sort: {
            assignedDate: -1,
            createdAt: -1,
          },
        },

        {
          $skip: skip,
        },

        {
          $limit:
            limitNumber,
        },
      ]),

      this.leadModel.countDocuments(
        match,
      ),
    ]);

  // =========================================================
  // RESPONSE
  // =========================================================

  return {
    total,

    page: pageNumber,

    limit: limitNumber,

    totalPages:
      Math.ceil(
        total /
          limitNumber,
      ),

    team: isTeam,

    employeeId,

    assignedDateRange:
      assignedRange
        ? {
            from:
              assignedRange.from,
            to:
              assignedRange.to,
          }
        : null,

    createdDateRange:
      createdRange
        ? {
            from:
              createdRange.from,
            to:
              createdRange.to,
          }
        : null,

    teamUserIds:
      isTeam
        ? assignedUserIds
        : [employeeId],

    data,
  };
}

async sourceCampaignWiseLeadRevenueReport(query: any) {
  const now = new Date();

  const getFilterRange = (filter: any) => {
    const value =
      String(filter || '').toLowerCase();

    let startDate: Date;
    let endDate: Date;

    if (value === 'today') {
      startDate = new Date(now);
      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'week') {
      startDate = new Date(now);
      startDate.setDate(
        startDate.getDate() - 6,
      );
      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'month') {
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
    } else if (value === 'year') {
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
    } else {
      throw new BadRequestException(
        `Invalid date filter: ${filter}`,
      );
    }

    return {
      $gte: startDate,
      $lte: endDate,
    };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
    name: string,
  ) => {
    if (!fromValue || !toValue) {
      throw new BadRequestException(
        `${name}From and ${name}To are both required`,
      );
    }

    const from =
      new Date(fromValue);

    const to =
      new Date(toValue);

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime())
    ) {
      throw new BadRequestException(
        `Invalid ${name} date`,
      );
    }

    from.setHours(
      0,
      0,
      0,
      0,
    );

    to.setHours(
      23,
      59,
      59,
      999,
    );

    if (from > to) {
      throw new BadRequestException(
        `${name}From cannot be greater than ${name}To`,
      );
    }

    const diffDays =
      Math.floor(
        (
          to.getTime() -
          from.getTime()
        ) /
          (
            1000 *
            60 *
            60 *
            24
          ),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        `${name} date range cannot be more than 31 days`,
      );
    }

    return {
      $gte: from,
      $lte: to,
    };
  };

  const getDateRange = (
    filter: any,
    from: any,
    to: any,
    name: string,
  ) => {
    if (from || to) {
      return getCustomRange(
        from,
        to,
        name,
      );
    }

    if (filter) {
      return getFilterRange(
        filter,
      );
    }

    return null;
  };

  // =========================================================
  // LEAD CREATED DATE FILTER
  // =========================================================

  const leadCreatedRange =
    getDateRange(
      query.leadCreatedDateFilter,
      query.leadCreatedDateFrom,
      query.leadCreatedDateTo,
      'leadCreatedDate',
    );

  // =========================================================
  // ORDER CREATED DATE FILTER
  // =========================================================

  const orderCreatedRange =
    getDateRange(
      query.orderCreatedDateFilter,
      query.orderCreatedDateFrom,
      query.orderCreatedDateTo,
      'orderCreatedDate',
    );

  const hasLeadCreatedFilter =
    !!leadCreatedRange;

  const hasOrderCreatedFilter =
    !!orderCreatedRange;

  // =========================================================
  // DEFAULT
  // Current calendar month based on LEAD CREATED DATE
  // =========================================================

  const defaultLeadCreatedRange =
    !hasLeadCreatedFilter &&
    !hasOrderCreatedFilter
      ? getFilterRange('month')
      : null;

  // =========================================================
  // GET ADMISSION DONE STAGE
  // =========================================================

  const admissionStage =
    await this.leadStageModel
      .findOne({
        name: {
          $regex:
            /^admission done$/i,
        },
      })
      .select('_id')
      .lean();

  if (!admissionStage) {
    throw new BadRequestException(
      'Admission Done stage not found',
    );
  }

  // =========================================================
  // LEADS
  // Only required when:
  // 1. Lead created date filter exists
  // 2. Both lead + order filters exist
  // 3. No filter exists -> default current month
  // =========================================================

  let selectedLeads: any[] = [];

  const shouldFilterByLead =
    hasLeadCreatedFilter ||
    !!defaultLeadCreatedRange;

  if (shouldFilterByLead) {
    const leadMatch: any = {
      stageId:
        admissionStage._id,

      createdAt:
        leadCreatedRange ||
        defaultLeadCreatedRange,
    };

    if (query.source) {
      leadMatch.source =
        String(
          query.source,
        ).toLowerCase();
    }

    if (query.state) {
      leadMatch.state =
        query.state;
    }

    if (query.source_campaign) {
      leadMatch.source_campaign = {
        $regex:
          query.source_campaign,
        $options: 'i',
      };
    }

    selectedLeads =
      await this.leadModel
        .find(leadMatch)
        .select(
          `
            _id
            leadId
            name
            phone
            mobile
            email
            source
            source_campaign
            stageId
            createdAt
            assignedDate
          `,
        )
        .lean();
  }

  // =========================================================
  // LEAD CONTACTS
  // =========================================================

  const leadMobiles =
    shouldFilterByLead
      ? [
          ...new Set(
            selectedLeads
              .flatMap(
                (lead: any) => [
                  lead.phone,
                  lead.mobile,
                ],
              )
              .filter(Boolean)
              .map(
                (value: any) =>
                  String(value),
              ),
          ),
        ]
      : [];

  // =========================================================
  // ORDER MATCH
  // =========================================================

  const orderMatch: any = {
    Approved: true,

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
    ],
  };

  // ---------------------------------------------------------
  // CASE:
  // Lead created date is applied
  // Orders must belong to selected Admission Done leads
  // ---------------------------------------------------------

  if (shouldFilterByLead) {
    if (!leadMobiles.length) {
      orderMatch.mobile = {
        $in: [],
      };
    } else {
      orderMatch.mobile = {
        $in: leadMobiles,
      };
    }
  }

  // ---------------------------------------------------------
  // CASE:
  // Order created date is applied
  // Direct order date filtering
  // ---------------------------------------------------------

  if (hasOrderCreatedFilter) {
    orderMatch.orderDate =
      orderCreatedRange;
  }

  // =========================================================
  // GET ORDERS
  // =========================================================

  const orders =
    await this.orderModel
      .find(orderMatch)
      .lean();

  // =========================================================
  // CALCULATE ORDER REVENUE
  // =========================================================

  const formattedOrders =
    orders
      .map((order: any) => {
        let revenue = 0;

        if (
          order.paymentMode ===
          'Lumpsum'
        ) {
          revenue =
            Number(
              order
                .lumpsumDetails
                ?.totalReceived,
            ) || 0;
        }

        else if (
          order.paymentMode ===
          'Loan'
        ) {
          revenue =
            Number(
              order
                .loanDetails
                ?.disbursementAmount,
            ) || 0;
        }

        return {
          ...order,

          calculatedRevenue:
            revenue,
        };
      })
      .filter(
        (order: any) =>
          Number(
            order.calculatedRevenue ||
              0,
          ) > 0,
      );

  // =========================================================
  // ORDER DATE ONLY
  // Get leads for campaign/source mapping
  // But DO NOT filter orders using lead date
  // =========================================================

  if (
    !shouldFilterByLead &&
    formattedOrders.length
  ) {
    const orderMobiles = [
      ...new Set(
        formattedOrders
          .map(
            (order: any) =>
              order.mobile,
          )
          .filter(Boolean)
          .map(
            (value: any) =>
              String(value),
          ),
      ),
    ];

    const leadMatch: any = {
      phone: {
        $in: orderMobiles,
      },
    };

    if (query.source) {
      leadMatch.source =
        String(
          query.source,
        ).toLowerCase();
    }

    if (query.state) {
      leadMatch.state =
        query.state;
    }

    if (query.stageId) {
      leadMatch.stageId =
        new Types.ObjectId(
          query.stageId,
        );
    }

    if (query.stage) {
      const stage =
        await this.leadStageModel
          .findOne({
            name: {
              $regex:
                query.stage,
              $options: 'i',
            },
          })
          .select('_id')
          .lean();

      if (stage) {
        leadMatch.stageId =
          stage._id;
      }
    }

    selectedLeads =
      await this.leadModel
        .find(leadMatch)
        .populate(
          'stageId',
          'name order',
        )
        .lean();
  }

  // =========================================================
  // EMPTY RESPONSE
  // =========================================================

  if (!formattedOrders.length) {
    return {
      startDate:
        shouldFilterByLead
          ? (
              leadCreatedRange ||
              defaultLeadCreatedRange
            )?.$gte || null
          : orderCreatedRange?.$gte ||
            null,

      endDate:
        shouldFilterByLead
          ? (
              leadCreatedRange ||
              defaultLeadCreatedRange
            )?.$lte || null
          : orderCreatedRange?.$lte ||
            null,

      campaigns: [],

      data: [],

      totals: {
        total: {
          totalLead: 0,
          revenue: 0,
        },

        byCampaign: {},
      },

      stats: {
        totalLead: 0,
        totalRevenue: 0,
        totalOrders: 0,
      },
    };
  }

  // =========================================================
  // MAP LEADS BY PHONE
  // =========================================================

  const leadByPhone =
    new Map<string, any>();

  selectedLeads.forEach(
    (lead: any) => {
      if (lead.phone) {
        leadByPhone.set(
          String(lead.phone),
          lead,
        );
      }

      if (lead.mobile) {
        leadByPhone.set(
          String(lead.mobile),
          lead,
        );
      }
    },
  );

  // =========================================================
  // GROUP DATA
  // =========================================================

  const groupedData =
    new Map<string, any>();

  formattedOrders.forEach(
    (order: any) => {
      const lead =
        leadByPhone.get(
          String(order.mobile),
        );

      if (!lead) {
        return;
      }

      const source =
        lead.source ||
        'Unknown';

      const campaignName =
        lead.source_campaign ||
        'Unknown';

      if (
        !groupedData.has(source)
      ) {
        groupedData.set(
          source,
          {
            source,

            campaigns:
              new Map(),
          },
        );
      }

      const sourceGroup =
        groupedData.get(source);

      if (
        !sourceGroup.campaigns.has(
          campaignName,
        )
      ) {
        sourceGroup.campaigns.set(
          campaignName,
          {
            campaignName,

            revenue: 0,

            leadIds:
              new Set<string>(),

            orders: [],
          },
        );
      }

      const campaign =
        sourceGroup.campaigns.get(
          campaignName,
        );

      campaign.revenue +=
        Number(
          order.calculatedRevenue ||
            0,
        );

      campaign.leadIds.add(
        String(lead._id),
      );

      campaign.orders.push({
        ...order,

        lead: {
          _id: lead._id,

          leadId:
            lead.leadId,

          name:
            lead.name,

          phone:
            lead.phone,

          email:
            lead.email,

          source:
            lead.source,

          source_campaign:
            lead.source_campaign,

          stageId:
            lead.stageId,
        },

        calculatedRevenue:
          Number(
            order.calculatedRevenue ||
              0,
          ),
      });
    },
  );

  // =========================================================
  // CAMPAIGNS
  // =========================================================

  const allCampaigns =
    new Set<string>();

  const sourceNames:
    string[] = [];

  groupedData.forEach(
    (item) => {
      sourceNames.push(
        item.source,
      );

      item.campaigns.forEach(
        (campaign: any) => {
          allCampaigns.add(
            campaign.campaignName,
          );
        },
      );
    },
  );

  const campaigns =
    Array.from(
      allCampaigns,
    ).sort();

  const activeRange =
    shouldFilterByLead
      ? (
          leadCreatedRange ||
          defaultLeadCreatedRange
        )
      : orderCreatedRange;

  const response: any = {
    startDate:
      activeRange?.$gte || null,

    endDate:
      activeRange?.$lte || null,

    campaigns,

    data: [],

    totals: {
      total: {
        totalLead: 0,

        revenue: 0,
      },

      byCampaign: {},
    },

    stats: {
      totalLead: 0,

      totalRevenue: 0,

      totalOrders:
        formattedOrders.length,
    },
  };

  // =========================================================
  // RESPONSE DATA
  // =========================================================

  sourceNames
    .sort()
    .forEach(
      (source) => {
        const sourceData =
          groupedData.get(
            source,
          );

        const row: any = {
          source,
        };

        campaigns.forEach(
          (campaignName) => {
            const campaign =
              sourceData.campaigns.get(
                campaignName,
              );

            if (campaign) {
              const leadCount =
                campaign.leadIds.size;

              row[
                `${campaignName}_lead`
              ] =
                leadCount;

              row[
                `${campaignName}_revenue`
              ] =
                campaign.revenue;

              row[
                `${campaignName}_orders`
              ] =
                campaign.orders;

              if (
                !response
                  .totals
                  .byCampaign[
                    campaignName
                  ]
              ) {
                response
                  .totals
                  .byCampaign[
                    campaignName
                  ] = {
                    totalLead: 0,

                    revenue: 0,
                  };
              }

              response
                .totals
                .byCampaign[
                  campaignName
                ]
                .totalLead +=
                leadCount;

              response
                .totals
                .byCampaign[
                  campaignName
                ]
                .revenue +=
                campaign.revenue;

              response
                .totals
                .total
                .totalLead +=
                leadCount;

              response
                .totals
                .total
                .revenue +=
                campaign.revenue;

              response
                .stats
                .totalRevenue +=
                campaign.revenue;

              response
                .stats
                .totalLead +=
                leadCount;
            } else {
              row[
                `${campaignName}_lead`
              ] = 0;

              row[
                `${campaignName}_revenue`
              ] = 0;

              row[
                `${campaignName}_orders`
              ] = [];
            }
          },
        );

        row.totalLead =
          campaigns.reduce(
            (sum, campaign) =>
              sum +
              (
                row[
                  `${campaign}_lead`
                ] || 0
              ),
            0,
          );

        row.totalRevenue =
          campaigns.reduce(
            (sum, campaign) =>
              sum +
              (
                row[
                  `${campaign}_revenue`
                ] || 0
              ),
            0,
          );

        response.data.push(
          row,
        );
      },
    );

  return response;
}

  async stateLeadStageRevenueReport(query: any) {
    const now = new Date();
    let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    if (query.dateFilter) {
      const filter = query.dateFilter.toString().toLowerCase();
      if (filter === 'today') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (filter === 'week') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (filter === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (filter === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      }
    }

    if (query.fromDate) {
      const from = new Date(query.fromDate);
      if (!Number.isNaN(from.getTime())) {
        startDate = new Date(from);
        startDate.setHours(0, 0, 0, 0);
      }
    }

    if (query.toDate) {
      const to = new Date(query.toDate);
      if (!Number.isNaN(to.getTime())) {
        endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    const leadMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (query.state) {
      leadMatch.state = { $regex: query.state, $options: 'i' };
    }

    const leads = await this.leadModel
      .find(leadMatch)
      .populate('stageId', 'name order')
      .select('phone state stageId')
      .lean();

    const filteredLeads = query.leadStage
      ? leads.filter((lead) => {
        const stageName = String((lead.stageId as any)?.name || '').toLowerCase();
        return stageName.includes(String(query.leadStage).toLowerCase());
      })
      : leads;

    if (!filteredLeads.length) {
      return {
        startDate,
        endDate,
        filters: {
          state: query.state || null,
          leadStage: query.leadStage || null,
        },
        states: [],
        leadStages: [],
        data: [],
        summary: {
          totalRevenue: 0,
          totalLeads: 0,
          totalOrders: 0,
        },
      };
    }

    const leadPhones = filteredLeads.map((lead) => lead.phone).filter(Boolean);
    const orders = await this.orderModel
      .find({
        mobile: { $in: leadPhones },
        orderDate: { $gte: startDate, $lte: endDate },
      })
      .lean();

    const ordersByPhone = new Map<string, any[]>();
    orders.forEach((order) => {
      const key = String(order.mobile || '');
      if (!key) return;
      if (!ordersByPhone.has(key)) {
        ordersByPhone.set(key, []);
      }
      ordersByPhone.get(key)?.push(order);
    });

    const stateSet = new Set<string>();
    const stageSet = new Set<string>();
    const rowMap = new Map<string, any>();

    const getRevenueForLead = (phone: string) => {
      const leadOrders = ordersByPhone.get(phone) || [];
      return leadOrders.reduce((sum, order) => sum + (order.countedRevenue || 0), 0);
    };

    filteredLeads.forEach((lead: any) => {
      const state = lead.state || 'Unknown';
      const stageName = (lead.stageId as any)?.name || 'Unknown';
      const stageOrder = Number((lead.stageId as any)?.order || 999999);
      const revenue = getRevenueForLead(String(lead.phone || ''));

      stateSet.add(state);
      stageSet.add(stageName);

      const rowKey = stageName;
      const existing = rowMap.get(rowKey) || {
        leadStage: stageName,
        stageOrder,
        totalRevenue: 0,
        totalLeads: 0,
      };

      existing[state] = (existing[state] || 0) + revenue;
      existing.totalRevenue += revenue;
      existing.totalLeads += 1;
      existing.stageOrder = Math.min(existing.stageOrder || 999999, stageOrder);
      rowMap.set(rowKey, existing);
    });

    const states = Array.from(stateSet).sort((a, b) => a.localeCompare(b));
    const leadStages = Array.from(stageSet).sort((a, b) => a.localeCompare(b));

    const data = Array.from(rowMap.values())
      .map((row: any) => {
        const finalRow: any = {
          leadStage: row.leadStage,
          totalRevenue: row.totalRevenue,
          totalLeads: row.totalLeads,
        };

        states.forEach((state) => {
          finalRow[state] = row[state] || 0;
        });

        return finalRow;
      })
      .sort((a, b) => {
        const aRow = rowMap.get(a.leadStage);
        const bRow = rowMap.get(b.leadStage);
        return (aRow?.stageOrder || 999999) - (bRow?.stageOrder || 999999);
      });

    const summary = {
      totalRevenue: orders.reduce((sum, order) => sum + (order.countedRevenue || 0), 0),
      totalLeads: filteredLeads.length,
      totalOrders: orders.length,
    };

    return {
      startDate,
      endDate,
      filters: {
        state: query.state || null,
        leadStage: query.leadStage || null,
      },
      states,
      leadStages,
      data,
      summary,
    };
  }

async employeePoolRevenueReport(query: any) {
  const now = new Date();

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
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

  // Date filter
  if (query.dateFilter) {
    const filter = query.dateFilter
      .toString()
      .toLowerCase();

    if (filter === 'month') {
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
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
    } else if (filter === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'week') {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
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

  if (query.fromDate) {
    const from = new Date(query.fromDate);

    if (!Number.isNaN(from.getTime())) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
    }
  }

  if (query.toDate) {
    const to = new Date(query.toDate);

    if (!Number.isNaN(to.getTime())) {
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    }
  }

  // Level
  const levelNumber = this.resolveLevel(
    query.level,
  );

  if (levelNumber === null) {
    return {
      startDate,
      endDate,
      months: [],
      pools: [],
      employees: [],
    };
  }

  const levelUserIds =
    await this.getUserIdsByRoleLevel(
      levelNumber,
    );

  if (!levelUserIds.length) {
    return {
      startDate,
      endDate,
      months: [],
      pools: [],
      employees: [],
    };
  }

  // Team filter
  const teamFilter =
    query.team === true ||
    query.team === 'true' ||
    query.teamFilter === true ||
    query.teamFilter === 'true';

  const selectedCounsellorId =
    query.counsellorId
      ? String(query.counsellorId)
      : null;

  // Get level users
  let rootUsers = await this.userModel
    .find({
      _id: {
        $in: levelUserIds,
      },
      status: 'active',
    })
    .select(
      'name email number employeeId role createdAt',
    )
    .lean();

  // Selected counsellor
  if (selectedCounsellorId) {
    const selectedCounsellor =
      await this.userModel
        .findOne({
          _id: selectedCounsellorId,
          status: 'active',
        })
        .populate(
          'role',
          'level',
        )
        .select(
          'name email number employeeId role createdAt',
        )
        .lean();

    if (
      !selectedCounsellor ||
      Number(
        (selectedCounsellor as any)?.role?.level,
      ) !== levelNumber
    ) {
      return {
        startDate,
        endDate,
        months: [],
        pools: [],
        employees: [],
      };
    }

    rootUsers = [
      selectedCounsellor,
    ];
  }

  // Build employee -> users included in report
  const rootUsersById =
    new Map<string, any>();

  const ownerByUserId =
    new Map<string, string>();

  const allAllowedUserIds =
    new Set<string>();

  for (const rootUser of rootUsers) {
    const rootId =
      rootUser._id.toString();

    rootUsersById.set(
      rootId,
      rootUser,
    );

    // team=false => own data only
    if (!teamFilter) {
      allAllowedUserIds.add(
        rootId,
      );

      ownerByUserId.set(
        rootId,
        rootId,
      );

      continue;
    }

    // team=true => own + complete subtree
    const subtreeIds =
      await this.getUserAndSubordinateIds(
        rootId,
      );

    // Always include root employee
    const memberIds = [
      rootId,
      ...subtreeIds,
    ];

    for (const memberId of memberIds) {
      const id =
        memberId.toString();

      allAllowedUserIds.add(id);

      ownerByUserId.set(
        id,
        rootId,
      );
    }
  }

  if (!allAllowedUserIds.size) {
    return {
      startDate,
      endDate,
      months: [],
      pools: [],
      employees: [],
    };
  }

  const allowedUserIdStrings =
    Array.from(
      allAllowedUserIds,
    );

  let poolObjectId: Types.ObjectId | null =
    null;

  if (
    query.poolId &&
    Types.ObjectId.isValid(
      query.poolId,
    )
  ) {
    poolObjectId =
      new Types.ObjectId(
        query.poolId,
      );
  }

  // Revenue aggregation
  const revenueRows =
    await this.orderModel.aggregate([
      {
        $addFields: {
          normalizedPoolId: {
            $convert: {
              input: '$courseVertical',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },

          normalizedEmployeeId: {
            $convert: {
              input: '$counsellorId',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },

          monthLabel: {
            $concat: [
              {
                $dateToString: {
                  format: '%b',
                  date: '$orderDate',
                },
              },
              "'",
              {
                $substr: [
                  {
                    $toString: {
                      $year: '$orderDate',
                    },
                  },
                  2,
                  2,
                ],
              },
            ],
          },

          calculatedRevenue: {
            $switch: {
              branches: [
                {
                  case: {
                    $eq: [
                      '$paymentMode',
                      PaymentMode.LOAN,
                    ],
                  },

                  then: {
                    $ifNull: [
                      '$loanDetails.disbursementAmount',
                      0,
                    ],
                  },
                },

                {
                  case: {
                    $eq: [
                      '$paymentMode',
                      PaymentMode.LUMPSUM,
                    ],
                  },

                  then: {
                    $ifNull: [
                      '$lumpsumDetails.totalReceived',
                      0,
                    ],
                  },
                },
              ],

              default: 0,
            },
          },
        },
      },

      {
        $match: {
          Approved:true,
          orderDate: {
            $gte: startDate,
            $lte: endDate,
          },

          normalizedPoolId: {
            $ne: null,
          },

          normalizedEmployeeId: {
            $in: allowedUserIdStrings,
          },

          calculatedRevenue: {
            $gt: 0,
          },

          ...(poolObjectId
            ? {
                normalizedPoolId:
                  poolObjectId,
              }
            : {}),
        },
      },

      {
        $group: {
          _id: {
            poolId:
              '$normalizedPoolId',

            employeeId:
              '$normalizedEmployeeId',

            month:
              '$monthLabel',
          },

          revenue: {
            $sum:
              '$calculatedRevenue',
          },

          orders: {
            $push: {
              orderId: '$_id',

              studentName:
                '$studentName',

              email:
                '$email',

              mobile:
                '$mobile',

              fatherName:
                '$fatherName',

              courseName:
                '$courseName',

              courseDuration:
                '$courseDuration',

              paymentMode:
                '$paymentMode',

              orderDate:
                '$orderDate',

              feeDepositDate:
                '$feeDepositDate',

              totalFee:
                '$totalFee',

              discount:
                '$discount',

              finalFee:
                '$finalFee',

              revenue:
                '$calculatedRevenue',

              loanDisbursementAmount: {
                $cond: [
                  {
                    $eq: [
                      '$paymentMode',
                      PaymentMode.LOAN,
                    ],
                  },
                  '$loanDetails.disbursementAmount',
                  null,
                ],
              },

              lumpsumTotalReceived: {
                $cond: [
                  {
                    $eq: [
                      '$paymentMode',
                      PaymentMode.LUMPSUM,
                    ],
                  },
                  '$lumpsumDetails.totalReceived',
                  null,
                ],
              },

              status:
                '$status',

              approved:
                '$Approved',
            },
          },
        },
      },

      {
        $lookup: {
          from: 'pools',
          localField: '_id.poolId',
          foreignField: '_id',
          as: 'pool',
        },
      },

      {
        $unwind: {
          path: '$pool',
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $project: {
          poolId:
            '$_id.poolId',

          poolName: {
            $ifNull: [
              '$pool.name',
              'Unknown',
            ],
          },

          employeeId:
            '$_id.employeeId',

          month:
            '$_id.month',

          revenue: 1,

          orders: 1,
        },
      },

      {
        $sort: {
          employeeId: 1,
          poolName: 1,
          month: 1,
        },
      },
    ]);

  // Month order
  const monthOrder = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const months = Array.from(
    new Set(
      revenueRows.map(
        (row) => row.month,
      ),
    ),
  ).sort((a, b) => {
    const [ma, ya] =
      String(a).split("'");

    const [mb, yb] =
      String(b).split("'");

    const valueA =
      Number(`20${ya}`) * 100 +
      monthOrder.indexOf(ma);

    const valueB =
      Number(`20${yb}`) * 100 +
      monthOrder.indexOf(mb);

    return valueA - valueB;
  });

  // Employee map
  const employeeMap =
    new Map<string, any>();

  for (const rootUser of rootUsers) {
    const rootId =
      rootUser._id.toString();

    employeeMap.set(
      rootId,
      {
        employeeId:
          rootId,

        employeeName:
          rootUser.name || 'Unknown',

        employeeEmail:
          rootUser.email || null,

        employeeNumber:
          rootUser.number || null,

        employeeEmployeeId:
          rootUser.employeeId || null,

        poolData:
          new Map<string, any>(),
      },
    );
  }

  // Build revenue data
  revenueRows.forEach((row) => {
    const employeeId =
      String(
        row.employeeId || '',
      );

    if (!employeeId) {
      return;
    }

    // team=true => assign subordinate data
    // to root employee
    //
    // team=false => employee owns
    // only their own data
    const rootId =
      teamFilter
        ? ownerByUserId.get(
            employeeId,
          ) || employeeId
        : employeeId;

    const sourceUser =
      rootUsersById.get(
        rootId,
      );

    const existing =
      employeeMap.get(
        rootId,
      ) || {
        employeeId:
          rootId,

        employeeName:
          sourceUser?.name ||
          'Unknown',

        employeeEmail:
          sourceUser?.email ||
          null,

        employeeNumber:
          sourceUser?.number ||
          null,

        employeeEmployeeId:
          sourceUser?.employeeId ||
          null,

        poolData:
          new Map<string, any>(),
      };

    const poolId =
      row.poolId?.toString() ||
      'unknown';

    const poolEntry =
      existing.poolData.get(
        poolId,
      ) || {
        poolId,

        poolName:
          row.poolName ||
          'Unknown',

        revenueByMonth: {},

        orders: [],
      };

    poolEntry.revenueByMonth[
      row.month
    ] =
      (
        poolEntry.revenueByMonth[
          row.month
        ] || 0
      ) + row.revenue;

    if (
      Array.isArray(row.orders) &&
      row.orders.length
    ) {
      poolEntry.orders.push(
        ...row.orders,
      );
    }

    existing.poolData.set(
      poolId,
      poolEntry,
    );

    employeeMap.set(
      rootId,
      existing,
    );
  });

  // Pools
  const pools =
    Array.from(
      new Map(
        revenueRows
          .map(
            (row) =>
              [
                row.poolId?.toString(),
                row.poolName ||
                  'Unknown',
              ] as const,
          )
          .filter(
            ([poolId]) =>
              Boolean(poolId),
          ),
      ).entries(),
    ).map(
      ([poolId, poolName]) => ({
        poolId,
        poolName,
      }),
    );

  // Final employee response
  const employees =
    Array.from(
      employeeMap.values(),
    )
      .map((emp) => ({
        employeeId:
          emp.employeeId,

        employeeName:
          emp.employeeName,

        employeeEmail:
          emp.employeeEmail,

        employeeNumber:
          emp.employeeNumber,

        employeeEmployeeId:
          emp.employeeEmployeeId,

        pools: pools.map(
          (reportPool) => {
            const existingPool =
              emp.poolData.get(
                reportPool.poolId,
              );

            return {
              poolId:
                reportPool.poolId,

              poolName:
                reportPool.poolName,

              revenueByMonth:
                months.map(
                  (month) => ({
                    month,

                    revenue:
                      existingPool
                        ?.revenueByMonth
                        ?.[month] || 0,
                  }),
                ),

              orders:
                existingPool
                  ?.orders || [],
            };
          },
        ),
      }))
      .sort((a, b) =>
        a.employeeName.localeCompare(
          b.employeeName,
        ),
      );

  return {
    startDate,
    endDate,
    months,
    pools,
    employees,

    filters: {
      level:
        levelNumber,

      team:
        teamFilter,

      counsellorId:
        selectedCounsellorId,
    },
  };
}

  async applyPayment(orderId: string, amount: number) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new BadRequestException('Order not found');

    order.lumpsumDetails = order.lumpsumDetails || {
      registrationDate: order.feeDepositDate || new Date(),
      registrationAmount: 0,
      totalReceived: 0,
      pendingAmount: order.finalFee || 0,
      paymentType: 'Subscription',
    };
    order.lumpsumDetails.totalReceived += amount;
    order.lumpsumDetails.pendingAmount = order.finalFee - order.lumpsumDetails.totalReceived;

    if (order.lumpsumDetails.pendingAmount <= 0) {
      order.status = OrderStatus.FULLY_PAID;
    } else {
      order.status = OrderStatus.PARTIALLY_PAID;
    }

    return await order.save();
  }

  async getAllEmi(query: any, user: any) {

    const {
      search,
      orderId,
      status,
      loanPartner,
      counsellorId,
      group,
      dateFilter,
      fromDate,
      toDate,
      page = 1,
      limit = 10,
    } = query;

    const filter: any = {};

    /* ================= GROUP FILTER ================= */

    let accessibleUserIds: string[] = [];

    if (group === true || group === 'true') {
      const users = await this.userLogic.getUsersUnder(user);

      accessibleUserIds = users.map((u) => u._id.toString());
      accessibleUserIds.push(user.userId);

      filter.couselorId = {
        $in: accessibleUserIds.map((id) => id),
      };
    }
    else if (user.roleName === 'bd') {
      filter.couselorId = user.userId;
    }

    /* ================= COUNSELLOR FILTER ================= */

    if (counsellorId) {
      filter.couselorId = counsellorId;
    }

    /* ================= LOAN PARTNER FILTER ================= */

    if (loanPartner) {
      filter.LoanPartner = loanPartner;
    }

    /* ================= SEARCH ================= */

    if (search) {
      filter.$or = [
        { learnerName: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { counselorName: { $regex: search, $options: 'i' } },
      ];
    }

    /* ================= OTHER FILTERS ================= */

    if (orderId) filter.orderId = new Types.ObjectId(orderId);
    if (status) filter.status = status;

    /* ================= DATE FILTER ================= */

    if (dateFilter) {
      let start: Date | null = null;
      let end: Date = new Date();

      if (dateFilter === 'today') {
        start = new Date();
        start.setHours(0, 0, 0, 0);
      }
      else if (dateFilter === 'week') {
        start = new Date();
        start.setDate(start.getDate() - 7);
      }
      else if (dateFilter === 'month') {
        start = new Date();
        start.setMonth(start.getMonth() - 1);
      }
      else if (dateFilter === 'year') {
        start = new Date();
        start.setFullYear(start.getFullYear() - 1);
      }

      if (start) {
        filter.createdAt = {
          $gte: start,
          $lte: end,
        };
      }
    }

    /* ================= CUSTOM DATE ================= */

    if (fromDate && toDate) {
      filter.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    /* ================= PAGINATION ================= */

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const [data, total] = await Promise.all([
      this.emiModel
        .find(filter)
        .populate('LoanPartner', 'name type submissionCharge')
        .populate('couselorId', 'name email employeeId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),

      this.emiModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async updateInstallments(dto: any, user: any, id: string) {
    const existing = await this.emiModel.findById(id);
    if (!existing) throw new BadRequestException('Loan not found');
    if (existing.couselorId.toString() !== user.userId && user.roleName !== 'admin') {
      throw new BadRequestException('Not authorized to update this loan');
    }
    if (dto.firstEmi) {
      existing.firstEmi = true;
    } else if (dto.secondEmi) {
      existing.secondEmi = true;
    } else if (dto.thirdEmi) {
      existing.thirdEmi = true;
    }
    await existing.save();
    return existing;
  }

  async sendReminder(id: string, body: any) {
    const { reminderText, reminderNumber } = body;
    const existing = await this.emiModel.findById(id);
    if (!existing) throw new Error('Loan not found');

    if (existing.status === 'COMPLETED') {
      throw new Error('Loan Completed');
    }

    // 🔥 Determine which reminder to update
    let updateField = '';
    let emiDate: Date | null = null;

    if (reminderNumber === 1) {
      // if (existing.firstReminderSent) {
      //   throw new Error('First reminder already sent');
      // }
      updateField = 'firstReminderSent';
      emiDate = existing.firstEmiDate;
    }
    else if (reminderNumber === 2) {
      // if (existing.secondReminderSent) {
      //   throw new Error('Second reminder already sent');
      // }
      updateField = 'secondReminderSent';
      emiDate = existing.secondEmiDate;
    }
    else if (reminderNumber === 3) {
      // if (existing.thirdReminderSent) {
      //   throw new Error('Third reminder already sent');
      // }
      updateField = 'thirdReminderSent';
      emiDate = existing.thirdEmiDate;
    }
    else {
      throw new Error('Invalid reminder number');
    }
    await this.emailService.sendReminder(existing.email, reminderText);


    // 🔥 Update reminder flag
    existing[updateField] = true;

    await existing.save();

    return {
      message: `Reminder ${reminderNumber} sent successfully`,
      loanId: id,
      emiDate,
    };
  }
async monthlyRevenueGraph(
  query: any,
  currentUser: any,
) {
  const now = new Date();
  let year = now.getFullYear();

  if (query.year) {
    const requestedYear =
      Number(query.year);

    if (
      Number.isInteger(requestedYear) &&
      requestedYear >= 2000 &&
      requestedYear <= 2100
    ) {
      year = requestedYear;
    }
  }
  const startDate = new Date(
    year,
    0,
    1,
    0,
    0,
    0,
    0,
  );

  const endDate = new Date(
    year,
    11,
    31,
    23,
    59,
    59,
    999,
  );

  // ---------------------------------------------------------
  // MONTHS
  // ---------------------------------------------------------

  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  // =========================================================
  // FIND USERS WHOSE ORDERS SHOULD BE INCLUDED
  // =========================================================

  const currentUserId =
    currentUser?._id ||
    currentUser?.userId;

  if (!currentUserId) {
    throw new BadRequestException(
      'User information not found',
    );
  }

  const userId =
    currentUserId.toString();

  // ---------------------------------------------------------
  // Determine role
  // ---------------------------------------------------------

  let roleName =
    currentUser?.roleName ||
    currentUser?.role?.name ||
    '';

  roleName =
    String(roleName)
      .toLowerCase();

  // ---------------------------------------------------------
  // ADMIN
  //
  // Admin sees ALL orders.
  // ---------------------------------------------------------

  let allowedUserIds:
    | string[]
    | null = null;
  if (roleName === 'admin') {
    // null means don't filter counsellorId
    allowedUserIds = null;
  }

  // ---------------------------------------------------------
  // BD
  //
  // BD sees:
  // 1. Own orders
  // 2. Orders of everyone under them
  // ---------------------------------------------------------
  
  else if (roleName === 'bd') {
    const userIds =
      await this.getUserAndSubordinateIds(
        userId,
      );
    allowedUserIds = [
      ...new Set([
        userId,
        ...userIds.map((id) =>
          id.toString(),
        ),
      ]),
    ];
  }

  // ---------------------------------------------------------
  // FALLBACK
  //
  // If some other role reaches this endpoint,
  // only show their own orders.
  // ---------------------------------------------------------

  else {
    allowedUserIds = [
      userId,
    ];
  }

  // =========================================================
  // ORDER MATCH
  // =========================================================

  const orderMatch: any = {
    orderDate: {
      $gte: startDate,
      $lte: endDate,
    },

    Approved: true,

    // -------------------------------------------------------
    // Only actual revenue orders
    // -------------------------------------------------------

    $or: [
      {
        paymentMode:
          PaymentMode.LUMPSUM,

        'lumpsumDetails.totalReceived': {
          $gt: 0,
        },
      },

      {
        paymentMode:
          PaymentMode.LOAN,

        'loanDetails.disbursementAmount': {
          $gt: 0,
        },
      },

      // Subscription will be added later.
    ],
  };

  // ---------------------------------------------------------
  // Apply counsellor filter only for BD/non-admin
  // ---------------------------------------------------------

  if (
    allowedUserIds !== null
  ) {
    orderMatch.counsellorId = {
      $in:allowedUserIds
    };
  }

  // =========================================================
  // AGGREGATE REVENUE
  // =========================================================

  const revenueRows =
    await this.orderModel.aggregate([
      {
        $match:
          orderMatch,
      },

      // -----------------------------------------------------
      // CALCULATE REVENUE
      // -----------------------------------------------------

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
                      PaymentMode.LUMPSUM,
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
                      PaymentMode.LOAN,
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
                // Subscription revenue later.
              ],

              default: 0,
            },
          },

          monthNumber: {
            $month:
              '$orderDate',
          },
        },
      },

      // -----------------------------------------------------
      // SAFETY CHECK
      // -----------------------------------------------------

      {
        $match: {
          calculatedRevenue: {
            $gt: 0,
          },
        },
      },

      // -----------------------------------------------------
      // GROUP BY MONTH
      // -----------------------------------------------------

      {
        $group: {
          _id:
            '$monthNumber',

          revenue: {
            $sum:
              '$calculatedRevenue',
          },
        },
      },

      {
        $sort: {
          _id: 1,
        },
      },
    ]);

  // =========================================================
  // MAP REVENUE BY MONTH
  // =========================================================

  const revenueByMonth =
    new Map<number, number>();

  revenueRows.forEach(
    (row: any) => {
      revenueByMonth.set(
        Number(row._id),
        Number(
          row.revenue || 0,
        ),
      );
    },
  );

  // =========================================================
  // RETURN ALL 12 MONTHS
  // =========================================================

  const data =
    monthNames.map(
      (month, index) => {
        const monthNumber =
          index + 1;

        // Future months of current year
        // should return 0.

        const isFutureMonth =
          year ===
            now.getFullYear() &&
          monthNumber >
            now.getMonth() + 1;

        return {
          month,

          monthNumber,

          revenue:
            isFutureMonth
              ? 0
              : revenueByMonth.get(
                  monthNumber,
                ) || 0,
        };
      },
    );

  // =========================================================
  // TOTAL REVENUE
  // =========================================================

  const totalRevenue =
    data.reduce(
      (sum, item) =>
        sum +
        Number(
          item.revenue || 0,
        ),
      0,
    );

  // =========================================================
  // RESPONSE
  // =========================================================

  return {
    year,

    startDate,

    endDate,

    data,

    totalRevenue,
  };
}
}
