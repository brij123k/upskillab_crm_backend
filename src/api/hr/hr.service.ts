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
  DOCUMENT_TYPES,
  EXIT_REASONS,
  EXPENSE_CATEGORIES,
  EmployeeDocument,
  ExitRequest,
  ExitStatus,
  ExpenseClaim,
  ExpenseStatus,
} from 'src/schema/hr/hr.schema';
import { hasPermission, isAdminUser } from 'src/common/utils/has-permission.util';
import {
  getBusinessTimezone,
  startOfDayInTimezone,
  toDateKey,
} from '../order_management/financial/order-financial.util';
import { FileUploaderService } from '../file-uploader/file-uploader.service';

/**
 * Permission module "hr":
 *  approve_exit      – see and approve / reject every exit request
 *  manage_documents  – upload / delete documents for any employee
 *  manage_expenses   – approve / reject / mark paid every expense claim
 *  reports           – HR reports (employee report)
 *  dashboard         – HR dashboard (numbers cover every employee with
 *                      user:all_users, otherwise the user's own team)
 * Everyone can raise their own exit request and expense claims and see their
 * own documents. Reporting seniors can upload documents for their team.
 */
export const HR_PERMISSIONS = {
  MODULE: 'hr',
  APPROVE_EXIT: 'approve_exit',
  MANAGE_DOCUMENTS: 'manage_documents',
  MANAGE_EXPENSES: 'manage_expenses',
  REPORTS: 'reports',
  /** "HR Dashboard" - may be given to any role. */
  DASHBOARD: 'dashboard',
} as const;

