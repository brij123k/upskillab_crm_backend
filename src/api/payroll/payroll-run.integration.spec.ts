/**
 * HR module: auto-TDS / insurance rules, templates, % increments, monthly
 * payroll (calculate → review → submit → approve → pay → payslip), payroll
 * report, exit management, documents and expenses.
 */
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  PayrollAdjustment,
  PayrollAdjustmentSchema,
  PayrollAuditLog,
  PayrollAuditLogSchema,
  PayrollEntry,
  PayrollEntrySchema,
  PayrollRun,
  PayrollRunSchema,
  PayrollSettings,
  PayrollSettingsSchema,
  SalaryRevision,
  SalaryRevisionSchema,
  SalaryStructure,
  SalaryStructureSchema,
  SalaryTemplate,
  SalaryTemplateSchema,
} from 'src/schema/payroll/payroll.schema';
import {
  EmployeeDocument,
  EmployeeDocumentSchema,
  ExitRequest,
  ExitRequestSchema,
  ExpenseClaim,
  ExpenseClaimSchema,
} from 'src/schema/hr/hr.schema';
import {
  DEFAULT_COMPONENTS,
  DEFAULT_STATUTORY,
  PayrollRules,
  amountInWords,
  calculateMonthlyPay,
  calculateSalary,
} from './payroll-calc';
import { PayrollService } from './payroll.service';
import { PayrollRunService } from './payroll-run.service';
import { HrService } from '../hr/hr.service';
import { User, UserSchema } from 'src/schema/user.schema';

const RULES: PayrollRules = { version: 1, components: DEFAULT_COMPONENTS, statutory: DEFAULT_STATUTORY };

describe('payroll rules (pure)', () => {
  it('no PF opted → 2% TDS of gross automatically; manual TDS wins', () => {
    const b = calculateSalary(RULES, { annualCtc: 360000, pfApplicable: false });
    const tds = b.deductions.find((d) => d.key === 'tds')!;
    expect(b.deductions.find((d) => d.key === 'pf')).toBeUndefined();
    expect(tds.monthly).toBe(600); // 2% of 30,000
    expect(b.tdsAuto).toBe(true);
    const manual = calculateSalary(RULES, { annualCtc: 360000, pfApplicable: false, tdsMonthly: 1000 });
    expect(manual.deductions.find((d) => d.key === 'tds')!.monthly).toBe(1000);
    expect(manual.tdsAuto).toBe(false);
    // PF opted → no auto TDS
    expect(calculateSalary(RULES, { annualCtc: 360000 }).deductions.find((d) => d.key === 'tds')).toBeUndefined();
  });

  it('optional insurance (per year) is recovered monthly', () => {
    const b = calculateSalary(RULES, { annualCtc: 600000, insuranceAnnual: 12000 });
    expect(b.deductions.find((d) => d.key === 'insurance')).toMatchObject({ monthly: 1000, annual: 12000 });
  });

  it('monthly pay: LOP prorates earnings, PF/PT recomputed, adjustments added', () => {
    const b = calculateSalary(RULES, { annualCtc: 600000, ptState: 'Maharashtra' });
    const pay = calculateMonthlyPay(
      { breakup: b, rules: RULES, ptState: 'Maharashtra' },
      {
        daysInMonth: 30,
        lopDays: 3,
        month: 11,
        adjustments: [
          { id: 'a1', type: 'incentive', kind: 'earning', name: 'Incentive', amount: 5000 },
          { id: 'a2', type: 'arrear', kind: 'earning', name: 'Arrear', amount: 1000 },
          { id: 'a3', type: 'recovery', kind: 'deduction', name: 'Laptop damage', amount: 500 },
        ],
      },
    );
    expect(pay.payableDays).toBe(27);
    expect(pay.earnings.find((e) => e.key === 'basic')).toMatchObject({ reference: 20000, amount: 18000 });
    expect(pay.grossEarnings).toBe(45000 + 5000 + 1000);
    expect(pay.earnings.find((e) => e.key === 'adj_a2')).toMatchObject({ amount: 0, arrear: 1000 });
    expect(pay.deductions.find((d) => d.key === 'pf')!.amount).toBe(1800); // basic 18,000 capped at 15,000
    expect(pay.deductions.find((d) => d.key === 'pt')!.amount).toBe(200);
    expect(pay.deductions.find((d) => d.key === 'adj_a3')!.amount).toBe(500);
    expect(pay.netPay).toBe(51000 - 1800 - 200 - 500);
  });

  it('net pay in words (Indian numbering)', () => {
    expect(amountInWords(125050)).toBe('One Lakh Twenty Five Thousand Fifty Rupees Only');
    expect(amountInWords(0)).toBe('Zero Rupees Only');
  });
});

