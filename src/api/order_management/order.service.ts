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

  // =========================================================
  // DATE FILTER
  // Same rolling-period logic as Leads API
  // =========================================================

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

  if (query.dateFilter) {
    const filter =
      query.dateFilter
        .toString()
        .toLowerCase();

    if (filter === 'today') {
      // Today
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    else if (filter === 'week') {
  startDate = new Date();
  startDate.setDate(
    startDate.getDate() - 7,
  );

  endDate = new Date();
}

    else if (filter === 'month') {
      // Last 1 month including today
      startDate = new Date(now);
      startDate.setMonth(
        startDate.getMonth() - 1,
      );
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    else if (filter === 'year') {
      // Last 1 year including today
      startDate = new Date(now);
      startDate.setFullYear(
        startDate.getFullYear() - 1,
      );
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }
  }

  // =========================================================
  // CUSTOM DATE FILTER
  // Overrides dateFilter boundaries
  // =========================================================

  if (query.fromDate) {
    const from =
      new Date(query.fromDate);

    if (
      !Number.isNaN(
        from.getTime(),
      )
    ) {
      startDate =
        new Date(from);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );
    }
  }

  if (query.toDate) {
    const to =
      new Date(query.toDate);

    if (
      !Number.isNaN(
        to.getTime(),
      )
    ) {
      endDate =
        new Date(to);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }
  }

  // =========================================================
  // LEVEL
  // =========================================================

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

  // =========================================================
  // COUNSELLOR FILTER
  // No team filter
  // =========================================================

  const selectedCounsellorId =
    query.counsellorId
      ? String(
          query.counsellorId,
        )
      : null;

  let rootUsers =
    await this.userModel
      .find({
        _id: {
          $in: levelUserIds,
        },
      })
      .select(
        'name email employeeId role createdAt',
      )
      .lean();

  // =========================================================
  // SELECTED COUNSELLOR
  // =========================================================

  if (
    selectedCounsellorId
  ) {
    const selectedCounsellor =
      await this.userModel
        .findById(
          selectedCounsellorId,
        )
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
        (
          selectedCounsellor as any
        )?.role?.level,
      ) !== levelNumber
    ) {
      return [];
    }

    rootUsers = [
      selectedCounsellor,
    ];
  }

  // =========================================================
  // ALLOWED USERS
  // No subordinate/team logic
  // =========================================================

  const allowedUserIdStrings =
    rootUsers.map(
      (user) =>
        user._id.toString(),
    );

  if (
    !allowedUserIdStrings.length
  ) {
    return rootUsers.map(
      (user) => ({
        consultantId:
          user._id.toString(),

        consultantName:
          user.name ||
          'Unknown',

        consultantEmail:
          user.email ||
          null,

        employeeId:
          user.employeeId ||
          null,

        totalLeadAssigned: 0,

        monthlyRevenueTarget:
          null,

        registrationDone: 0,

        admDone: 0,

        bookedRevenue: 0,

        unrealisedRevenue: 0,

        realisedRevenue: 0,

        achievementPercentage:
          null,

        tillDateRealisedInLastMonth:
          0,

        lastSalePunchDate:
          null,

        lastRevenuePunched: 0,

        numberOfDaysOnZero:
          null,
      }),
    );
  }

  // =========================================================
  // LEAD STATS
  //
  // IMPORTANT:
  // We use assignedDate because this report measures
  // leads assigned to the consultant.
  // =========================================================

  const leadStats =
    await this.leadModel.aggregate([
      {
        $addFields: {
          normalizedAssignedTo: {
            $convert: {
              input:
                '$assignedTo',

              to: 'string',

              onError: null,

              onNull: null,
            },
          },
        },
      },

      {
        $match: {
          assignedDate: {
            $gte: startDate,
            $lte: endDate,
          },

          normalizedAssignedTo: {
            $in:
              allowedUserIdStrings,
          },
        },
      },

      {
        $group: {
          _id:
            '$normalizedAssignedTo',

          totalLeadAssigned: {
            $sum: 1,
          },
        },
      },
    ]);

  // =========================================================
  // ORDER STATS
  // =========================================================

  const orderStats =
    await this.orderModel.aggregate([
      {
        $addFields: {
          normalizedCounsellorId: {
            $convert: {
              input:
                '$counsellorId',

              to: 'string',

              onError: null,

              onNull: null,
            },
          },

          // =================================================
          // ACTUAL REVENUE
          // =================================================

          calculatedRevenue: {
            $switch: {
              branches: [
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
                // SUBSCRIPTION
                // -------------------------------------------

                // TODO:
                // Subscription revenue calculation later.
              ],

              // Never use finalFee here.
              default: 0,
            },
          },

          // =================================================
          // UNREALISED REVENUE
          // =================================================

          calculatedUnrealisedRevenue: {
            $switch: {
              branches: [
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

                  then: 0,
                },

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
                      '$lumpsumDetails.pendingAmount',
                      0,
                    ],
                  },
                },

                // -------------------------------------------
                // SUBSCRIPTION
                // -------------------------------------------

                // TODO:
                // Subscription unrealised revenue later.
              ],

              default: 0,
            },
          },
        },
      },

      // =====================================================
      // ORDER DATE FILTER
      // =====================================================

      {
        $match: {
          orderDate: {
            $gte: startDate,
            $lte: endDate,
          },

          normalizedCounsellorId: {
            $in:
              allowedUserIdStrings,
          },
        },
      },

      // Latest order first
      {
        $sort: {
          feeDepositDate: -1,
          updatedAt: -1,
          createdAt: -1,
        },
      },

      {
        $group: {
          _id:
            '$normalizedCounsellorId',

          // -----------------------------------------------
          // REGISTRATION
          // -----------------------------------------------

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

          // -----------------------------------------------
          // ADM
          // -----------------------------------------------

          admDone: {
            $sum: {
              $cond: [
                '$Approved',
                1,
                0,
              ],
            },
          },

          // -----------------------------------------------
          // BOOKED REVENUE
          // -----------------------------------------------

          bookedRevenue: {
            $sum:
              '$calculatedRevenue',
          },

          // -----------------------------------------------
          // REALISED REVENUE
          // -----------------------------------------------

          realisedRevenue: {
            $sum:
              '$calculatedRevenue',
          },

          // -----------------------------------------------
          // UNREALISED REVENUE
          // -----------------------------------------------

          unrealisedRevenue: {
            $sum:
              '$calculatedUnrealisedRevenue',
          },

          // -----------------------------------------------
          // LAST SALE
          // -----------------------------------------------

          lastSalePunchDate: {
            $first:
              '$feeDepositDate',
          },

          // -----------------------------------------------
          // LAST REVENUE PUNCHED
          // -----------------------------------------------

          lastRevenuePunched: {
            $first:
              '$calculatedRevenue',
          },

          // -----------------------------------------------
          // TOTAL ORDERS
          // -----------------------------------------------

          totalOrders: {
            $sum: 1,
          },
        },
      },
    ]);

  // =========================================================
  // LAST MONTH REVENUE
  // =========================================================

  const monthStart =
    new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
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
              input:
                '$counsellorId',

              to: 'string',

              onError: null,

              onNull: null,
            },
          },

          // Same revenue calculation
          // as current report.

          calculatedRevenue: {
            $switch: {
              branches: [
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
                // SUBSCRIPTION
                // -------------------------------------------

                // TODO:
                // Subscription revenue later.
              ],

              default: 0,
            },
          },
        },
      },

      {
        $match: {
          feeDepositDate: {
            $gte:
              monthStart,

            $lte:
              monthEnd,
          },

          normalizedCounsellorId: {
            $in:
              allowedUserIdStrings,
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
  // BUILD STATS
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

            admDone: 0,

            bookedRevenue: 0,

            unrealisedRevenue: 0,

            realisedRevenue: 0,

            lastSalePunchDate:
              null,

            lastRevenuePunched:
              0,

            tillDateRealisedInLastMonth:
              0,
          },
        );
      }

      return statsByConsultant.get(
        id,
      );
    };

  // =========================================================
  // ADD LEAD STATS
  // =========================================================

  leadStats.forEach(
    (item) => {
      if (!item._id) {
        return;
      }

      const userId =
        item._id.toString();

      const current =
        ensureStats(userId);

      current.totalLeadAssigned +=
        item.totalLeadAssigned ||
        0;
    },
  );

  // =========================================================
  // ADD ORDER STATS
  // =========================================================

  orderStats.forEach(
    (item) => {
      if (!item._id) {
        return;
      }

      const userId =
        item._id.toString();

      const current =
        ensureStats(userId);

      current.registrationDone +=
        item.registrationDone ||
        0;

      current.admDone +=
        item.admDone ||
        0;

      current.bookedRevenue +=
        item.bookedRevenue ||
        0;

      current.realisedRevenue +=
        item.realisedRevenue ||
        0;

      current.unrealisedRevenue +=
        item.unrealisedRevenue ||
        0;

      if (
        item.lastSalePunchDate
      ) {
        if (
          !current.lastSalePunchDate ||
          new Date(
            item.lastSalePunchDate,
          ) >
            new Date(
              current.lastSalePunchDate,
            )
        ) {
          current.lastSalePunchDate =
            item.lastSalePunchDate;

          current.lastRevenuePunched =
            item.lastRevenuePunched ||
            0;
        }
      }
    },
  );

  // =========================================================
  // ADD LAST MONTH STATS
  // =========================================================

  lastMonthStats.forEach(
    (item) => {
      if (!item._id) {
        return;
      }

      const userId =
        item._id.toString();

      const current =
        ensureStats(userId);

      current.tillDateRealisedInLastMonth +=
        item.tillDateRealisedInLastMonth ||
        0;
    },
  );

  // =========================================================
  // FINAL REPORT
  // =========================================================

  const report =
    rootUsers
      .map((user) => {
        const item =
          ensureStats(
            user._id.toString(),
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
                    (
                      1000 *
                      60 *
                      60 *
                      24
                    ),
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
          consultantId:
            user._id.toString(),

          consultantName:
            user?.name ||
            'Unknown',

          consultantEmail:
            user?.email ||
            null,

          employeeId:
            user?.employeeId ||
            null,

          totalLeadAssigned:
            item.totalLeadAssigned,

          monthlyRevenueTarget,

          registrationDone:
            item.registrationDone,

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
            item.tillDateRealisedInLastMonth ||
            0,

          lastSalePunchDate,

          lastRevenuePunched:
            item.lastRevenuePunched,

          numberOfDaysOnZero,
        };
      })
      .sort(
        (a, b) =>
          a.consultantName.localeCompare(
            b.consultantName,
          ),
      );

  return report;
}


