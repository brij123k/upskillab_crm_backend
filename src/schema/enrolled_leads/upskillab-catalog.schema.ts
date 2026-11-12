import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Upskillab course, stored separately (refreshed on every sync). */
@Schema({ timestamps: true, collection: 'upskillab_courses' })
export class UpskillabCourse {
  @Prop({ required: true, unique: true, index: true })
  upskillabId: string;

  @Prop({ index: true })
  courseName?: string;

  @Prop()
  category?: string;

  @Prop()
  language?: string;

  /** The full course object exactly as received. */
  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop()
  firstSyncedAt?: Date;

  @Prop()
  lastSyncedAt?: Date;
}

export const UpskillabCourseSchema =
  SchemaFactory.createForClass(UpskillabCourse);

/** Upskillab batch, stored separately (refreshed on every sync). */
@Schema({ timestamps: true, collection: 'upskillab_batches' })
export class UpskillabBatch {
  @Prop({ required: true, unique: true, index: true })
  upskillabId: string;

  @Prop({ index: true })
  batchCode?: string;

  @Prop({ index: true })
  courseId?: string;

  @Prop()
  courseName?: string;

  @Prop()
  teacherName?: string;

  @Prop({ index: true })
  status?: string;

  @Prop()
  active?: boolean;

  @Prop()
  startDate?: Date;

  @Prop()
  endDate?: Date;

  @Prop()
  startTime?: string;

  @Prop()
  duration?: string;

  @Prop()
  seats?: number;

  @Prop()
  enrolledStudents?: number;

  @Prop()
  paidStudents?: number;

  @Prop()
  totalOrders?: number;

  /** The full batch object exactly as received. */
  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop()
  firstSyncedAt?: Date;

  @Prop()
  lastSyncedAt?: Date;
}

export const UpskillabBatchSchema =
  SchemaFactory.createForClass(UpskillabBatch);
