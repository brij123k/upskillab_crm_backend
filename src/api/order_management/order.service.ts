import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderStatus, PaymentMode } from 'src/schema/order_Management/order.schema';
import { CreateOrderDto, UpdateOrderDto } from 'src/dto/order_management/create-order.dto';
import { Pool } from 'src/schema/Pool.schema';
import { LoanEmi } from 'src/schema/order_Management/loan-emi.schema';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Pool.name) private poolModel: Model<Pool>,
    @InjectModel(LoanEmi.name) private emiModel: Model<LoanEmi>,
  ) { }

  async createOrder(dto: CreateOrderDto) {
    try {
      const pool = await this.poolModel.findById(dto.courseVertical);
      if (!pool) throw new BadRequestException('Invalid pool');

      const finalFee = dto.totalFee - (dto.discount || 0);
      let pendingAmount = finalFee;
      let status = OrderStatus.PARTIALLY_PAID;

      // Payment Mode Logic
      if (dto.paymentMode === PaymentMode.LOAN) {
        const firstDate = new Date(dto.loanDetails.firstEmiDate);

        const secondDate = new Date(firstDate);
        secondDate.setMonth(secondDate.getMonth() + 1);

        const thirdDate = new Date(firstDate);
        thirdDate.setMonth(thirdDate.getMonth() + 2);

        const res =await this.emiModel.create({
          learnerName: dto.studentName,
          mobile: dto.mobile,
          counselorName: dto.counsellorName,
          loanAmount: dto.loanDetails.loanAmount,
          disbursementAmount: dto.loanDetails.disbursementAmount,
          loanDate: dto.loanDetails.loanDate,
          firstEmiDate: firstDate,
          secondEmiDate: secondDate,
          thirdEmiDate: thirdDate,
        });
        return await this.orderModel.create({
        ...dto,
        loanDetails: {
            ...dto.loanDetails,
            pendingAmount,
            loanId: res._id,
          },
        countedRevenue: pool.revenue_percentage,
        finalFee,
        status,
      });
      }

      if (dto.paymentMode === PaymentMode.LUMPSUM) {
        if (dto.lumpsumDetails?.totalReceived >= finalFee) {
          status = OrderStatus.FULLY_PAID;
          pendingAmount = 0;
        } else {
          status = OrderStatus.PARTIALLY_PAID;
          pendingAmount = finalFee - (dto.lumpsumDetails?.totalReceived || 0);
        }
        return await this.orderModel.create({
          ...dto,
          lumpsumDetails: {
            ...dto.lumpsumDetails,
            pendingAmount,
          },
          countedRevenue: pool.revenue_percentage,
          finalFee,
          status,
        });
      }


      return await this.orderModel.create({
        ...dto,
        countedRevenue: pool.revenue_percentage,
        finalFee,
        status,
      });
    } catch (error) {
      // ✅ Handle duplicate key error
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern || {})[0];
        throw new BadRequestException(
          `${field} already exists. Please use a different value.`,
        );
      }

      throw error;
    }
  }

  async findAll() {
    return this.orderModel
      .find()
      .populate('courseVertical', 'name revenue_percentage')
      .populate('counsellorId', 'name email')
      .populate('approvedBy', 'name email')
      .populate('loanDetails.loanPartner', 'name type submissionCharge')
      .populate('loanDetails.loanId');
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

  async update(id: string, dto: any) {
    return this.orderModel.findByIdAndUpdate(id, dto, { new: true });
  }

  async approveOrder(id: string, approvedBy: string) {
    return this.orderModel.findByIdAndUpdate(
      id,
      { Approved: true, approvedBy },
      { new: true },
    );
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
}