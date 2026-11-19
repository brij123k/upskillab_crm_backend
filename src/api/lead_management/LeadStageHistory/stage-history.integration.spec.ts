/**
 * Stage changes made from the after-call form are recorded (lead stage +
 * LeadStageHistory + lead history), and old call logs are backfilled.
 */
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { LeadStage, LeadStageSchema } from 'src/schema/lead_management/lead-stage.schema';
import { LeadStageHistory, LeadStageHistorySchema } from 'src/schema/lead_management/LeadStageHistory.schema';
import { LeadActionType, LeadHistory, LeadHistorySchema } from 'src/schema/lead_management/lead-history.schema';
import { SmartfloService } from '../../smartflo/smartflo.service';
import { StageHistoryBackfillService } from './stage-history-backfill.service';

let mongo: MongoMemoryServer;
const m: Record<string, Model<any>> = {};
let smartflo: SmartfloService;
let backfill: StageHistoryBackfillService;
const historyLogs: any[] = [];
const USER = new Types.ObjectId();
const stage: Record<string, Types.ObjectId> = {};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'stage_history_test' });
  const reg = (name: string, schema: any) => {
    m[name] = mongoose.models[name] || mongoose.model(name, schema);
  };
  reg(CallLog.name, CallLogSchema);
  reg(Lead.name, LeadSchema);
  reg(LeadStage.name, LeadStageSchema);
  reg(LeadStageHistory.name, LeadStageHistorySchema);
  reg(LeadHistory.name, LeadHistorySchema);
  await Promise.all(Object.values(m).map((x) => x.init()));

  for (const [i, name] of ['New Lead', 'Interested', 'PCAT Schedule', 'PCAT Done'].entries()) {
    stage[name] = (await m.LeadStage.create({ name, order: i + 1 }))._id;
  }

  smartflo = new SmartfloService(
    m.CallLog,
    m.Lead,
    {} as any,
    {} as any,
    { log: async (d: any) => historyLogs.push(d) } as any,
    { log: async () => undefined } as any,
    { create: async () => undefined } as any,
    {} as any,
    m.LeadStage,
    m.LeadStageHistory,
  );
  backfill = new StageHistoryBackfillService(m.LeadStageHistory, m.LeadHistory, m.Lead, m.LeadStage);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const newLead = (leadId: number, stageName = 'New Lead') =>
  m.Lead.create({ leadId, name: `Lead ${leadId}`, phone: `90000${leadId}`, stageId: stage[stageName], poolId: new Types.ObjectId() });

describe('after-call form stage change', () => {
  it('updates the lead and records stage history + lead history', async () => {
    const lead = await newLead(1);
    const call = await m.CallLog.create({ leadId: 1, userId: USER });
    historyLogs.length = 0;

    await smartflo.updateCallLog({ callId: call._id, stageId: String(stage['PCAT Schedule']), outcome: 'ok' });

    const updated: any = await m.Lead.findById(lead._id).lean();
    expect(String(updated.stageId)).toBe(String(stage['PCAT Schedule']));
    expect(updated.stageChangedAt).toBeTruthy();

    const rows: any[] = await m.LeadStageHistory.find({ leadId: lead._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stageName: 'PCAT Schedule', source: 'call' });
    expect(String(rows[0].userId)).toBe(String(USER));
    expect(String(rows[0].callLogId)).toBe(String(call._id));

    const stageLog = historyLogs.find((h) => h.actionType === LeadActionType.STAGE_CHANGED_CallS);
    expect(stageLog.changes.status).toEqual({ from: 'New Lead', to: 'PCAT Schedule' });
    expect(historyLogs.some((h) => h.actionType === LeadActionType.CALL_LOG)).toBe(true);
  });

  it('records nothing extra when the call keeps the same stage', async () => {
    const lead = await newLead(2, 'Interested');
    const call = await m.CallLog.create({ leadId: 2, userId: USER });
    await smartflo.updateCallLog({ callId: call._id, stageId: String(stage['Interested']), outcome: 'ok' });
    expect(await m.LeadStageHistory.countDocuments({ leadId: lead._id })).toBe(0);
  });
});

describe('backfill from old call logs', () => {
  it('rebuilds stage changes from call_log lead history once, skipping repeats and recorded ones', async () => {
    const lead = await newLead(3);
    const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min));
    const callLog = (min: number, stageName: string) => ({
      leadId: '3',
      actionType: LeadActionType.CALL_LOG,
      actionBy: USER,
      changes: { _id: new Types.ObjectId(), stageId: stage[stageName] },
      createdAt: t(min),
    });
    await m.LeadHistory.collection.insertMany([
      callLog(0, 'New Lead'), // same as start stage – not a change
      callLog(10, 'Interested'), // change
      callLog(20, 'Interested'), // repeat – not a change
      callLog(30, 'PCAT Schedule'), // change, but already recorded (below)
      callLog(40, 'PCAT Done'), // change
    ]);
    await m.LeadStageHistory.create({ leadId: lead._id, stageId: stage['PCAT Schedule'], stageName: 'PCAT Schedule', userId: USER, changedAt: t(31) });

    const created = await backfill.run();
    expect(created).toBe(2);
    const rows: any[] = await m.LeadStageHistory.find({ leadId: lead._id }).sort({ changedAt: 1 }).lean();
    expect(rows.map((r) => r.stageName)).toEqual(['Interested', 'PCAT Schedule', 'PCAT Done']);
    expect(rows.filter((r) => r.source === 'backfill_call_log').map((r) => r.changedAt.toISOString())).toEqual([
      t(10).toISOString(),
      t(40).toISOString(),
    ]);

    // runs once only
    expect(await backfill.run()).toBe(0);
  });
});
