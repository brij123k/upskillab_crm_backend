import {
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
import { CreditStatus, Order } from 'src/schema/order_Management/order.schema';
import {
  CreditNotificationCategory,
  CreditNotificationLog,
  CreditNotificationRun,
  CreditNotificationRunStatus,
} from 'src/schema/order_Management/credit-notification.schema';
import { Role } from 'src/schema/role.schema';
import { User, UserStatus } from 'src/schema/user.schema';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';
import {
  diffDateKeys,
  getBusinessTimezone,
  startOfDayInTimezone,
  toDateKey,
} from '../financial/order-financial.util';
import { counsellorAndPoolLookups } from './pending-credit.service';

export const PENDING_CREDIT_CRON_NAME = 'pending-credit-notifications';
const MAX_ITEMS_IN_NOTIFICATION = 500;

interface CandidateCredit {
  orderId: Types.ObjectId;
  creditId: Types.ObjectId;
  studentName: string;
  courseName: string;
  counsellorName: string;
  amount: number;
  dueDate: Date;
  dueDateKey: string;
  category: CreditNotificationCategory;
  daysOverdue: number;
}

/**
 * Daily admin notification for past-due and due-today credits.
 *
 * - Schedule: PENDING_CREDIT_NOTIFICATION_CRON (default "0 9 * * *") in
 *   PENDING_CREDIT_TIMEZONE (default Asia/Kolkata). Disable with
 *   PENDING_CREDIT_NOTIFICATIONS_ENABLED=false.
 * - Delivery: the existing NotificationEngineService (in-app + socket; the
 *   engine resolves further channels such as EMAIL/WHATSAPP from user
 *   notification preferences for the PENDING_CREDITS_DUE event).
 * - Duplicate prevention: credit_notification_logs has a unique index on
 *   (creditId, notificationDate); only credits whose log row is newly created
 *   by this run are included, so re-runs on the same date notify nothing new.
 * - History: every execution is stored in credit_notification_runs.
 */
@Injectable()
export class PendingCreditNotificationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PendingCreditNotificationService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(CreditNotificationLog.name)
    private readonly logModel: Model<CreditNotificationLog>,
    @InjectModel(CreditNotificationRun.name)
    private readonly runModel: Model<CreditNotificationRun>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    private readonly notificationEngine: NotificationEngineService,
    @Optional() private readonly schedulerRegistry?: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (
      String(process.env.PENDING_CREDIT_NOTIFICATIONS_ENABLED).toLowerCase() ===
      'false'
    ) {
      this.logger.log('Pending credit notifications are disabled');
      return;
    }
    if (!this.schedulerRegistry) {
      this.logger.warn(
        'SchedulerRegistry not available; pending credit cron not scheduled',
      );
      return;
    }
    const expression =
      process.env.PENDING_CREDIT_NOTIFICATION_CRON || '0 9 * * *';
    const timeZone = getBusinessTimezone();
    try {
      const job = new CronJob(
        expression,
        () => {
          this.run('CRON').catch((error) =>
            this.logger.error(
              `Pending credit notification run failed: ${error?.message}`,
              error?.stack,
            ),
          );
        },
        null,
        false,
        timeZone,
      );
      this.schedulerRegistry.addCronJob(PENDING_CREDIT_CRON_NAME, job as any);
      job.start();
      this.logger.log(
        `Pending credit notifications scheduled "${expression}" (${timeZone})`,
      );
    } catch (error: any) {
      this.logger.error(
        `Invalid PENDING_CREDIT_NOTIFICATION_CRON "${expression}": ${error?.message}`,
      );
    }
  }

  onModuleDestroy() {
    try {
      this.schedulerRegistry?.deleteCronJob(PENDING_CREDIT_CRON_NAME);
    } catch {
      // not scheduled
    }
  }

  /** Users that receive the organisation-wide summary. */
  async resolveRecipients(): Promise<string[]> {
    const roles = await this.roleModel
      .find({
        $or: [
          { name: { $regex: '^admin$', $options: 'i' } },
          { isSuperAdmin: true },
          { permissions: { $elemMatch: { module: '*', actions: '*' } } },
        ],
      })
      .select('_id')
      .lean();
    const roleIds = roles.map((r: any) => r._id);
    const users = roleIds.length
      ? await this.userModel
          .find({
            role: {
              $in: [...roleIds, ...roleIds.map((id: any) => id.toString())],
            },
            status: UserStatus.ACTIVE,
            isBlocked: { $ne: true },
          })
          .select('_id')
          .lean()
      : [];

    const configured = String(process.env.PENDING_CREDIT_NOTIFY_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => Types.ObjectId.isValid(id));

    return [
      ...new Set([...users.map((u: any) => u._id.toString()), ...configured]),
    ];
  }

  /** Persists Overdue on unpaid credits whose due date is before today. */
  async markOverdueCredits(
    todayKey: string,
    timeZone: string,
  ): Promise<number> {
    const startOfToday = startOfDayInTimezone(todayKey, timeZone);
    const result = await this.orderModel.updateMany(
      {
        credits: {
          $elemMatch: {
            status: CreditStatus.PENDING,
            dueDate: { $lt: startOfToday },
          },
        },
      },
      { $set: { 'credits.$[c].status': CreditStatus.OVERDUE } },
      {
        arrayFilters: [
          {
            'c.status': CreditStatus.PENDING,
            'c.dueDate': { $lt: startOfToday },
          },
        ],
        timestamps: false,
      },
    );
    return result.modifiedCount || 0;
  }

  async findCandidates(
    todayKey: string,
    timeZone: string,
  ): Promise<CandidateCredit[]> {
    const endOfToday = new Date(
      startOfDayInTimezone(todayKey, timeZone).getTime() + 86_400_000,
    );
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          Approved: true,
          credits: {
            $elemMatch: {
              status: { $in: [CreditStatus.PENDING, CreditStatus.OVERDUE] },
              dueDate: { $lt: endOfToday },
            },
          },
        },
      },
      { $unwind: '$credits' },
      {
        $match: {
          'credits.status': {
            $in: [CreditStatus.PENDING, CreditStatus.OVERDUE],
          },
          'credits.dueDate': { $lt: endOfToday },
        },
      },
      ...counsellorAndPoolLookups(),
      {
        $project: {
          orderId: '$_id',
          creditId: '$credits._id',
          studentName: 1,
          courseName: {
            $ifNull: ['$courseName', { $arrayElemAt: ['$pool.name', 0] }],
          },
          counsellorName: {
            $ifNull: [
              { $arrayElemAt: ['$counsellor.name', 0] },
              '$counsellorName',
            ],
          },
          amount: '$credits.amount',
          dueDate: '$credits.dueDate',
          dueDateKey: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$credits.dueDate',
              timezone: timeZone,
            },
          },
        },
      },
      { $sort: { dueDate: 1 } },
    ]);

    return rows.map((row: any) => {
      const pastDue = row.dueDateKey < todayKey;
      return {
        ...row,
        category: pastDue
          ? CreditNotificationCategory.PAST_DUE
          : CreditNotificationCategory.DUE_TODAY,
        daysOverdue: pastDue ? diffDateKeys(row.dueDateKey, todayKey) : 0,
      };
    });
  }

  /** Inserts the log rows; returns the candidates that were not notified yet today. */
  private async claimCandidates(
    candidates: CandidateCredit[],
    todayKey: string,
    runId: Types.ObjectId,
  ): Promise<CandidateCredit[]> {
    const fresh: CandidateCredit[] = [];
    for (const candidate of candidates) {
      try {
        const result = await this.logModel.updateOne(
          { creditId: candidate.creditId, notificationDate: todayKey },
          {
            $setOnInsert: {
              orderId: candidate.orderId,
              creditId: candidate.creditId,
              notificationDate: todayKey,
              category: candidate.category,
              runId,
              amount: candidate.amount,
              dueDate: candidate.dueDate,
              daysOverdue: candidate.daysOverdue,
            },
          },
          { upsert: true },
        );
        if (result.upsertedCount === 1) fresh.push(candidate);
      } catch (error: any) {
        if (error?.code !== 11000) throw error; // concurrent run claimed it
      }
    }
    return fresh;
  }

  private formatAmount(amount: number) {
    return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  async run(
    trigger: 'CRON' | 'MANUAL' = 'CRON',
    triggeredBy?: string,
    now = new Date(),
  ) {
    const timeZone = getBusinessTimezone();
    const todayKey = toDateKey(now, timeZone);
    const run = await this.runModel.create({
      runDate: todayKey,
      trigger,
      triggeredBy:
        triggeredBy && Types.ObjectId.isValid(triggeredBy)
          ? new Types.ObjectId(triggeredBy)
          : undefined,
      startedAt: new Date(),
      status: CreditNotificationRunStatus.RUNNING,
    });

    let claimed: CandidateCredit[] = [];
    try {
      const creditsMarkedOverdue = await this.markOverdueCredits(
        todayKey,
        timeZone,
      );
      const candidates = await this.findCandidates(todayKey, timeZone);
      const pastDueFound = candidates.filter(
        (c) => c.category === CreditNotificationCategory.PAST_DUE,
      ).length;
      const dueTodayFound = candidates.length - pastDueFound;

      const recipients = candidates.length
        ? await this.resolveRecipients()
        : [];
      if (candidates.length && !recipients.length) {
        throw new Error(
          'No admin recipients found for pending credit notifications',
        );
      }

      claimed = await this.claimCandidates(candidates, todayKey, run._id);
      const pastDue = claimed.filter(
        (c) => c.category === CreditNotificationCategory.PAST_DUE,
      );
      const dueToday = claimed.filter(
        (c) => c.category === CreditNotificationCategory.DUE_TODAY,
      );

      if (claimed.length) {
        const sum = (items: CandidateCredit[]) =>
          items.reduce((total, item) => total + Number(item.amount || 0), 0);
        const toItem = (c: CandidateCredit, withOverdue: boolean) => ({
          orderId: c.orderId.toString(),
          creditId: c.creditId.toString(),
          studentName: c.studentName,
          course: c.courseName,
          counsellor: c.counsellorName,
          creditAmount: c.amount,
          dueDate: c.dueDate,
          ...(withOverdue ? { daysOverdue: c.daysOverdue } : {}),
        });

        const parts: string[] = [];
        if (pastDue.length) {
          parts.push(
            `${pastDue.length} past due (${this.formatAmount(sum(pastDue))})`,
          );
        }
        if (dueToday.length) {
          parts.push(
            `${dueToday.length} due today (${this.formatAmount(sum(dueToday))})`,
          );
        }

        await this.notificationEngine.handleEvent({
          event: NOTIFICATION_EVENT.PENDING_CREDITS_DUE,
          recipients: { userIds: recipients },
          title: `Pending credit payments – ${todayKey}`,
          message: `Credits requiring follow-up: ${parts.join(', ')}.`,
          entity: { type: NOTIFICATION_ENTITY.PAYMENT, id: run._id.toString() },
          metadata: {
            redirectUrl: '/admin/pending-credits',
            kind: 'pending-credits',
            runId: run._id.toString(),
            date: todayKey,
            timezone: timeZone,
            pastDue: {
              count: pastDue.length,
              totalAmount: sum(pastDue),
              items: pastDue
                .slice(0, MAX_ITEMS_IN_NOTIFICATION)
                .map((c) => toItem(c, true)),
              truncated: pastDue.length > MAX_ITEMS_IN_NOTIFICATION,
            },
            dueToday: {
              count: dueToday.length,
              totalAmount: sum(dueToday),
              items: dueToday
                .slice(0, MAX_ITEMS_IN_NOTIFICATION)
                .map((c) => toItem(c, false)),
              truncated: dueToday.length > MAX_ITEMS_IN_NOTIFICATION,
            },
          },
        });
      }

      await this.runModel.updateOne(
        { _id: run._id },
        {
          $set: {
            status: claimed.length
              ? CreditNotificationRunStatus.COMPLETED
              : CreditNotificationRunStatus.SKIPPED,
            finishedAt: new Date(),
            pastDueFound,
            dueTodayFound,
            pastDueNotified: pastDue.length,
            dueTodayNotified: dueToday.length,
            alreadyNotified: candidates.length - claimed.length,
            creditsMarkedOverdue,
            recipients: claimed.length
              ? recipients.map((id) => new Types.ObjectId(id))
              : [],
          },
        },
      );
      return this.runModel.findById(run._id).lean();
    } catch (error: any) {
      // Release this run's claims so that a retry can notify these credits.
      if (claimed.length) {
        await this.logModel
          .deleteMany({ runId: run._id })
          .catch((cleanupError) =>
            this.logger.error(
              `Failed to release notification claims: ${cleanupError?.message}`,
            ),
          );
      }
      await this.runModel.updateOne(
        { _id: run._id },
        {
          $set: {
            status: CreditNotificationRunStatus.FAILED,
            finishedAt: new Date(),
            error: String(error?.message || error),
          },
        },
      );
      this.logger.error(
        `Pending credit notification run failed: ${error?.message}`,
      );
      throw error;
    }
  }

  async getHistory(page = 1, limit = 20) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [data, total] = await Promise.all([
      this.runModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.runModel.countDocuments(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
