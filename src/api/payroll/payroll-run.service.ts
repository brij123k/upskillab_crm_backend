import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PAYROLL_COMPANY_ID,
  PayrollAdjustment,
  PayrollEntry,
  PayrollRun,
  PayrollRunStatus,
  SalaryStructure,
  SalaryStructureStatus,
} from 'src/schema/payroll/payroll.schema';
import { isAdminUser } from 'src/common/utils/has-permission.util';
import {
  getBusinessTimezone,
  startOfDayInTimezone,
  toDateKey,
} from '../order_management/financial/order-financial.util';
import {
  ADJUSTMENT_TYPES,
  MonthlyAdjustment,
  amountInWords,
  calculateMonthlyPay,
} from './payroll-calc';
import { PayrollService } from './payroll.service';

const oid = (v: any) => new Types.ObjectId(String(v));
const isId = (v: any) => !!v && Types.ObjectId.isValid(String(v));
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Employee statuses included in a payroll run. */
const PAYABLE_STATUSES = ['active', 'probation'];

/**
 * Monthly payroll: calculate → review (LOP, hold, remarks, adjustments) →
 * submit → approve (maker ≠ checker) → salary payments (approve / pay) →
 * payslips. Also the payroll report.
 */
@Injectable()
export class PayrollRunService {
  private readonly logger = new Logger(PayrollRunService.name);

  constructor(
    @InjectModel(PayrollRun.name) private readonly runModel: Model<PayrollRun>,
    @InjectModel(PayrollEntry.name) private readonly entryModel: Model<PayrollEntry>,
    @InjectModel(PayrollAdjustment.name) private readonly adjustmentModel: Model<PayrollAdjustment>,
    @InjectModel(SalaryStructure.name) private readonly structureModel: Model<SalaryStructure>,
    private readonly payroll: PayrollService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  private get db() {
    return this.runModel.db;
  }

  private me(user: any) {
    const id = user?.userId || user?._id;
    if (!isId(id)) throw new ForbiddenException('Invalid session');
    return String(id);
  }

  private isAdmin(user: any) {
    return isAdminUser(user) || !!user?.isSuperAdmin;
  }

  private assertMonth(month: string) {
    if (!MONTH_RE.test(month || '')) throw new BadRequestException('Month must be YYYY-MM');
  }

  private monthRange(month: string) {
    this.assertMonth(month);
    const tz = getBusinessTimezone();
    const [y, m] = month.split('-').map(Number);
    const start = startOfDayInTimezone(`${month}-01`, tz);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const end = startOfDayInTimezone(`${ny}-${String(nm).padStart(2, '0')}-01`, tz);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start, end, daysInMonth, year: y, monthNo: m };
  }

  private monthLabel(month: string) {
    const [y, m] = month.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }

  /** Financial year (April–March) months up to and including `month`. */
  private fyStart(month: string) {
    const [y, m] = month.split('-').map(Number);
    return m >= 4 ? `${y}-04` : `${y - 1}-04`;
  }

  private async actorName(user: any) {
    return user?.name || undefined;
  }

  private async pushHistory(runId: any, action: string, user: any, note?: string) {
    await this.runModel.updateOne(
      { _id: runId },
      { $push: { history: { action, by: isId(user?.userId) ? oid(user.userId) : undefined, byName: await this.actorName(user), at: new Date(), note } } },
    );
  }

