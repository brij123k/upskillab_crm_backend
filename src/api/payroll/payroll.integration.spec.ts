/**
 * Payroll Phase 1: CTC breakup (client's component table), PF / ESI / PT,
 * salary structures, revisions, onboarding hook, profile salary sync.
 */
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  PayrollAuditLog,
  PayrollAuditLogSchema,
  PayrollSettings,
  PayrollSettingsSchema,
  SalaryRevision,
  SalaryRevisionSchema,
  SalaryStructure,
  SalaryStructureSchema,
  SalaryTemplate,
  SalaryTemplateSchema,
} from 'src/schema/payroll/payroll.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { DEFAULT_COMPONENTS, DEFAULT_STATUTORY, PayrollRules, calculateSalary, validateRules } from './payroll-calc';
import { PayrollService } from './payroll.service';

const RULES: PayrollRules = { version: 1, components: DEFAULT_COMPONENTS, statutory: DEFAULT_STATUTORY };

describe('CTC breakup (pure)', () => {
  it('splits CTC by the client table: Basic 40, HRA 20, Special 25, Conveyance 5, Medical 5, Other 5', () => {
    const b = calculateSalary(RULES, { annualCtc: 600000 });
    expect(b.monthlyCtc).toBe(50000);
    expect(Object.fromEntries(b.earnings.map((e) => [e.key, e.monthly]))).toEqual({
      basic: 20000, hra: 10000, special: 12500, conveyance: 2500, medical: 2500, other: 2500,
    });
    expect(b.grossMonthly).toBe(50000); // Total Gross = 100% of CTC
    expect(b.grossAnnual).toBe(600000);
  });

  it('PF = 12% of Basic capped at ₹15,000; no ESI above ₹21,000 gross; PT by state', () => {
    const b = calculateSalary(RULES, { annualCtc: 600000, ptState: 'maharashtra' });
    const d = Object.fromEntries(b.deductions.map((x) => [x.key, x]));
    expect(d.pf.monthly).toBe(1800); // 12% of 15,000 (basic 20,000 capped)
    expect(d.esi).toBeUndefined();
    expect(d.pt.monthly).toBe(200);
    expect(d.pt.annual).toBe(200 * 11 + 300); // February ₹300
    expect(b.netMonthly).toBe(50000 - 1800 - 200);
    expect(b.employerContributions.find((x) => x.key === 'pf_employer')!.monthly).toBe(1800);
  });

  it('ESI 0.75% when gross ≤ ₹21,000; PF on actual basic below the cap; TDS and other deductions', () => {
    const b = calculateSalary(RULES, {
      annualCtc: 216000, // 18,000 / month
      ptState: 'Karnataka',
      tdsMonthly: 0,
      otherDeductions: [{ name: 'Canteen', amount: 300 }],
    });
    const d = Object.fromEntries(b.deductions.map((x) => [x.key, x.monthly]));
    expect(d.pf).toBe(864); // 12% of 7,200
    expect(d.esi).toBe(135); // 0.75% of 18,000
    expect(d.pt).toBeUndefined(); // Karnataka: below 25,000
    expect(d.other_1).toBe(300);
    expect(b.esiApplicable).toBe(true);
    expect(b.employerContributions.find((x) => x.key === 'esi_employer')!.monthly).toBe(585); // 3.25%
  });

  it('rounding: earnings always add up to the monthly CTC exactly', () => {
    const b = calculateSalary(RULES, { annualCtc: 523457 });
    expect(b.earnings.reduce((s, e) => s + e.monthly, 0)).toBe(b.monthlyCtc);
  });

  it('PF opt-out and uncapped PF', () => {
    expect(calculateSalary(RULES, { annualCtc: 600000, pfApplicable: false }).deductions.find((d) => d.key === 'pf')).toBeUndefined();
    const uncapped = calculateSalary({ ...RULES, statutory: { ...DEFAULT_STATUTORY, pf: { ...DEFAULT_STATUTORY.pf, capAtCeiling: false } } }, { annualCtc: 600000 });
    expect(uncapped.deductions.find((d) => d.key === 'pf')!.monthly).toBe(2400);
  });

  it('rules validation: components must total 100%', () => {
    expect(validateRules({ components: DEFAULT_COMPONENTS, statutory: DEFAULT_STATUTORY })).toEqual([]);
    const bad = DEFAULT_COMPONENTS.map((c) => (c.key === 'basic' ? { ...c, percent: 45 } : c));
    expect(validateRules({ components: bad, statutory: DEFAULT_STATUTORY })[0]).toContain('105%');
  });
});

