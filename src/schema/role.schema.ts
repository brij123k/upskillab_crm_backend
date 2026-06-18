import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document,Types } from 'mongoose';

@Schema({ timestamps: true })
export class Role extends Document {
  @Prop({ required: true, unique: true })
  name: string;

 @Prop({
  type: Types.ObjectId,
  ref: 'Level',
  required: false,
})
levelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Role'})
  reportingRole: Types.ObjectId;

  @Prop({ default: false })
  isSuperAdmin: boolean;
  @Prop({
    type: [
      {
        module: String,
        actions: [String],
      },
    ],
    default: [],
  })
  permissions: {
    module: string;
    actions: string[];
  }[];


  
}

export const RoleSchema = SchemaFactory.createForClass(Role);
