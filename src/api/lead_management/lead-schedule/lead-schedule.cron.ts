import { Cron } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { LeadScheduleData } from './lead-schedule.data';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { SocketGateway } from 'src/api/socket/socket.gateway';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
@Injectable()
export class LeadScheduleCron {
  constructor(
    private readonly scheduleData: LeadScheduleData,

    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
    private readonly socketGateway: SocketGateway,
  ) {}

@Cron('*/1 * * * *') // every minute
async handleSchedules() {
  const now = new Date();

  while (true) {
    // 🔒 ATOMIC LOCK (one schedule at a time)
    const schedule = await this.scheduleData.lockOnePending(now);

    // No more pending schedules
    if (!schedule) break;

    // 1️⃣ Get latest lead assignment
    const lead = await this.leadModel.findOne({
      leadId: schedule.leadId,
    });

    if (!lead?.assignedTo) {
      continue;
    }

    // 2️⃣ Emit socket notification (ONCE)
    this.socketGateway.emitToUser(
      lead.assignedTo.toString(),
      'lead-schedule-reminder',
      {
        leadId: schedule.leadId,
        message: schedule.message,
        url:""
      },
    );
  }
}

}