describe('salary structures (database)', () => {
  let mongo: MongoMemoryServer;
  let service: PayrollService;
  const m: Record<string, Model<any>> = {};
  const ADMIN = { userId: new Types.ObjectId().toString(), roleName: 'Admin', permissions: [] };
  const VIEWER = { userId: new Types.ObjectId().toString(), roleName: 'bd', permissions: [{ module: 'payroll', actions: ['read'] }] };
  const EMP = new Types.ObjectId();

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'payroll_test' });
    const reg = (name: string, schema: any) => {
      m[name] = mongoose.models[name] || mongoose.model(name, schema);
    };
    reg(PayrollSettings.name, PayrollSettingsSchema);
    reg(SalaryStructure.name, SalaryStructureSchema);
    reg(SalaryRevision.name, SalaryRevisionSchema);
    reg(PayrollAuditLog.name, PayrollAuditLogSchema);
    reg(SalaryTemplate.name, SalaryTemplateSchema);
    reg(User.name, UserSchema);
    await Promise.all(Object.values(m).map((x) => x.init()));
    service = new PayrollService(m.PayrollSettings, m.SalaryStructure, m.SalaryRevision, m.PayrollAuditLog, m.SalaryTemplate);
    const db = mongoose.connection.db!;
    await db.collection('users').insertOne({ _id: EMP, name: 'Riya', email: 'riya@x.io', number: '9000000101', employeeId: 101, status: 'active' });
    await db.collection('profiles').insertOne({ userId: EMP, salary: 0, currentAddress: { state: 'Maharashtra' } });
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  const profileSalary = async () => (await mongoose.connection.db!.collection('profiles').findOne({ userId: EMP }))!.salary;

  it('creates default rules on first use; only permitted users can change them', async () => {
    const rules = await service.getSettings(ADMIN);
    expect(rules.components.map((c: any) => c.percent)).toEqual([40, 20, 25, 5, 5, 5]);
    await expect(service.updateSettings({ components: rules.components, statutory: rules.statutory }, VIEWER)).rejects.toThrow('permission');
    await expect(
      service.updateSettings({ components: [{ key: 'basic', name: 'Basic', percent: 50, pfEligible: true }], statutory: rules.statutory }, ADMIN),
    ).rejects.toThrow('100%');
  });

  it('onboarding approval saves an approved structure and sets the monthly salary', async () => {
    const s: any = await service.applyOnboardingCtc(String(EMP), { annualCtc: 600000, ptState: 'Maharashtra', effectiveFrom: '2026-11-01' } as any, ADMIN);
    expect(s.status).toBe('approved');
    expect(s.source).toBe('onboarding');
    expect(s.breakup.grossMonthly).toBe(50000);
    expect(await profileSalary()).toBe(50000);
    const revs: any[] = await service.listRevisions(String(EMP), ADMIN);
    expect(revs[0]).toMatchObject({ status: 'approved', newAnnualCtc: 600000, oldAnnualCtc: 0, changePercent: null });
  });

  it('revision: draft → edit → approve; old structures keep their own rules', async () => {
    const before = await service.getRules();
    // change rules: Basic 50 / Special 15
    const changed = before.components.map((c: any) => (c.key === 'basic' ? { ...c, percent: 50 } : c.key === 'special' ? { ...c, percent: 15 } : c));
    await service.updateSettings({ components: changed, statutory: before.statutory }, ADMIN);

    const { structure, revision } = await service.createRevision(
      { employeeId: String(EMP), annualCtc: 660000, effectiveFrom: '2026-10-15', reason: 'Appraisal' } as any,
      ADMIN,
    );
    expect(structure.status).toBe('draft');
    expect(revision.status).toBe('pending');
    await service.updateDraft(String(structure._id), { annualCtc: 720000 }, ADMIN);
    await expect(service.approveStructure(String(structure._id), VIEWER)).rejects.toThrow('permission');
    const approved: any = await service.approveStructure(String(structure._id), ADMIN);
    expect(approved.status).toBe('approved');
    expect(approved.breakup.earnings.find((e: any) => e.key === 'basic').percent).toBe(50);

    // effective 15 Oct, but the onboarding structure from 1 Nov is later → still in force
    const current: any = await service.effectiveStructure(String(EMP));
    expect(current.source).toBe('onboarding');
    expect(current.rules.components.find((c: any) => c.key === 'basic').percent).toBe(40); // frozen
    expect(await profileSalary()).toBe(50000);
  });

  it('a later revision becomes current; the same date cannot be approved twice', async () => {
    const { structure } = await service.createRevision({ employeeId: String(EMP), annualCtc: 780000, effectiveFrom: '2026-11-10' } as any, ADMIN);
    await service.approveStructure(String(structure._id), ADMIN);
    expect(await profileSalary()).toBe(65000);
    const revs: any[] = await service.listRevisions(String(EMP), ADMIN);
    expect(revs[0]).toMatchObject({ oldAnnualCtc: 600000, newAnnualCtc: 780000, changePercent: 30, status: 'approved' });

    const dup: any = await service.createStructure({ employeeId: String(EMP), annualCtc: 800000, effectiveFrom: '2026-11-10' } as any, ADMIN);
    await expect(service.approveStructure(String(dup._id), ADMIN)).rejects.toThrow('same date');
    await service.cancelDraft(String(dup._id), ADMIN);
  });

  it('employee listing shows the current CTC; daily sync fixes a stale monthly salary', async () => {
    const rows: any[] = await service.listEmployees(VIEWER);
    expect(rows.find((r) => r._id === String(EMP))).toMatchObject({ annualCtc: 780000, grossMonthly: 65000, pendingDrafts: 0 });
    await mongoose.connection.db!.collection('profiles').updateOne({ userId: EMP }, { $set: { salary: 1 } });
    expect(await service.syncAllProfileSalaries()).toBe(1);
    expect(await profileSalary()).toBe(65000);
  });
});
