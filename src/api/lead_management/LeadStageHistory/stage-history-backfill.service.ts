import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeadStageHistory } from 'src/schema/lead_management/LeadStageHistory.schema';
import { LeadHistory, LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';

const MARKER_ID = 'stage-history-from-call-logs-v1';
/** An existing stage-history row this close to a call already records it. */
const SAME_EVENT_MS = 10 * 60 * 1000;

/**
 * One-time repair (runs in the background on startup, once per database).
 *
 * Until 2026-11-19 the after-call form changed the lead's stage without writing
 * a LeadStageHistory row, so stage activity reports missed every stage change
 * made from a call. The "call_log" entries in lead history still hold the
 * stage chosen in each call, so the missing rows are rebuilt from them:
 * a call counts as a stage change when its stage differs from the lead's
 * stage just before it (previous call / existing stage history).
 */
@Injectable()
export class StageHistoryBackfillService implements OnModuleInit {
  private readonly logger = new Logger(StageHistoryBackfillService.name);

  constructor(
    @InjectModel(LeadStageHistory.name) private readonly stageHistoryModel: Model<LeadStageHistory>,
    @InjectModel(LeadHistory.name) private readonly leadHistoryModel: Model<LeadHistory>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(LeadStage.name) private readonly leadStageModel: Model<LeadStage>,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => {
      this.run().catch((e) => this.logger.warn(`Stage history backfill failed: ${e?.message}`));
    }, 15_000);
  }

  /** Returns the number of rows created (0 when it already ran). */
  async run(force = false): Promise<number> {
    const migrations = this.stageHistoryModel.db.collection('migrations');
    if (!force && (await migrations.findOne({ _id: MARKER_ID as any }))) return 0;

    const stages = await this.leadStageModel.find().select('name order').lean();
    const stageName = new Map(stages.map((s: any) => [String(s._id), s.name]));
    // stage a new lead starts in (lowest order) – a first call into it is not a change
    const defaultStage = [...stages].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
    const defaultStageId = defaultStage ? String(defaultStage._id) : '';

    const cursor = this.leadHistoryModel
      .aggregate([
        {
          $match: {
            actionType: LeadActionType.CALL_LOG,
            'changes.stageId': { $exists: true, $ne: null },
          },
        },
        { $sort: { createdAt: 1 } },
        {
          $group: {
            _id: '$leadId',
            calls: {
              $push: { stageId: '$changes.stageId', at: '$createdAt', by: '$actionBy', callId: '$changes._id' },
            },
          },
        },
      ])
      .allowDiskUse(true)
      .cursor({ batchSize: 200 });

    let created = 0;
    let leadsTouched = 0;
    let batch: any[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await this.stageHistoryModel.insertMany(batch, { ordered: false });
      created += batch.length;
      batch = [];
    };

    for await (const group of cursor as any) {
      const numericId = Number(group._id);
      if (!Number.isFinite(numericId)) continue;
      const lead: any = await this.leadModel.findOne({ leadId: numericId }).select('_id').lean();
      if (!lead) continue;

      const existing = await this.stageHistoryModel
        .find({ leadId: lead._id })
        .select('stageId changedAt')
        .sort({ changedAt: 1 })
        .lean();
      const known = existing.map((h: any) => ({ stageId: String(h.stageId), at: new Date(h.changedAt).getTime() }));

      let prevCallStage: string | null = null;
      let prevCallAt = -Infinity;
      let addedForLead = 0;

      for (const c of group.calls) {
        const stageId = c.stageId ? String(c.stageId) : '';
        const at = new Date(c.at).getTime();
        if (!stageId || !Types.ObjectId.isValid(stageId) || !c.by || !Number.isFinite(at)) continue;

        // lead's stage just before this call: latest of previous call / recorded history
        const lastKnown = [...known].reverse().find((h) => h.at < at);
        let before: string | null = prevCallStage;
        if (lastKnown && lastKnown.at > prevCallAt) before = lastKnown.stageId;
        if (before === null) before = defaultStageId;

        prevCallStage = stageId;
        prevCallAt = at;
        if (stageId === before) continue;

        // already recorded (e.g. stage also changed from the lead page)?
        if (known.some((h) => h.stageId === stageId && Math.abs(h.at - at) <= SAME_EVENT_MS)) continue;

        batch.push({
          leadId: lead._id,
          stageId: new Types.ObjectId(stageId),
          stageName: stageName.get(stageId) || 'Unknown',
          userId: new Types.ObjectId(String(c.by)),
          changedAt: new Date(at),
          source: 'backfill_call_log',
          ...(c.callId && Types.ObjectId.isValid(String(c.callId)) ? { callLogId: new Types.ObjectId(String(c.callId)) } : {}),
        });
        known.push({ stageId, at });
        addedForLead++;
        if (batch.length >= 500) await flush();
      }
      if (addedForLead) leadsTouched++;
    }
    await flush();

    await migrations.updateOne(
      { _id: MARKER_ID as any },
      { $set: { ranAt: new Date(), created, leadsTouched } },
      { upsert: true },
    );
    this.logger.log(`Stage history backfill: ${created} stage changes rebuilt from call logs on ${leadsTouched} leads`);
    return created;
  }
}
