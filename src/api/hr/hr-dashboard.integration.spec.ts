/**
 * HR dashboard (hr:dashboard): any role can be given it; the numbers cover
 * every employee with "HR All Users" (user:all_users), otherwise only the
 * user and their team.
 */
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  EmployeeDocument,
  EmployeeDocumentSchema,
  ExitRequest,
  ExitRequestSchema,
  ExpenseClaim,
  ExpenseClaimSchema,
} from 'src/schema/hr/hr.schema';
import { HrService } from './hr.service';

const MGR = new Types.ObjectId();
const TEAM1 = new Types.ObjectId();
const OTHER = new Types.ObjectId();

const actor = (permissions: any[], id = MGR) => ({ userId: String(id), roleName: 'bd', permissions });

describe('HR dashboard', () => {
  let mongo: MongoMemoryServer;
  let hr: HrService;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'hr_dashboard_test' });
    const exitModel = mongoose.model(ExitRequest.name, ExitRequestSchema) as unknown as Model<ExitRequest>;
    const docModel = mongoose.model(EmployeeDocument.name, EmployeeDocumentSchema) as unknown as Model<EmployeeDocument>;
    const expModel = mongoose.model(ExpenseClaim.name, ExpenseClaimSchema) as unknown as Model<ExpenseClaim>;
    hr = new HrService(exitModel, docModel, expModel, { uploadFile: async () => ({ url: 'x' }) } as any);

    const db = mongoose.connection.db!;
    await db.collection('users').insertMany([
      { _id: MGR, name: 'Manager', employeeId: 1, status: 'active', createdAt: new Date('2024-01-10') },
      { _id: TEAM1, name: 'Team One', employeeId: 2, status: 'active', createdAt: new Date(), onboarding: { status: 'submitted' } },
      { _id: OTHER, name: 'Other', employeeId: 3, status: 'active', isBlocked: true, createdAt: new Date('2023-02-01') },
    ]);
    await db.collection('profiles').insertMany([
      { userId: MGR },
      { userId: TEAM1, reportingSeniorId: MGR },
      { userId: OTHER },
    ]);
    await expModel.create([
      { employeeId: OTHER, category: 'travel', title: 'Cab', expenseDate: '2026-11-01', amount: 500, description: 'x', status: 'submitted' } as any,
    ]).catch(() => undefined);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('is refused without hr:dashboard', async () => {
    await expect(hr.dashboard(actor([{ module: 'user', actions: ['read'] }]))).rejects.toThrow('HR dashboard');
  });

  it('without HR All Users it only counts the user and their team', async () => {
    const d: any = await hr.dashboard(actor([{ module: 'hr', actions: ['dashboard'] }]));
    expect(d.scope).toBe('team');
    expect(d.headcount.total).toBe(2);
    expect(d.headcount.blocked).toBe(0);
    expect(d.onboarding.awaitingReview).toBe(1);
  });

  it('with HR All Users it counts every employee', async () => {
    const d: any = await hr.dashboard(
      actor([
        { module: 'hr', actions: ['dashboard'] },
        { module: 'user', actions: ['all_users'] },
      ]),
    );
    expect(d.scope).toBe('all');
    expect(d.headcount.total).toBe(3);
    expect(d.headcount.blocked).toBe(1);
    expect(d.attendanceToday.total).toBe(3);
  });

  it('admin sees everything and access() reports the flags', async () => {
    const admin = { userId: String(MGR), roleName: 'Admin', permissions: [] };
    expect(((await hr.dashboard(admin)) as any).scope).toBe('all');
    const a: any = await hr.access(actor([{ module: 'hr', actions: ['dashboard'] }]));
    expect(a).toMatchObject({ dashboard: true, allUsers: false, hasTeam: true });
  });
});
