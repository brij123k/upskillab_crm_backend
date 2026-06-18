import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LevelDocument = Level & Document;

@Schema({
  timestamps: true,
})
export class Level {
  @Prop({
    required: true,
    unique: true,
    trim: true,
  })
  name?: string;
}

export const LevelSchema = SchemaFactory.createForClass(Level);