describe('monthly payroll + HR (database)', () => {
  let mongo: MongoMemoryServer;
  let payroll: PayrollService;
  let runs: PayrollRunService;
  let hr: HrService;
  const m: Record<string, Model<any>> = {};
  const ADMIN = { userId: new Types.ObjectId().toString(), roleName: 'Admin', permissions: [] };
  const RUNNER = { userId: new Types.ObjectId().toString(), roleName: 'hr', permissions: [{ module: 'payroll', actions: ['run_payroll', 'approve_payroll'] }] };
  const APPROVER = { userId: new Types.ObjectId().toString(), roleName: 'bd', permissions: [{ module: 'payroll', actions: ['approve_payroll', 'manage_payments', 'payslips', 'reports'] }] };
  const HR = { userId: new Types.ObjectId().toString(), roleName: 'hr', permissions: [{ module: 'hr', actions: ['approve_exit', 'manage_expenses', 'reports'] }] };
  const EMP = new Types.ObjectId();
  const EMP2 = new Types.ObjectId();
  const MANAGER = new Types.ObjectId();
  const asUser = (id: Types.ObjectId) => ({ userId: String(id), roleName: 'bd', permissions: [] });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'payroll_run_test' });
    const reg = (name: string, schema: any) => {
      m[name] = mongoose.models[name] || mongoose.model(name, schema);
    };
    reg(PayrollSettings.name, PayrollSettingsSchema);
    reg(SalaryStructure.name, SalaryStructureSchema);
    reg(SalaryRevision.name, SalaryRevisionSchema);
    reg(PayrollAuditLog.name, PayrollAuditLogSchema);
    reg(SalaryTemplate.name, SalaryTemplateSchema);
    reg(PayrollRun.name, PayrollRunSchema);
    reg(PayrollEntry.name, PayrollEntrySchema);
    reg(PayrollAdjustment.name, PayrollAdjustmentSchema);
    reg(ExitRequest.name, ExitRequestSchema);
    reg(EmployeeDocument.name, EmployeeDocumentSchema);
    reg(ExpenseClaim.name, ExpenseClaimSchema);
    reg(User.name, UserSchema);
    await Promise.all(Object.values(m).map((x) => x.init()));
    payroll = new PayrollService(m.PayrollSettings, m.SalaryStructure, m.SalaryRevision, m.PayrollAuditLog, m.SalaryTemplate);
    runs = new PayrollRunService(m.PayrollRun, m.PayrollEntry, m.PayrollAdjustment, m.SalaryStructure, payroll);
    hr = new HrService(m.ExitRequest, m.EmployeeDocument, m.ExpenseClaim, { uploadFile: async () => ({ url: 'x' }) } as any);

    const db = mongoose.connection.db!;
    await db.collection('users').insertMany([
      { _id: EMP, name: 'Riya', email: 'riya@x.io', employeeId: 201, status: 'active' },
      { _id: EMP2, name: 'Aman', email: 'aman@x.io', employeeId: 202, status: 'active' },
      { _id: MANAGER, name: 'Neha', email: 'neha@x.io', employeeId: 200, status: 'active' },
    ]);
    await db.collection('profiles').insertMany([
      { userId: EMP, reportingSeniorId: MANAGER, currentAddress: { state: 'Maharashtra' }, bankDetails: { bankName: 'HDFC', accountNumber: '123456789012' }, personalDetails: { panNumber: 'ABCDE1234F' } },
      { userId: EMP2, reportingSeniorId: MANAGER },
      { userId: MANAGER },
    ]);
    // Structures from 1 Oct 2026
    await payroll.applyOnboardingCtc(String(EMP), { annualCtc: 600000, ptState: 'Maharashtra', effectiveFrom: '2026-10-01' } as any, ADMIN);
    await payroll.applyOnboardingCtc(String(EMP2), { annualCtc: 360000, pfApplicable: false, effectiveFrom: '2026-10-01' } as any, ADMIN);
    // October attendance for Riya: 2 absent + 1 half day → 2.5 LOP
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 0, 0, 0) - 5.5 * 3600_000);
    await db.collection('attendances').insertMany([
      { userId: EMP, date: day(5), status: 'absent', loginTime: day(5) },
      { userId: EMP, date: day(6), status: 'absent', loginTime: day(6) },
      { userId: EMP, date: day(7), status: 'half_day', loginTime: day(7) },
      { userId: EMP, date: day(8), status: 'present', loginTime: day(8) },
    ]);
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('templates: own % split is used for structures created from them', async () => {
    const t: any = await payroll.createTemplate(
      {
        name: 'Sales Executive',
        defaultAnnualCtc: 480000,
        components: [
          { key: 'basic', name: 'Basic', percent: 50, pfEligible: true },
          { key: 'hra', name: 'HRA', percent: 25 },
          { key: 'special', name: 'Special', percent: 25, balancing: true },
        ],
        insuranceAnnual: 6000,
      },
      ADMIN,
    );
    await expect(payroll.createTemplate({ name: 'Sales Executive' }, ADMIN)).rejects.toThrow('already exists');
    await expect(payroll.createTemplate({ name: 'Bad', components: [{ key: 'basic', name: 'Basic', percent: 90, pfEligible: true }] }, ADMIN)).rejects.toThrow('100%');
    const b: any = await payroll.preview({ annualCtc: 480000, templateId: String(t._id), insuranceAnnual: 6000 } as any);
    expect(b.earnings.find((e: any) => e.key === 'basic').monthly).toBe(20000);
    expect(b.deductions.find((d: any) => d.key === 'insurance').monthly).toBe(500);
    expect(b.componentsCustomized).toBe(false);
    // Per-employee change of the template split (template itself untouched).
    const custom = [
      { key: 'basic', name: 'Basic', percent: 60, pfEligible: true },
      { key: 'hra', name: 'HRA', percent: 20 },
      { key: 'special', name: 'Special', percent: 20, balancing: true },
    ];
    const c: any = await payroll.preview({ annualCtc: 480000, templateId: String(t._id), customComponents: custom } as any);
    expect(c.earnings.find((e: any) => e.key === 'basic').monthly).toBe(24000);
    expect(c.componentsCustomized).toBe(true);
    await expect(
      payroll.preview({ annualCtc: 480000, templateId: String(t._id), customComponents: [{ key: 'basic', name: 'Basic', percent: 70, pfEligible: true }] } as any),
    ).rejects.toThrow('100%');
    const list: any[] = await payroll.listTemplates(ADMIN);
    expect(list.map((x) => x.name)).toEqual(['Sales Executive']);
  });

  it('calculates October: LOP from attendance, auto TDS for the no-PF employee', async () => {
    const res: any = await runs.calculate({ month: '2026-10' }, RUNNER);
    expect(res.calculated).toBe(2);
    expect(res.skipped.map((s: any) => s.name)).toEqual(['Neha']); // no structure
    const { entries }: any = await runs.getRun('2026-10', RUNNER);
    const riya = entries.find((e: any) => String(e.employeeId) === String(EMP));
    expect(riya.lopDays).toBe(2.5);
    expect(riya.daysInMonth).toBe(31);
    expect(riya.employee).toMatchObject({ name: 'Riya', bankName: 'HDFC', accountMasked: 'XXXXXXXX9012', pan: 'ABCDE1234F' });
    const aman = entries.find((e: any) => String(e.employeeId) === String(EMP2));
    expect(aman.deductions.find((d: any) => d.key === 'tds').amount).toBe(600);
  });

  it('review → submit → maker cannot approve → approver approves', async () => {
    const { entries }: any = await runs.getRun('2026-10', RUNNER);
    const riya = entries.find((e: any) => String(e.employeeId) === String(EMP));
    const changed: any = await runs.updateEntry(String(riya._id), { lopDays: 0, reviewStatus: 'reviewed' }, RUNNER);
    expect(changed.lopOverridden).toBe(true);
    expect(changed.grossEarnings).toBe(50000);
    await expect(runs.submit('2026-10', {}, RUNNER)).rejects.toThrow('not reviewed');
    await runs.markAllReviewed('2026-10', RUNNER);
    // Recalculation keeps the LOP typed by HR
    await runs.calculate({ month: '2026-10' }, RUNNER);
    const again: any = (await runs.getRun('2026-10', RUNNER)).entries.find((e: any) => String(e.employeeId) === String(EMP));
    expect(again.lopDays).toBe(0);
    await runs.submit('2026-10', {}, RUNNER);
    await expect(runs.approve('2026-10', {}, RUNNER)).rejects.toThrow('cannot approve');
    const approved: any = await runs.approve('2026-10', {}, APPROVER);
    expect(approved.status).toBe('approved');
    await expect(runs.calculate({ month: '2026-10' }, RUNNER)).rejects.toThrow('Reopen');
  });

  it('salary payments: manual incentive → approve → paid → payroll closed', async () => {
    const res: any = await runs.createAdjustment({ month: '2026-10', employeeId: String(EMP), type: 'incentive', amount: 2500, name: 'Sales incentive' }, APPROVER, 'salary_payments');
    expect(res.recalculated).toBe(true);
    const pay: any = await runs.payments('2026-10', APPROVER);
    const riya = pay.entries.find((e: any) => String(e.employeeId) === String(EMP));
    expect(riya.grossEarnings).toBe(52500);
    const ids = pay.entries.map((e: any) => String(e._id));
    expect((await runs.approvePayments({ entryIds: ids }, APPROVER)).updated).toBe(2);
    expect((await runs.markPaid({ entryIds: ids, reference: 'UTR1' }, APPROVER)).updated).toBe(2);
    expect((await runs.getRun('2026-10', APPROVER)).run.status).toBe('closed');
    await expect(
      runs.createAdjustment({ month: '2026-10', employeeId: String(EMP), type: 'bonus', amount: 100 }, APPROVER),
    ).rejects.toThrow('already paid');
  });

  it('payslips: generated after approval, YTD, own access only', async () => {
    expect((await runs.generatePayslips({ month: '2026-10' }, APPROVER)).generated).toBe(2);
    const mine: any[] = await runs.myPayslips(asUser(EMP));
    expect(mine).toHaveLength(1);
    const slip: any = await runs.payslip(String(mine[0]._id), asUser(EMP));
    expect(slip.monthLabel).toBe('October 2026');
    expect(slip.payslipNumber).toMatch(/^UPS\/202610\/\d{4}$/);
    expect(slip.totals.gross).toBe(52500);
    expect(slip.earnings.find((e: any) => e.name === 'Sales incentive')).toMatchObject({ amount: 2500, ytd: 2500 });
    expect(slip.netPayInWords).toContain('Rupees Only');
    expect(slip.totals.totalCtc).toBe(52500 + 1800);
    await expect(runs.payslip(String(mine[0]._id), asUser(EMP2))).rejects.toThrow('own payslips');
  });

  it('% increment creates history; payroll report sums the month', async () => {
    const res: any = await payroll.incrementSalaries({ employeeIds: [String(EMP), String(EMP2)], percent: 10, effectiveFrom: '2026-11-01', approveNow: true }, ADMIN);
    expect(res).toMatchObject({ done: 2, failed: 0, approved: true });
    const hist: any[] = await payroll.revisionHistory(ADMIN, { from: '2026-11-01', to: '2026-11-30' });
    expect(hist.find((h) => String(h.employeeId._id) === String(EMP))).toMatchObject({ oldAnnualCtc: 600000, newAnnualCtc: 660000, changePercent: 10, status: 'approved' });
    const asOfOct: any[] = await payroll.listEmployees(ADMIN, 'active', '2026-10-15');
    expect(asOfOct.find((r) => r._id === String(EMP)).annualCtc).toBe(600000);
    const report: any = await runs.payrollReport(APPROVER, { from: '2026-04', to: '2026-12' });
    expect(report.months).toHaveLength(1);
    expect(report.summary.gross).toBe(52500 + 30000);
    expect(report.employees.find((e: any) => e.name === 'Aman').tds).toBe(600);
  });

  it('exit: employee requests, HR approves → account inactive', async () => {
    const lwd = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const req: any = await hr.createExit({ reasonCategory: 'Higher studies', reason: 'MBA', lastWorkingDay: lwd }, asUser(EMP2));
    await expect(hr.createExit({ reasonCategory: 'Other', reason: 'x', lastWorkingDay: lwd }, asUser(EMP2))).rejects.toThrow('already');
    await expect(hr.decideExit(String(req._id), { decision: 'approve' }, asUser(EMP))).rejects.toThrow('cannot approve');
    const done: any = await hr.decideExit(String(req._id), { decision: 'approve', deactivateMode: 'now' }, HR);
    expect(done).toMatchObject({ status: 'approved', deactivated: true });
    const user = await mongoose.connection.db!.collection('users').findOne({ _id: EMP2 });
    expect(user!.status).toBe('inactive');
  });

  it('documents: a reporting senior can upload for the team only', async () => {
    const mgr = asUser(MANAGER);
    await hr.createDocument({ employeeId: String(EMP), type: 'increment_letter', title: 'Increment 2026', fileUrl: 'https://f/x.pdf' }, mgr);
    await expect(hr.createDocument({ employeeId: String(MANAGER), type: 'other', title: 'x', fileUrl: 'u' }, asUser(EMP))).rejects.toThrow('only for your team');
    const mine: any[] = await hr.listDocuments(asUser(EMP), { mine: 'true' });
    expect(mine).toHaveLength(1);
    expect(mine[0].uploadedBy.name).toBe('Neha');
  });

  it('expenses: submit → approve (partial) → paid', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const e: any = await hr.createExpense({ title: 'Cab', category: 'travel', amount: 900, expenseDate: yesterday }, asUser(EMP));
    await expect(hr.decideExpense(String(e._id), { decision: 'approve' }, asUser(EMP))).rejects.toThrow('cannot approve');
    await expect(hr.payExpense(String(e._id), {}, HR)).rejects.toThrow('Only approved');
    const ok: any = await hr.decideExpense(String(e._id), { decision: 'approve', approvedAmount: 800 }, HR);
    expect(ok).toMatchObject({ status: 'approved', approvedAmount: 800 });
    const paid: any = await hr.payExpense(String(e._id), { paymentReference: 'UTR9' }, HR);
    expect(paid.status).toBe('paid');
    await expect(hr.createExpense({ title: 'Courier', category: 'other', amount: 100, expenseDate: yesterday }, asUser(EMP))).rejects.toThrow('Specify');
    const o: any = await hr.createExpense({ title: 'Courier', category: 'other', otherCategory: 'Courier charges', amount: 100, expenseDate: yesterday }, asUser(EMP));
    expect(o.otherCategory).toBe('Courier charges');
    const list: any = await hr.listExpenses(asUser(EMP), {});
    expect(list.totals.paidAmount).toBe(800);
    expect(list.canManage).toBe(false);
  });
});
