import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Model, Types } from 'mongoose';
import { EnrolledLead } from 'src/schema/enrolled_leads/enrolled-lead.schema';
import {
  EnrolledLeadAction,
  EnrolledLeadHistory,
  EnrolledLeadSyncRun,
  EnrolledSyncStatus,
} from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';
import {
  UpskillabBatch,
  UpskillabCourse,
} from 'src/schema/enrolled_leads/upskillab-catalog.schema';
import { getBusinessTimezone } from '../order_management/financial/order-financial.util';
import { UpskillabClient } from './upskillab.client';
import { mapBatch, mapCourse, mapStudent } from './enrolled-lead.mapper';
import { EnrolledLeadStageService } from './enrolled-lead-stage.service';

export const ENROLLED_SYNC_CRON_NAME = 'enrolled-leads-sync';
const CHUNK = 500;
/** A RUNNING sync older than this is treated as dead. */
const STALE_RUN_MS = 30 * 60 * 1000;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
};

/**
 * Imports Upskillab students, courses and batches.
 *
 * - New students are added with the default stage ("Enrolled").
 * - Students already in the CRM are never added again (unique studentId);
 *   their Upskillab details (status, courses, batches, orders...) are
 *   refreshed, while CRM fields (stage, assignment, history) are kept.
 * - Courses and batches are upserted into their own collections.
 * - Runs nightly (ENROLLED_LEADS_SYNC_CRON, default "0 0 * * *" = 12 AM in
 *   the business timezone) and from the "Fetch more" button. Every run is
 *   stored in enrolled_lead_sync_runs.
 */