  private async getRunOrThrow(month: string) {
    this.assertMonth(month);
    const run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month }).lean();
    if (!run) throw new NotFoundException(`Payroll for ${this.monthLabel(month)} has not been calculated yet`);
    return run;
  }

  private async refreshTotals(runId: any) {
    const rows = await this.entryModel.aggregate([
      { $match: { runId: oid(runId) } },
      {
        $group: {
          _id: null,
          employees: { $sum: 1 },
          gross: { $sum: '$grossEarnings' },
          deductions: { $sum: '$totalDeductions' },
          net: { $sum: '$netPay' },
          employerCost: { $sum: '$monthlyCost' },
          lopDays: { $sum: '$lopDays' },
          onHold: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'on_hold'] }, 1, 0] } },
        },
      },
    ]);
    const t = rows[0] || {};
    await this.runModel.updateOne(
      { _id: runId },
      {
        $set: {
          totals: {
            employees: t.employees || 0,
            gross: t.gross || 0,
            deductions: t.deductions || 0,
            net: t.net || 0,
            employerCost: t.employerCost || 0,
            lopDays: t.lopDays || 0,
            onHold: t.onHold || 0,
          },
        },
      },
    );
  }

  /* ------------------------------------------------------------------ */
  /* calculation                                                         */
  /* ------------------------------------------------------------------ */

  private async employeeSnapshots(ids: string[]) {
    const objIds = ids.map(oid);
    const [users, profiles, departments, roles] = await Promise.all([
      this.db.collection('users').find({ _id: { $in: objIds } }, { projection: { name: 1, employeeId: 1, email: 1, role: 1, status: 1, createdAt: 1, onboarding: 1 } }).toArray(),
      this.db.collection('profiles').find({ userId: { $in: objIds } }, { projection: { userId: 1, departmentId: 1, bankDetails: 1, personalDetails: 1, statutoryDetails: 1 } }).toArray(),
      this.db.collection('departments').find({}, { projection: { name: 1 } }).toArray(),
      this.db.collection('roles').find({}, { projection: { name: 1 } }).toArray(),
    ]);
    const tz = getBusinessTimezone();
    const dept = new Map(departments.map((d: any) => [String(d._id), d.name]));
    const role = new Map(roles.map((r: any) => [String(r._id), r.name]));
    const prof = new Map(profiles.map((p: any) => [String(p.userId), p]));
    const out = new Map<string, any>();
    for (const u of users) {
      const p: any = prof.get(String(u._id)) || {};
      const acc = String(p.bankDetails?.accountNumber || '');
      out.set(String(u._id), {
        name: u.name,
        code: u.employeeId,
        email: u.email,
        status: u.status,
        department: p.departmentId ? dept.get(String(p.departmentId)) || null : null,
        designation: role.get(String(u.role)) || null,
        bankName: p.bankDetails?.bankName || null,
        accountMasked: acc ? `${'X'.repeat(Math.max(0, acc.length - 4))}${acc.slice(-4)}` : null,
        ifsc: p.bankDetails?.ifscCode || null,
        pan: p.personalDetails?.panNumber || null,
        dateOfBirth: p.personalDetails?.dateOfBirth || null,
        dateOfJoining:
          p.statutoryDetails?.dateOfJoining ||
          (u.onboarding?.approvedAt ? toDateKey(new Date(u.onboarding.approvedAt), tz) : u.createdAt ? toDateKey(new Date(u.createdAt), tz) : null),
        uan: p.statutoryDetails?.uan || null,
        pfNumber: p.statutoryDetails?.pfNumber || null,
        esiNumber: p.statutoryDetails?.esiNumber || null,
      });
    }
    return out;
  }

  /** LOP from attendance + days before salary start / after the last working day. */
  private async attendanceFor(ids: string[], start: Date, end: Date) {
    const rows = await this.db
      .collection('attendances')
      .aggregate([
        { $match: { userId: { $in: ids.map(oid) }, date: { $gte: start, $lt: end } } },
        { $group: { _id: { u: '$userId', s: '$status' }, count: { $sum: 1 } } },
      ])
      .toArray();
    const out = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const u = String(r._id.u);
      const m = out.get(u) || {};
      m[r._id.s || 'other'] = (m[r._id.s || 'other'] || 0) + r.count;
      out.set(u, m);
    }
    return out;
  }

  private async payrollCandidates(month: string, start: Date, end: Date, only?: string[]) {
    // Employees active now, plus anyone whose approved exit falls in this month.
    const exits = await this.db
      .collection('exitrequests')
      .find({ status: 'approved', lastWorkingDay: { $gte: start } }, { projection: { employeeId: 1, lastWorkingDay: 1 } })
      .toArray();
    const exitBy = new Map(exits.map((e: any) => [String(e.employeeId), e.lastWorkingDay as Date]));
    const filter: any = { $or: [{ status: { $in: PAYABLE_STATUSES } }, { _id: { $in: exits.map((e: any) => e.employeeId) } }] };
    if (only?.length) filter._id = { $in: only.map(oid) };
    const users = await this.db.collection('users').find(filter, { projection: { _id: 1 } }).toArray();
    return { ids: users.map((u: any) => String(u._id)), exitBy };
  }

  /** Calculates one employee for a run. Returns null when there is no salary structure. */
  private async computeEntry(
    run: any,
    employeeId: string,
    ctx: { start: Date; end: Date; daysInMonth: number; monthNo: number; snapshot?: any; attendance?: Record<string, number>; lastWorkingDay?: Date | null },
    existing?: any,
  ) {
    const structure: any = await this.payroll.effectiveStructure(employeeId, new Date(ctx.end.getTime() - 1));
    if (!structure) return null;

    // Salary start: first approved structure; days before it are unpaid.
    const first: any = await this.structureModel
      .findOne({ companyId: PAYROLL_COMPANY_ID, employeeId: oid(employeeId), status: SalaryStructureStatus.APPROVED })
      .sort({ effectiveFrom: 1 })
      .select('effectiveFrom')
      .lean();
    const att = ctx.attendance || {};
    const dayMs = 86_400_000;
    let lop = (att.absent || 0) + 0.5 * (att.half_day || 0);
    const notes: string[] = [];
    if (first?.effectiveFrom && first.effectiveFrom > ctx.start) {
      const before = Math.min(ctx.daysInMonth, Math.round((first.effectiveFrom.getTime() - ctx.start.getTime()) / dayMs));
      if (before > 0) {
        lop += before;
        notes.push(`${before} day(s) before salary start`);
      }
    }
    if (ctx.lastWorkingDay && ctx.lastWorkingDay < ctx.end) {
      const after = Math.min(ctx.daysInMonth, Math.round((ctx.end.getTime() - ctx.lastWorkingDay.getTime()) / dayMs) - 1);
      if (after > 0) {
        lop += after;
        notes.push(`${after} day(s) after last working day`);
      }
    }
    lop = Math.min(ctx.daysInMonth, Math.round(lop * 2) / 2);
    const lopDays = existing?.lopOverridden ? Number(existing.lopDays) || 0 : lop;

    const adjustments = await this.adjustmentModel
      .find({ companyId: PAYROLL_COMPANY_ID, month: run.month, employeeId: oid(employeeId), status: 'active' })
      .lean();
    const adj: MonthlyAdjustment[] = adjustments.map((a: any) => ({ id: String(a._id), type: a.type, kind: a.kind, name: a.name, amount: a.amount }));

    const pay = calculateMonthlyPay(
      {
        breakup: structure.breakup,
        rules: structure.rules,
        ptState: structure.ptState,
        tdsMonthly: structure.tdsMonthly,
        insuranceAnnual: structure.insuranceAnnual,
        otherDeductions: structure.otherDeductions,
      },
      { daysInMonth: ctx.daysInMonth, lopDays, month: ctx.monthNo, adjustments: adj },
    );

    return {
      companyId: PAYROLL_COMPANY_ID,
      runId: run._id,
      month: run.month,
      employeeId: oid(employeeId),
      employee: ctx.snapshot || existing?.employee || {},
      structureId: structure._id,
      annualCtc: structure.annualCtc,
      attendance: { ...att, calculatedLop: lop, ...(notes.length ? { notes: notes.join('; ') } : {}) } as any,
      daysInMonth: pay.daysInMonth,
      lopDays: pay.lopDays,
      lopOverridden: !!existing?.lopOverridden,
      payableDays: pay.payableDays,
      earnings: pay.earnings,
      deductions: pay.deductions,
      employerContributions: pay.employerContributions,
      grossEarnings: pay.grossEarnings,
      totalDeductions: pay.totalDeductions,
      netPay: pay.netPay,
      monthlyCost: pay.monthlyCost,
    };
  }

  async calculate(dto: { month: string; employeeIds?: string[] }, user: any) {
    this.payroll.assertAccess(user, 'RUN_PAYROLL');
    const { start, end, daysInMonth, monthNo } = this.monthRange(dto.month);
    if (start.getTime() > Date.now()) throw new BadRequestException('Payroll cannot be calculated for a future month');

    let run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month: dto.month }).lean();
    if (run && run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(`Payroll for ${this.monthLabel(dto.month)} is ${run.status.replace('_', ' ')}. Reopen it to recalculate.`);
    }
    if (!run) {
      try {
        run = (await this.runModel.create({ companyId: PAYROLL_COMPANY_ID, month: dto.month, status: PayrollRunStatus.DRAFT })).toObject();
      } catch {
        run = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month: dto.month }).lean();
      }
    }

    const { ids, exitBy } = await this.payrollCandidates(dto.month, start, end, dto.employeeIds);
    const [snapshots, attendance, existing] = await Promise.all([
      this.employeeSnapshots(ids),
      this.attendanceFor(ids, start, end),
      this.entryModel.find({ runId: run._id }).lean(),
    ]);
    const existingBy = new Map(existing.map((e: any) => [String(e.employeeId), e]));

    const skipped: { employeeId: string; name: string; reason: string }[] = [];
    let calculated = 0;
    for (const id of ids) {
      try {
        const old: any = existingBy.get(id);
        const doc = await this.computeEntry(
          run,
          id,
          { start, end, daysInMonth, monthNo, snapshot: snapshots.get(id), attendance: attendance.get(id), lastWorkingDay: exitBy.get(id) || null },
          old,
        );
        if (!doc) {
          skipped.push({ employeeId: id, name: snapshots.get(id)?.name || id, reason: 'No approved salary structure' });
          if (old) await this.entryModel.deleteOne({ _id: old._id });
          continue;
        }
        await this.entryModel.updateOne(
          { runId: run._id, employeeId: oid(id) },
          {
            $set: { ...doc, payment: { status: 'pending' } },
            $setOnInsert: { reviewStatus: 'pending' },
          },
          { upsert: true },
        );
        calculated += 1;
      } catch (e: any) {
        skipped.push({ employeeId: id, name: snapshots.get(id)?.name || id, reason: e?.message || 'Calculation failed' });
      }
    }

    // A full recalculation drops employees who are no longer payable.
    if (!dto.employeeIds?.length) {
      await this.entryModel.deleteMany({ runId: run._id, employeeId: { $nin: ids.map(oid) } });
    }
    await this.runModel.updateOne(
      { _id: run._id },
      { $set: { calculatedAt: new Date(), calculatedBy: oid(this.me(user)), rejectionReason: null } },
    );
    await this.refreshTotals(run._id);
    await this.pushHistory(run._id, dto.employeeIds?.length ? 'RECALCULATED_EMPLOYEES' : 'CALCULATED', user, `${calculated} employees`);
    return { run: await this.runModel.findById(run._id).lean(), calculated, skipped };
  }

  /** Recalculate one entry (after LOP edit or an adjustment change). */
  private async recalcEntry(entry: any, resetPayment: boolean) {
    const run: any = await this.runModel.findById(entry.runId).lean();
    const { start, end, daysInMonth, monthNo } = this.monthRange(run.month);
    const id = String(entry.employeeId);
    const [attendance, exit] = await Promise.all([
      this.attendanceFor([id], start, end),
      this.db.collection('exitrequests').findOne({ employeeId: oid(id), status: 'approved', lastWorkingDay: { $gte: start } }),
    ]);
    const doc = await this.computeEntry(
      run,
      id,
      { start, end, daysInMonth, monthNo, attendance: attendance.get(id), lastWorkingDay: exit?.lastWorkingDay || null },
      entry,
    );
    if (!doc) throw new BadRequestException('This employee has no approved salary structure for the month');
    const set: any = { ...doc };
    if (resetPayment) set.payment = { status: 'pending' };
    await this.entryModel.updateOne({ _id: entry._id }, { $set: set });
    await this.refreshTotals(run._id);
    return this.entryModel.findById(entry._id).lean();
  }

  /* ------------------------------------------------------------------ */
  /* runs, entries, review                                               */
  /* ------------------------------------------------------------------ */

  private assertCanSeeRuns(user: any) {
    if (!['RUN_PAYROLL', 'APPROVE_PAYROLL', 'MANAGE_PAYMENTS', 'PAYSLIPS', 'REPORTS', 'READ'].some((a) => this.payroll.can(user, a as any))) {
      throw new ForbiddenException('You do not have access to payroll');
    }
  }

  async listRuns(user: any) {
    this.assertCanSeeRuns(user);
    return this.runModel
      .find({ companyId: PAYROLL_COMPANY_ID })
      .sort({ month: -1 })
      .limit(36)
      .populate('calculatedBy', 'name')
      .populate('submittedBy', 'name')
      .populate('approvedBy', 'name')
      .lean();
  }

  async getRun(month: string, user: any) {
    this.assertCanSeeRuns(user);
    const run: any = await this.runModel
      .findOne({ companyId: PAYROLL_COMPANY_ID, month })
      .populate('calculatedBy', 'name')
      .populate('submittedBy', 'name')
      .populate('approvedBy', 'name')
      .lean();
    if (!run) return { run: null, entries: [] };
    const entries = await this.entryModel.find({ runId: run._id }).sort({ 'employee.name': 1 }).lean();
    return { run, entries };
  }

  async updateEntry(entryId: string, dto: { lopDays?: number; resetLop?: boolean; reviewStatus?: string; remarks?: string }, user: any) {
    this.payroll.assertAccess(user, 'RUN_PAYROLL');
    const entry: any = await this.entryModel.findById(entryId).lean();
    if (!entry) throw new NotFoundException('Payroll entry not found');
    const run: any = await this.runModel.findById(entry.runId).lean();
    if (run.status !== PayrollRunStatus.DRAFT) throw new BadRequestException('Only a draft payroll can be changed. Ask the approver to reject / reopen it.');

    const set: any = {};
    if (dto.reviewStatus) set.reviewStatus = dto.reviewStatus;
    if (dto.remarks !== undefined) set.remarks = dto.remarks.trim();
    if (Object.keys(set).length) await this.entryModel.updateOne({ _id: entryId }, { $set: set });

    if (dto.resetLop || dto.lopDays !== undefined) {
      if (dto.lopDays !== undefined && dto.lopDays > entry.daysInMonth) throw new BadRequestException(`LOP cannot be more than ${entry.daysInMonth} days`);
      const next = dto.resetLop
        ? { ...entry, lopOverridden: false }
        : { ...entry, lopOverridden: true, lopDays: Math.round(Number(dto.lopDays) * 2) / 2 };
      await this.entryModel.updateOne({ _id: entryId }, { $set: { lopOverridden: next.lopOverridden, lopDays: next.lopDays } });
      await this.recalcEntry({ ...next, ...set }, false);
    } else {
      await this.refreshTotals(run._id);
    }
    return this.entryModel.findById(entryId).lean();
  }

  async markAllReviewed(month: string, user: any) {
    this.payroll.assertAccess(user, 'RUN_PAYROLL');
    const run = await this.getRunOrThrow(month);
    if (run.status !== PayrollRunStatus.DRAFT) throw new BadRequestException('Only a draft payroll can be reviewed');
    const res = await this.entryModel.updateMany({ runId: run._id, reviewStatus: 'pending' }, { $set: { reviewStatus: 'reviewed' } });
    await this.pushHistory(run._id, 'MARKED_REVIEWED', user, `${res.modifiedCount} employees`);
    return { updated: res.modifiedCount };
  }

  async submit(month: string, dto: { note?: string }, user: any) {
    this.payroll.assertAccess(user, 'RUN_PAYROLL');
    const run = await this.getRunOrThrow(month);
    if (run.status !== PayrollRunStatus.DRAFT) throw new BadRequestException(`Payroll is already ${run.status.replace('_', ' ')}`);
    const counts = await this.entryModel.aggregate([{ $match: { runId: run._id } }, { $group: { _id: '$reviewStatus', n: { $sum: 1 } } }]);
    const by = Object.fromEntries(counts.map((c: any) => [c._id, c.n]));
    const total = counts.reduce((s: number, c: any) => s + c.n, 0);
    if (!total) throw new BadRequestException('There are no employees in this payroll');
    if (by.pending) throw new BadRequestException(`${by.pending} employee(s) are not reviewed yet. Review them (or put them on hold) first.`);
    await this.runModel.updateOne(
      { _id: run._id, status: PayrollRunStatus.DRAFT },
      { $set: { status: PayrollRunStatus.PENDING_APPROVAL, submittedAt: new Date(), submittedBy: oid(this.me(user)), rejectionReason: null } },
    );
    await this.pushHistory(run._id, 'SUBMITTED', user, dto.note);
    return this.runModel.findById(run._id).lean();
  }

  async approve(month: string, dto: { note?: string }, user: any) {
    this.payroll.assertAccess(user, 'APPROVE_PAYROLL');
    const run = await this.getRunOrThrow(month);
    if (run.status !== PayrollRunStatus.PENDING_APPROVAL) throw new BadRequestException('Only a payroll waiting for approval can be approved');
    if (String(run.submittedBy) === this.me(user) && !this.isAdmin(user)) {
      throw new ForbiddenException('The person who submitted the payroll cannot approve it');
    }
    await this.runModel.updateOne(
      { _id: run._id, status: PayrollRunStatus.PENDING_APPROVAL },
      { $set: { status: PayrollRunStatus.APPROVED, approvedAt: new Date(), approvedBy: oid(this.me(user)) } },
    );
    await this.pushHistory(run._id, 'APPROVED', user, dto.note);
    return this.runModel.findById(run._id).lean();
  }

  async reject(month: string, dto: { note?: string }, user: any) {
    this.payroll.assertAccess(user, 'APPROVE_PAYROLL');
    const run = await this.getRunOrThrow(month);
    if (run.status !== PayrollRunStatus.PENDING_APPROVAL) throw new BadRequestException('Only a payroll waiting for approval can be rejected');
    if (!dto.note?.trim()) throw new BadRequestException('Please add a reason for rejecting');
    await this.runModel.updateOne(
      { _id: run._id },
      { $set: { status: PayrollRunStatus.DRAFT, rejectionReason: dto.note.trim(), submittedAt: null, submittedBy: null } },
    );
    await this.pushHistory(run._id, 'REJECTED', user, dto.note.trim());
    return this.runModel.findById(run._id).lean();
  }

  /** Approved payroll back to draft – only while no salary has been paid. */
  async reopen(month: string, dto: { note?: string }, user: any) {
    this.payroll.assertAccess(user, 'APPROVE_PAYROLL');
    const run = await this.getRunOrThrow(month);
    if (run.status !== PayrollRunStatus.APPROVED) throw new BadRequestException('Only an approved payroll can be reopened');
    const paid = await this.entryModel.countDocuments({ runId: run._id, 'payment.status': 'paid' });
    if (paid) throw new BadRequestException(`${paid} salary payment(s) are already paid – the payroll cannot be reopened`);
    await this.entryModel.updateMany({ runId: run._id }, { $set: { payment: { status: 'pending' }, payslip: null } });
    await this.runModel.updateOne({ _id: run._id }, { $set: { status: PayrollRunStatus.DRAFT, approvedAt: null, approvedBy: null, submittedAt: null, submittedBy: null } });
    await this.pushHistory(run._id, 'REOPENED', user, dto.note);
    return this.runModel.findById(run._id).lean();
  }

  /* ------------------------------------------------------------------ */
  /* adjustments                                                         */
  /* ------------------------------------------------------------------ */

  adjustmentTypes() {
    return Object.entries(ADJUSTMENT_TYPES).map(([value, t]) => ({ value, label: t.label, kind: t.kind }));
  }

  async listAdjustments(user: any, query: { month?: string; employeeId?: string; status?: string }) {
    if (!this.payroll.can(user, 'RUN_PAYROLL') && !this.payroll.can(user, 'MANAGE_PAYMENTS') && !this.payroll.can(user, 'READ')) {
      throw new ForbiddenException('You do not have access to payroll adjustments');
    }
    const filter: any = { companyId: PAYROLL_COMPANY_ID };
    if (query.month) filter.month = query.month;
    if (query.employeeId && isId(query.employeeId)) filter.employeeId = oid(query.employeeId);
    filter.status = query.status && query.status !== 'all' ? query.status : 'active';
    if (query.status === 'all') delete filter.status;
    return this.adjustmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(2000)
      .populate('employeeId', 'name employeeId')
      .populate('createdBy', 'name')
      .lean();
  }

  /** Applies a changed adjustment to the month's payroll entry, if any. */
  private async applyAdjustmentChange(month: string, employeeId: string) {
    const run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month }).lean();
    if (!run) return { recalculated: false };
    const entry: any = await this.entryModel.findOne({ runId: run._id, employeeId: oid(employeeId) }).lean();
    if (!entry) return { recalculated: false };
    if (run.status === PayrollRunStatus.PENDING_APPROVAL) {
      throw new BadRequestException('This payroll is waiting for approval. Ask the approver to reject it before changing amounts.');
    }
    if (entry.payment?.status === 'paid') throw new BadRequestException('This salary is already paid. Add the adjustment to the next month.');
    // In an approved payroll the salary goes back to "pending" payment approval.
    await this.recalcEntry(entry, run.status !== PayrollRunStatus.DRAFT);
    if (run.status === PayrollRunStatus.CLOSED) {
      await this.runModel.updateOne({ _id: run._id }, { $set: { status: PayrollRunStatus.APPROVED } });
    }
    return { recalculated: true };
  }

  async createAdjustment(dto: { month: string; employeeId: string; type: string; name?: string; amount: number; remarks?: string }, user: any, source = 'manual') {
    if (!this.payroll.can(user, 'RUN_PAYROLL') && !this.payroll.can(user, 'MANAGE_PAYMENTS')) {
      throw new ForbiddenException('You cannot add payroll adjustments');
    }
    this.assertMonth(dto.month);
    const t = ADJUSTMENT_TYPES[dto.type];
    if (!t) throw new BadRequestException('Choose an adjustment type');
    const amount = Math.round(Number(dto.amount));
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than 0');
    const emp = await this.db.collection('users').findOne({ _id: oid(dto.employeeId) }, { projection: { name: 1 } });
    if (!emp) throw new NotFoundException('Employee not found');

    // Validate against the payroll state before saving.
    const run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month: dto.month }).lean();
    if (run?.status === PayrollRunStatus.PENDING_APPROVAL) {
      throw new BadRequestException('This payroll is waiting for approval. Ask the approver to reject it before changing amounts.');
    }
    if (run) {
      const entry: any = await this.entryModel.findOne({ runId: run._id, employeeId: oid(dto.employeeId) }).select('payment').lean();
      if (entry?.payment?.status === 'paid') throw new BadRequestException('This salary is already paid. Add the adjustment to the next month.');
    }

    const created = await this.adjustmentModel.create({
      companyId: PAYROLL_COMPANY_ID,
      month: dto.month,
      employeeId: oid(dto.employeeId),
      type: dto.type,
      kind: t.kind,
      name: dto.name?.trim() || t.label,
      amount,
      remarks: dto.remarks?.trim() || undefined,
      source,
      status: 'active',
      createdBy: oid(this.me(user)),
    });
    const applied = await this.applyAdjustmentChange(dto.month, dto.employeeId);
    if (run) await this.pushHistory(run._id, 'ADJUSTMENT_ADDED', user, `${t.label} ₹${amount} – ${emp.name}`);
    return { adjustment: created.toObject(), ...applied };
  }

  async cancelAdjustment(id: string, user: any) {
    if (!this.payroll.can(user, 'RUN_PAYROLL') && !this.payroll.can(user, 'MANAGE_PAYMENTS')) {
      throw new ForbiddenException('You cannot change payroll adjustments');
    }
    const adj: any = await this.adjustmentModel.findOne({ _id: id, status: 'active' }).lean();
    if (!adj) throw new NotFoundException('Adjustment not found');
    // Check before cancelling so a paid / pending-approval payroll is not changed.
    const run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month: adj.month }).lean();
    if (run?.status === PayrollRunStatus.PENDING_APPROVAL) throw new BadRequestException('This payroll is waiting for approval.');
    if (run) {
      const entry: any = await this.entryModel.findOne({ runId: run._id, employeeId: adj.employeeId }).select('payment').lean();
      if (entry?.payment?.status === 'paid') throw new BadRequestException('This salary is already paid; the adjustment cannot be removed.');
    }
    await this.adjustmentModel.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    const applied = await this.applyAdjustmentChange(adj.month, String(adj.employeeId));
    if (run) await this.pushHistory(run._id, 'ADJUSTMENT_CANCELLED', user, `${adj.name} ₹${adj.amount}`);
    return { success: true, ...applied };
  }

  /* ------------------------------------------------------------------ */
  /* salary payments                                                     */
  /* ------------------------------------------------------------------ */

  async payments(month: string, user: any) {
    this.payroll.assertAccess(user, 'MANAGE_PAYMENTS');
    const run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month }).lean();
    if (!run) return { run: null, entries: [], ready: false };
    const ready = [PayrollRunStatus.APPROVED, PayrollRunStatus.CLOSED].includes(run.status);
    const entries = await this.entryModel
      .find({ runId: run._id })
      .sort({ 'employee.name': 1 })
      .populate('payment.approvedBy', 'name')
      .populate('payment.paidBy', 'name')
      .lean();
    const totals = { pending: 0, approved: 0, paid: 0, on_hold: 0, pendingAmount: 0, approvedAmount: 0, paidAmount: 0 };
    for (const e of entries as any[]) {
      const s = e.payment?.status || 'pending';
      totals[s] = (totals[s] || 0) + 1;
      if (s === 'pending') totals.pendingAmount += e.netPay;
      if (s === 'approved') totals.approvedAmount += e.payment?.amount ?? e.netPay;
      if (s === 'paid') totals.paidAmount += e.payment?.amount ?? e.netPay;
    }
    return { run, entries, ready, totals };
  }

  private async paymentEntries(entryIds: string[], user: any) {
    this.payroll.assertAccess(user, 'MANAGE_PAYMENTS');
    const ids = [...new Set(entryIds.filter(isId))];
    if (!ids.length) throw new BadRequestException('Select at least one employee');
    const entries: any[] = await this.entryModel.find({ _id: { $in: ids.map(oid) } }).lean();
    const runIds = [...new Set(entries.map((e) => String(e.runId)))];
    const runs: any[] = await this.runModel.find({ _id: { $in: runIds.map(oid) } }).lean();
    if (runs.some((r) => ![PayrollRunStatus.APPROVED, PayrollRunStatus.CLOSED].includes(r.status))) {
      throw new BadRequestException('Salaries can be paid only after the monthly payroll is approved');
    }
    return { entries, runs };
  }

  private async closeRunsIfPaid(runIds: string[]) {
    for (const id of runIds) {
      const open = await this.entryModel.countDocuments({ runId: oid(id), 'payment.status': { $in: ['pending', 'approved'] } });
      const run: any = await this.runModel.findById(id).select('status').lean();
      if (!open && run?.status === PayrollRunStatus.APPROVED) await this.runModel.updateOne({ _id: id }, { $set: { status: PayrollRunStatus.CLOSED } });
      if (open && run?.status === PayrollRunStatus.CLOSED) await this.runModel.updateOne({ _id: id }, { $set: { status: PayrollRunStatus.APPROVED } });
    }
  }

  async approvePayments(dto: { entryIds: string[]; note?: string }, user: any) {
    const { entries, runs } = await this.paymentEntries(dto.entryIds, user);
    let updated = 0;
    for (const e of entries) {
      if ((e.payment?.status || 'pending') !== 'pending') continue;
      if (e.netPay <= 0) continue;
      await this.entryModel.updateOne(
        { _id: e._id, 'payment.status': { $in: ['pending', null] } },
        { $set: { payment: { status: 'approved', amount: e.netPay, approvedBy: oid(this.me(user)), approvedAt: new Date(), note: dto.note?.trim() || undefined } } },
      );
      updated += 1;
    }
    for (const r of runs) await this.pushHistory(r._id, 'PAYMENTS_APPROVED', user, `${updated} salaries`);
    return { updated };
  }

  async markPaid(dto: { entryIds: string[]; mode?: string; reference?: string; paidOn?: string; note?: string }, user: any) {
    const { entries, runs } = await this.paymentEntries(dto.entryIds, user);
    const paidAt = dto.paidOn ? startOfDayInTimezone(dto.paidOn, getBusinessTimezone()) : new Date();
    let updated = 0;
    for (const e of entries) {
      if (e.payment?.status !== 'approved') continue;
      await this.entryModel.updateOne(
        { _id: e._id, 'payment.status': 'approved' },
        {
          $set: {
            'payment.status': 'paid',
            'payment.paidBy': oid(this.me(user)),
            'payment.paidAt': paidAt,
            'payment.mode': dto.mode?.trim() || 'Bank transfer',
            'payment.reference': dto.reference?.trim() || undefined,
            ...(dto.note?.trim() ? { 'payment.note': dto.note.trim() } : {}),
          },
        },
      );
      updated += 1;
    }
    await this.closeRunsIfPaid(runs.map((r) => String(r._id)));
    for (const r of runs) await this.pushHistory(r._id, 'PAYMENTS_PAID', user, `${updated} salaries${dto.reference ? ` – ${dto.reference}` : ''}`);
    return { updated };
  }

  async holdPayments(dto: { entryIds: string[]; hold?: boolean; note?: string }, user: any) {
    const { entries, runs } = await this.paymentEntries(dto.entryIds, user);
    const hold = dto.hold !== false;
    let updated = 0;
    for (const e of entries) {
      const s = e.payment?.status || 'pending';
      if (s === 'paid') continue;
      if (hold && s === 'on_hold') continue;
      if (!hold && s !== 'on_hold') continue;
      await this.entryModel.updateOne(
        { _id: e._id },
        { $set: { payment: { status: hold ? 'on_hold' : 'pending', note: dto.note?.trim() || undefined } } },
      );
      updated += 1;
    }
    await this.closeRunsIfPaid(runs.map((r) => String(r._id)));
    return { updated };
  }

  /* ------------------------------------------------------------------ */
  /* payslips                                                            */
  /* ------------------------------------------------------------------ */

  async generatePayslips(dto: { month: string; employeeIds?: string[] }, user: any) {
    this.payroll.assertAccess(user, 'PAYSLIPS');
    const run = await this.getRunOrThrow(dto.month);
    if (![PayrollRunStatus.APPROVED, PayrollRunStatus.CLOSED].includes(run.status)) {
      throw new BadRequestException('Payslips can be generated after the monthly payroll is approved');
    }
    const filter: any = { runId: run._id };
    if (dto.employeeIds?.length) filter.employeeId = { $in: dto.employeeIds.map(oid) };
    const entries: any[] = await this.entryModel.find(filter).sort({ 'employee.name': 1 }).lean();
    // Keep the snapshot fresh (bank, UAN … may have been added after calculation).
    const snapshots = await this.employeeSnapshots(entries.map((e) => String(e.employeeId)));
    let seq = await this.entryModel.countDocuments({ runId: run._id, payslip: { $ne: null } });
    const now = new Date();
    let generated = 0;
    for (const e of entries) {
      const number = e.payslip?.number || `UPS/${run.month.replace('-', '')}/${String(++seq).padStart(4, '0')}`;
      await this.entryModel.updateOne(
        { _id: e._id },
        { $set: { payslip: { number, generatedAt: now, generatedBy: oid(this.me(user)) }, employee: { ...e.employee, ...(snapshots.get(String(e.employeeId)) || {}) } } },
      );
      generated += 1;
    }
    await this.pushHistory(run._id, 'PAYSLIPS_GENERATED', user, `${generated} payslips`);
    return { generated };
  }

  async listPayslips(month: string, user: any) {
    this.payroll.assertAccess(user, 'PAYSLIPS');
    const run: any = await this.runModel.findOne({ companyId: PAYROLL_COMPANY_ID, month }).lean();
    if (!run) return { run: null, entries: [] };
    const entries = await this.entryModel
      .find({ runId: run._id })
      .select('employeeId employee netPay grossEarnings totalDeductions payslip payment month lopDays payableDays')
      .sort({ 'employee.name': 1 })
      .lean();
    return { run, entries };
  }

  async myPayslips(user: any) {
    return this.entryModel
      .find({ companyId: PAYROLL_COMPANY_ID, employeeId: oid(this.me(user)), payslip: { $ne: null } })
      .select('month netPay grossEarnings totalDeductions payslip payment')
      .sort({ month: -1 })
      .lean();
  }

  /** Everything the payslip page shows (amounts, YTD, words). Zero rows are dropped by the client. */
  async payslip(entryId: string, user: any) {
    if (!isId(entryId)) throw new BadRequestException('Invalid payslip');
    const entry: any = await this.entryModel.findById(entryId).lean();
    if (!entry || !entry.payslip) throw new NotFoundException('Payslip not found');
    const own = String(entry.employeeId) === this.me(user);
    if (!own && !this.payroll.can(user, 'PAYSLIPS')) throw new ForbiddenException('You can only see your own payslips');

    // Year to date: approved entries of this financial year up to this month.
    const ytdEntries: any[] = await this.entryModel
      .find({
        companyId: PAYROLL_COMPANY_ID,
        employeeId: entry.employeeId,
        month: { $gte: this.fyStart(entry.month), $lte: entry.month },
      })
      .select('runId month earnings deductions employerContributions grossEarnings totalDeductions netPay')
      .lean();
    const runIds = [...new Set(ytdEntries.map((e) => String(e.runId)))];
    const okRuns = new Set(
      (await this.runModel.find({ _id: { $in: runIds.map(oid) }, status: { $in: [PayrollRunStatus.APPROVED, PayrollRunStatus.CLOSED] } }).select('_id').lean()).map(
        (r: any) => String(r._id),
      ),
    );
    const ytdList = ytdEntries.filter((e) => okRuns.has(String(e.runId)));
    const sumBy = (field: 'earnings' | 'deductions' | 'employerContributions') => {
      const m = new Map<string, number>();
      for (const e of ytdList) for (const l of e[field] || []) {
        // Adjustments are grouped by their type across months (e.g. all incentives).
        const k = l.adjustmentId ? `adj:${l.note || l.name}` : l.key;
        m.set(k, (m.get(k) || 0) + (l.amount || 0) + (l.arrear || 0));
      }
      return m;
    };
    const ytdE = sumBy('earnings');
    const ytdD = sumBy('deductions');
    const ytdC = sumBy('employerContributions');
    const keyOf = (l: any) => (l.adjustmentId ? `adj:${l.note || l.name}` : l.key);
    const total = (list: any[], f: string) => list.reduce((s, e) => s + (e[f] || 0), 0);

    const structure: any = entry.structureId ? await this.structureModel.findById(entry.structureId).select('breakup tdsMonthly').lean() : null;
    const annualTdsProjected = structure?.breakup?.deductions?.find((d: any) => d.key === 'tds')?.annual || 0;
    const annualPtProjected = structure?.breakup?.deductions?.find((d: any) => d.key === 'pt')?.annual || 0;
    const tdsYtd = ytdD.get('tds') || 0;
    const ptYtd = ytdD.get('pt') || 0;
    const employerTotal = (entry.employerContributions || []).reduce((s: number, c: any) => s + c.amount, 0);

    return {
      company: {
        name: process.env.PAYSLIP_COMPANY_NAME || 'Upskillab',
        address: process.env.PAYSLIP_COMPANY_ADDRESS || '',
      },
      payslipNumber: entry.payslip.number,
      generatedAt: entry.payslip.generatedAt,
      month: entry.month,
      monthLabel: this.monthLabel(entry.month),
      employee: { _id: String(entry.employeeId), ...entry.employee },
      days: { daysInMonth: entry.daysInMonth, lopDays: entry.lopDays, payableDays: entry.payableDays },
      earnings: (entry.earnings || []).map((l: any) => ({
        name: l.name,
        reference: l.reference || 0,
        amount: l.amount || 0,
        arrear: l.arrear || 0,
        ytd: ytdE.get(keyOf(l)) || 0,
      })),
      deductions: (entry.deductions || []).map((l: any) => ({ name: l.name, amount: l.amount || 0, ytd: ytdD.get(keyOf(l)) || 0 })),
      employerContributions: (entry.employerContributions || []).map((l: any) => ({ name: l.name, amount: l.amount || 0, ytd: ytdC.get(keyOf(l)) || 0 })),
      totals: {
        referenceGross: (entry.earnings || []).reduce((s: number, l: any) => s + (l.reference || 0), 0),
        gross: entry.grossEarnings,
        arrears: (entry.earnings || []).reduce((s: number, l: any) => s + (l.arrear || 0), 0),
        grossYtd: total(ytdList, 'grossEarnings'),
        deductions: entry.totalDeductions,
        deductionsYtd: total(ytdList, 'totalDeductions'),
        net: entry.netPay,
        netYtd: total(ytdList, 'netPay'),
        employer: employerTotal,
        employerYtd: [...ytdC.values()].reduce((s, v) => s + v, 0),
        totalCtc: entry.grossEarnings + employerTotal,
      },
      netPayInWords: amountInWords(entry.netPay),
      otherStatutory: [
        { name: 'Income Tax', projected: annualTdsProjected, ytd: tdsYtd, balance: Math.max(0, annualTdsProjected - tdsYtd) },
        { name: 'Professional Tax', projected: annualPtProjected, ytd: ptYtd, balance: Math.max(0, annualPtProjected - ptYtd) },
      ],
      payment: entry.payment?.status === 'paid' ? { paidAt: entry.payment.paidAt, mode: entry.payment.mode, reference: entry.payment.reference } : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* payroll report                                                      */
  /* ------------------------------------------------------------------ */

  async payrollReport(user: any, query: { from?: string; to?: string; status?: string }) {
    this.payroll.assertAccess(user, 'REPORTS');
    const to = query.to && MONTH_RE.test(query.to) ? query.to : toDateKey(new Date(), getBusinessTimezone()).slice(0, 7);
    const from = query.from && MONTH_RE.test(query.from) ? query.from : this.fyStart(to);
    if (from > to) throw new BadRequestException('"From" month must be before "To" month');
    const runFilter: any = { companyId: PAYROLL_COMPANY_ID, month: { $gte: from, $lte: to } };
    if (query.status === 'approved') runFilter.status = { $in: [PayrollRunStatus.APPROVED, PayrollRunStatus.CLOSED] };
    const runs: any[] = await this.runModel.find(runFilter).sort({ month: 1 }).lean();
    const entries: any[] = await this.entryModel.find({ runId: { $in: runs.map((r) => r._id) } }).lean();

    const lineSum = (list: any[], key: string) => list.filter((l) => l.key === key).reduce((s, l) => s + (l.amount || 0), 0);
    const adjSum = (list: any[], type: string) => list.filter((l) => l.adjustmentId && l.note === type).reduce((s, l) => s + (l.amount || 0) + (l.arrear || 0), 0);

    const months = runs.map((r) => {
      const es = entries.filter((e) => String(e.runId) === String(r._id));
      return {
        month: r.month,
        label: this.monthLabel(r.month),
        status: r.status,
        employees: es.length,
        gross: es.reduce((s, e) => s + e.grossEarnings, 0),
        deductions: es.reduce((s, e) => s + e.totalDeductions, 0),
        net: es.reduce((s, e) => s + e.netPay, 0),
        employerCost: es.reduce((s, e) => s + e.monthlyCost, 0),
        pf: es.reduce((s, e) => s + lineSum(e.deductions, 'pf'), 0),
        esi: es.reduce((s, e) => s + lineSum(e.deductions, 'esi'), 0),
        pt: es.reduce((s, e) => s + lineSum(e.deductions, 'pt'), 0),
        tds: es.reduce((s, e) => s + lineSum(e.deductions, 'tds'), 0),
        employerPf: es.reduce((s, e) => s + lineSum(e.employerContributions, 'pf_employer'), 0),
        employerEsi: es.reduce((s, e) => s + lineSum(e.employerContributions, 'esi_employer'), 0),
        incentives: es.reduce((s, e) => s + adjSum(e.earnings, 'incentive') + adjSum(e.earnings, 'bonus'), 0),
        lopDays: es.reduce((s, e) => s + (e.lopDays || 0), 0),
        paid: es.filter((e) => e.payment?.status === 'paid').reduce((s, e) => s + (e.payment?.amount ?? e.netPay), 0),
      };
    });

    const empMap = new Map<string, any>();
    for (const e of entries) {
      const k = String(e.employeeId);
      const row =
        empMap.get(k) ||
        {
          employeeId: k,
          name: e.employee?.name,
          code: e.employee?.code,
          department: e.employee?.department,
          annualCtc: e.annualCtc,
          months: 0,
          gross: 0,
          deductions: 0,
          net: 0,
          pf: 0,
          esi: 0,
          pt: 0,
          tds: 0,
          employerPf: 0,
          incentives: 0,
          lopDays: 0,
          paid: 0,
        };
      row.months += 1;
      row.annualCtc = e.annualCtc;
      row.gross += e.grossEarnings;
      row.deductions += e.totalDeductions;
      row.net += e.netPay;
      row.pf += lineSum(e.deductions, 'pf');
      row.esi += lineSum(e.deductions, 'esi');
      row.pt += lineSum(e.deductions, 'pt');
      row.tds += lineSum(e.deductions, 'tds');
      row.employerPf += lineSum(e.employerContributions, 'pf_employer');
      row.incentives += adjSum(e.earnings, 'incentive') + adjSum(e.earnings, 'bonus');
      row.lopDays += e.lopDays || 0;
      if (e.payment?.status === 'paid') row.paid += e.payment?.amount ?? e.netPay;
      empMap.set(k, row);
    }
    const employees = [...empMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const sum = (f: string) => months.reduce((s, m: any) => s + (m[f] || 0), 0);
    return {
      from,
      to,
      months,
      employees,
      summary: {
        runs: months.length,
        gross: sum('gross'),
        deductions: sum('deductions'),
        net: sum('net'),
        employerCost: sum('employerCost'),
        pf: sum('pf'),
        esi: sum('esi'),
        pt: sum('pt'),
        tds: sum('tds'),
        incentives: sum('incentives'),
        paid: sum('paid'),
      },
    };
  }
}
