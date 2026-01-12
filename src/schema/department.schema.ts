import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Department extends Document {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Department', default: null })
  parentDepartmentId?: Types.ObjectId | Department;

  // timestamps (for TS)
  createdAt: Date;
  updatedAt: Date;
}

export const DepartmentSchema =
  SchemaFactory.createForClass(Department);
