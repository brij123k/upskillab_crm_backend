import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document,Types } from 'mongoose';

@Schema({ timestamps: true })
export class Pool extends Document {
  @Prop({ required: true, unique: true })
  name: string;

   @Prop({ default:true })
  isActive: boolean;
}

export const PoolSchema = SchemaFactory.createForClass(Pool);