@Injectable()
export class EnrolledLeadSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnrolledLeadSyncService.name);

  constructor(
    @InjectModel(EnrolledLead.name)
    private readonly leadModel: Model<EnrolledLead>,
    @InjectModel(EnrolledLeadHistory.name)
    private readonly historyModel: Model<EnrolledLeadHistory>,
    @InjectModel(EnrolledLeadSyncRun.name)
    private readonly runModel: Model<EnrolledLeadSyncRun>,
    @InjectModel(UpskillabCourse.name)
    private readonly courseModel: Model<UpskillabCourse>,
    @InjectModel(UpskillabBatch.name)
    private readonly batchModel: Model<UpskillabBatch>,
    private readonly client: UpskillabClient,
    private readonly stages: EnrolledLeadStageService,
    @Optional() private readonly schedulerRegistry?: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (
      String(process.env.ENROLLED_LEADS_SYNC_ENABLED).toLowerCase() === 'false'
    ) {
      this.logger.log('Enrolled leads nightly sync is disabled');
      return;
    }
    if (!this.schedulerRegistry) {
      this.logger.warn(
        'SchedulerRegistry not available; enrolled leads sync not scheduled',
      );
      return;
    }
    const expression = process.env.ENROLLED_LEADS_SYNC_CRON || '0 0 * * *';
    const timeZone = getBusinessTimezone();
    try {
      const job = new CronJob(
        expression,
        () => {
          this.run('CRON').catch((error) =>
            this.logger.error(
              `Enrolled leads sync failed: ${error?.message}`,
              error?.stack,
            ),
          );
        },
        null,
        false,
        timeZone,
      );
      this.schedulerRegistry.addCronJob(ENROLLED_SYNC_CRON_NAME, job as any);
      job.start();
      this.logger.log(
        `Enrolled leads sync scheduled "${expression}" (${timeZone})`,
      );
    } catch (error: any) {
      this.logger.error(
        `Invalid ENROLLED_LEADS_SYNC_CRON "${expression}": ${error?.message}`,
      );
    }
  }

  onModuleDestroy() {
    try {
      this.schedulerRegistry?.deleteCronJob(ENROLLED_SYNC_CRON_NAME);
    } catch {
      // not scheduled
    }
  }

  /** Runs one sync and records it. Only one sync can run at a time. */
  async run(trigger: 'CRON' | 'MANUAL', userId?: string) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_RUN_MS);
    await this.runModel.updateMany(
      { status: EnrolledSyncStatus.RUNNING, startedAt: { $lt: staleBefore } },
      {
        $set: {
          status: EnrolledSyncStatus.FAILED,
          finishedAt: now,
          error: 'Timed out',
        },
      },
    );
    const running = await this.runModel
      .findOne({ status: EnrolledSyncStatus.RUNNING })
      .lean();
    if (running) {
      throw new ConflictException(
        'A student sync is already running. Try again in a few minutes.',
      );
    }

    const run = await this.runModel.create({
      trigger,
      triggeredBy:
        userId && Types.ObjectId.isValid(userId)
          ? new Types.ObjectId(userId)
          : undefined,
      status: EnrolledSyncStatus.RUNNING,
      startedAt: now,
    });

    try {
      const stats = await this.sync();
      return await this.runModel
        .findByIdAndUpdate(
          run._id,
          {
            $set: {
              ...stats,
              status: EnrolledSyncStatus.SUCCESS,
              finishedAt: new Date(),
            },
          },
          { new: true },
        )
        .lean();
    } catch (error: any) {
      await this.runModel.updateOne(
        { _id: run._id },
        {
          $set: {
            status: EnrolledSyncStatus.FAILED,
            finishedAt: new Date(),
            error: String(error?.message || error).slice(0, 1000),
          },
        },
      );
      throw error;
    }
  }

  private async sync() {
    const { students, courses, batches } = await this.client.fetchAllStudents();
    const now = new Date();

    // ---------------- courses ----------------
    const courseDocs = courses.map(mapCourse).filter((c) => c.upskillabId);
    const courseNames = new Map<string, string>();
    courseDocs.forEach(
      (c) => c.courseName && courseNames.set(c.upskillabId!, c.courseName),
    );
    let newCourses = 0;
    for (const part of chunks(courseDocs, CHUNK)) {
      const result = await this.courseModel.bulkWrite(
        part.map((doc) => ({
          updateOne: {
            filter: { upskillabId: doc.upskillabId },
            update: {
              $set: { ...doc, lastSyncedAt: now },
              $setOnInsert: { firstSyncedAt: now },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      newCourses += result.upsertedCount || 0;
    }

    // ---------------- batches ----------------
    const batchDocs = batches
      .map((b) => mapBatch(b, courseNames))
      .filter((b) => b.upskillabId);
    let newBatches = 0;
    for (const part of chunks(batchDocs, CHUNK)) {
      const result = await this.batchModel.bulkWrite(
        part.map((doc) => ({
          updateOne: {
            filter: { upskillabId: doc.upskillabId },
            update: {
              $set: { ...doc, lastSyncedAt: now },
              $setOnInsert: { firstSyncedAt: now },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      newBatches += result.upsertedCount || 0;
    }

    // ---------------- students ----------------
    const byId = new Map<string, ReturnType<typeof mapStudent>>();
    for (const student of students) {
      const doc = mapStudent(student);
      if (doc.studentId) byId.set(doc.studentId, doc);
    }
    const studentDocs = Array.from(byId.values());
    const defaultStage = await this.stages.getDefaultStage();

    let newStudents = 0;
    let updatedStudents = 0;
    let statusChanged = 0;

    for (const part of chunks(studentDocs, CHUNK)) {
      const existing = await this.leadModel
        .find({ studentId: { $in: part.map((d) => d.studentId as string) } })
        .select('_id studentId status isActive')
        .lean();
      const existingById = new Map(existing.map((e: any) => [e.studentId, e]));

      const result = await this.leadModel.bulkWrite(
        part.map((doc) => ({
          updateOne: {
            filter: { studentId: doc.studentId },
            update: {
              $set: { ...doc, lastSyncedAt: now },
              $setOnInsert: {
                stageId: defaultStage._id,
                stageName: defaultStage.name,
                firstSyncedAt: now,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );

      const insertedIds = Object.values(result.upsertedIds || {});
      newStudents += insertedIds.length;
      updatedStudents += part.length - insertedIds.length;

      const histories: any[] = insertedIds.map((id: any) => ({
        enrolledLeadId: id,
        actionType: EnrolledLeadAction.CREATED,
        toStage: defaultStage.name,
        note: 'Imported from Upskillab',
      }));

      for (const doc of part) {
        const before: any = existingById.get(doc.studentId);
        if (!before) continue;
        const changes: Record<string, any> = {};
        if ((before.status ?? null) !== (doc.status ?? null)) {
          changes.status = {
            from: before.status ?? null,
            to: doc.status ?? null,
          };
        }
        if ((before.isActive ?? null) !== (doc.isActive ?? null)) {
          changes.isActive = {
            from: before.isActive ?? null,
            to: doc.isActive ?? null,
          };
        }
        if (Object.keys(changes).length) {
          statusChanged++;
          histories.push({
            enrolledLeadId: before._id,
            actionType: EnrolledLeadAction.STATUS_SYNCED,
            note: 'Status updated from Upskillab',
            changes,
          });
        }
      }

      if (histories.length)
        await this.historyModel.insertMany(histories, { ordered: false });
    }

    return {
      studentsFetched: studentDocs.length,
      newStudents,
      updatedStudents,
      statusChanged,
      coursesFetched: courseDocs.length,
      newCourses,
      batchesFetched: batchDocs.length,
      newBatches,
    };
  }

  async getRuns(page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.runModel
        .find()
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('triggeredBy', 'name employeeId')
        .lean(),
      this.runModel.countDocuments(),
    ]);
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getLastRun() {
    return this.runModel.findOne().sort({ startedAt: -1 }).lean();
  }
}
