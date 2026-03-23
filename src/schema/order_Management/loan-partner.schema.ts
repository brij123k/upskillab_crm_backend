import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LoanPartnerDocument = LoanPartner & Document;

@Schema({ timestamps: true })
export class LoanPartner {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: ['NBFC', 'BANK'] })
  type: string;

  @Prop({ required: true })
  submissionCharge: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const LoanPartnerSchema =
  SchemaFactory.createForClass(LoanPartner);