import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { LoanEmi } from 'src/schema/order_Management/loan-emi.schema';
import { Model } from 'mongoose';

@Injectable()
export class EmiCronService {
  constructor(
    @InjectModel(LoanEmi.name)
    private emiModel: Model<LoanEmi>,
  ) {}

  @Cron('0 9 * * *') // daily 9 AM
  async sendReminders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const emis = await this.emiModel.find({ status: 'Pending' });

    for (const emi of emis) {
      // 🔥 FIRST EMI
      if (
        !emi.firstReminderSent &&
        this.isSameDay(emi.firstEmiDate, today)
      ) {
        console.log(`📢 1st EMI Reminder: ${emi.learnerName}`);
        emi.firstReminderSent = true;
      }

      // 🔥 SECOND EMI
      if (
        !emi.secondReminderSent &&
        this.isSameDay(emi.secondEmiDate, today)
      ) {
        console.log(`📢 2nd EMI Reminder: ${emi.learnerName}`);
        emi.secondReminderSent = true;
      }

      // 🔥 THIRD EMI
      if (
        !emi.thirdReminderSent &&
        this.isSameDay(emi.thirdEmiDate, today)
      ) {
        console.log(`📢 3rd EMI Reminder: ${emi.learnerName}`);
        emi.thirdReminderSent = true;
      }

      // 🔥 Mark complete after 3rd EMI
      if (
        emi.firstReminderSent &&
        emi.secondReminderSent &&
        emi.thirdReminderSent
      ) {
        emi.status = 'Completed';
      }

      await emi.save();
    }
  }

  private isSameDay(date1: Date, date2: Date) {
    return (
      date1 &&
      date1.toDateString() === date2.toDateString()
    );
  }
}