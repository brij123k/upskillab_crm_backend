import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SubscriptionsPlanDocument = SubscriptionsPlan & Document;

@Schema({ timestamps: true })
export class SubscriptionsPlan {
    @Prop()
    planId: string;

    @Prop()
    planName: string;

    @Prop()
    amount: number;

    @Prop()
    interval: number;

    @Prop()
    plan_interval_type: string;

    @Prop()
    max_cycles: number;

    @Prop()
    max_amount: number;

    @Prop({ default: true })
    isActive: boolean;
}

export const SubscriptionsPlanSchema =
    SchemaFactory.createForClass(SubscriptionsPlan);