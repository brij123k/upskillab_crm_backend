import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SubscriptionDocument = Subscription & Document;

@Schema({ timestamps: true })
export class Subscription {
    @Prop({ type: Types.ObjectId, ref: 'Order' })
    orderId: Types.ObjectId;

    @Prop()
    subscriptionId: string;

    @Prop()
    planId: string;

    @Prop()
    studentName: string;

    @Prop()
    mobile: string;

    @Prop()
    email: string;
    
    @Prop()
    counselorName: string;

    @Prop()
    totalAmount: number;

    @Prop()
    installmentAmount: number;

    @Prop()
    numberOfInstallments: number;

    @Prop()
    firstInstallmentDate: Date;

    @Prop()
    lastInstallmentDate: Date;

    // 🔥 TRACK PAYMENTS
    @Prop({
        type: [
            {
                installmentNo: Number,
                dueDate: Date,
                amount: Number,
                isPaid: { type: Boolean, default: false },
                paidAt: Date,
                reminderSent: { type: Boolean, default: false },
            },
        ],
    })
    installments: any[];

    @Prop()
    paymentMethod: string;

    @Prop({ type: Object })
    paymentDetails: any;

    @Prop()
    cashfreeSubscriptionId: string;

    @Prop({ default: 'PENDING' })
    authStatus: string;

    @Prop({ type: Array, default: [] })
    webhookLogs: any[];

    @Prop({ default: 'Active' })
    status: string;
}

export const SubscriptionSchema =
    SchemaFactory.createForClass(Subscription);