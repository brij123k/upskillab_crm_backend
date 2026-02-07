import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

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
}

export const LeadScheduleSchema =
  SchemaFactory.createForClass(LeadSchedule);

// 🔥 Critical index
LeadScheduleSchema.index({ scheduledAt: 1, isTriggered: 1 });
