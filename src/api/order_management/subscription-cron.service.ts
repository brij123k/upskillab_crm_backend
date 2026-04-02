import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { Model } from 'mongoose';

@Injectable()
export class SubscriptionCronService {
  constructor(
    @InjectModel(Subscription.name)
    private model: Model<Subscription>,
  ) {}

  @Cron('0 9 * * *')
  async sendReminders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const subs = await this.model.find({ status: 'Active' });

    for (const sub of subs) {
      for (const inst of sub.installments) {
        if (
          !inst.isPaid &&
          !inst.reminderSent &&
          this.isSameDay(inst.dueDate, today)
        ) {
          console.log(
            `📢 Installment Reminder: ${sub.studentName} - Installment ${inst.installmentNo}`,
          );

          inst.reminderSent = true;
        }
      }

      await sub.save();
    }
  }

  private isSameDay(d1: Date, d2: Date) {
    return d1.toDateString() === d2.toDateString();
  }
}