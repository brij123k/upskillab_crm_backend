import {
  BadRequestException,
  Injectable,
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
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { CallLog } from 'src/schema/call-log.schema';
import { Role } from 'src/schema/role.schema';
import { User } from 'src/schema/user.schema';

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

async createOrder(dto: CreateOrderDto, userId: string) {
  try {
    const user = await this.userLogic.findById(userId);
    if (!user) throw new BadRequestException('Invalid counsellorId');
    const pool = await this.poolModel.findById(dto.courseVertical);
    if (!pool) throw new BadRequestException('Invalid pool');

    let finalFee = dto.totalFee - (dto.discount || 0);
    let status = OrderStatus.PARTIALLY_PAID;
    let countedRevenue = Number(pool.revenue_percentage)*finalFee/100;
    // 🔥 STEP 1: CREATE ORDER FIRST
    if(dto.GSTEnabled){
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
        referenceId: order._id.toString(),
        meta: {
          message:dto.remarks,
          PaymentMode: dto.paymentMode,
          order},
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
  if (allPaid) sub.status = 'Completed';

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
    const users = await this.userLogic.getUsersUnder(user.userId);
    accessibleUserIds = users.map((u) => u._id.toString());
    accessibleUserIds.push(user.userId);

    query.counsellorId = { $in: accessibleUserIds };
  }else if (user.roleName === 'bd') {
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
    let start: Date | null = null;

    if (dateFilter === 'today') {
      start = new Date();
      start.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    } else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    } else if (dateFilter === 'year') {
      start = new Date();
      start.setFullYear(start.getFullYear() - 1);
    }

    if (start) {
      query.createdAt = { $gte: start };
    }
  }

  if (fromDate && toDate) {
    query.createdAt = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
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

  async update(id: string, dto: any,userId: string) {
    const existing = await this.orderModel.findById(id);
    if (!existing) throw new BadRequestException('Order not found');
    if(existing.Approved) throw new BadRequestException('Cannot update approved order');
    await this.userActivityLogic.log({
        userId: userId,
        action: 'Order Updated',
        referenceType: 'ORDER',
        referenceId: existing._id.toString(),
        meta: {
          message:"Order updated",
          order: existing},
      });
    return this.orderModel.findByIdAndUpdate(id, dto, { new: true });
  }

  async approveOrder(id: string, approvedBy: string) {
    const order= await this.orderModel.findByIdAndUpdate(
      id,
      { Approved: true, approvedBy },
      { new: true },
    );
     await this.userActivityLogic.log({
        userId: approvedBy,
        action: 'Order Approved',
        referenceType: 'ORDER',
        referenceId: id.toString(),
        meta: {
          message:"Order approved",
          order: order},
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

    const filterCounsellorId = query.counsellorId
      ? new Types.ObjectId(query.counsellorId)
      : undefined;

    const leadMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (filterCounsellorId) leadMatch.assignedTo = filterCounsellorId;

    const leadStats = await this.leadModel.aggregate([
      { $match: leadMatch },
      {
        $group: {
          _id: '$assignedTo',
          totalLeadAssigned: { $sum: 1 },
        },
      },
    ]);

    const orderMatch: any = {
      orderDate: { $gte: startDate, $lte: endDate },
    };
    if (filterCounsellorId) orderMatch.counsellorId = filterCounsellorId;

    const orderStats = await this.orderModel.aggregate([
      { $match: orderMatch },
      { $sort: { feeDepositDate: -1, updatedAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$counsellorId',
          registrationDone: {
            $sum: {
              $cond: [{ $gt: ['$registrationAmount', 0] }, 1, 0],
            },
          },
          admDone: {
            $sum: {
              $cond: ['$Approved', 1, 0],
            },
          },
          bookedRevenue: { $sum: { $ifNull: ['$finalFee', 0] } },
          realisedRevenue: {
            $sum: { $ifNull: ['$lumpsumDetails.totalReceived', 0] },
          },
          unrealisedRevenue: {
            $sum: { $ifNull: ['$lumpsumDetails.pendingAmount', 0] },
          },
          lastSalePunchDate: { $first: '$feeDepositDate' },
          lastRevenuePunched: {
            $first: { $ifNull: ['$lumpsumDetails.totalReceived', 0] },
          },
          totalOrders: { $sum: 1 },
        },
      },
    ]);

    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const lastMonthMatch: any = {
      feeDepositDate: { $gte: monthStart, $lte: monthEnd },
    };
    if (filterCounsellorId) lastMonthMatch.counsellorId = filterCounsellorId;

    const lastMonthStats = await this.orderModel.aggregate([
      { $match: lastMonthMatch },
      {
        $group: {
          _id: '$counsellorId',
          tillDateRealisedInLastMonth: {
            $sum: { $ifNull: ['$lumpsumDetails.totalReceived', 0] },
          },
        },
      },
    ]);

    const statsByConsultant = new Map<string, any>();

    leadStats.forEach((item) => {
      if (!item._id) return;
      const id = item._id.toString();
      statsByConsultant.set(id, {
        consultantId: id,
        totalLeadAssigned: item.totalLeadAssigned,
        registrationDone: 0,
        admDone: 0,
        bookedRevenue: 0,
        unrealisedRevenue: 0,
        realisedRevenue: 0,
        lastSalePunchDate: null,
        lastRevenuePunched: 0,
        tillDateRealisedInLastMonth: 0,
      });
    });

    orderStats.forEach((item) => {
      if (!item._id) return;
      const id = item._id.toString();
      const existing = statsByConsultant.get(id) || {
        consultantId: id,
        totalLeadAssigned: 0,
      };
      statsByConsultant.set(id, {
        ...existing,
        registrationDone: item.registrationDone,
        admDone: item.admDone,
        bookedRevenue: item.bookedRevenue,
        unrealisedRevenue: item.unrealisedRevenue,
        realisedRevenue: item.realisedRevenue,
        lastSalePunchDate: item.lastSalePunchDate,
        lastRevenuePunched: item.lastRevenuePunched,
        totalLeadAssigned: existing.totalLeadAssigned || 0,
      });
    });

    lastMonthStats.forEach((item) => {
      if (!item._id) return;
      const id = item._id.toString();
      const existing = statsByConsultant.get(id) || {
        consultantId: id,
        totalLeadAssigned: 0,
        registrationDone: 0,
        admDone: 0,
        bookedRevenue: 0,
        unrealisedRevenue: 0,
        realisedRevenue: 0,
        lastSalePunchDate: null,
        lastRevenuePunched: 0,
      };
      statsByConsultant.set(id, {
        ...existing,
        tillDateRealisedInLastMonth: item.tillDateRealisedInLastMonth,
      });
    });

    const consultantIds = Array.from(statsByConsultant.keys()).map(
      (id) => new Types.ObjectId(id),
    );

    const users = consultantIds.length
      ? await this.userModel
          .find({ _id: { $in: consultantIds } })
          .select('name email employeeId')
          .lean()
      : [];

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    const report = Array.from(statsByConsultant.values()).map((item) => {
      const user = usersById.get(item.consultantId);
      const lastSalePunchDate = item.lastSalePunchDate
        ? new Date(item.lastSalePunchDate)
        : null;
      const numberOfDaysOnZero = lastSalePunchDate
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - lastSalePunchDate.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : null;

      const monthlyRevenueTarget = null;
      const achievementPercentage = monthlyRevenueTarget
        ? Number(
            ((item.realisedRevenue / monthlyRevenueTarget) * 100).toFixed(2),
          )
        : null;

      return {
        consultantId: item.consultantId,
        consultantName: user?.name || 'Unknown',
        consultantEmail: user?.email || null,
        employeeId: user?.employeeId || null,
        totalLeadAssigned: item.totalLeadAssigned,
        monthlyRevenueTarget,
        registrationDone: item.registrationDone,
        admDone: item.admDone,
        bookedRevenue: item.bookedRevenue,
        unrealisedRevenue: item.unrealisedRevenue,
        realisedRevenue: item.realisedRevenue,
        achievementPercentage,
        tillDateRealisedInLastMonth:
          item.tillDateRealisedInLastMonth || 0,
        lastSalePunchDate,
        lastRevenuePunched: item.lastRevenuePunched,
        numberOfDaysOnZero,
      };
    });

    return report.sort((a, b) =>
      a.consultantName.localeCompare(b.consultantName),
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
    let pools: any[] = [];
    if(query.poolId=="all")
    pools = await this.poolModel.find().lean();
    const poolIds = pools.map((pool) => pool._id);

    const leadMatch: any = {
      poolId: { $in: poolIds },
      createdAt: { $gte: startDate, $lte: endDate },
      assignedTo: { $ne: null },
    };
    if (query.poolId) {
      leadMatch.poolId = new Types.ObjectId(query.poolId);
    }
    if (query.counsellorId) {
      leadMatch.assignedTo = new Types.ObjectId(query.counsellorId);
    }

    const leadAssignments = await this.leadModel.aggregate([
      { $match: leadMatch },
      {
        $group: {
          _id: {
            poolId: '$poolId',
            employeeId: '$assignedTo',
          },
          totalAssigned: { $sum: 1 },
        },
      },
    ]);

    const orderConversionMatch: any = {
      courseVertical: { $in: poolIds },
      orderDate: { $gte: startDate, $lte: endDate },
    };
    if (query.poolId) {
      orderConversionMatch.courseVertical = new Types.ObjectId(query.poolId);
    }
    if (query.counsellorId) {
      orderConversionMatch.counsellorId = new Types.ObjectId(query.counsellorId);
    }

    const conversions = await this.orderModel.aggregate([
      { $match: orderConversionMatch },
      {
        $group: {
          _id: {
            poolId: '$courseVertical',
            employeeId: '$counsellorId',
          },
          convert: { $sum: 1 },
        },
      },
    ]);

    const pcatScheduledMatch = {
      ...leadMatch,
      pcatScheduledDate: { $exists: true, $ne: null },
    };
    const pcatScheduled = await this.leadModel.aggregate([
      { $match: pcatScheduledMatch },
      {
        $group: {
          _id: '$assignedTo',
          pcatScheduled: { $sum: 1 },
        },
      },
    ]);

    const pcatDoneMatch = {
      ...leadMatch,
      pcatDoneDate: { $exists: true, $ne: null },
    };
    const pcatDone = await this.leadModel.aggregate([
      { $match: pcatDoneMatch },
      {
        $group: {
          _id: '$assignedTo',
          pcatDone: { $sum: 1 },
        },
      },
    ]);

    const callMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
      userId: { $exists: true, $ne: null },
    };
    if (query.counsellorId) {
      callMatch.userId = query.counsellorId;
    }

    const callStats = await this.callLogModel.aggregate([
      { $match: callMatch },
      {
        $group: {
          _id: '$userId',
          totalDial: { $sum: 1 },
          answeredTalkTime: {
            $sum: {
              $cond: [{ $gt: ['$duration', 0] }, '$duration', 0],
            },
          },
        },
      },
    ]);

    const orderMatch: any = {
      orderDate: { $gte: startDate, $lte: endDate },
    };
    if (query.poolId) {
      orderMatch.courseVertical = new Types.ObjectId(query.poolId);
    }
    if (query.counsellorId) {
      orderMatch.counsellorId = new Types.ObjectId(query.counsellorId);
    }

    const orderStats = await this.orderModel.aggregate([
      { $match: orderMatch },
      {
        $group: {
          _id: '$counsellorId',
          registrationDone: {
            $sum: {
              $cond: [{ $gt: ['$registrationAmount', 0] }, 1, 0],
            },
          },
          admissionDone: {
            $sum: {
              $cond: ['$Approved', 1, 0],
            },
          },
        },
      },
    ]);

    const leadAssignmentByEmployee = new Map<string, number>();
    leadAssignments.forEach((item) => {
      const employeeId = item._id.employeeId?.toString();
      if (!employeeId) return;
      const current = leadAssignmentByEmployee.get(employeeId) || 0;
      leadAssignmentByEmployee.set(employeeId, current + item.totalAssigned);
    });

    const pcatScheduledByEmployee = new Map<string, number>();
    pcatScheduled.forEach((item) => {
      if (!item._id) return;
      pcatScheduledByEmployee.set(item._id.toString(), item.pcatScheduled);
    });

    const pcatDoneByEmployee = new Map<string, number>();
    pcatDone.forEach((item) => {
      if (!item._id) return;
      pcatDoneByEmployee.set(item._id.toString(), item.pcatDone);
    });

    const callStatsByEmployee = new Map<string, any>();
    callStats.forEach((item) => {
      if (!item._id) return;
      callStatsByEmployee.set(item._id.toString(), {
        totalDial: item.totalDial,
        answeredTalkTime: item.answeredTalkTime,
      });
    });

    const orderStatsByEmployee = new Map<string, any>();
    orderStats.forEach((item) => {
      if (!item._id) return;
      orderStatsByEmployee.set(item._id.toString(), {
        registrationDone: item.registrationDone,
        admissionDone: item.admissionDone,
      });
    });

    const employeeIds = new Set<string>();
    leadAssignmentByEmployee.forEach((value, key) => employeeIds.add(key));
    pcatScheduledByEmployee.forEach((value, key) => employeeIds.add(key));
    pcatDoneByEmployee.forEach((value, key) => employeeIds.add(key));
    callStatsByEmployee.forEach((value, key) => employeeIds.add(key));
    orderStatsByEmployee.forEach((value, key) => employeeIds.add(key));

    const poolAssignmentMap = new Map<string, number>();
    leadAssignments.forEach((item) => {
      const employeeId = item._id.employeeId?.toString();
      const poolId = item._id.poolId?.toString();
      if (!employeeId || !poolId) return;
      poolAssignmentMap.set(`${employeeId}_${poolId}`, item.totalAssigned);
    });

    const poolConversionMap = new Map<string, number>();
    conversions.forEach((item) => {
      if (!item._id.employeeId || !item._id.poolId) return;
      poolConversionMap.set(
        `${item._id.employeeId.toString()}_${item._id.poolId.toString()}`,
        item.convert,
      );
    });

    const users = employeeIds.size
      ? await this.userModel
          .find({ _id: { $in: Array.from(employeeIds).map((id) => new Types.ObjectId(id)) } })
          .select('name email number employeeId role createdAt')
          .lean()
      : [];

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
      const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      if (years > 0) {
        return remainingMonths > 0 ? `${years}y ${remainingMonths}m` : `${years}y`;
      }
      return `${remainingMonths}m`;
    };

    const employees = Array.from(employeeIds).map((employeeId) => {
      const user = usersById.get(employeeId);
      const roleName = user?.role ? rolesById.get(user.role.toString()) : null;
      const callStats = callStatsByEmployee.get(employeeId) || { totalDial: 0, answeredTalkTime: 0 };
      const orderStats = orderStatsByEmployee.get(employeeId) || { registrationDone: 0, admissionDone: 0 };
      const totalLeadAssigned = leadAssignmentByEmployee.get(employeeId) || 0;

      return {
        employeeId,
        employeeName: user?.name || 'Unknown',
        designation: roleName || null,
        vintage: calculateVintage(user?.createdAt),
        leadAssigned: totalLeadAssigned,
        totalDial: callStats.totalDial || 0,
        answeredTalkTime: callStats.answeredTalkTime || 0,
        pcatScheduled: pcatScheduledByEmployee.get(employeeId) || 0,
        pcatDone: pcatDoneByEmployee.get(employeeId) || 0,
        registrationDone: orderStats.registrationDone || 0,
        admissionDone: orderStats.admissionDone || 0,
        employeeEmail: user?.email || null,
        employeeNumber: user?.number || null,
        employeeEmployeeId: user?.employeeId || null,
        pools: pools.map((pool) => {
          const key = `${employeeId}_${pool._id.toString()}`;
          const totalAssigned = poolAssignmentMap.get(key) || 0;
          const convert = poolConversionMap.get(key) || 0;
          const conversionRate = totalAssigned > 0 ? Number(((convert / totalAssigned) * 100).toFixed(2)) : 0;
          return {
            poolId: pool._id.toString(),
            poolName: pool.name || 'Unknown',
            totalLeadAssigned: totalAssigned,
            convert,
            conversionPercentage: `${conversionRate}%`,
          };
        }),
      };
    });

    return {
      startDate,
      endDate,
      employees,
      pools: pools.map((pool) => ({ poolId: pool._id.toString(), poolName: pool.name || 'Unknown' })),
    };
  }

  async sourceCampaignWiseLeadRevenueReport(query: any) {
    const now = new Date();
    let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Date filter (today/week/month/year)
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

    // Month filter (specific month-year)
    if (query.month) {
      const [year, month] = query.month.split('-').map(Number);
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59, 999);
    }

    // From/To date range
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

    // Get all leads in date range
    const leadMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
      status: 'converted', // Only converted leads
    };

    if (query.source) {
      leadMatch.source = query.source.toLowerCase();
    }
    if (query.campaign) {
      leadMatch.source_campaign = query.campaign;
    }

    // Fetch leads
    const leads = await this.leadModel.find(leadMatch).lean();
    const leadIds = leads.map((l) => l._id);

    if (!leadIds.length) {
      return {
        startDate,
        endDate,
        data: [],
        summary: {},
      };
    }

    // Fetch orders for these leads (need to match by student somehow - using email/phone)
    const leadPhones = leads.map((l) => l.phone);
    const orders = await this.orderModel
      .find({
        mobile: { $in: leadPhones },
        orderDate: { $gte: startDate, $lte: endDate },
      })
      .lean();

    // Create a map of phone -> orders for quick lookup
    const ordersByPhone = new Map<string, any[]>();
    orders.forEach((order) => {
      if (!ordersByPhone.has(order.mobile)) {
        ordersByPhone.set(order.mobile, []);
      }
      const phoneOrders = ordersByPhone.get(order.mobile);
      if (phoneOrders) {
        phoneOrders.push(order);
      }
    });

    // Get pool names
    const poolIds = new Set<string>();
    leads.forEach((lead) => {
      poolIds.add(lead.poolId.toString());
    });

    const pools = await this.poolModel
      .find({ _id: { $in: Array.from(poolIds).map((id) => new Types.ObjectId(id)) } })
      .lean();
    const poolsById = new Map(pools.map((p) => [p._id.toString(), p.name]));

    // Group by source and pool
    const groupedData = new Map<string, any>();

    leads.forEach((lead) => {
      const source = lead.source || 'Unknown';
      const poolId = lead.poolId.toString();
      const poolName = poolsById.get(poolId) || 'Unknown';
      const key = `${source}`;

      if (!groupedData.has(key)) {
        groupedData.set(key, {
          source,
          campaigns: new Map(),
        });
      }

      if (!groupedData.get(key).campaigns.has(poolName)) {
        groupedData.get(key).campaigns.set(poolName, {
          poolName,
          totalLead: 0,
          revenue: 0,
        });
      }

      const campaign = groupedData.get(key).campaigns.get(poolName);
      campaign.totalLead += 1;

      // Add revenue from orders
      const ordersForLead = ordersByPhone.get(lead.phone) || [];
      ordersForLead.forEach((order) => {
        campaign.revenue += order.countedRevenue || order.finalFee || 0;
      });
    });

    // Build response in Excel format
    const allCampaigns = new Set<string>();
    const sourceNames: string[] = [];

    groupedData.forEach((data) => {
      sourceNames.push(data.source);
      data.campaigns.forEach((campaign) => {
        allCampaigns.add(campaign.poolName);
      });
    });

    const campaigns = Array.from(allCampaigns).sort();
    const response: any = {
      startDate,
      endDate,
      campaigns,
      data: [],
      totals: {
        total: { totalLead: 0, revenue: 0 },
        byCampaign: {},
      },
    };

    // Add rows for each source
    sourceNames.sort().forEach((source) => {
      const sourceData = groupedData.get(source);
      const row: any = {
        source,
      };

      campaigns.forEach((campaign) => {
        const campaignData = sourceData.campaigns.get(campaign);
        if (campaignData) {
          row[`${campaign}_lead`] = campaignData.totalLead;
          row[`${campaign}_revenue`] = campaignData.revenue;

          // Update campaign totals
          if (!response.totals.byCampaign[campaign]) {
            response.totals.byCampaign[campaign] = { totalLead: 0, revenue: 0 };
          }
          response.totals.byCampaign[campaign].totalLead += campaignData.totalLead;
          response.totals.byCampaign[campaign].revenue += campaignData.revenue;

          // Update grand total
          response.totals.total.totalLead += campaignData.totalLead;
          response.totals.total.revenue += campaignData.revenue;
        } else {
          row[`${campaign}_lead`] = 0;
          row[`${campaign}_revenue`] = 0;
        }
      });

      // Calculate source totals
      row.totalLead = campaigns.reduce((sum, campaign) => sum + (row[`${campaign}_lead`] || 0), 0);
      row.totalRevenue = campaigns.reduce((sum, campaign) => sum + (row[`${campaign}_revenue`] || 0), 0);

      response.data.push(row);
    });

    return response;
  }

  async employeePoolRevenueReport(query: any) {
    const now = new Date();
    let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    if (query.dateFilter) {
      const filter = query.dateFilter.toString().toLowerCase();
      if (filter === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
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

    const match: any = {
      orderDate: { $gte: startDate, $lte: endDate },
      courseVertical: { $exists: true, $ne: null },
    };
    if (query.poolId) {
      match.courseVertical = new Types.ObjectId(query.poolId);
    }
    if (query.counsellorId) {
      match.counsellorId = new Types.ObjectId(query.counsellorId);
    }

    const revenueRows = await this.orderModel.aggregate([
      { $match: match },
      {
        $addFields: {
          normalizedPoolId: {
            $cond: [
              { $eq: [{ $type: '$courseVertical' }, 'objectId'] },
              '$courseVertical',
              {
                $cond: [
                  { $and: [
                    { $ne: ['$courseVertical', null] },
                    { $ne: ['$courseVertical', ''] },
                  ] },
                  { $toObjectId: '$courseVertical' },
                  null,
                ],
              },
            ],
          },
          normalizedEmployeeId: {
            $cond: [
              { $eq: [{ $type: '$counsellorId' }, 'objectId'] },
              '$counsellorId',
              {
                $cond: [
                  { $and: [
                    { $ne: ['$counsellorId', null] },
                    { $ne: ['$counsellorId', ''] },
                  ] },
                  { $toObjectId: '$counsellorId' },
                  null,
                ],
              },
            ],
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
                  { $toString: { $year: '$orderDate' } },
                  2,
                  2,
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            poolId: '$normalizedPoolId',
            employeeId: '$normalizedEmployeeId',
            month: '$monthLabel',
          },
          revenue: { $sum: { $ifNull: ['$finalFee', 0] } },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.employeeId',
          foreignField: '_id',
          as: 'employee',
        },
      },
      { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'pools',
          localField: '_id.poolId',
          foreignField: '_id',
          as: 'pool',
        },
      },
      { $unwind: { path: '$pool', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          poolId: '$_id.poolId',
          poolName: { $ifNull: ['$pool.name', 'Unknown'] },
          employeeId: '$_id.employeeId',
          employeeName: { $ifNull: ['$employee.name', 'Unknown'] },
          employeeEmail: '$employee.email',
          employeeNumber: '$employee.number',
          employeeEmployeeId: '$employee.employeeId',
          month: '$_id.month',
          revenue: 1,
        },
      },
      { $sort: { employeeName: 1, poolName: 1, month: 1 } },
    ]);

    const months = Array.from(new Set(revenueRows.map((row) => row.month))).sort((a, b) => {
      const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const [ma, ya] = a.split("'");
      const [mb, yb] = b.split("'");
      const valueA = Number(`20${ya}`) * 100 + monthOrder.indexOf(ma);
      const valueB = Number(`20${yb}`) * 100 + monthOrder.indexOf(mb);
      return valueA - valueB;
    });

    const employeeMap = new Map<string, any>();
    revenueRows.forEach((row) => {
      if (!row.employeeId) return;
      const empId = row.employeeId.toString();
      const existing = employeeMap.get(empId) || {
        employeeId: empId,
        employeeName: row.employeeName || 'Unknown',
        employeeEmail: row.employeeEmail || null,
        employeeNumber: row.employeeNumber || null,
        employeeEmployeeId: row.employeeEmployeeId || null,
        poolData: new Map<string, any>(),
      };

      const poolId = row.poolId?.toString() || 'unknown';
      const poolEntry = existing.poolData.get(poolId) || {
        poolId,
        poolName: row.poolName || 'Unknown',
        revenueByMonth: {},
      };
      poolEntry.revenueByMonth[row.month] = row.revenue;
      existing.poolData.set(poolId, poolEntry);
      employeeMap.set(empId, existing);
    });

    const employees = Array.from(employeeMap.values()).map((emp) => ({
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      employeeEmail: emp.employeeEmail,
      employeeNumber: emp.employeeNumber,
      employeeEmployeeId: emp.employeeEmployeeId,
      pools: Array.from(emp.poolData.values()).map((pool: any) => ({
        poolId: pool.poolId,
        poolName: pool.poolName,
        revenueByMonth: months.map((month) => ({
          month,
          revenue: pool.revenueByMonth[month] || 0,
        })),
      })),
    }));

    const pools = Array.from(new Set(revenueRows.map((row) => row.poolId?.toString()))).map((poolId) => {
      const row = revenueRows.find((r) => r.poolId?.toString() === poolId);
      return {
        poolId,
        poolName: row?.poolName || 'Unknown',
      };
    });

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
    const users = await this.userLogic.getUsersUnder(user.userId);

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

async updateInstallments(dto: any, user: any,id: string) {
  const existing = await this.emiModel.findById(id);
  if (!existing) throw new BadRequestException('Loan not found');
  if(existing.couselorId.toString() !== user.userId && user.roleName !== 'admin'){
    throw new BadRequestException('Not authorized to update this loan');
  }
  if(dto.firstEmi){
    existing.firstEmi = true;
  }else if(dto.secondEmi){
    existing.secondEmi = true;
  }else if(dto.thirdEmi){
    existing.thirdEmi = true;
  }
  await existing.save();
  return existing;
}

 async sendReminder(id: string, body: any) {
  const { reminderText, reminderNumber } = body;
  const existing = await this.emiModel.findById(id);
  if (!existing) throw new Error('Loan not found');

  if (existing.status === 'Completed') {
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
}