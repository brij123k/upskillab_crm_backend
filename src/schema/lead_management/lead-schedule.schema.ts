import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
export enum LeadScheduleStatus {
  UPCOMING = 'upcoming',
  OVERDUE = 'overdue',
  COMPLETED = 'completed',
}
@Schema({ timestamps: true })
export class LeadSchedule {
  @Prop({ required: true })
  leadId: number;

  @Prop({ required: true })
  scheduledAt: Date;

  @Prop({ required: true })
  message: string;

  @Prop({ default: false })
  isTriggered: boolean;

  @Prop({
    enum: LeadScheduleStatus,
    default: LeadScheduleStatus.UPCOMING,
  })
  status: LeadScheduleStatus;

  @Prop()
  completedAt?: Date;
}

export const LeadScheduleSchema =
  SchemaFactory.createForClass(LeadSchedule);

// 🔥 Critical index
LeadScheduleSchema.index({ scheduledAt: 1, isTriggered: 1 });
