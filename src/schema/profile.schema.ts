import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Profile extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  departmentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reportingSeniorId?: Types.ObjectId;

  @Prop()
  education?: string;

  @Prop()
  salary?: number;

  @Prop()
  profileImage?: string;

  @Prop({ type: Types.ObjectId, ref: 'Pool' })
  poolId?: Types.ObjectId;

  @Prop({
    type: [
      {
        module: String,
        actions: [String],
      },
    ],
    default: [],
  })
  extraAccessControls?: {
    module: string;
    actions: string[];
  }[];

  createdAt: Date;
  updatedAt: Date;
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
