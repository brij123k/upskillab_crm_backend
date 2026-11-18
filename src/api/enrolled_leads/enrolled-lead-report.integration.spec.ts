/**
 * Enrolled students by stage report + Leads table sorting (lastCallAt hook,
 * name / last-call sort), against an in-memory MongoDB.
 */
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EnrolledLead, EnrolledLeadSchema } from 'src/schema/enrolled_leads/enrolled-lead.schema';
import { EnrolledLeadStage, EnrolledLeadStageSchema } from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';
import {
  UpskillabBatch,
  UpskillabBatchSchema,
  UpskillabCourse,
  UpskillabCourseSchema,
} from 'src/schema/enrolled_leads/upskillab-catalog.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { EnrolledLeadStageService } from './enrolled-lead-stage.service';
import { EnrolledLeadReportService } from './enrolled-lead-report.service';
import { leadSortSpec } from '../lead_management/lead/lead.data';

let mongo: MongoMemoryServer;
const m: Record<string, Model<any>> = {};
let report: EnrolledLeadReportService;
let stageIds: string[] = [];

const oid = () => new Types.ObjectId();
const MANAGER = oid();
const BDA_1 = oid();
const BDA_2 = oid();
const OUTSIDER = oid();
const ROLE_L1 = oid();
const ROLE_L2 = oid();

const ADMIN = { userId: oid().toString(), roleName: 'Admin', permissions: [{ module: '*', actions: ['*'] }] };
const MGR = {
  userId: MANAGER.toString(),
  roleName: 'bd',
  permissions: [{ module: 'reports', actions: ['enrolled-stages'] }],
};
const NOBODY = { userId: OUTSIDER.toString(), roleName: 'bd', permissions: [] };

