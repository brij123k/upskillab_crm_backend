import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class CallEventQueue extends Document {
    @Prop()
    userId?: string;

    @Prop()
    event: string;

    @Prop({ type: mongoose.Schema.Types.Mixed }) // ⭐ recommended
    payload: any;

    @Prop()
    createdAt?: string;
}

export const CallEventQueueSchema =
    SchemaFactory.createForClass(CallEventQueue);
