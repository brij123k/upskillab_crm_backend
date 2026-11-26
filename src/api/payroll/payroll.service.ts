import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PAYROLL_COMPANY_ID,
  PayrollAuditLog,
  PayrollSettings,
  SalaryRevision,
  SalaryStructure,
  SalaryStructureStatus,
  SalaryTemplate,
} from 'src/schema/payroll/payroll.schema';
import { hasPermission, isAdminUser } from 'src/common/utils/has-permission.util';
import {
  getBusinessTimezone,
  startOfDayInTimezone,
  toDateKey,
} from '../order_management/financial/order-financial.util';
import {
  DEFAULT_COMPONENTS,
  DEFAULT_STATUTORY,
  PayrollRules,
  SalaryInput,
  calculateSalary,
  validateRules,
} from './payroll-calc';
import {
  CreateSalaryRevisionDto,
  CreateSalaryStructureDto,
  SalaryInputDto,
  UpdatePayrollSettingsDto,
  UpdateSalaryStructureDto,
} from 'src/dto/payroll/payroll.dto';

export const PAYROLL_PERMISSIONS = {
  MODULE: 'payroll',
  READ: 'read',
  MANAGE_SETTINGS: 'manage_settings',
  MANAGE_STRUCTURES: 'manage_structures',
  APPROVE_STRUCTURES: 'approve_structures',
  /** Calculate monthly payroll, review entries, add adjustments. */
  RUN_PAYROLL: 'run_payroll',
  /** Approve / reject a monthly payroll. */
  APPROVE_PAYROLL: 'approve_payroll',
  /** Salary payments: approve, change, mark paid, manual incentives. */
  MANAGE_PAYMENTS: 'manage_payments',
  /** Generate payslips and see every employee's payslip. */
  PAYSLIPS: 'payslips',
  /** Payroll report. */
  REPORTS: 'reports',
} as const;

type PayrollAction = Exclude<keyof typeof PAYROLL_PERMISSIONS, 'MODULE'>;

