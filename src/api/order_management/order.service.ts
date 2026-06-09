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

      let finalFee = dto.totalFee - (dto.discount || 0);
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
        referenceId: order._id.toString(),
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

  async update(id: string, dto: any, userId: string) {
    const existing = await this.orderModel.findById(id);
    if (!existing) throw new BadRequestException('Order not found');
    if (existing.Approved) throw new BadRequestException('Cannot update approved order');
    await this.userActivityLogic.log({
      userId: userId,
      action: 'Order Updated',
      referenceType: 'ORDER',
      referenceId: existing._id.toString(),
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
      referenceId: id.toString(),
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

    const levelNumber = this.resolveLevel(query.level);
    if (levelNumber === null) {
      return [];
    }

    const levelUserIds = await this.getUserIdsByRoleLevel(levelNumber);
    if (!levelUserIds.length) {
      return [];
    }

    const selectedCounsellorId = filterCounsellorId ? filterCounsellorId.toString() : null;
    let rootUsers = await this.userModel
      .find({ _id: { $in: levelUserIds } })
      .select('name email employeeId role createdAt')
      .lean();

    if (selectedCounsellorId) {
      const selectedCounsellor = await this.userModel
        .findById(selectedCounsellorId)
        .populate('role', 'level')
        .select('name email employeeId role createdAt')
        .lean();

      if (!selectedCounsellor || Number((selectedCounsellor as any)?.role?.level) !== levelNumber) {
        return [];
      }

      rootUsers = [selectedCounsellor];
    }

    const rootUsersById = new Map<string, any>();
    const ownerByUserId = new Map<string, string>();
    const allowedUserIds = new Set<string>();

    for (const rootUser of rootUsers) {
      const rootId = rootUser._id.toString();
      rootUsersById.set(rootId, rootUser);

      const subtreeIds = await this.getUserAndSubordinateIds(rootId);
      subtreeIds.forEach((id) => {
        allowedUserIds.add(id);
        ownerByUserId.set(id, rootId);
      });
    }

    const allowedUserIdStrings = Array.from(allowedUserIds);
    if (!allowedUserIdStrings.length) {
      return [];
    }

    const leadStats = await this.leadModel.aggregate([
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
          createdAt: { $gte: startDate, $lte: endDate },
          normalizedAssignedTo: { $in: allowedUserIdStrings },
        },
      },
      {
        $group: {
          _id: '$normalizedAssignedTo',
          totalLeadAssigned: { $sum: 1 },
        },
      },
    ]);

    const orderStats = await this.orderModel.aggregate([
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
        },
      },
      {
        $match: {
          orderDate: { $gte: startDate, $lte: endDate },
          normalizedCounsellorId: { $in: allowedUserIdStrings },
        },
      },
      { $sort: { feeDepositDate: -1, updatedAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$normalizedCounsellorId',
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
    const lastMonthStats = await this.orderModel.aggregate([
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
        },
      },
      {
        $match: {
          feeDepositDate: { $gte: monthStart, $lte: monthEnd },
          normalizedCounsellorId: { $in: allowedUserIdStrings },
        },
      },
      {
        $group: {
          _id: '$normalizedCounsellorId',
          tillDateRealisedInLastMonth: {
            $sum: { $ifNull: ['$lumpsumDetails.totalReceived', 0] },
          },
        },
      },
    ]);

    const statsByConsultant = new Map<string, any>();

    const ensureStats = (id: string) => {
      if (!statsByConsultant.has(id)) {
        statsByConsultant.set(id, {
          consultantId: id,
          totalLeadAssigned: 0,
          registrationDone: 0,
          admDone: 0,
          bookedRevenue: 0,
          unrealisedRevenue: 0,
          realisedRevenue: 0,
          lastSalePunchDate: null,
          lastRevenuePunched: 0,
          tillDateRealisedInLastMonth: 0,
        });
      }
      return statsByConsultant.get(id);
    };

    leadStats.forEach((item) => {
      if (!item._id) return;
      const userId = item._id.toString();
      const rootId = ownerByUserId.get(userId) || userId;
      const current = ensureStats(rootId);
      current.totalLeadAssigned += item.totalLeadAssigned || 0;
    });

    orderStats.forEach((item) => {
      if (!item._id) return;
      const userId = item._id.toString();
      const rootId = ownerByUserId.get(userId) || userId;
      const current = ensureStats(rootId);
      current.registrationDone += item.registrationDone || 0;
      current.admDone += item.admDone || 0;
      current.bookedRevenue += item.bookedRevenue || 0;
      current.realisedRevenue += item.realisedRevenue || 0;
      current.unrealisedRevenue += item.unrealisedRevenue || 0;

      if (!current.lastSalePunchDate || new Date(item.lastSalePunchDate) > new Date(current.lastSalePunchDate)) {
        current.lastSalePunchDate = item.lastSalePunchDate;
        current.lastRevenuePunched = item.lastRevenuePunched || 0;
      }
    });

    lastMonthStats.forEach((item) => {
      if (!item._id) return;
      const userId = item._id.toString();
      const rootId = ownerByUserId.get(userId) || userId;
      const current = ensureStats(rootId);
      current.tillDateRealisedInLastMonth += item.tillDateRealisedInLastMonth || 0;
    });

    const report = rootUsers.map((user) => {
      const item = ensureStats(user._id.toString());
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
        consultantId: user._id.toString(),
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
        tillDateRealisedInLastMonth: item.tillDateRealisedInLastMonth || 0,
        lastSalePunchDate,
        lastRevenuePunched: item.lastRevenuePunched,
        numberOfDaysOnZero,
      };
    }).sort((a, b) => a.consultantName.localeCompare(b.consultantName));

    return report;
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


    const stageCountsByEmployee = new Map<string, Map<string, number>>();
    stageUpdates.forEach((item) => {
      const employeeId = item._id.employeeId?.toString();
      const stageName = item._id.stageName?.toString() || 'Unknown';
      if (!employeeId) return;

      if (!stageCountsByEmployee.has(employeeId)) {
        stageCountsByEmployee.set(employeeId, new Map<string, number>());
      }
      const existing = stageCountsByEmployee.get(employeeId)?.get(stageName.toLowerCase()) || 0;
      stageCountsByEmployee.get(employeeId)?.set(stageName.toLowerCase(), existing + item.count);
    });

    const getStageCount = (employeeId: string, stageName: string) => {
      return stageCountsByEmployee.get(employeeId)?.get(stageName.toLowerCase()) || 0;
    };

    const sumMatchingStageCounts = (employeeId: string, patterns: RegExp[]) => {
      const stages = stageCountsByEmployee.get(employeeId);
      if (!stages) return 0;


      return Array.from(stages.entries()).reduce((total, [stageName, count]) => {
        return patterns.some((pattern) => pattern.test(stageName))
          ? total + count
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

        allStages: Object.fromEntries(
          stageCountsByEmployee.get(employeeId) || new Map(),
        ),

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

    const levelNumber = this.resolveLevel(query.level);
    if (levelNumber === null) {
      return {
        startDate,
        endDate,
        data: [],
        summary: {},
      };
    }

    const levelUserIds = await this.getUserIdsByRoleLevel(levelNumber);
    if (!levelUserIds.length) {
      return {
        startDate,
        endDate,
        data: [],
        summary: {},
      };
    }

    const levelObjectIds = levelUserIds.map((id) => id.toString());

    const leadMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
      assignedTo: { $in: levelObjectIds },
      // status: 'active', 
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

    // Fetch leads
    const leads = await this.leadModel
      .find(leadMatch)
      .populate('stageId', 'name order')
      .lean();

    const filteredLeads = query.stage
      ? leads.filter((lead: any) =>
        String(lead?.stageId?.name || '').toLowerCase().includes(String(query.stage).toLowerCase()),
      )
      : leads;
    if (!filteredLeads.length) {
      return {
        startDate,
        endDate,
        data: [],
        summary: {},
      };
    }

    // Fetch orders for these leads (need to match by student somehow - using email/phone)
    const leadPhones = filteredLeads.map((l) => l.phone);
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

    // Group by source and source campaign
    const groupedData = new Map<string, any>();

    filteredLeads.forEach((lead: any) => {
      const source = lead.source || 'Unknown';
      const campaignName = lead.source_campaign || 'Unknown';
      const key = `${source}`;

      if (!groupedData.has(key)) {
        groupedData.set(key, {
          source,
          campaigns: new Map(),
        });
      }

      if (!groupedData.get(key).campaigns.has(campaignName)) {
        groupedData.get(key).campaigns.set(campaignName, {
          campaignName,
          totalLead: 0,
          revenue: 0,
        });
      }

      const campaign = groupedData.get(key).campaigns.get(campaignName);
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
        total: { totalLead: 0, revenue: 0 },
        byCampaign: {},
      },
      stats: {
        totalLead: filteredLeads.length,
        totalRevenue: 0,
        totalOrders: orders.length,
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
          response.stats.totalRevenue += campaignData.revenue;
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
      return leadOrders.reduce((sum, order) => sum + (order.countedRevenue || order.finalFee || 0), 0);
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
      totalRevenue: orders.reduce((sum, order) => sum + (order.countedRevenue || order.finalFee || 0), 0),
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

    const levelUserIds = await this.getUserIdsByRoleLevel(levelNumber);
    if (!levelUserIds.length) {
      return {
        startDate,
        endDate,
        months: [],
        pools: [],
        employees: [],
      };
    }
    const selectedCounsellorId = query.counsellorId ? String(query.counsellorId) : null;
    let rootUsers = await this.userModel
      .find({ _id: { $in: levelUserIds } })
      .select('name email number employeeId role createdAt')
      .lean();

    if (selectedCounsellorId) {
      const selectedCounsellor = await this.userModel
        .findById(selectedCounsellorId)
        .populate('role', 'level')
        .select('name email number employeeId role createdAt')
        .lean();

      if (!selectedCounsellor || Number((selectedCounsellor as any)?.role?.level) !== levelNumber) {
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

    const rootUsersById = new Map<string, any>();
    const ownerByUserId = new Map<string, string>();
    const allAllowedUserIds = new Set<string>();

    for (const rootUser of rootUsers) {
      const rootId = rootUser._id.toString();
      rootUsersById.set(rootId, rootUser);

      const subtreeIds = await this.getUserAndSubordinateIds(rootId);
      subtreeIds.forEach((id) => {
        allAllowedUserIds.add(id);
        ownerByUserId.set(id, rootId);
      });
    }

    if (!allAllowedUserIds.size) {
      return {
        startDate,
        endDate,
        months: [],
        pools: [],
        employees: rootUsers.map((user) => ({
          employeeId: user._id.toString(),
          employeeName: user.name || 'Unknown',
          employeeEmail: user.email || null,
          employeeNumber: user.number || null,
          employeeEmployeeId: user.employeeId || null,
          pools: [],
        })),
      };
    }

    const allowedUserIdStrings = Array.from(allAllowedUserIds);
    const poolObjectId = query.poolId ? new Types.ObjectId(query.poolId) : null;

    const revenueRows = await this.orderModel.aggregate([
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
        $match: {
          orderDate: { $gte: startDate, $lte: endDate },
          normalizedPoolId: { $ne: null },
          normalizedEmployeeId: { $in: allowedUserIdStrings },
          ...(poolObjectId ? { normalizedPoolId: poolObjectId } : {}),
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
          month: '$_id.month',
          revenue: 1,
        },
      },
      { $sort: { employeeId: 1, poolName: 1, month: 1 } },
    ]);

    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = Array.from(new Set(revenueRows.map((row) => row.month))).sort((a, b) => {
      const [ma, ya] = String(a).split("'");
      const [mb, yb] = String(b).split("'");
      const valueA = Number(`20${ya}`) * 100 + monthOrder.indexOf(ma);
      const valueB = Number(`20${yb}`) * 100 + monthOrder.indexOf(mb);
      return valueA - valueB;
    });

    const employeeMap = new Map<string, any>();
    for (const rootUser of rootUsers) {
      const rootId = rootUser._id.toString();
      employeeMap.set(rootId, {
        employeeId: rootId,
        employeeName: rootUser.name || 'Unknown',
        employeeEmail: rootUser.email || null,
        employeeNumber: rootUser.number || null,
        employeeEmployeeId: rootUser.employeeId || null,
        poolData: new Map<string, any>(),
      });
    }

    revenueRows.forEach((row) => {
      const employeeId = String(row.employeeId || '');
      if (!employeeId) return;

      const rootId = ownerByUserId.get(employeeId) || employeeId;
      const sourceUser = rootUsersById.get(rootId);
      const existing = employeeMap.get(rootId) || {
        employeeId: rootId,
        employeeName: sourceUser?.name || 'Unknown',
        employeeEmail: sourceUser?.email || null,
        employeeNumber: sourceUser?.number || null,
        employeeEmployeeId: sourceUser?.employeeId || null,
        poolData: new Map<string, any>(),
      };

      const poolId = row.poolId?.toString() || 'unknown';
      const poolEntry = existing.poolData.get(poolId) || {
        poolId,
        poolName: row.poolName || 'Unknown',
        revenueByMonth: {},
      };
      poolEntry.revenueByMonth[row.month] = (poolEntry.revenueByMonth[row.month] || 0) + row.revenue;
      existing.poolData.set(poolId, poolEntry);
      employeeMap.set(rootId, existing);
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
    })).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    const pools = Array.from(new Map(
      revenueRows
        .map((row) => [row.poolId?.toString(), row.poolName || 'Unknown'] as const)
        .filter(([poolId]) => Boolean(poolId)),
    ).entries()).map(([poolId, poolName]) => ({
      poolId,
      poolName,
    }));

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
}
