import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class MaskSetting extends Document {
  @Prop({ default: true })
  emailMask: boolean;

  @Prop({ default: true })
  phoneMask: boolean;
}

export const MaskSettingSchema =
  SchemaFactory.createForClass(MaskSetting);