// Manager sees self + both BDAs (stub of the profile hierarchy).
const userLogicStub: any = {
  getUsersUnder: async ({ userId }: any) =>
    userId === MANAGER.toString() ? [{ _id: BDA_1 }, { _id: BDA_2 }] : [],
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'enrolled_report_test' });
  const reg = (name: string, schema: any) => {
    m[name] = mongoose.models[name] || mongoose.model(name, schema);
  };
  reg(EnrolledLead.name, EnrolledLeadSchema);
  reg(EnrolledLeadStage.name, EnrolledLeadStageSchema);
  reg(UpskillabCourse.name, UpskillabCourseSchema);
  reg(UpskillabBatch.name, UpskillabBatchSchema);
  reg(User.name, UserSchema);
  reg(CallLog.name, CallLogSchema);
  reg(Lead.name, LeadSchema);
  await Promise.all(Object.values(m).map((model) => model.init()));

  const stages = new EnrolledLeadStageService(m.EnrolledLeadStage, m.EnrolledLead);
  await stages.onModuleInit();
  stageIds = (await stages.list()).map((s: any) => String(s._id));

  report = new EnrolledLeadReportService(
    m.EnrolledLead,
    m.UpskillabCourse,
    m.UpskillabBatch,
    m.User,
    userLogicStub,
    stages,
  );

  const db = mongoose.connection.db!;
  await db.collection('roles').insertMany([
    { _id: ROLE_L1, name: 'BDA', level: 1 },
    { _id: ROLE_L2, name: 'Team Lead', level: 2 },
  ]);
  await db.collection('users').insertMany([
    { _id: MANAGER, name: 'Manager', email: 'm@x.io', number: '9000000010', employeeId: 10, role: ROLE_L2, status: 'active' },
    { _id: BDA_1, name: 'Asha', email: 'a@x.io', number: '9000000011', employeeId: 11, role: ROLE_L1, status: 'active' },
    { _id: BDA_2, name: 'Bala', email: 'b@x.io', number: '9000000012', employeeId: 12, role: ROLE_L1, status: 'active' },
    { _id: OUTSIDER, name: 'Other', email: 'o@x.io', number: '9000000013', employeeId: 13, role: ROLE_L1, status: 'active' },
  ]);
  await db.collection('profiles').insertMany([
    { userId: BDA_1, reportingSeniorId: MANAGER },
    { userId: BDA_2, reportingSeniorId: MANAGER },
  ]);
  await m.UpskillabCourse.create({ upskillabId: 'c1', courseName: 'Psychology' });
  await m.UpskillabBatch.create({ upskillabId: 'b1', batchCode: 'PSY-NOW', courseId: 'c1' });

  const [enrolled, second] = stageIds;
  let n = 0;
  const student = (assignedTo: any, stageId: string, extra: any = {}) => ({
    studentId: `s${++n}`,
    fullName: `Student ${n}`,
    courseIds: ['c1'],
    batchIds: ['b1'],
    isActive: true,
    stageId: new Types.ObjectId(stageId),
    assignedTo,
    ...extra,
  });
  await m.EnrolledLead.insertMany([
    student(BDA_1, enrolled),
    student(BDA_1, enrolled),
    student(BDA_1, second),
    student(BDA_2, second, { isActive: false }),
    student(MANAGER, enrolled),
    student(OUTSIDER, enrolled),
    student(null, second),
    // other batch – never counted
    { ...student(BDA_1, enrolled), batchIds: ['b2'] },
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('enrolled students by stage report', () => {
  it('default view: every batch × stage, no filters needed', async () => {
    const [enrolled, second] = stageIds;
    const r: any = await report.stageReport({}, ADMIN);
    expect(r.groupBy).toBe('batch');
    expect(r.totals.total).toBe(8); // includes the b2 student
    const b1 = r.rows.find((x: any) => x.batchId === 'b1');
    expect(b1).toMatchObject({ batchCode: 'PSY-NOW', courseName: 'Psychology', total: 7 });
    expect(b1.byStage).toEqual({ [enrolled]: 4, [second]: 3 });
    expect(r.rows.find((x: any) => x.batchId === 'b2').total).toBe(1);

    const onlyB1: any = await report.stageReport({ batchId: 'b1' }, ADMIN);
    expect(onlyB1.rows.map((x: any) => x.batchId)).toEqual(['b1']);

    const scoped: any = await report.stageReport({}, MGR);
    expect(scoped.totals.total).toBe(6); // team students in b1 (5) + Asha's b2 student
  });

  it('refuses users without report or enrolled-leads access', async () => {
    await expect(report.stageReport({}, NOBODY)).rejects.toThrow('do not have access');
  });

  it('admin: every counsellor with students, per stage, plus the unassigned bucket', async () => {
    const r: any = await report.stageReport({ groupBy: 'counsellor', courseId: 'c1', batchId: 'b1' }, ADMIN);
    const [enrolled, second] = stageIds;
    expect(r.course.name).toBe('Psychology');
    expect(r.batch.code).toBe('PSY-NOW');
    expect(r.totals.total).toBe(7);
    expect(r.totals.active).toBe(6);
    expect(r.totals.assigned).toBe(6);
    expect(r.totals.byStage[enrolled]).toBe(4);
    expect(r.totals.byStage[second]).toBe(3);
    expect(r.unassigned).toEqual({ total: 1, byStage: { [second]: 1 } });
    const asha = r.rows.find((x: any) => x.name === 'Asha')!;
    expect(asha).toMatchObject({ total: 3, level: 1, roleName: 'BDA', teamSize: 1 });
    expect(asha.byStage).toEqual({ [enrolled]: 2, [second]: 1 });
    expect(r.rows[0].name).toBe('Asha'); // sorted by total
  });

  it('level filter + team view rolls each person up with their team', async () => {
    const lvl2: any = await report.stageReport({ groupBy: 'counsellor', courseId: 'c1', batchId: 'b1', level: '2' }, ADMIN);
    expect(lvl2.rows.map((x: any) => x.name)).toEqual(['Manager']);
    expect(lvl2.rows[0].total).toBe(1);

    const team: any = await report.stageReport({ groupBy: 'counsellor', courseId: 'c1', batchId: 'b1', level: '2', team: 'true' }, ADMIN);
    expect(team.rows[0]).toMatchObject({ name: 'Manager', total: 5, teamSize: 3 });
  });

  it('active filter narrows the counts', async () => {
    const r: any = await report.stageReport({ groupBy: 'counsellor', courseId: 'c1', batchId: 'b1', active: 'inactive' }, ADMIN);
    expect(r.totals.total).toBe(1);
    expect(r.rows.map((x: any) => x.name)).toEqual(['Bala']);
  });

  it('non-admin sees only self + team, no unassigned bucket', async () => {
    const r: any = await report.stageReport({ groupBy: 'counsellor', courseId: 'c1', batchId: 'b1' }, MGR);
    expect(r.totals.total).toBe(5);
    expect(r.unassigned).toBeNull();
    expect(r.rows.map((x: any) => x.name).sort()).toEqual(['Asha', 'Bala', 'Manager']);
  });

  it('drill-down lists the students of a cell, with team roll-up and scope', async () => {
    const [enrolled] = stageIds;
    const cell = await report.stageReportStudents({ courseId: 'c1', batchId: 'b1', userId: BDA_1.toString(), stageId: enrolled }, ADMIN);
    expect(cell.total).toBe(2);
    expect((cell.data[0] as any).assignedTo.name).toBe('Asha');

    const teamCell = await report.stageReportStudents({ courseId: 'c1', batchId: 'b1', userId: MANAGER.toString(), team: 'true' }, ADMIN);
    expect(teamCell.total).toBe(5);

    const unassigned = await report.stageReportStudents({ courseId: 'c1', batchId: 'b1', userId: 'unassigned' }, ADMIN);
    expect(unassigned.total).toBe(1);

    await expect(
      report.stageReportStudents({ courseId: 'c1', batchId: 'b1', userId: OUTSIDER.toString() }, MGR),
    ).rejects.toThrow('outside your team');
  });
});

describe('leads table sorting', () => {
  const pool = oid();
  const stage = oid();

  beforeAll(async () => {
    await m.Lead.insertMany([
      { leadId: 1, name: 'charlie', phone: '1', stageId: stage, poolId: pool, createdAt: new Date('2026-01-01') },
      { leadId: 2, name: 'Alpha', phone: '2', stageId: stage, poolId: pool, createdAt: new Date('2026-01-03') },
      { leadId: 3, name: 'bravo', phone: '3', stageId: stage, poolId: pool, createdAt: new Date('2026-01-02') },
    ]);
  });

  const names = async (sort: string) => {
    const spec = leadSortSpec(sort);
    const rows = await m.Lead.find({ leadId: { $in: [1, 2, 3] } }).sort(spec.sort).collation(spec.collation).lean();
    return rows.map((r: any) => r.name);
  };

  it('a call log keeps Lead.lastCallAt at the latest call', async () => {
    const user = oid();
    await m.CallLog.create({ leadId: 1, userId: user, createdAt: new Date('2026-02-05') });
    await m.CallLog.create({ leadId: 3, userId: user, createdAt: new Date('2026-02-01') });
    await m.CallLog.create({ leadId: 1, userId: user, createdAt: new Date('2026-02-03') }); // older – ignored
    // hook is fire-and-forget
    await new Promise((r) => setTimeout(r, 300));
    const l1: any = await m.Lead.findOne({ leadId: 1 }).lean();
    const l3: any = await m.Lead.findOne({ leadId: 3 }).lean();
    expect(new Date(l1.lastCallAt).toISOString()).toBe('2026-02-05T00:00:00.000Z');
    expect(new Date(l3.lastCallAt).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('sorts by name A–Z / Z–A (case-insensitive), created date and last call', async () => {
    expect(await names('name_asc')).toEqual(['Alpha', 'bravo', 'charlie']);
    expect(await names('name_desc')).toEqual(['charlie', 'bravo', 'Alpha']);
    expect(await names('new')).toEqual(['Alpha', 'bravo', 'charlie']);
    expect(await names('old')).toEqual(['charlie', 'bravo', 'Alpha']);
    expect(await names('last_call_desc')).toEqual(['charlie', 'bravo', 'Alpha']);
    expect(await names('last_call_asc')).toEqual(['Alpha', 'bravo', 'charlie']);
  });
});
