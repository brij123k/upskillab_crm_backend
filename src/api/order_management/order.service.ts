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

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Pool.name) private poolModel: Model<Pool>,
    @InjectModel(LoanEmi.name) private emiModel: Model<LoanEmi>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<Subscription>,
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
  } catch (error) {
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