import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LoanEmiDocument = LoanEmi & Document;

@Schema({ timestamps: true })
export class LoanEmi {
  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId: Types.ObjectId;

  @Prop()
  learnerName: string;

  @Prop()
  mobile: string;

  @Prop()
  counselorName: string;

  @Prop()
  loanAmount: number;

  @Prop()
  disbursementAmount: number;

  @Prop()
  loanDate: Date;

  // 🔥 EMI DATES
  @Prop()
  firstEmiDate: Date;

  @Prop()
  firstEmi: Boolean;

  @Prop()
  secondEmiDate: Date;

  @Prop()
  secondEmi: Boolean;

  @Prop()
  thirdEmiDate: Date;

    @Prop()
  thirdEmi: Boolean;


  // 🔥 REMINDER FLAGS
  @Prop({ default: false })
  firstReminderSent: boolean;

  @Prop({ default: false })
  secondReminderSent: boolean;

  @Prop({ default: false })
  thirdReminderSent: boolean;

  // 🔥 STATUS
  @Prop({
    enum: ['Pending', 'Completed'],
    default: 'Pending',
  })
  status: string;
}

export const LoanEmiSchema = SchemaFactory.createForClass(LoanEmi);