async consultantPerformanceDetails(query: any) {
  const now = new Date();

  // =========================================================
  // DATE FILTER
  // Same rolling filter logic as Leads API
  // =========================================================

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

  if (query.dateFilter) {
    const filter =
      query.dateFilter.toString().toLowerCase();

    if (filter === 'today') {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date();
    }

    else if (filter === 'week') {
      // EXACT same rolling logic as Leads API
      startDate = new Date();
      startDate.setDate(
        startDate.getDate() - 7,
      );

      endDate = new Date();
    }

    else if (filter === 'month') {
      startDate = new Date();
      startDate.setMonth(
        startDate.getMonth() - 1,
      );

      endDate = new Date();
    }

    else if (filter === 'year') {
      startDate = new Date();
      startDate.setFullYear(
        startDate.getFullYear() - 1,
      );

      endDate = new Date();
    }
  }

  // =========================================================
  // CUSTOM DATE
  // =========================================================

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

  // =========================================================
  // VALIDATE COUNSELLOR
  // =========================================================

  if (!query.counsellorId) {
    throw new BadRequestException(
      'counsellorId is required',
    );
  }

  const counsellorId =
    String(query.counsellorId);

  if (!Types.ObjectId.isValid(counsellorId)) {
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

  // =========================================================
  // TYPE
  // =========================================================

  const type =
    String(
      query.type || 'assigned-leads',
    ).toLowerCase();

  // =========================================================
  // ASSIGNED LEADS
  // =========================================================

  if (
    type === 'assigned-leads' ||
    type === 'assigned' ||
    type === 'leads'
  ) {
    const leads =
      await this.leadModel
        .find({
          assignedTo:counsellorId,
          assignedDate: {
            $gte: startDate,
            $lte: endDate,
          },
        })
        .sort({
          assignedDate: -1,
        })
        .lean();

    return {
      type: 'assigned-leads',

      counsellor: {
        id: counsellor._id,
        name: counsellor.name,
        email: counsellor.email,
        employeeId:
          counsellor.employeeId,
      },

      startDate,
      endDate,

      total: leads.length,

      data: leads,
    };
  }

  // =========================================================
  // ADMISSION DONE LEADS
  // =========================================================

  // =========================================================
// ADMISSION DONE LEADS
// =========================================================

if (
  type === 'admission-leads' ||
  type === 'admission' ||
  type === 'adm'
) {
  // -------------------------------------------------------
  // First get approved orders for this counsellor
  // -------------------------------------------------------

  const approvedOrders =
    await this.orderModel
      .find({
        counsellorId: counsellorId,

        Approved: true,

        orderDate: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .select(
        '_id mobile email studentName paymentMode loanDetails lumpsumDetails orderDate finalFee',
      )
      .sort({
        orderDate: -1,
      })
      .lean();

  // -------------------------------------------------------
  // If no approved orders
  // -------------------------------------------------------

  if (!approvedOrders.length) {
    return {
      type: 'admission-leads',

      counsellor: {
        id: counsellor._id,
        name: counsellor.name,
        email: counsellor.email,
        employeeId: counsellor.employeeId,
      },

      startDate,
      endDate,

      total: 0,

      data: [],
    };
  }

  // -------------------------------------------------------
  // Build mobile/email lists
  // -------------------------------------------------------

  const mobiles = approvedOrders
    .map((order: any) => order.mobile)
    .filter(Boolean);

  const emails = approvedOrders
    .map((order: any) => order.email)
    .filter(Boolean);

  // -------------------------------------------------------
  // Find corresponding leads
  //
  // Assuming Lead has mobile/email fields.
  // -------------------------------------------------------

  const leads =
    await this.leadModel
      .find({
        $or: [
          ...(mobiles.length
            ? [{ mobile: { $in: mobiles } }]
            : []),

          ...(emails.length
            ? [{ email: { $in: emails } }]
            : []),
        ],
      })
      .lean();

  // -------------------------------------------------------
  // Create lookup maps
  // -------------------------------------------------------

  const leadByMobile = new Map<string, any>();
  const leadByEmail = new Map<string, any>();

  leads.forEach((lead: any) => {
    if (lead.mobile) {
      leadByMobile.set(
        String(lead.mobile),
        lead,
      );
    }

    if (lead.email) {
      leadByEmail.set(
        String(lead.email).toLowerCase(),
        lead,
      );
    }
  });

  // -------------------------------------------------------
  // Attach order + revenue information to Lead
  // -------------------------------------------------------

  const admissionLeads =
    approvedOrders
      .map((order: any) => {
        let lead: any = null;

        // First try mobile
        if (order.mobile) {
          lead =
            leadByMobile.get(
              String(order.mobile),
            ) || null;
        }

        // Then email
        if (!lead && order.email) {
          lead =
            leadByEmail.get(
              String(order.email).toLowerCase(),
            ) || null;
        }

        // If corresponding lead doesn't exist,
        // don't return the order as a lead.
        if (!lead) {
          return null;
        }

        // ---------------------------------------------------
        // Calculate actual revenue
        // ---------------------------------------------------

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

        else if (
          order.paymentMode ===
          PaymentMode.LUMPSUM
        ) {
          revenue =
            Number(
              order.lumpsumDetails
                ?.totalReceived,
            ) || 0;
        }

        // Subscription = 0 for now

        return {
          ...lead,

          admission: true,

          admissionDate:
            order.orderDate,

          paymentMode:
            order.paymentMode,

          revenue,

          orderId:
            order._id,

          order: {
            orderId: order._id,

            orderDate:
              order.orderDate,

            paymentMode:
              order.paymentMode,

            revenue,

            // Keeping finalFee only as
            // reference, NOT as revenue.
            finalFee:
              order.finalFee || 0,
          },
        };
      })
      .filter(Boolean);

  return {
    type: 'admission-leads',

    counsellor: {
      id: counsellor._id,
      name: counsellor.name,
      email: counsellor.email,
      employeeId:
        counsellor.employeeId,
    },

    startDate,
    endDate,

    total:
      admissionLeads.length,

    data:
      admissionLeads,
  };
}


// =========================================================
// ORDERS
// =========================================================

if (type === 'orders') {
  const orders =
    await this.orderModel
      .find({
        counsellorId: counsellorId,

        Approved: true,

        orderDate: {
          $gte: startDate,
          $lte: endDate,
        },
        $or: [
          {
            paymentMode: PaymentMode.LUMPSUM,

            'lumpsumDetails.totalReceived': {
              $gt: 0,
            },
          },

          {
            paymentMode: PaymentMode.LOAN,

            'loanDetails.disbursementAmount': {
              $gt: 0,
            },
          },

          // -------------------------------------------------
          // Subscription intentionally excluded for now.
          // Add it here when subscription revenue logic
          // is finalized.
          // -------------------------------------------------
        ],
        
      })
      .sort({
        orderDate: -1,
      })
      .lean();

  // -------------------------------------------------------
  // Add calculated revenue to each order
  // -------------------------------------------------------

  const formattedOrders =
    orders.map((order: any) => {
      let revenue = 0;

      // ---------------------------------------------------
      // LOAN
      // ---------------------------------------------------

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

      // ---------------------------------------------------
      // LUMPSUM
      // ---------------------------------------------------

      else if (
        order.paymentMode ===
        PaymentMode.LUMPSUM
      ) {
        revenue =
          Number(
            order.lumpsumDetails
              ?.totalReceived,
          ) || 0;
      }

      // ---------------------------------------------------
      // SUBSCRIPTION
      // ---------------------------------------------------

      // TODO:
      // Subscription revenue calculation
      // will be added later.
      //
      // revenue = ...

      return {
        ...order,

        // Actual revenue counted by CRM
        revenue,
      };
    });

  return {
    type: 'orders',

    counsellor: {
      id: counsellor._id,
      name: counsellor.name,
      email: counsellor.email,
      employeeId:
        counsellor.employeeId,
    },

    startDate,
    endDate,

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

    if (query.startDate) {
      const from = new Date(query.startDate);
      if (!Number.isNaN(from.getTime())) {
        startDate = new Date(from);
        startDate.setHours(0, 0, 0, 0);
      }
    }
    if (query.endDate) {
      const to = new Date(query.endDate);
      if (!Number.isNaN(to.getTime())) {
        endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    const levelNumber = this.resolveLevel(query.level);
    if (levelNumber === null) {
      return {
        startDate,
        endDate,
        employees: [],
      };
    }

    const levelUserIds = await this.getUserIdsByRoleLevel(levelNumber);
    if (!levelUserIds.length) {
      return {
        startDate,
        endDate,
        employees: [],
      };
    }

    const levelUserIdStrings = levelUserIds.map((id) => id.toString());
    const buildLevelMatch = (fieldPath: string) => ({
      $expr: {
        $in: [
          {
            $convert: {
              input: fieldPath,
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
          levelUserIdStrings,
        ],
      },
    });

    const leadAssignments = await this.leadModel.aggregate([
      {
        $match: {
          assignedDate: { $gte: startDate, $lte: endDate },
          ...buildLevelMatch('$assignedTo'),
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
        $group: {
          _id: '$normalizedAssignedTo',
          totalAssigned: { $sum: 1 },
        },
      },
    ]);
    const newLeads = await this.leadModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          ...buildLevelMatch('$assignedTo'),
        },
      },
      {
        $group: {
          _id: {
            $convert: {
              input: '$assignedTo',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const callStats = await this.callLogModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          ...buildLevelMatch('$userId'),
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
            customerNumber: '$customerNumber',
          },
          dialCount: { $sum: 1 },
          answeredCount: {
            $sum: {
              $cond: [{ $gt: ['$duration', 0] }, 1, 0],
            },
          },
          talkTime: {
            $sum: {
              $cond: [{ $gt: ['$duration', 0] }, '$duration', 0],
            },
          },
        },
      },
      {
        $group: {
          _id: '$_id.userId',
          totalDial: { $sum: '$dialCount' },
          uniqDial: { $sum: 1 },
          answeredCall: { $sum: '$answeredCount' },
          answeredTalkTime: { $sum: '$talkTime' },
        },
      },
    ]);

    const stageUpdates = await this.leadModel.aggregate([
      {
        $match: {
          ...buildLevelMatch('$assignedTo'),
          $expr: {
            $and: [
              {
                $gte: [
                  { $ifNull: ['$modifiedAt', '$updatedAt'] },
                  startDate,
                ],
              },
              {
                $lte: [
                  { $ifNull: ['$modifiedAt', '$updatedAt'] },
                  endDate,
                ],
              },
            ],
          },
          stageId: { $exists: true, $ne: null },
        },
      },
      {
        $lookup: {
          from: 'leadstages',
          localField: 'stageId',
          foreignField: '_id',
          as: 'stage',
        },
      },
      { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            employeeId: {
              $convert: {
                input: '$assignedTo',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            stageId: '$stage._id',
            stageName: { $ifNull: ['$stage.name', 'Unknown'] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.stageName': 1 } },
    ]);

    const leadAssignmentByEmployee = new Map<string, number>();
    leadAssignments.forEach((item) => {
      const employeeId = item._id?.toString();
      if (!employeeId) return;
      leadAssignmentByEmployee.set(employeeId, item.totalAssigned || 0);
    });

    const newLeadsByEmployee = new Map<string, number>();

    newLeads.forEach((item) => {
      if (!item._id) return;
      newLeadsByEmployee.set(
        item._id.toString(),
        item.count || 0,
      );
    });

    const callStatsByEmployee = new Map<string, any>();

    callStats.forEach((item) => {
      if (!item._id) return;

      callStatsByEmployee.set(item._id.toString(), {
        totalDial: item.totalDial || 0,
        uniqDial: item.uniqDial || 0,
        answeredCall: item.answeredCall || 0,
        answeredTalkTime: item.answeredTalkTime || 0,
      });
    });


    const stageCountsByEmployee = new Map<
      string,
      Array<{
        stageId: string;
        stageName: string;
        count: number;
      }>
    >();
    stageUpdates.forEach((item) => {
      const employeeId =
        item._id.employeeId?.toString();

      if (!employeeId) return;

      if (!stageCountsByEmployee.has(employeeId)) {
        stageCountsByEmployee.set(employeeId, []);
      }

      stageCountsByEmployee.get(employeeId)?.push({
        stageId: item._id.stageId?.toString(),
        stageName: item._id.stageName,
        count: item.count,
      });
    });

    const getStageCount = (
      employeeId: string,
      stageName: string,
    ) => {
      const stages =
        stageCountsByEmployee.get(employeeId) || [];

      const stage = stages.find(
        (s) =>
          s.stageName.toLowerCase() ===
          stageName.toLowerCase(),
      );

      return stage?.count || 0;
    };

    const sumMatchingStageCounts = (
      employeeId: string,
      patterns: RegExp[],
    ) => {
      const stages =
        stageCountsByEmployee.get(employeeId) || [];

      return stages.reduce((total, stage) => {
        return patterns.some((pattern) =>
          pattern.test(stage.stageName),
        )
          ? total + stage.count
          : total;
      }, 0);
    };

    const users = await this.userModel
      .find({ _id: { $in: levelUserIds } })
      .select('name email number employeeId role createdAt')
      .lean();

    const roleIds = Array.from(new Set(users.map((user) => user.role?.toString()).filter(Boolean)));
    const roles = roleIds.length
      ? await this.roleModel.find({ _id: { $in: roleIds.map((id) => new Types.ObjectId(id)) } }).select('name').lean()
      : [];

    const rolesById = new Map(roles.map((role) => [role._id.toString(), role.name]));
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    const calculateVintage = (createdAt?: Date) => {
      if (!createdAt) return null;
      const start = new Date(createdAt);
      const diff = now.getTime() - start.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      return `${days}d`;
    };

    const employees = users.map((user) => {
      const employeeId = user._id.toString();
      const roleName = user?.role ? rolesById.get(user.role.toString()) : null;
      const callStats =
        callStatsByEmployee.get(employeeId) || {
          totalDial: 0,
          uniqDial: 0,
          answeredCall: 0,
          answeredTalkTime: 0,
        };
      const totalLeadAssigned = leadAssignmentByEmployee.get(employeeId) || 0;
      const totalNewLead =
        newLeadsByEmployee.get(employeeId) || 0;
      return {
        employeeId,
        employeeName: user?.name || 'Unknown',
        designation: roleName || null,
        vintage: calculateVintage(user?.createdAt),

        leadAssigned: totalLeadAssigned,
        newLead: totalNewLead,

        totalDial: callStats.totalDial,
        uniqDial: callStats.uniqDial,
        answeredCall: callStats.answeredCall,
        answeredTalkTime: callStats.answeredTalkTime,

        pcatScheduled: sumMatchingStageCounts(
          employeeId,
          [/pcat.*schedul/i],
        ),

        pcatDone: sumMatchingStageCounts(
          employeeId,
          [/pcat.*done/i, /pcat.*complete/i],
        ),

        registrationDone: getStageCount(
          employeeId,
          'Registration Done',
        ),

        admissionDone: getStageCount(
          employeeId,
          'Admission Done',
        ),

        allStages:
          stageCountsByEmployee.get(employeeId) || [],

        employeeEmail: user?.email || null,
        employeeNumber: user?.number || null,
        employeeEmployeeId: user?.employeeId || null,
      };
    }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return {
      startDate,
      endDate,
      employees,
    };
  }

  async employeeStageLeads(query: any) {
    const {
      employeeId,
      stageId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = query;

    if (!employeeId) {
      throw new BadRequestException('employeeId is required');
    }

    if (!stageId) {
      throw new BadRequestException('stageId is required');
    }

    const match: any = {
      assignedTo: employeeId,
      stageId: new Types.ObjectId(stageId),
    };

    if (startDate || endDate) {
      match.assignedDate = {};

      if (startDate) {
        match.assignedDate.$gte = new Date(startDate);
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        match.assignedDate.$lte = end;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      this.leadModel.aggregate([
        {
          $match: match,
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
          $lookup: {
            from: 'users',
            let: {
              assignedToId: {
                $toObjectId: '$assignedTo',
              },
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$_id', '$$assignedToId'],
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
            preserveNullAndEmptyArrays: true,
          },
        },

        {
          $project: {
            _id: 1,
            leadId: 1,
            name: 1,
            phone: 1,
            email: 1,
            source: 1,
            assignedTo: 1,
            stageName: '$stage.name',
            employeeName: '$employee.name',
            assignedDate: 1,
          },
        },

        {
          $sort: {
            createdAt: -1,
          },
        },

        {
          $skip: skip,
        },

        {
          $limit: Number(limit),
        },
      ]),

      this.leadModel.countDocuments(match),
    ]);

    return {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      data,
    };
  }

async sourceCampaignWiseLeadRevenueReport(query: any) {
  const now = new Date();
  let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
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
      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (filter === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
  }

  // Specific month
  if (query.month) {
    const [year, month] = query.month.split('-').map(Number);

    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0, 23, 59, 59, 999);
  }

  // From Date
  if (query.fromDate) {
    const from = new Date(query.fromDate);

    if (!Number.isNaN(from.getTime())) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
    }
  }

  // To Date
  if (query.toDate) {
    const to = new Date(query.toDate);

    if (!Number.isNaN(to.getTime())) {
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    }
  }

  // -----------------------------
  // STEP 1 : FETCH ORDERS FIRST
  // -----------------------------
  const orderMatch: any = {
    orderDate: {
      $gte: startDate,
      $lte: endDate,
    },
  };

  // Optional
  orderMatch.Approved = true;

  const orders = await this.orderModel.find(orderMatch).lean();
  
  if (!orders.length) {
    return {
      startDate,
      endDate,
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

  // -----------------------------
  // STEP 2 : FETCH LEADS
  // -----------------------------
  const mobiles = [...new Set(orders.map((o: any) => o.mobile))];

  const leadMatch: any = {
    phone: {
      $in: mobiles,
    },
  };

  if (query.source) {
    leadMatch.source = query.source.toLowerCase();
  }

  if (query.state) {
    leadMatch.state = query.state;
  }

  if (query.stageId) {
    leadMatch.stageId = new Types.ObjectId(query.stageId);
  }

  const leads = await this.leadModel
    .find(leadMatch)
    .populate('stageId', 'name order')
    .lean();

  const filteredLeads = query.stage
    ? leads.filter((lead: any) =>
        String(lead?.stageId?.name || '')
          .toLowerCase()
          .includes(String(query.stage).toLowerCase()),
      )
    : leads;

  if (!filteredLeads.length) {
    return {
      startDate,
      endDate,
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
        totalOrders: orders.length,
      },
    };
  }

  // -----------------------------
  // STEP 3 : MAP LEADS
  // -----------------------------
  const leadByPhone = new Map<string, any>();

  filteredLeads.forEach((lead: any) => {
    leadByPhone.set(lead.phone, lead);
  });

  // -----------------------------
  // STEP 4 : GROUP DATA
  // -----------------------------
  const groupedData = new Map<string, any>();

  orders.forEach((order: any) => {
    const lead = leadByPhone.get(order.mobile);

    if (!lead) return;

    const source = lead.source || 'Unknown';
    const campaignName = lead.source_campaign || 'Unknown';

    if (!groupedData.has(source)) {
      groupedData.set(source, {
        source,
        campaigns: new Map(),
      });
    }

    const sourceGroup = groupedData.get(source);

    if (!sourceGroup.campaigns.has(campaignName)) {
      sourceGroup.campaigns.set(campaignName, {
        campaignName,
        revenue: 0,
        leadIds: new Set<string>(),
      });
    }

    const campaign = sourceGroup.campaigns.get(campaignName);

    campaign.revenue +=
      Number(order.countedRevenue || 0);

    campaign.leadIds.add(String(lead._id));
  });

  // -----------------------------
  // RESPONSE
  // -----------------------------
  const allCampaigns = new Set<string>();
  const sourceNames: string[] = [];

  groupedData.forEach((data) => {
    sourceNames.push(data.source);

    data.campaigns.forEach((campaign: any) => {
      allCampaigns.add(campaign.campaignName);
    });
  });

  const campaigns = Array.from(allCampaigns).sort();

  const response: any = {
    startDate,
    endDate,
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
      totalOrders: orders.length,
    },
  };

  sourceNames.sort().forEach((source) => {
    const sourceData = groupedData.get(source);

    const row: any = {
      source,
    };

    campaigns.forEach((campaignName) => {
      const campaign = sourceData.campaigns.get(campaignName);

      if (campaign) {
        const leadCount = campaign.leadIds.size;

        row[`${campaignName}_lead`] = leadCount;
        row[`${campaignName}_revenue`] = campaign.revenue;

        if (!response.totals.byCampaign[campaignName]) {
          response.totals.byCampaign[campaignName] = {
            totalLead: 0,
            revenue: 0,
          };
        }

        response.totals.byCampaign[campaignName].totalLead += leadCount;
        response.totals.byCampaign[campaignName].revenue += campaign.revenue;

        response.totals.total.totalLead += leadCount;
        response.totals.total.revenue += campaign.revenue;
        response.stats.totalRevenue += campaign.revenue;
        response.stats.totalLead += leadCount;
      } else {
        row[`${campaignName}_lead`] = 0;
        row[`${campaignName}_revenue`] = 0;
      }
    });

    row.totalLead = campaigns.reduce(
      (sum, c) => sum + (row[`${c}_lead`] || 0),
      0,
    );

    row.totalRevenue = campaigns.reduce(
      (sum, c) => sum + (row[`${c}_revenue`] || 0),
      0,
    );

    response.data.push(row);
  });

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

  // ---------------------------------------------------------
  // DATE FILTER
  // ---------------------------------------------------------

  if (query.dateFilter) {
    const filter = query.dateFilter.toString().toLowerCase();

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

  // ---------------------------------------------------------
  // LEVEL
  // ---------------------------------------------------------

  const levelNumber = this.resolveLevel(query.level);

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
    await this.getUserIdsByRoleLevel(levelNumber);

  if (!levelUserIds.length) {
    return {
      startDate,
      endDate,
      months: [],
      pools: [],
      employees: [],
    };
  }

  // ---------------------------------------------------------
  // COUNSELLOR / TEAM FILTER
  // ---------------------------------------------------------

  const selectedCounsellorId = query.counsellorId
    ? String(query.counsellorId)
    : null;

  const teamFilter =
    String(query.teamFilter).toLowerCase() === 'true';

  let rootUsers = await this.userModel
    .find({
      _id: { $in: levelUserIds },
    })
    .select(
      'name email number employeeId role createdAt',
    )
    .lean();

  // ---------------------------------------------------------
  // SELECTED COUNSELLOR
  // ---------------------------------------------------------

  if (selectedCounsellorId) {
    const selectedCounsellor =
      await this.userModel
        .findById(selectedCounsellorId)
        .populate('role', 'level')
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

    rootUsers = [selectedCounsellor];
  }

  // ---------------------------------------------------------
  // BUILD ALLOWED USERS
  // ---------------------------------------------------------

  const rootUsersById = new Map<string, any>();
  const ownerByUserId = new Map<string, string>();
  const allAllowedUserIds = new Set<string>();

  for (const rootUser of rootUsers) {
    const rootId =
      rootUser._id.toString();

    rootUsersById.set(
      rootId,
      rootUser,
    );

    // -------------------------------------------------------
    // COUNSELLOR FILTER + teamFilter=false
    // ONLY selected counsellor
    // -------------------------------------------------------

    if (
      selectedCounsellorId &&
      !teamFilter
    ) {
      allAllowedUserIds.add(rootId);
      ownerByUserId.set(
        rootId,
        rootId,
      );

      continue;
    }

    // -------------------------------------------------------
    // teamFilter=true
    // Include counsellor + complete subordinate tree
    // -------------------------------------------------------

    const subtreeIds =
      await this.getUserAndSubordinateIds(
        rootId,
      );

    subtreeIds.forEach((id) => {
      allAllowedUserIds.add(id);

      ownerByUserId.set(
        id,
        rootId,
      );
    });
  }

  // ---------------------------------------------------------
  // NO USERS
  // ---------------------------------------------------------

  if (!allAllowedUserIds.size) {
    return {
      startDate,
      endDate,
      months: [],
      pools: [],
      employees: rootUsers.map((user) => ({
        employeeId:
          user._id.toString(),

        employeeName:
          user.name || 'Unknown',

        employeeEmail:
          user.email || null,

        employeeNumber:
          user.number || null,

        employeeEmployeeId:
          user.employeeId || null,

        pools: [],
      })),
    };
  }

  const allowedUserIdStrings =
    Array.from(allAllowedUserIds);

  const poolObjectId =
    query.poolId
      ? new Types.ObjectId(
          query.poolId,
        )
      : null;

  // ---------------------------------------------------------
  // REVENUE AGGREGATION
  // ---------------------------------------------------------

  const revenueRows =
    await this.orderModel.aggregate([
      {
        $addFields: {
          // -------------------------------------------------
          // NORMALIZED POOL
          // -------------------------------------------------

          normalizedPoolId: {
            $convert: {
              input: '$courseVertical',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },

          // -------------------------------------------------
          // NORMALIZED EMPLOYEE
          // -------------------------------------------------

          normalizedEmployeeId: {
            $convert: {
              input: '$counsellorId',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },

          // -------------------------------------------------
          // MONTH
          // -------------------------------------------------

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

          // -------------------------------------------------
          // CALCULATED REVENUE
          // -------------------------------------------------

          calculatedRevenue: {
            $switch: {
              branches: [
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
                // SUBSCRIPTION
                // -------------------------------------------

                // TODO:
                // Subscription revenue calculation
                // will be added later.
              ],

              // Do NOT use finalFee.
              // Subscription currently returns 0.
              default: 0,
            },
          },
        },
      },

      // -------------------------------------------------------
      // MATCH
      // -------------------------------------------------------

      {
        $match: {
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

      // -------------------------------------------------------
      // GROUP
      // -------------------------------------------------------

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

          // Monthly revenue
          revenue: {
            $sum:
              '$calculatedRevenue',
          },

          // ---------------------------------------------------
          // INDIVIDUAL ORDERS
          // ---------------------------------------------------

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

              // This is the actual revenue
              // counted in this report.
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

      // -------------------------------------------------------
      // POOL LOOKUP
      // -------------------------------------------------------

      {
        $lookup: {
          from: 'pools',

          localField:
            '_id.poolId',

          foreignField:
            '_id',

          as: 'pool',
        },
      },

      {
        $unwind: {
          path: '$pool',

          preserveNullAndEmptyArrays:
            true,
        },
      },

      // -------------------------------------------------------
      // PROJECT
      // -------------------------------------------------------

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

      // -------------------------------------------------------
      // SORT
      // -------------------------------------------------------

      {
        $sort: {
          employeeId: 1,
          poolName: 1,
          month: 1,
        },
      },
    ]);

  // ---------------------------------------------------------
  // MONTH ORDER
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // EMPLOYEE MAP
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // BUILD REVENUE + ORDERS DATA
  // ---------------------------------------------------------

  revenueRows.forEach((row) => {
    const employeeId =
      String(
        row.employeeId || '',
      );

    if (!employeeId) {
      return;
    }

    // -------------------------------------------------------
    // If teamFilter=true, subordinate revenue/order
    // belongs to the root counsellor.
    // -------------------------------------------------------

    const rootId =
      ownerByUserId.get(
        employeeId,
      ) || employeeId;

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

        // All orders belonging
        // to this employee + pool
        orders: [],
      };

    // -------------------------------------------------------
    // MONTHLY REVENUE
    // -------------------------------------------------------

    poolEntry.revenueByMonth[
      row.month
    ] =
      (
        poolEntry.revenueByMonth[
          row.month
        ] || 0
      ) + row.revenue;

    // -------------------------------------------------------
    // ADD ORDERS
    // -------------------------------------------------------

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

  // ---------------------------------------------------------
  // POOLS
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // FINAL EMPLOYEE RESPONSE
  // ---------------------------------------------------------

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

        // ---------------------------------------------------
        // EVERY EMPLOYEE GETS EVERY POOL
        // Missing revenue = 0
        // Missing orders = []
        // ---------------------------------------------------

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

              // ---------------------------------------------
              // MONTHLY REVENUE
              // ---------------------------------------------

              revenueByMonth:
                months.map(
                  (month) => ({
                    month,

                    revenue:
                      existingPool
                        ?.revenueByMonth
                        ?.[
                          month
                        ] || 0,
                  }),
                ),

              // ---------------------------------------------
              // ORDERS
              // ---------------------------------------------

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

  // ---------------------------------------------------------
  // FINAL RESPONSE
  // ---------------------------------------------------------

  return {
    startDate,
    endDate,
    months,
    pools,
    employees,
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