const oid = (v: any) => new Types.ObjectId(String(v));

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    @InjectModel(PayrollSettings.name) private readonly settingsModel: Model<PayrollSettings>,
    @InjectModel(SalaryStructure.name) private readonly structureModel: Model<SalaryStructure>,
    @InjectModel(SalaryRevision.name) private readonly revisionModel: Model<SalaryRevision>,
    @InjectModel(PayrollAuditLog.name) private readonly auditModel: Model<PayrollAuditLog>,
    @InjectModel(SalaryTemplate.name) private readonly templateModel: Model<SalaryTemplate>,
  ) {}

  /* ------------------------------------------------------------------ */
  /* access                                                              */
  /* ------------------------------------------------------------------ */

  /** Admin, or the payroll permission (manage_* / approve_* also allow read). */
  assertAccess(user: any, action: PayrollAction) {
    if (isAdminUser(user) || user?.isSuperAdmin) return;
    if (!this.can(user, action)) throw new ForbiddenException('You do not have permission for this payroll action');
  }

  can(user: any, action: PayrollAction) {
    if (isAdminUser(user) || user?.isSuperAdmin) return true;
    const p = PAYROLL_PERMISSIONS;
    return (
      hasPermission(user, p.MODULE, p[action]) ||
      (action === 'READ' &&
        [p.MANAGE_SETTINGS, p.MANAGE_STRUCTURES, p.APPROVE_STRUCTURES, p.RUN_PAYROLL, p.APPROVE_PAYROLL, p.MANAGE_PAYMENTS, p.REPORTS].some((a) =>
          hasPermission(user, p.MODULE, a),
        ))
    );
  }

  /** Which payroll screens / actions the user has (for the HR menu). */
  access(user: any) {
    return {
      read: this.can(user, 'READ'),
      manageSettings: this.can(user, 'MANAGE_SETTINGS'),
      manageStructures: this.can(user, 'MANAGE_STRUCTURES'),
      approveStructures: this.can(user, 'APPROVE_STRUCTURES'),
      runPayroll: this.can(user, 'RUN_PAYROLL'),
      approvePayroll: this.can(user, 'APPROVE_PAYROLL'),
      managePayments: this.can(user, 'MANAGE_PAYMENTS'),
      payslips: this.can(user, 'PAYSLIPS'),
      reports: this.can(user, 'REPORTS'),
    };
  }

  private actorId(user: any) {
    const id = user?.userId || user?._id;
    return id && Types.ObjectId.isValid(String(id)) ? oid(id) : undefined;
  }

  private audit(entityType: string, entityId: any, action: string, user: any, before?: any, after?: any) {
    return this.auditModel
      .create({ companyId: PAYROLL_COMPANY_ID, entityType, entityId: String(entityId), action, before, after, performedBy: this.actorId(user) })
      .catch((e) => this.logger.warn(`audit failed: ${e?.message}`));
  }

  private get db() {
    return this.structureModel.db;
  }

  /** 'YYYY-MM-DD' (business timezone) → start of that day. */
  private dayStart(key?: string) {
    const tz = getBusinessTimezone();
    const k = key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : toDateKey(new Date(), tz);
    const d = startOfDayInTimezone(k, tz);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  /* ------------------------------------------------------------------ */
  /* settings                                                            */
  /* ------------------------------------------------------------------ */

  async getRules(): Promise<PayrollRules & { updatedAt?: Date }> {
    let s: any = await this.settingsModel.findOne({ companyId: PAYROLL_COMPANY_ID }).lean();
    if (!s) {
      try {
        s = (
          await this.settingsModel.create({
            companyId: PAYROLL_COMPANY_ID,
            version: 1,
            components: DEFAULT_COMPONENTS,
            statutory: DEFAULT_STATUTORY,
          })
        ).toObject();
      } catch {
        s = await this.settingsModel.findOne({ companyId: PAYROLL_COMPANY_ID }).lean(); // created concurrently
      }
    }
    // Settings saved before the auto-TDS rule existed get the default.
    const statutory = { ...s.statutory, tds: s.statutory?.tds || DEFAULT_STATUTORY.tds };
    return { version: s.version, components: s.components, statutory, updatedAt: s.updatedAt };
  }

  async getSettings(user: any) {
    this.assertAccess(user, 'READ');
    return this.getRules();
  }

  async updateSettings(dto: UpdatePayrollSettingsDto, user: any) {
    this.assertAccess(user, 'MANAGE_SETTINGS');
    const components = (dto.components || []).map((c: any) => ({
      key: String(c.key || '').trim(),
      name: String(c.name || '').trim(),
      percent: Math.round(Number(c.percent) * 100) / 100,
      pfEligible: !!c.pfEligible,
      balancing: !!c.balancing,
    }));
    const s = dto.statutory || {};
    const statutory = {
      pf: {
        enabled: s.pf?.enabled !== false,
        employeeRate: Number(s.pf?.employeeRate ?? 12),
        employerRate: Number(s.pf?.employerRate ?? 12),
        wageCeiling: Number(s.pf?.wageCeiling ?? 15000),
        capAtCeiling: s.pf?.capAtCeiling !== false,
      },
      esi: {
        enabled: s.esi?.enabled !== false,
        employeeRate: Number(s.esi?.employeeRate ?? 0.75),
        employerRate: Number(s.esi?.employerRate ?? 3.25),
        grossLimit: Number(s.esi?.grossLimit ?? 21000),
      },
      pt: {
        enabled: s.pt?.enabled !== false,
        defaultState: String(s.pt?.defaultState || '').trim(),
        states: (s.pt?.states || []).map((st: any) => ({
          state: String(st.state || '').trim(),
          februaryAmount: st.februaryAmount === null || st.februaryAmount === '' || st.februaryAmount === undefined ? null : Number(st.februaryAmount),
          slabs: (st.slabs || []).map((sl: any) => ({
            min: Number(sl.min || 0),
            max: sl.max === null || sl.max === '' || sl.max === undefined ? null : Number(sl.max),
            amount: Number(sl.amount || 0),
          })),
        })),
      },
      tds: {
        noPfPercent: Number(s.tds?.noPfPercent ?? 2),
      },
    };
    const errors = validateRules({ components, statutory });
    if (errors.length) throw new BadRequestException({ message: errors[0], errors });

    const before = await this.getRules();
    const updated = await this.settingsModel.findOneAndUpdate(
      { companyId: PAYROLL_COMPANY_ID },
      { $set: { components, statutory, updatedBy: this.actorId(user) }, $inc: { version: 1 } },
      { new: true, upsert: true },
    );
    await this.audit('settings', PAYROLL_COMPANY_ID, 'UPDATE', user, before, { version: updated?.version, components, statutory });
    return this.getRules();
  }

  /* ------------------------------------------------------------------ */
  /* calculation                                                         */
  /* ------------------------------------------------------------------ */

  private toInput(dto: Partial<SalaryInputDto>): SalaryInput {
    const esi = dto.esiApplicable as any;
    return {
      annualCtc: Number(dto.annualCtc) || 0,
      ptState: dto.ptState?.trim() || null,
      pfApplicable: dto.pfApplicable !== false,
      esiApplicable: esi === true || esi === 'true' ? true : esi === false || esi === 'false' ? false : 'auto',
      tdsMonthly: Number(dto.tdsMonthly) || 0,
      otherDeductions: (dto.otherDeductions || [])
        .filter((o: any) => o && Number(o.amount) > 0)
        .map((o: any) => ({ name: String(o.name || 'Other deduction').slice(0, 60), amount: Number(o.amount) })),
      insuranceAnnual: Math.max(0, Number((dto as any).insuranceAnnual) || 0),
    };
  }

  private cleanComponents(list: any[] | undefined) {
    return (list || []).map((c: any) => ({
      key: String(c.key || '').trim(),
      name: String(c.name || '').trim(),
      percent: Math.round(Number(c.percent) * 100) / 100,
      pfEligible: !!c.pfEligible,
      balancing: !!c.balancing,
    }));
  }

  /**
   * Rules for one employee: company rules → template's own % split (if any)
   * → this employee's custom split (if given).
   */
  private async rulesFor(templateId?: any, customComponents?: any[]): Promise<{ rules: PayrollRules; template: any | null; customized: boolean }> {
    const rules = await this.getRules();
    let template: any = null;
    let components = rules.components;
    if (templateId && Types.ObjectId.isValid(String(templateId))) {
      template = await this.templateModel.findById(templateId).lean();
      if (!template) throw new BadRequestException('Salary structure template not found');
      if (template.components?.length) components = template.components;
    }
    const custom = this.cleanComponents(customComponents);
    if (custom.length) {
      const errors = validateRules({ components: custom, statutory: rules.statutory });
      if (errors.length) throw new BadRequestException({ message: errors[0], errors });
      return { rules: { ...rules, components: custom }, template, customized: true };
    }
    return { rules: { ...rules, components }, template, customized: false };
  }

  /** Breakup with the current rules (no saving). */
  async preview(dto: SalaryInputDto) {
    const { rules, customized } = await this.rulesFor((dto as any).templateId, (dto as any).customComponents);
    // `components` = the % split used, so the UI can offer it for a per-employee change.
    return { ...calculateSalary(rules, this.toInput(dto)), components: rules.components, componentsCustomized: customized };
  }

  async previewFor(dto: SalaryInputDto, user: any) {
    // HR approving an onboarding needs the breakup even without payroll access.
    if (!hasPermission(user, 'user', 'onboarding')) this.assertAccess(user, 'READ');
    return this.preview(dto);
  }

  /* ------------------------------------------------------------------ */
  /* structures                                                          */
  /* ------------------------------------------------------------------ */

  private async buildStructureDoc(dto: Partial<SalaryInputDto> & { templateId?: any; customComponents?: any[] }) {
    const { rules, template, customized } = await this.rulesFor(dto.templateId, dto.customComponents);
    const input = this.toInput(dto);
    if (!(input.annualCtc > 0)) throw new BadRequestException('Annual CTC must be greater than 0');
    const breakup = calculateSalary(rules, input);
    return {
      annualCtc: breakup.annualCtc,
      ptState: input.ptState || undefined,
      pfApplicable: input.pfApplicable !== false,
      esiApplicable: String(input.esiApplicable),
      tdsMonthly: input.tdsMonthly || 0,
      otherDeductions: input.otherDeductions || [],
      insuranceAnnual: input.insuranceAnnual || 0,
      templateId: template?._id,
      templateName: template?.name,
      componentsCustomized: customized,
      rules: { version: rules.version, components: rules.components, statutory: rules.statutory },
      breakup,
    };
  }

  private async assertEmployee(employeeId: string) {
    if (!Types.ObjectId.isValid(employeeId)) throw new BadRequestException('Invalid employee id');
    const user = await this.db.collection('users').findOne({ _id: oid(employeeId) }, { projection: { name: 1 } });
    if (!user) throw new NotFoundException('Employee not found');
    return user;
  }

  async createStructure(dto: CreateSalaryStructureDto, user: any, source: 'manual' | 'revision' = 'manual') {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    await this.assertEmployee(dto.employeeId);
    const doc = await this.buildStructureDoc(dto);
    const created = await this.structureModel.create({
      companyId: PAYROLL_COMPANY_ID,
      employeeId: oid(dto.employeeId),
      effectiveFrom: this.dayStart(dto.effectiveFrom),
      status: SalaryStructureStatus.DRAFT,
      source,
      notes: dto.notes,
      createdBy: this.actorId(user),
      ...doc,
    });
    await this.audit('structure', created._id, 'CREATE_DRAFT', user, undefined, { annualCtc: created.annualCtc, effectiveFrom: created.effectiveFrom });
    return created.toObject();
  }

  async getStructure(id: string, user: any) {
    this.assertAccess(user, 'READ');
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid id');
    const s = await this.structureModel.findById(id).populate('employeeId', 'name employeeId email').lean();
    if (!s) throw new NotFoundException('Salary structure not found');
    return s;
  }

  async updateDraft(id: string, dto: UpdateSalaryStructureDto, user: any) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    const s: any = await this.structureModel.findById(id).lean();
    if (!s) throw new NotFoundException('Salary structure not found');
    if (s.status !== SalaryStructureStatus.DRAFT) throw new BadRequestException('Only draft structures can be changed. Create a revision instead.');
    const merged = {
      annualCtc: dto.annualCtc ?? s.annualCtc,
      ptState: dto.ptState ?? s.ptState,
      pfApplicable: dto.pfApplicable ?? s.pfApplicable,
      esiApplicable: (dto.esiApplicable ?? s.esiApplicable) as any,
      tdsMonthly: dto.tdsMonthly ?? s.tdsMonthly,
      otherDeductions: dto.otherDeductions ?? s.otherDeductions,
      insuranceAnnual: (dto as any).insuranceAnnual ?? s.insuranceAnnual,
      templateId: (dto as any).templateId !== undefined ? (dto as any).templateId || undefined : s.templateId,
      customComponents:
        (dto as any).customComponents !== undefined
          ? (dto as any).customComponents
          : s.componentsCustomized
            ? s.rules?.components
            : undefined,
    };
    const doc = await this.buildStructureDoc(merged as any);
    const set: any = { ...doc };
    if (dto.effectiveFrom) set.effectiveFrom = this.dayStart(dto.effectiveFrom);
    if (dto.notes !== undefined) set.notes = dto.notes;
    const updated = await this.structureModel.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
    if (s.source === 'revision') {
      await this.revisionModel.updateOne(
        { toStructureId: s._id, status: 'pending' },
        { $set: { newAnnualCtc: doc.annualCtc, ...(set.effectiveFrom ? { effectiveFrom: set.effectiveFrom } : {}) } },
      );
    }
    await this.audit('structure', id, 'UPDATE_DRAFT', user, { annualCtc: s.annualCtc }, { annualCtc: doc.annualCtc });
    return updated;
  }

  /** Approved structure in force on `at` (latest effectiveFrom ≤ at). */
  async effectiveStructure(employeeId: string, at = new Date()) {
    return this.structureModel
      .findOne({
        companyId: PAYROLL_COMPANY_ID,
        employeeId: oid(employeeId),
        status: SalaryStructureStatus.APPROVED,
        effectiveFrom: { $lte: at },
      })
      .sort({ effectiveFrom: -1 })
      .lean();
  }

  async approveStructure(id: string, user: any) {
    this.assertAccess(user, 'APPROVE_STRUCTURES');
    const s: any = await this.structureModel.findById(id).lean();
    if (!s) throw new NotFoundException('Salary structure not found');
    if (s.status !== SalaryStructureStatus.DRAFT) throw new BadRequestException(`This structure is already ${s.status}`);
    const clash = await this.structureModel.exists({
      companyId: PAYROLL_COMPANY_ID,
      employeeId: s.employeeId,
      status: SalaryStructureStatus.APPROVED,
      effectiveFrom: s.effectiveFrom,
    });
    if (clash) throw new BadRequestException('Another approved structure starts on the same date. Choose a different effective date.');

    // Recalculate with the current rules – the rules may have changed since the draft.
    const doc = await this.buildStructureDoc(s);
    const previous = await this.effectiveStructure(String(s.employeeId), new Date(s.effectiveFrom.getTime() - 1));
    const now = new Date();
    await this.structureModel.updateOne(
      { _id: s._id, status: SalaryStructureStatus.DRAFT },
      { $set: { ...doc, status: SalaryStructureStatus.APPROVED, approvedBy: this.actorId(user), approvedAt: now } },
    );
    const revisionUpdate = {
      status: 'approved',
      approvedBy: this.actorId(user),
      approvedAt: now,
      newAnnualCtc: doc.annualCtc,
      oldAnnualCtc: previous?.annualCtc || 0,
      fromStructureId: previous?._id,
      changePercent: previous?.annualCtc ? Math.round(((doc.annualCtc - previous.annualCtc) / previous.annualCtc) * 10000) / 100 : null,
    };
    const rev = await this.revisionModel.updateOne({ toStructureId: s._id, status: 'pending' }, { $set: revisionUpdate });
    if (!rev.matchedCount) {
      await this.revisionModel.create({
        companyId: PAYROLL_COMPANY_ID,
        employeeId: s.employeeId,
        toStructureId: s._id,
        effectiveFrom: s.effectiveFrom,
        reason: s.notes,
        createdBy: s.createdBy,
        ...revisionUpdate,
      });
    }
    await this.audit('structure', id, 'APPROVE', user, { status: 'draft' }, { status: 'approved', annualCtc: doc.annualCtc });
    await this.syncProfileSalary(String(s.employeeId));
    return this.structureModel.findById(id).lean();
  }

  async cancelDraft(id: string, user: any) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    const res = await this.structureModel.findOneAndUpdate(
      { _id: id, status: SalaryStructureStatus.DRAFT },
      { $set: { status: SalaryStructureStatus.CANCELLED } },
      { new: true },
    );
    if (!res) throw new BadRequestException('Only draft structures can be cancelled');
    await this.revisionModel.updateOne({ toStructureId: res._id, status: 'pending' }, { $set: { status: 'cancelled' } });
    await this.audit('structure', id, 'CANCEL', user);
    return res.toObject();
  }

  /* ------------------------------------------------------------------ */
  /* revisions                                                           */
  /* ------------------------------------------------------------------ */

  async createRevision(dto: CreateSalaryRevisionDto, user: any) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    const current = await this.effectiveStructure(dto.employeeId, this.dayStart(dto.effectiveFrom));
    const draft: any = await this.createStructure({ ...dto, notes: dto.reason }, user, 'revision');
    const revision = await this.revisionModel.create({
      companyId: PAYROLL_COMPANY_ID,
      employeeId: oid(dto.employeeId),
      fromStructureId: current?._id,
      toStructureId: draft._id,
      oldAnnualCtc: current?.annualCtc || 0,
      newAnnualCtc: draft.annualCtc,
      changePercent: current?.annualCtc ? Math.round(((draft.annualCtc - current.annualCtc) / current.annualCtc) * 10000) / 100 : null,
      effectiveFrom: draft.effectiveFrom,
      reason: dto.reason,
      status: 'pending',
      createdBy: this.actorId(user),
    });
    return { revision: revision.toObject(), structure: draft };
  }

  async listRevisions(employeeId: string, user: any) {
    this.assertAccess(user, 'READ');
    if (!Types.ObjectId.isValid(employeeId)) throw new BadRequestException('Invalid employee id');
    return this.revisionModel
      .find({ companyId: PAYROLL_COMPANY_ID, employeeId: oid(employeeId) })
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .populate('createdBy', 'name')
      .populate('approvedBy', 'name')
      .lean();
  }

  /* ------------------------------------------------------------------ */
  /* employees                                                           */
  /* ------------------------------------------------------------------ */

  async listEmployees(user: any, status?: string, asOf?: string) {
    this.assertAccess(user, 'READ');
    // "As on" date: the structure in force on that day (end of day).
    const now = asOf ? new Date(this.dayStart(asOf).getTime() + 86_400_000 - 1) : new Date();
    const userFilter: any = {};
    if (status && status !== 'all') userFilter.status = status;
    const [users, profiles, current, drafts] = await Promise.all([
      this.db.collection('users').find(userFilter, { projection: { name: 1, employeeId: 1, email: 1, status: 1, role: 1 } }).toArray(),
      this.db.collection('profiles').find({}, { projection: { userId: 1, departmentId: 1, salary: 1 } }).toArray(),
      this.structureModel.aggregate([
        { $match: { companyId: PAYROLL_COMPANY_ID, status: SalaryStructureStatus.APPROVED, effectiveFrom: { $lte: now } } },
        { $sort: { effectiveFrom: -1 } },
        { $group: { _id: '$employeeId', s: { $first: '$$ROOT' } } },
      ]),
      this.structureModel.aggregate([
        { $match: { companyId: PAYROLL_COMPANY_ID, status: SalaryStructureStatus.DRAFT } },
        { $group: { _id: '$employeeId', count: { $sum: 1 } } },
      ]),
    ]);
    const [departments, roles] = await Promise.all([
      this.db.collection('departments').find({}, { projection: { name: 1 } }).toArray(),
      this.db.collection('roles').find({}, { projection: { name: 1 } }).toArray(),
    ]);
    const deptName = new Map(departments.map((d: any) => [String(d._id), d.name]));
    const roleName = new Map(roles.map((r: any) => [String(r._id), r.name]));
    const profileBy = new Map(profiles.map((p: any) => [String(p.userId), p]));
    const currentBy = new Map(current.map((c: any) => [String(c._id), c.s]));
    const draftsBy = new Map(drafts.map((d: any) => [String(d._id), d.count]));

    return users
      .map((u: any) => {
        const id = String(u._id);
        const s: any = currentBy.get(id);
        const p: any = profileBy.get(id);
        return {
          _id: id,
          name: u.name,
          employeeId: u.employeeId,
          email: u.email,
          status: u.status,
          role: roleName.get(String(u.role)) || null,
          department: p?.departmentId ? deptName.get(String(p.departmentId)) || null : null,
          profileMonthlySalary: p?.salary ?? null,
          structureId: s?._id || null,
          annualCtc: s?.annualCtc ?? null,
          grossMonthly: s?.breakup?.grossMonthly ?? null,
          netMonthly: s?.breakup?.netMonthly ?? null,
          effectiveFrom: s?.effectiveFrom ?? null,
          templateName: s?.templateName ?? null,
          pfApplicable: s?.pfApplicable ?? null,
          insuranceAnnual: s?.insuranceAnnual ?? 0,
          pendingDrafts: draftsBy.get(id) || 0,
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async employeeSalaryProfile(employeeId: string, user: any) {
    this.assertAccess(user, 'READ');
    const emp: any = await this.assertEmployee(employeeId);
    const [current, structures, revisions, profile] = await Promise.all([
      this.effectiveStructure(employeeId),
      this.structureModel
        .find({ companyId: PAYROLL_COMPANY_ID, employeeId: oid(employeeId), status: { $ne: SalaryStructureStatus.CANCELLED } })
        .sort({ effectiveFrom: -1, createdAt: -1 })
        .populate('createdBy', 'name')
        .populate('approvedBy', 'name')
        .lean(),
      this.listRevisions(employeeId, user),
      this.db
        .collection('profiles')
        .findOne({ userId: oid(employeeId) }, { projection: { address: 1, currentAddress: 1, salary: 1, statutoryDetails: 1 } }),
    ]);
    return {
      employee: { _id: employeeId, name: emp.name },
      statutoryDetails: profile?.statutoryDetails || {},
      suggestedPtState: profile?.currentAddress?.state || profile?.address?.state || null,
      current,
      structures,
      revisions,
    };
  }

  /* ------------------------------------------------------------------ */
  /* salary structure templates                                          */
  /* ------------------------------------------------------------------ */

  private cleanTemplate(dto: any) {
    const components = (dto.components || []).map((c: any) => ({
      key: String(c.key || '').trim(),
      name: String(c.name || '').trim(),
      percent: Math.round(Number(c.percent) * 100) / 100,
      pfEligible: !!c.pfEligible,
      balancing: !!c.balancing,
    }));
    const esi = dto.esiApplicable;
    return {
      name: String(dto.name || '').trim(),
      description: dto.description?.trim() || undefined,
      components,
      defaultAnnualCtc: Math.max(0, Math.round(Number(dto.defaultAnnualCtc) || 0)),
      pfApplicable: dto.pfApplicable !== false,
      esiApplicable: esi === true || esi === 'true' ? 'true' : esi === false || esi === 'false' ? 'false' : 'auto',
      insuranceAnnual: Math.max(0, Math.round(Number(dto.insuranceAnnual) || 0)),
      tdsMonthly: Math.max(0, Math.round(Number(dto.tdsMonthly) || 0)),
      ptState: dto.ptState?.trim() || undefined,
      otherDeductions: (dto.otherDeductions || [])
        .filter((o: any) => o && Number(o.amount) > 0)
        .map((o: any) => ({ name: String(o.name || 'Other deduction').slice(0, 60), amount: Number(o.amount) })),
    };
  }

  private async validateTemplate(t: ReturnType<PayrollService['cleanTemplate']>) {
    if (!t.name) throw new BadRequestException('Give the template a name');
    if (t.components.length) {
      const rules = await this.getRules();
      const errors = validateRules({ components: t.components, statutory: rules.statutory });
      if (errors.length) throw new BadRequestException({ message: errors[0], errors });
    }
  }

  /** Active templates are visible to anyone who can preview a CTC (HR at onboarding too). */
  async listTemplates(user: any, includeInactive = false) {
    if (!hasPermission(user, 'user', 'onboarding')) this.assertAccess(user, 'READ');
    const filter: any = { companyId: PAYROLL_COMPANY_ID };
    if (!includeInactive) filter.isActive = true;
    const [templates, usage] = await Promise.all([
      this.templateModel.find(filter).sort({ isActive: -1, name: 1 }).lean(),
      this.structureModel.aggregate([
        { $match: { companyId: PAYROLL_COMPANY_ID, status: SalaryStructureStatus.APPROVED, templateId: { $ne: null } } },
        { $group: { _id: '$templateId', employees: { $addToSet: '$employeeId' } } },
      ]),
    ]);
    const used = new Map(usage.map((u: any) => [String(u._id), u.employees.length]));
    return templates.map((t: any) => ({ ...t, employees: used.get(String(t._id)) || 0 }));
  }

  async createTemplate(dto: any, user: any) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    const t = this.cleanTemplate(dto);
    await this.validateTemplate(t);
    try {
      const created = await this.templateModel.create({ companyId: PAYROLL_COMPANY_ID, ...t, isActive: true, createdBy: this.actorId(user) });
      await this.audit('template', created._id, 'CREATE', user, undefined, t);
      return created.toObject();
    } catch (e: any) {
      if (e?.code === 11000) throw new BadRequestException('A template with this name already exists');
      throw e;
    }
  }

  async updateTemplate(id: string, dto: any, user: any) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    const before: any = await this.templateModel.findById(id).lean();
    if (!before) throw new NotFoundException('Template not found');
    const t = this.cleanTemplate({ ...before, ...dto });
    await this.validateTemplate(t);
    const set: any = { ...t, updatedBy: this.actorId(user) };
    if (dto.isActive !== undefined) set.isActive = !!dto.isActive;
    try {
      const updated = await this.templateModel.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
      await this.audit('template', id, 'UPDATE', user, before, set);
      return updated;
    } catch (e: any) {
      if (e?.code === 11000) throw new BadRequestException('A template with this name already exists');
      throw e;
    }
  }

  /* ------------------------------------------------------------------ */
  /* salary revision: % increment + history                              */
  /* ------------------------------------------------------------------ */

  /**
   * Increment the CTC of one or more employees by a % (or to a new CTC for
   * one employee). Creates revision drafts; approves them at once when the
   * user may approve and asked to.
   */
  async incrementSalaries(
    dto: { employeeIds: string[]; percent?: number; newAnnualCtc?: number; effectiveFrom: string; reason?: string; approveNow?: boolean },
    user: any,
  ) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    const ids = [...new Set((dto.employeeIds || []).filter((i) => Types.ObjectId.isValid(i)))];
    if (!ids.length) throw new BadRequestException('Choose at least one employee');
    const pct = Number(dto.percent);
    const fixed = Number(dto.newAnnualCtc);
    if (!(fixed > 0) && !(Number.isFinite(pct) && pct !== 0)) throw new BadRequestException('Enter the increment % (or the new CTC)');
    if (fixed > 0 && ids.length > 1) throw new BadRequestException('A new CTC amount can be set for one employee at a time; use % for several');
    if (Number.isFinite(pct) && pct <= -100) throw new BadRequestException('Increment % must be more than -100');
    const approveNow = !!dto.approveNow && this.can(user, 'APPROVE_STRUCTURES');
    const at = this.dayStart(dto.effectiveFrom);

    const results: any[] = [];
    for (const employeeId of ids) {
      try {
        const current: any = await this.effectiveStructure(employeeId, new Date(at.getTime() + 86_400_000 - 1));
        if (!current) throw new BadRequestException('No approved salary structure yet – create one first');
        const newCtc = fixed > 0 ? Math.round(fixed) : Math.round(current.annualCtc * (1 + pct / 100));
        const { revision, structure } = await this.createRevision(
          {
            employeeId,
            effectiveFrom: dto.effectiveFrom,
            reason: dto.reason || (fixed > 0 ? 'Salary revision' : `Increment ${pct}%`),
            annualCtc: newCtc,
            ptState: current.ptState,
            pfApplicable: current.pfApplicable,
            esiApplicable: current.esiApplicable as any,
            tdsMonthly: current.tdsMonthly,
            otherDeductions: current.otherDeductions,
            insuranceAnnual: current.insuranceAnnual,
            templateId: current.templateId ? String(current.templateId) : undefined,
            customComponents: current.componentsCustomized ? current.rules?.components : undefined,
          } as any,
          user,
        );
        if (approveNow) await this.approveStructure(String(structure._id), user);
        results.push({ employeeId, ok: true, oldAnnualCtc: current.annualCtc, newAnnualCtc: newCtc, revisionId: revision._id, approved: approveNow });
      } catch (e: any) {
        results.push({ employeeId, ok: false, error: e?.response?.message || e?.message || 'Failed' });
      }
    }
    return {
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      approved: approveNow,
      results,
    };
  }

  /** Every revision (all employees) with filters – the salary history. */
  async revisionHistory(user: any, query: { from?: string; to?: string; employeeId?: string; status?: string }) {
    this.assertAccess(user, 'READ');
    const filter: any = { companyId: PAYROLL_COMPANY_ID };
    if (query.employeeId && Types.ObjectId.isValid(query.employeeId)) filter.employeeId = oid(query.employeeId);
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.from || query.to) {
      filter.effectiveFrom = {};
      if (query.from) filter.effectiveFrom.$gte = this.dayStart(query.from);
      if (query.to) filter.effectiveFrom.$lt = new Date(this.dayStart(query.to).getTime() + 86_400_000);
    }
    const rows: any[] = await this.revisionModel
      .find(filter)
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .limit(3000)
      .populate('employeeId', 'name employeeId email status')
      .populate('createdBy', 'name')
      .populate('approvedBy', 'name')
      .populate('toStructureId', 'status breakup.grossMonthly breakup.netMonthly templateName')
      .lean();
    return rows.map((r) => ({
      ...r,
      changeAmount: (r.newAnnualCtc || 0) - (r.oldAnnualCtc || 0),
      newGrossMonthly: r.toStructureId?.breakup?.grossMonthly ?? null,
      newNetMonthly: r.toStructureId?.breakup?.netMonthly ?? null,
      structureStatus: r.toStructureId?.status ?? null,
      toStructureId: r.toStructureId?._id ?? r.toStructureId,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* payslip details (UAN, PF a/c …)                                     */
  /* ------------------------------------------------------------------ */

  async updateStatutoryDetails(employeeId: string, dto: { uan?: string; pfNumber?: string; esiNumber?: string; dateOfJoining?: string }, user: any) {
    this.assertAccess(user, 'MANAGE_STRUCTURES');
    await this.assertEmployee(employeeId);
    const clean = (v?: string) => (v === undefined ? undefined : String(v).trim().slice(0, 40));
    if (dto.dateOfJoining && !/^\d{4}-\d{2}-\d{2}$/.test(dto.dateOfJoining)) throw new BadRequestException('Date of joining must be YYYY-MM-DD');
    const set: any = {};
    for (const k of ['uan', 'pfNumber', 'esiNumber', 'dateOfJoining'] as const) {
      const v = clean(dto[k]);
      if (v !== undefined) set[`statutoryDetails.${k}`] = v;
    }
    await this.db.collection('profiles').updateOne({ userId: oid(employeeId) }, { $set: set });
    const p = await this.db.collection('profiles').findOne({ userId: oid(employeeId) }, { projection: { statutoryDetails: 1 } });
    return p?.statutoryDetails || {};
  }

  /* ------------------------------------------------------------------ */
  /* onboarding hook + profile salary sync                               */
  /* ------------------------------------------------------------------ */

  /**
   * Called when HR approves an onboarding: saves the CTC as an approved
   * structure (replacing an earlier onboarding structure with the same date).
   */
  async applyOnboardingCtc(employeeId: string, input: SalaryInputDto & { effectiveFrom?: string }, user: any) {
    const doc = await this.buildStructureDoc(input);
    const effectiveFrom = this.dayStart(input.effectiveFrom);
    const previous = await this.effectiveStructure(employeeId, new Date(effectiveFrom.getTime() - 1));
    await this.structureModel.updateMany(
      { companyId: PAYROLL_COMPANY_ID, employeeId: oid(employeeId), status: SalaryStructureStatus.APPROVED, effectiveFrom },
      { $set: { status: SalaryStructureStatus.SUPERSEDED } },
    );
    const now = new Date();
    const created = await this.structureModel.create({
      companyId: PAYROLL_COMPANY_ID,
      employeeId: oid(employeeId),
      effectiveFrom,
      status: SalaryStructureStatus.APPROVED,
      source: 'onboarding',
      notes: 'Set at onboarding approval',
      createdBy: this.actorId(user),
      approvedBy: this.actorId(user),
      approvedAt: now,
      ...doc,
    });
    await this.revisionModel.create({
      companyId: PAYROLL_COMPANY_ID,
      employeeId: oid(employeeId),
      fromStructureId: previous?._id,
      toStructureId: created._id,
      oldAnnualCtc: previous?.annualCtc || 0,
      newAnnualCtc: created.annualCtc,
      changePercent: previous?.annualCtc ? Math.round(((created.annualCtc - previous.annualCtc) / previous.annualCtc) * 10000) / 100 : null,
      effectiveFrom,
      reason: 'Onboarding',
      status: 'approved',
      createdBy: this.actorId(user),
      approvedBy: this.actorId(user),
      approvedAt: now,
    });
    await this.audit('structure', created._id, 'ONBOARDING_APPROVE', user, undefined, { annualCtc: created.annualCtc });
    await this.syncProfileSalary(employeeId);
    return created.toObject();
  }

  /** Profile.salary (used by the Salary Sheet) = monthly gross of the structure in force. */
  async syncProfileSalary(employeeId: string) {
    const s: any = await this.effectiveStructure(employeeId);
    if (!s) return;
    await this.db
      .collection('profiles')
      .updateOne({ userId: oid(employeeId) }, { $set: { salary: s.breakup?.grossMonthly ?? Math.round(s.annualCtc / 12) } });
  }

  /** Applies revisions whose effective date has arrived. */
  @Cron('0 10 0 * * *', { timeZone: 'Asia/Kolkata' })
  async syncAllProfileSalaries() {
    try {
      const rows = await this.structureModel.aggregate([
        { $match: { companyId: PAYROLL_COMPANY_ID, status: SalaryStructureStatus.APPROVED, effectiveFrom: { $lte: new Date() } } },
        { $sort: { effectiveFrom: -1 } },
        { $group: { _id: '$employeeId', gross: { $first: '$breakup.grossMonthly' } } },
      ]);
      if (!rows.length) return 0;
      const res = await this.db.collection('profiles').bulkWrite(
        rows
          .filter((r: any) => typeof r.gross === 'number')
          .map((r: any) => ({ updateOne: { filter: { userId: r._id, salary: { $ne: r.gross } }, update: { $set: { salary: r.gross } } } })),
        { ordered: false },
      );
      if (res.modifiedCount) this.logger.log(`Payroll: monthly salary updated for ${res.modifiedCount} employees`);
      return res.modifiedCount;
    } catch (e: any) {
      this.logger.warn(`Payroll salary sync failed: ${e?.message}`);
      return 0;
    }
  }
}
