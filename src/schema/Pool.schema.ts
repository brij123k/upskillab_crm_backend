import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document,Types } from 'mongoose';

@Schema({ timestamps: true })
export class Pool extends Document {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({required:false})
  revenue_percentage:string;

  @Prop({ default:true })
  payment_internal:boolean;

  @Prop({required:true,type: Types.ObjectId, ref:'User'})
  pool_owner:Types.ObjectId;

   @Prop({ default:true })
  isActive: boolean;
}

export const PoolSchema = SchemaFactory.createForClass(Pool);