const oid = (v: any) => new Types.ObjectId(String(v));
const isId = (v: any) => !!v && Types.ObjectId.isValid(String(v));

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(
    @InjectModel(ExitRequest.name) private readonly exitModel: Model<ExitRequest>,
    @InjectModel(EmployeeDocument.name) private readonly documentModel: Model<EmployeeDocument>,
    @InjectModel(ExpenseClaim.name) private readonly expenseModel: Model<ExpenseClaim>,
    private readonly uploader: FileUploaderService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  private get db() {
    return this.exitModel.db;
  }

  private me(user: any) {
    const id = user?.userId || user?._id;
    if (!isId(id)) throw new ForbiddenException('Invalid session');
    return String(id);
  }

  isAdmin(user: any) {
    return isAdminUser(user) || !!user?.isSuperAdmin;
  }

  can(user: any, action: string) {
    return this.isAdmin(user) || hasPermission(user, HR_PERMISSIONS.MODULE, action);
  }

  private assert(user: any, action: string, message: string) {
    if (!this.can(user, action)) throw new ForbiddenException(message);
  }

  private dayStart(key?: string) {
    const tz = getBusinessTimezone();
    const k = key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : toDateKey(new Date(), tz);
    const d = startOfDayInTimezone(k, tz);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  /** Every employee below `userId` in the reporting tree (all levels). */
  async teamIds(userId: string): Promise<string[]> {
    const profiles = await this.db
      .collection('profiles')
      .find({ reportingSeniorId: { $ne: null } }, { projection: { userId: 1, reportingSeniorId: 1 } })
      .toArray();
    const children = new Map<string, string[]>();
    for (const p of profiles) {
      const senior = String(p.reportingSeniorId);
      if (!children.has(senior)) children.set(senior, []);
      children.get(senior)!.push(String(p.userId));
    }
    const out = new Set<string>();
    const queue = [String(userId)];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const c of children.get(cur) || []) {
        if (!out.has(c) && c !== String(userId)) {
          out.add(c);
          queue.push(c);
        }
      }
    }
    return [...out];
  }

  private async userBrief(ids: string[]) {
    const valid = [...new Set(ids.filter(isId))];
    if (!valid.length) return new Map<string, any>();
    const users = await this.db
      .collection('users')
      .find({ _id: { $in: valid.map(oid) } }, { projection: { name: 1, employeeId: 1, email: 1, status: 1 } })
      .toArray();
    return new Map(users.map((u: any) => [String(u._id), { _id: String(u._id), name: u.name, employeeId: u.employeeId, email: u.email, status: u.status }]));
  }

  private async withPeople<T extends Record<string, any>>(rows: T[], fields: string[]) {
    const ids = rows.flatMap((r) => fields.map((f) => (r[f] ? String(r[f]) : ''))).filter(Boolean);
    const people = await this.userBrief(ids);
    return rows.map((r) => {
      const out: any = { ...r };
      for (const f of fields) out[f] = r[f] ? people.get(String(r[f])) || { _id: String(r[f]) } : null;
      return out;
    });
  }

  /** Access summary for the frontend (which HR menus / actions to show). */
  async access(user: any) {
    const me = this.me(user);
    const team = await this.teamIds(me);
    return {
      isAdmin: this.isAdmin(user),
      approveExit: this.can(user, HR_PERMISSIONS.APPROVE_EXIT),
      manageDocuments: this.can(user, HR_PERMISSIONS.MANAGE_DOCUMENTS),
      manageExpenses: this.can(user, HR_PERMISSIONS.MANAGE_EXPENSES),
      reports: this.can(user, HR_PERMISSIONS.REPORTS),
      dashboard: this.can(user, HR_PERMISSIONS.DASHBOARD),
      allUsers: this.hasAllUsers(user),
      hasTeam: team.length > 0,
      teamSize: team.length,
    };
  }

  /** Employees the user may pick in HR forms. */
  async employeesForPicker(user: any, scope?: string) {
    const me = this.me(user);
    const full =
      this.can(user, HR_PERMISSIONS.MANAGE_DOCUMENTS) ||
      this.can(user, HR_PERMISSIONS.APPROVE_EXIT) ||
      this.can(user, HR_PERMISSIONS.MANAGE_EXPENSES) ||
      this.can(user, HR_PERMISSIONS.REPORTS) ||
      hasPermission(user, 'payroll', 'read') ||
      hasPermission(user, 'payroll', 'run_payroll') ||
      hasPermission(user, 'payroll', 'manage_payments');
    const filter: any = {};
    if (!full || scope === 'team') {
      const team = await this.teamIds(me);
      filter._id = { $in: [me, ...team].map(oid) };
    }
    const users = await this.db
      .collection('users')
      .find(filter, { projection: { name: 1, employeeId: 1, email: 1, status: 1 } })
      .sort({ name: 1 })
      .toArray();
    return users.map((u: any) => ({ _id: String(u._id), name: u.name, employeeId: u.employeeId, email: u.email, status: u.status }));
  }

  async upload(file: Express.Multer.File | undefined, folder: string) {
    if (!file) throw new BadRequestException('Choose a file to upload');
    if (!ALLOWED_UPLOAD_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only PDF, images (JPG, PNG, WEBP), Word or Excel files are allowed');
    }
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('File must be 10 MB or smaller');
    const allowed = ['documents', 'expenses'];
    const data = await this.uploader.uploadFile(file, `hr/${allowed.includes(folder) ? folder : 'documents'}`);
    return { success: true, data };
  }

  /* ------------------------------------------------------------------ */
  /* exit management                                                     */
  /* ------------------------------------------------------------------ */

  exitOptions() {
    return { reasons: EXIT_REASONS };
  }

  async createExit(dto: { reasonCategory: string; reason: string; lastWorkingDay: string }, user: any) {
    const me = this.me(user);
    const open = await this.exitModel.exists({ employeeId: oid(me), status: { $in: [ExitStatus.PENDING, ExitStatus.APPROVED] } });
    if (open) throw new BadRequestException('You already have an exit request in progress');
    if (!dto.reason?.trim()) throw new BadRequestException('Please tell us why you want to exit');
    const lwd = this.dayStart(dto.lastWorkingDay);
    if (lwd.getTime() < this.dayStart().getTime()) throw new BadRequestException('Last working day cannot be in the past');
    const created = await this.exitModel.create({
      employeeId: oid(me),
      reasonCategory: dto.reasonCategory?.trim() || 'Other',
      reason: dto.reason.trim(),
      requestedLastWorkingDay: lwd,
      status: ExitStatus.PENDING,
    });
    return created.toObject();
  }

  async myExits(user: any) {
    const rows = await this.exitModel.find({ employeeId: oid(this.me(user)) }).sort({ createdAt: -1 }).lean();
    return this.withPeople(rows, ['decisionBy']);
  }

  async withdrawExit(id: string, user: any) {
    const res = await this.exitModel.findOneAndUpdate(
      { _id: id, employeeId: oid(this.me(user)), status: ExitStatus.PENDING },
      { $set: { status: ExitStatus.WITHDRAWN, decisionAt: new Date() } },
      { new: true },
    );
    if (!res) throw new BadRequestException('Only your pending requests can be withdrawn');
    return res.toObject();
  }

  async listExits(user: any, query: { status?: string; search?: string }) {
    this.assert(user, HR_PERMISSIONS.APPROVE_EXIT, 'You cannot review exit requests');
    const filter: any = {};
    if (query.status && query.status !== 'all') filter.status = query.status;
    let rows: any[] = await this.exitModel.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    rows = await this.withPeople(rows, ['employeeId', 'decisionBy']);
    if (query.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      rows = rows.filter((r) => `${r.employeeId?.name || ''} ${r.employeeId?.employeeId || ''} ${r.employeeId?.email || ''}`.toLowerCase().includes(q));
    }
    const counts = await this.exitModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    return { data: rows, counts: Object.fromEntries(counts.map((c: any) => [c._id, c.count])) };
  }

  private async deactivateUser(employeeId: any) {
    await this.db.collection('users').updateOne({ _id: oid(employeeId) }, { $set: { status: 'inactive', updatedAt: new Date() } });
  }

  async decideExit(
    id: string,
    dto: { decision: 'approve' | 'reject'; remarks?: string; lastWorkingDay?: string; deactivateMode?: 'now' | 'last_day' },
    user: any,
  ) {
    this.assert(user, HR_PERMISSIONS.APPROVE_EXIT, 'You cannot approve exit requests');
    const req: any = await this.exitModel.findById(id).lean();
    if (!req) throw new NotFoundException('Exit request not found');
    if (req.status !== ExitStatus.PENDING) throw new BadRequestException(`This request is already ${req.status}`);
    if (String(req.employeeId) === this.me(user) && !this.isAdmin(user)) {
      throw new ForbiddenException('You cannot approve your own exit request');
    }
    const now = new Date();
    if (dto.decision === 'reject') {
      if (!dto.remarks?.trim()) throw new BadRequestException('Please add a reason for rejecting');
      await this.exitModel.updateOne(
        { _id: id, status: ExitStatus.PENDING },
        { $set: { status: ExitStatus.REJECTED, decisionBy: oid(this.me(user)), decisionAt: now, decisionRemarks: dto.remarks.trim() } },
      );
      return this.exitModel.findById(id).lean();
    }

    const lwd = dto.lastWorkingDay ? this.dayStart(dto.lastWorkingDay) : new Date(req.requestedLastWorkingDay);
    const mode = dto.deactivateMode === 'last_day' ? 'last_day' : 'now';
    // Deactivate now, or right away if the last working day has already passed.
    const deactivateNow = mode === 'now' || lwd.getTime() <= this.dayStart().getTime();
    await this.exitModel.updateOne(
      { _id: id, status: ExitStatus.PENDING },
      {
        $set: {
          status: ExitStatus.APPROVED,
          lastWorkingDay: lwd,
          decisionBy: oid(this.me(user)),
          decisionAt: now,
          decisionRemarks: dto.remarks?.trim() || undefined,
          deactivateMode: mode,
          ...(deactivateNow ? { deactivated: true, deactivatedAt: now } : {}),
        },
      },
    );
    if (deactivateNow) await this.deactivateUser(req.employeeId);
    return this.exitModel.findById(id).lean();
  }

  /** Approved exits whose last working day has come → deactivate the account. */
  @Cron('0 20 0 * * *', { timeZone: 'Asia/Kolkata' })
  async deactivateDueExits() {
    try {
      const due = await this.exitModel
        .find({ status: ExitStatus.APPROVED, deactivated: false, lastWorkingDay: { $lte: this.dayStart() } })
        .lean();
      for (const e of due) {
        await this.deactivateUser(e.employeeId);
        await this.exitModel.updateOne({ _id: e._id }, { $set: { deactivated: true, deactivatedAt: new Date() } });
      }
      if (due.length) this.logger.log(`Exit: deactivated ${due.length} account(s) on their last working day`);
      return due.length;
    } catch (e: any) {
      this.logger.warn(`Exit deactivation failed: ${e?.message}`);
      return 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* employee documents                                                  */
  /* ------------------------------------------------------------------ */

  documentTypes() {
    return Object.entries(DOCUMENT_TYPES).map(([value, label]) => ({ value, label }));
  }

  /** null = every employee; otherwise the ids the user may manage. */
  private async documentScope(user: any): Promise<string[] | null> {
    if (this.can(user, HR_PERMISSIONS.MANAGE_DOCUMENTS)) return null;
    return this.teamIds(this.me(user));
  }

  async listDocuments(user: any, query: { employeeId?: string; type?: string; mine?: string }) {
    const me = this.me(user);
    const filter: any = { deleted: false };
    if (query.mine === 'true') {
      filter.employeeId = oid(me);
    } else {
      const scope = await this.documentScope(user);
      if (scope !== null) {
        const allowed = [me, ...scope];
        if (query.employeeId && !allowed.includes(query.employeeId)) throw new ForbiddenException('You cannot see this employee’s documents');
        filter.employeeId = query.employeeId ? oid(query.employeeId) : { $in: allowed.map(oid) };
      } else if (query.employeeId) {
        if (!isId(query.employeeId)) throw new BadRequestException('Invalid employee');
        filter.employeeId = oid(query.employeeId);
      }
    }
    if (query.type && query.type !== 'all') filter.type = query.type;
    const rows = await this.documentModel.find(filter).sort({ createdAt: -1 }).limit(2000).lean();
    return this.withPeople(rows, ['employeeId', 'uploadedBy']);
  }

  async createDocument(
    dto: { employeeId: string; type: string; title: string; fileUrl: string; fileName?: string; documentDate?: string; notes?: string },
    user: any,
  ) {
    if (!isId(dto.employeeId)) throw new BadRequestException('Choose an employee');
    const scope = await this.documentScope(user);
    if (scope !== null && !scope.includes(dto.employeeId)) {
      throw new ForbiddenException('You can upload documents only for your team');
    }
    if (!DOCUMENT_TYPES[dto.type]) throw new BadRequestException('Choose a document type');
    if (!dto.fileUrl?.trim()) throw new BadRequestException('Upload the document file');
    const exists = await this.db.collection('users').findOne({ _id: oid(dto.employeeId) }, { projection: { _id: 1 } });
    if (!exists) throw new NotFoundException('Employee not found');
    const created = await this.documentModel.create({
      employeeId: oid(dto.employeeId),
      type: dto.type,
      title: dto.title?.trim() || DOCUMENT_TYPES[dto.type],
      fileUrl: dto.fileUrl.trim(),
      fileName: dto.fileName,
      documentDate: dto.documentDate ? this.dayStart(dto.documentDate) : undefined,
      notes: dto.notes?.trim() || undefined,
      uploadedBy: oid(this.me(user)),
    });
    return created.toObject();
  }

  async deleteDocument(id: string, user: any) {
    const doc: any = await this.documentModel.findOne({ _id: id, deleted: false }).lean();
    if (!doc) throw new NotFoundException('Document not found');
    const scope = await this.documentScope(user);
    const mineUpload = String(doc.uploadedBy) === this.me(user);
    if (scope !== null && !(mineUpload && scope.includes(String(doc.employeeId)))) {
      throw new ForbiddenException('You cannot delete this document');
    }
    await this.documentModel.updateOne({ _id: id }, { $set: { deleted: true } });
    return { success: true };
  }

  /* ------------------------------------------------------------------ */
  /* expenses                                                            */
  /* ------------------------------------------------------------------ */

  expenseCategories() {
    return Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => ({ value, label }));
  }

  async createExpense(
    dto: { title: string; category: string; otherCategory?: string; amount: number; expenseDate: string; description?: string; receipts?: string[] },
    user: any,
  ) {
    const amount = Math.round(Number(dto.amount) * 100) / 100;
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than 0');
    if (!dto.title?.trim()) throw new BadRequestException('Add a title');
    if (!EXPENSE_CATEGORIES[dto.category]) throw new BadRequestException('Choose a category');
    const otherCategory = dto.category === 'other' ? dto.otherCategory?.trim() : undefined;
    if (dto.category === 'other' && !otherCategory) throw new BadRequestException('Specify the expense category');
    const date = this.dayStart(dto.expenseDate);
    if (date.getTime() > this.dayStart().getTime()) throw new BadRequestException('Expense date cannot be in the future');
    const created = await this.expenseModel.create({
      employeeId: oid(this.me(user)),
      title: dto.title.trim(),
      category: dto.category,
      otherCategory,
      amount,
      expenseDate: date,
      description: dto.description?.trim() || undefined,
      receipts: (dto.receipts || []).filter((r) => typeof r === 'string' && r.trim()).slice(0, 10),
      status: ExpenseStatus.SUBMITTED,
    });
    return created.toObject();
  }

  async listExpenses(user: any, query: { status?: string; mine?: string; employeeId?: string; from?: string; to?: string }) {
    const filter: any = {};
    const all = query.mine !== 'true' && this.can(user, HR_PERMISSIONS.MANAGE_EXPENSES);
    if (!all) filter.employeeId = oid(this.me(user));
    else if (query.employeeId && isId(query.employeeId)) filter.employeeId = oid(query.employeeId);
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.from || query.to) {
      filter.expenseDate = {};
      if (query.from) filter.expenseDate.$gte = this.dayStart(query.from);
      if (query.to) filter.expenseDate.$lt = new Date(this.dayStart(query.to).getTime() + 86_400_000);
    }
    const rows = await this.expenseModel.find(filter).sort({ createdAt: -1 }).limit(2000).lean();
    const data = await this.withPeople(rows, ['employeeId', 'decisionBy', 'paidBy']);
    const totals = { submitted: 0, approved: 0, rejected: 0, paid: 0, submittedAmount: 0, approvedAmount: 0, paidAmount: 0 };
    for (const r of rows as any[]) {
      totals[r.status] = (totals[r.status] || 0) + 1;
      if (r.status === 'submitted') totals.submittedAmount += r.amount;
      if (r.status === 'approved') totals.approvedAmount += r.approvedAmount ?? r.amount;
      if (r.status === 'paid') totals.paidAmount += r.approvedAmount ?? r.amount;
    }
    return { data, totals, canManage: this.can(user, HR_PERMISSIONS.MANAGE_EXPENSES) };
  }

  async decideExpense(id: string, dto: { decision: 'approve' | 'reject'; approvedAmount?: number; remarks?: string }, user: any) {
    this.assert(user, HR_PERMISSIONS.MANAGE_EXPENSES, 'You cannot approve expenses');
    const exp: any = await this.expenseModel.findById(id).lean();
    if (!exp) throw new NotFoundException('Expense not found');
    if (exp.status !== ExpenseStatus.SUBMITTED) throw new BadRequestException(`This expense is already ${exp.status}`);
    if (String(exp.employeeId) === this.me(user) && !this.isAdmin(user)) throw new ForbiddenException('You cannot approve your own expense');
    const now = new Date();
    if (dto.decision === 'reject') {
      if (!dto.remarks?.trim()) throw new BadRequestException('Please add a reason for rejecting');
      await this.expenseModel.updateOne(
        { _id: id, status: ExpenseStatus.SUBMITTED },
        { $set: { status: ExpenseStatus.REJECTED, decisionBy: oid(this.me(user)), decisionAt: now, decisionRemarks: dto.remarks.trim() } },
      );
    } else {
      const approvedAmount = dto.approvedAmount === undefined || dto.approvedAmount === null ? exp.amount : Number(dto.approvedAmount);
      if (!(approvedAmount > 0) || approvedAmount > exp.amount) {
        throw new BadRequestException('Approved amount must be more than 0 and not above the claimed amount');
      }
      await this.expenseModel.updateOne(
        { _id: id, status: ExpenseStatus.SUBMITTED },
        {
          $set: {
            status: ExpenseStatus.APPROVED,
            approvedAmount: Math.round(approvedAmount * 100) / 100,
            decisionBy: oid(this.me(user)),
            decisionAt: now,
            decisionRemarks: dto.remarks?.trim() || undefined,
          },
        },
      );
    }
    return this.expenseModel.findById(id).lean();
  }

  async payExpense(id: string, dto: { paymentMode?: string; paymentReference?: string; paidOn?: string }, user: any) {
    this.assert(user, HR_PERMISSIONS.MANAGE_EXPENSES, 'You cannot mark expenses as paid');
    const res = await this.expenseModel.findOneAndUpdate(
      { _id: id, status: ExpenseStatus.APPROVED },
      {
        $set: {
          status: ExpenseStatus.PAID,
          paidBy: oid(this.me(user)),
          paidAt: dto.paidOn ? this.dayStart(dto.paidOn) : new Date(),
          paymentMode: dto.paymentMode?.trim() || 'Bank transfer',
          paymentReference: dto.paymentReference?.trim() || undefined,
        },
      },
      { new: true },
    );
    if (!res) throw new BadRequestException('Only approved expenses can be marked as paid');
    return res.toObject();
  }

  async deleteExpense(id: string, user: any) {
    const res = await this.expenseModel.deleteOne({ _id: id, employeeId: oid(this.me(user)), status: ExpenseStatus.SUBMITTED });
    if (!res.deletedCount) throw new BadRequestException('Only your own submitted (not yet reviewed) expenses can be deleted');
    return { success: true };
  }

  /* ------------------------------------------------------------------ */
  /* employee report                                                     */
  /* ------------------------------------------------------------------ */

  async employeeReport(user: any, query: { status?: string; departmentId?: string }) {
    this.assert(user, HR_PERMISSIONS.REPORTS, 'You cannot view HR reports');
    const userFilter: any = {};
    if (query.status && query.status !== 'all') userFilter.status = query.status;
    const now = new Date();
    const [users, profiles, departments, roles, structures, exits, docs, expenses] = await Promise.all([
      this.db
        .collection('users')
        .find(userFilter, { projection: { name: 1, employeeId: 1, email: 1, number: 1, status: 1, role: 1, createdAt: 1, onboarding: 1 } })
        .toArray(),
      this.db
        .collection('profiles')
        .find({}, { projection: { userId: 1, departmentId: 1, reportingSeniorId: 1, salary: 1, statutoryDetails: 1, personalDetails: 1, currentAddress: 1, address: 1 } })
        .toArray(),
      this.db.collection('departments').find({}, { projection: { name: 1 } }).toArray(),
      this.db.collection('roles').find({}, { projection: { name: 1 } }).toArray(),
      this.db
        .collection('salarystructures')
        .aggregate([
          { $match: { status: 'approved', effectiveFrom: { $lte: now } } },
          { $sort: { effectiveFrom: -1 } },
          { $group: { _id: '$employeeId', annualCtc: { $first: '$annualCtc' }, gross: { $first: '$breakup.grossMonthly' }, net: { $first: '$breakup.netMonthly' } } },
        ])
        .toArray(),
      this.exitModel.find({ status: { $in: [ExitStatus.PENDING, ExitStatus.APPROVED] } }, { employeeId: 1, status: 1, lastWorkingDay: 1, requestedLastWorkingDay: 1 }).lean(),
      this.documentModel.aggregate([{ $match: { deleted: false } }, { $group: { _id: '$employeeId', count: { $sum: 1 } } }]),
      this.expenseModel.aggregate([
        { $group: { _id: '$employeeId', claimed: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$approvedAmount', '$amount'] }, 0] } } } },
      ]),
    ]);
    const dept = new Map(departments.map((d: any) => [String(d._id), d.name]));
    const role = new Map(roles.map((r: any) => [String(r._id), r.name]));
    const prof = new Map(profiles.map((p: any) => [String(p.userId), p]));
    const names = new Map(users.map((u: any) => [String(u._id), u.name]));
    const sal = new Map(structures.map((s: any) => [String(s._id), s]));
    const exitBy = new Map(exits.map((e: any) => [String(e.employeeId), e]));
    const docBy = new Map(docs.map((d: any) => [String(d._id), d.count]));
    const expBy = new Map(expenses.map((e: any) => [String(e._id), e]));

    let rows = users.map((u: any) => {
      const id = String(u._id);
      const p: any = prof.get(id) || {};
      const s: any = sal.get(id);
      const e: any = exitBy.get(id);
      const x: any = expBy.get(id);
      const doj = p.statutoryDetails?.dateOfJoining || (u.onboarding?.approvedAt ? toDateKey(new Date(u.onboarding.approvedAt), getBusinessTimezone()) : u.createdAt ? toDateKey(new Date(u.createdAt), getBusinessTimezone()) : null);
      const tenureMonths = doj ? Math.max(0, Math.floor((now.getTime() - new Date(doj).getTime()) / (30.44 * 86_400_000))) : null;
      return {
        _id: id,
        employeeId: u.employeeId,
        name: u.name,
        email: u.email,
        phone: u.number,
        status: u.status,
        role: role.get(String(u.role)) || null,
        departmentId: p.departmentId ? String(p.departmentId) : null,
        department: p.departmentId ? dept.get(String(p.departmentId)) || null : null,
        reportingSenior: p.reportingSeniorId ? names.get(String(p.reportingSeniorId)) || null : null,
        dateOfJoining: doj,
        tenureMonths,
        gender: p.personalDetails?.gender || null,
        state: p.currentAddress?.state || p.address?.state || null,
        onboardingStatus: u.onboarding?.status || 'not_shared',
        annualCtc: s?.annualCtc ?? null,
        grossMonthly: s?.gross ?? p.salary ?? null,
        netMonthly: s?.net ?? null,
        exitStatus: e?.status || null,
        lastWorkingDay: e?.lastWorkingDay || e?.requestedLastWorkingDay || null,
        documents: docBy.get(id) || 0,
        expensesClaimed: x?.claimed || 0,
        expensesPaid: x?.paid || 0,
      };
    });
    if (query.departmentId && query.departmentId !== 'all') rows = rows.filter((r) => r.departmentId === query.departmentId);
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const byStatus: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status || 'unknown'] = (byStatus[r.status || 'unknown'] || 0) + 1;
      const d = r.department || 'No department';
      byDept[d] = (byDept[d] || 0) + 1;
    }
    return {
      rows,
      summary: {
        total: rows.length,
        active: byStatus.active || 0,
        inactive: byStatus.inactive || 0,
        monthlyGross: rows.filter((r) => r.status === 'active').reduce((s, r) => s + (Number(r.grossMonthly) || 0), 0),
        annualCtc: rows.filter((r) => r.status === 'active').reduce((s, r) => s + (Number(r.annualCtc) || 0), 0),
        pendingExits: rows.filter((r) => r.exitStatus === 'pending').length,
        byStatus,
        byDepartment: Object.entries(byDept).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      },
      departments: departments.map((d: any) => ({ _id: String(d._id), name: d.name })),
    };
  }

  /* ------------------------------------------------------------------ */
  /* HR dashboard                                                        */
  /* ------------------------------------------------------------------ */

  /** "HR All Users" (user:all_users) – work on every employee, not only the own team. */
  hasAllUsers(user: any) {
    return this.isAdmin(user) || hasPermission(user, 'user', 'all_users');
  }

  /**
   * HR dashboard (hr:dashboard). Every number covers the whole company for
   * admins / user:all_users, otherwise the user and everyone below them.
   */
  async dashboard(user: any) {
    this.assert(user, HR_PERMISSIONS.DASHBOARD, 'You do not have access to the HR dashboard');
    const me = this.me(user);
    const allUsers = this.hasAllUsers(user);
    const scopeIds = allUsers ? null : [me, ...(await this.teamIds(me))];
    const idFilter = (field: string) => (scopeIds ? { [field]: { $in: scopeIds.map(oid) } } : {});

    const tz = getBusinessTimezone();
    const todayStr = toDateKey(new Date(), tz);
    const today = this.dayStart(todayStr);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const in30 = new Date(today.getTime() + 30 * 86_400_000);
    const monthKey = todayStr.slice(0, 7);

    const [users, profiles, departments, attendance, leavesToday, pendingLeaves, exits, expenses] = await Promise.all([
      this.db
        .collection('users')
        .find(idFilter('_id'), { projection: { name: 1, employeeId: 1, status: 1, isBlocked: 1, createdAt: 1, onboarding: 1 } })
        .toArray(),
      this.db
        .collection('profiles')
        .find(idFilter('userId'), { projection: { userId: 1, departmentId: 1, statutoryDetails: 1, 'personalDetails.dateOfBirth': 1 } })
        .toArray(),
      this.db.collection('departments').find({}, { projection: { name: 1 } }).toArray(),
      this.db
        .collection('attendances')
        .aggregate([
          { $match: { ...idFilter('userId'), date: { $gte: today, $lt: tomorrow } } },
          { $sort: { updatedAt: 1 } },
          { $group: { _id: '$userId', status: { $last: '$status' } } },
        ])
        .toArray(),
      this.db
        .collection('leaverequests')
        .find(
          {
            ...idFilter('userId'),
            status: 'approved',
            $or: [
              { leaveFrom: { $lt: tomorrow }, leaveTo: { $gte: today } },
              { leaveDate: { $gte: today, $lt: tomorrow } },
              { leaveFrom: { $gte: today, $lt: tomorrow }, leaveTo: null },
            ],
          },
          { projection: { userId: 1, leaveType: 1, leaveFrom: 1, leaveTo: 1, leaveDate: 1 } },
        )
        .toArray(),
      this.db.collection('leaverequests').countDocuments({ ...idFilter('userId'), status: 'pending' }),
      this.exitModel
        .find(
          { ...idFilter('employeeId'), status: { $in: [ExitStatus.PENDING, ExitStatus.APPROVED] } },
          { employeeId: 1, status: 1, lastWorkingDay: 1, requestedLastWorkingDay: 1, reasonCategory: 1 },
        )
        .lean(),
      this.expenseModel.aggregate([
        { $match: { ...idFilter('employeeId'), status: { $in: [ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED] } } },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$approvedAmount', '$amount'] } } } },
      ]),
    ]);

    const prof = new Map(profiles.map((p: any) => [String(p.userId), p]));
    const dept = new Map(departments.map((d: any) => [String(d._id), d.name]));
    const brief = (u: any) => ({ _id: String(u._id), name: u.name, employeeId: u.employeeId });
    const working = users.filter((u: any) => u.status === 'active' || u.status === 'probation');
    const workingIds = new Set(working.map((u: any) => String(u._id)));
    const byId = new Map(users.map((u: any) => [String(u._id), u]));

    /* headcount */
    const byStatus: Record<string, number> = {};
    for (const u of users) byStatus[u.status || 'unknown'] = (byStatus[u.status || 'unknown'] || 0) + 1;
    const byDept: Record<string, number> = {};
    for (const u of working) {
      const p: any = prof.get(String(u._id));
      const name = (p?.departmentId && dept.get(String(p.departmentId))) || 'No department';
      byDept[name] = (byDept[name] || 0) + 1;
    }

    /* joiners, work anniversaries (this month), birthdays (next 30 days) */
    const joinDate = (u: any): string | null => {
      const p: any = prof.get(String(u._id));
      const doj = p?.statutoryDetails?.dateOfJoining;
      if (doj && /^\d{4}-\d{2}-\d{2}/.test(String(doj))) return String(doj).slice(0, 10);
      if (u.onboarding?.approvedAt) return toDateKey(new Date(u.onboarding.approvedAt), tz);
      return u.createdAt ? toDateKey(new Date(u.createdAt), tz) : null;
    };
    const daysUntil = (mmdd: string) => {
      const y = Number(todayStr.slice(0, 4));
      let next = `${y}-${mmdd}`;
      if (next < todayStr) next = `${y + 1}-${mmdd}`;
      return Math.round((Date.parse(next) - Date.parse(todayStr)) / 86_400_000);
    };
    const newJoiners: any[] = [];
    const anniversaries: any[] = [];
    const birthdays: any[] = [];
    for (const u of working) {
      const doj = joinDate(u);
      if (doj) {
        if (doj.slice(0, 7) === monthKey) newJoiners.push({ ...brief(u), dateOfJoining: doj });
        const years = Number(todayStr.slice(0, 4)) - Number(doj.slice(0, 4));
        if (years >= 1 && doj.slice(5, 7) === todayStr.slice(5, 7)) anniversaries.push({ ...brief(u), dateOfJoining: doj, years });
      }
      const dob = (prof.get(String(u._id)) as any)?.personalDetails?.dateOfBirth;
      if (dob && /^\d{4}-\d{2}-\d{2}/.test(String(dob))) {
        const inDays = daysUntil(String(dob).slice(5, 10));
        if (inDays >= 0 && inDays <= 30) birthdays.push({ ...brief(u), date: String(dob).slice(5, 10), inDays });
      }
    }
    newJoiners.sort((a, b) => b.dateOfJoining.localeCompare(a.dateOfJoining));
    anniversaries.sort((a, b) => a.dateOfJoining.slice(8, 10).localeCompare(b.dateOfJoining.slice(8, 10)));
    birthdays.sort((a, b) => a.inDays - b.inDays);

    /* onboarding */
    let linkShared = 0;
    const awaitingReview: any[] = [];
    for (const u of users) {
      if (u.onboarding?.status === 'pending') linkShared += 1;
      if (u.onboarding?.status === 'submitted') awaitingReview.push({ ...brief(u), submittedAt: u.onboarding?.submittedAt || null });
    }

    /* attendance today (active + probation employees) */
    const att = { total: working.length, present: 0, halfDay: 0, onLeave: 0, absent: 0, weekOffOrHoliday: 0, notMarked: 0 };
    const marked = new Set<string>();
    for (const a of attendance) {
      const id = String(a._id);
      if (!workingIds.has(id)) continue;
      marked.add(id);
      const st = String(a.status || '');
      if (st === 'present' || st === 'logged_in' || st === 'late') att.present += 1;
      else if (st === 'half_day') att.halfDay += 1;
      else if (st === 'leave') att.onLeave += 1;
      else if (st === 'week_off' || st === 'holiday') att.weekOffOrHoliday += 1;
      else att.absent += 1;
    }
    const onLeaveToday: any[] = [];
    const seenLeave = new Set<string>();
    for (const l of leavesToday) {
      const id = String(l.userId);
      if (seenLeave.has(id) || !byId.has(id)) continue;
      seenLeave.add(id);
      onLeaveToday.push({
        ...brief(byId.get(id)),
        leaveType: l.leaveType,
        from: l.leaveFrom || l.leaveDate,
        to: l.leaveTo || l.leaveFrom || l.leaveDate,
      });
      if (workingIds.has(id) && !marked.has(id)) {
        marked.add(id);
        att.onLeave += 1;
      }
    }
    att.notMarked = Math.max(0, working.length - marked.size);

    /* exits */
    const exitRows = exits.map((e: any) => ({
      _id: String(e._id),
      employee: byId.has(String(e.employeeId)) ? brief(byId.get(String(e.employeeId))) : { _id: String(e.employeeId) },
      status: e.status,
      reasonCategory: e.reasonCategory,
      lastWorkingDay: e.lastWorkingDay || e.requestedLastWorkingDay || null,
    }));
    const pendingExits = exitRows.filter((e) => e.status === ExitStatus.PENDING);
    const upcomingExits = exitRows
      .filter((e) => e.status === ExitStatus.APPROVED && e.lastWorkingDay && new Date(e.lastWorkingDay) >= today && new Date(e.lastWorkingDay) <= in30)
      .sort((a, b) => new Date(a.lastWorkingDay).getTime() - new Date(b.lastWorkingDay).getTime());

    const exp = (status: string) => {
      const row: any = expenses.find((e: any) => e._id === status);
      return { count: row?.count || 0, amount: row?.amount || 0 };
    };

    return {
      scope: allUsers ? 'all' : 'team',
      date: todayStr,
      headcount: {
        total: users.length,
        working: working.length,
        active: byStatus.active || 0,
        probation: byStatus.probation || 0,
        inactive: byStatus.inactive || 0,
        resigned: byStatus.resigned || 0,
        blocked: users.filter((u: any) => u.isBlocked).length,
        newThisMonth: newJoiners.length,
      },
      byDepartment: Object.entries(byDept)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      attendanceToday: att,
      onLeaveToday,
      pendingLeaves,
      onboarding: { linkShared, awaitingReview: awaitingReview.length, awaitingReviewList: awaitingReview.slice(0, 8) },
      exits: { pending: pendingExits.length, pendingList: pendingExits.slice(0, 8), upcoming: upcomingExits.slice(0, 8) },
      expenses: { awaitingApproval: exp(ExpenseStatus.SUBMITTED), awaitingPayment: exp(ExpenseStatus.APPROVED) },
      newJoiners: newJoiners.slice(0, 8),
      birthdays: birthdays.slice(0, 8),
      anniversaries: anniversaries.slice(0, 8),
    };
  }
}
