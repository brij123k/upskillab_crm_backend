import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EnrolledLead } from 'src/schema/enrolled_leads/enrolled-lead.schema';
import {
  UpskillabBatch,
  UpskillabCourse,
} from 'src/schema/enrolled_leads/upskillab-catalog.schema';
import { User } from 'src/schema/user.schema';
import {
  hasPermission,
  isAdminUser,
} from 'src/common/utils/has-permission.util';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { UserLogic } from '../user/user.logic';
import {
  getBusinessTimezone,
  startOfDayInTimezone,
} from '../order_management/financial/order-financial.util';
import { EnrolledLeadStageService, escapeRegex } from './enrolled-lead-stage.service';

const M = PERMISSIONS.ENROLLED_LEADS;
/** Report tab permission (ReportsPage: reports → enrolled-stages). */
export const ENROLLED_STAGES_REPORT = 'enrolled-stages';

export interface EnrolledStageReportQuery {
  /** "batch" (default view: every batch × stage) or "counsellor". */
  groupBy?: string;
  courseId?: string;
  batchId?: string;
  /** Role level number, or "all". */
  level?: string;
  /** "true" → each row includes the students of the person's whole team. */
  team?: string;
  active?: string;
  fromDate?: string;
  toDate?: string;
}

export interface EnrolledStageStudentsQuery extends EnrolledStageReportQuery {
  /** Stage id, or "none" for students without a stage. */
  stageId?: string;
  /** User id, or "unassigned". */
  userId?: string;
  search?: string;
  page?: string;
  limit?: string;
}

type Counts = { total: number; byStage: Record<string, number> };
const emptyCounts = (): Counts => ({ total: 0, byStage: {} });
const NO_STAGE = 'none';

/**
 * "Enrolled students by stage" report.
 * Rows are counsellors (optionally rolled up with their team), columns are the
 * fixed enrolled-lead stages (or batches × stages, the default view). Course and
 * batch are optional filters. Visibility follows
 * the Enrolled Leads page: admins / read_all see everyone, others see
 * themselves and their team.
 */
@Injectable()
export class EnrolledLeadReportService {
  constructor(
    @InjectModel(EnrolledLead.name)
    private readonly leadModel: Model<EnrolledLead>,
    @InjectModel(UpskillabCourse.name)
    private readonly courseModel: Model<UpskillabCourse>,
    @InjectModel(UpskillabBatch.name)
    private readonly batchModel: Model<UpskillabBatch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly userLogic: UserLogic,
    private readonly stages: EnrolledLeadStageService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* access                                                              */
  /* ------------------------------------------------------------------ */

  private assertAccess(user: any) {
    const ok =
      isAdminUser(user) ||
      hasPermission(user, 'reports', ENROLLED_STAGES_REPORT) ||
      hasPermission(user, M.MODULE, M.ACTIONS.READ) ||
      hasPermission(user, M.MODULE, M.ACTIONS.READ_ALL) ||
      hasPermission(user, M.MODULE, M.ACTIONS.FULL_ACCESS);
    if (!ok) throw new ForbiddenException('You do not have access to this report');
  }

  private canSeeAll(user: any) {
    return isAdminUser(user) || hasPermission(user, M.MODULE, M.ACTIONS.READ_ALL);
  }

  /** null = everyone; otherwise self + team (same rule as the Enrolled Leads list). */
  private async visibleUserIds(user: any): Promise<Set<string> | null> {
    if (this.canSeeAll(user)) return null;
    const self = String(user?.userId || user?._id || '');
    const ids = new Set<string>([self]);
    try {
      const under = await this.userLogic.getUsersUnder({ userId: self, roleName: 'user' }, 'all');
      for (const u of under as any[]) if (u?._id) ids.add(String(u._id));
    } catch {
      /* only own students */
    }
    return ids;
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  /** Course and batch are optional filters. */
  private baseMatch(q: EnrolledStageReportQuery): Record<string, any>[] {
    const and: Record<string, any>[] = [];
    if (q.courseId && String(q.courseId).trim()) and.push({ courseIds: String(q.courseId) });
    if (q.batchId && String(q.batchId).trim()) and.push({ batchIds: String(q.batchId) });
    if (q.active === 'active') and.push({ isActive: true });
    if (q.active === 'inactive') and.push({ isActive: false });
    if (q.fromDate || q.toDate) {
      const tz = getBusinessTimezone();
      const range: Record<string, Date> = {};
      if (q.fromDate) range.$gte = startOfDayInTimezone(q.fromDate.slice(0, 10), tz);
      if (q.toDate) {
        range.$lt = new Date(startOfDayInTimezone(q.toDate.slice(0, 10), tz).getTime() + 86_400_000);
      }
      and.push({ studentCreatedAt: range });
    }
    return and;
  }

  private toObjectIds(ids: Iterable<string>) {
    return [...ids].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  }

  /** reportingSenior → direct reports, from profiles (one query). */
  private async childrenMap(): Promise<Map<string, string[]>> {
    const profiles = await this.userModel.db
      .collection('profiles')
      .find({ reportingSeniorId: { $ne: null } }, { projection: { userId: 1, reportingSeniorId: 1 } })
      .toArray();
    const map = new Map<string, string[]>();
    for (const p of profiles) {
      const senior = p.reportingSeniorId ? String(p.reportingSeniorId) : '';
      const uid = p.userId ? String(p.userId) : '';
      if (!senior || !uid || senior === uid) continue;
      if (!map.has(senior)) map.set(senior, []);
      map.get(senior)!.push(uid);
    }
    return map;
  }

  private descendants(root: string, children: Map<string, string[]>): Set<string> {
    const out = new Set<string>();
    const stack = [...(children.get(root) || [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id) || id === root) continue;
      out.add(id);
      stack.push(...(children.get(id) || []));
    }
    return out;
  }

  /** userId → role level number (roles carry a numeric `level`). */
  private async userLevels(userIds: string[]) {
    const [users, roles] = await Promise.all([
      this.userModel.db
        .collection('users')
        .find(
          { _id: { $in: this.toObjectIds(userIds) } },
          { projection: { name: 1, employeeId: 1, role: 1, status: 1 } },
        )
        .toArray(),
      this.userModel.db.collection('roles').find({}, { projection: { name: 1, level: 1 } }).toArray(),
    ]);
    const roleById = new Map(roles.map((r: any) => [String(r._id), r]));
    return new Map(
      users.map((u: any) => {
        const role: any = roleById.get(String(u.role));
        const level = Number(role?.level);
        return [
          String(u._id),
          {
            userId: String(u._id),
            name: u.name as string,
            employeeId: u.employeeId,
            status: u.status,
            roleName: role?.name as string | undefined,
            level: Number.isFinite(level) && level > 0 ? level : null,
          },
        ];
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /* report                                                              */
  /* ------------------------------------------------------------------ */

  async options(user: any) {
    this.assertAccess(user);
    const [stages, courses, batches] = await Promise.all([
      this.stages.list(),
      this.courseModel.find().select('upskillabId courseName').sort({ courseName: 1 }).lean(),
      this.batchModel
        .find()
        .select('upskillabId batchCode courseId courseName status startDate')
        .sort({ startDate: -1 })
        .lean(),
    ]);
    return { stages, courses, batches };
  }

  private stagesOut(stageList: any[], hasNoStage: boolean) {
    const out = stageList.map((s: any) => ({
      _id: String(s._id),
      name: s.name,
      color: s.color,
      description: s.description,
      order: s.order,
    }));
    if (hasNoStage) out.push({ _id: NO_STAGE, name: 'No stage', color: '#94a3b8', description: undefined, order: 999 });
    return out;
  }

  /**
   * Default view: one row per batch, stage counts per batch. A student in two
   * batches counts in both rows; totals count each student once.
   */
  async batchStageReport(q: EnrolledStageReportQuery, user: any) {
    this.assertAccess(user);
    const visible = await this.visibleUserIds(user);
    const and = this.baseMatch(q);
    if (visible) and.push({ assignedTo: { $in: this.toObjectIds(visible) } });
    const match = and.length ? { $and: and } : {};

    // When a course is chosen, only its batches are rows.
    let courseBatchIds: string[] | null = null;
    if (q.courseId) {
      courseBatchIds = (await this.batchModel.find({ courseId: String(q.courseId) }).select('upskillabId').lean()).map(
        (b: any) => b.upskillabId,
      );
    }
    const batchFilter: Record<string, any> = {};
    if (q.batchId) batchFilter.batchIds = String(q.batchId);
    else if (courseBatchIds) batchFilter.batchIds = { $in: courseBatchIds };

    const [stageList, perBatch, totalsAgg] = await Promise.all([
      this.stages.list(),
      this.leadModel.aggregate([
        { $match: match },
        { $project: { batchIds: 1, stageId: 1, isActive: 1 } },
        { $unwind: '$batchIds' },
        ...(Object.keys(batchFilter).length ? [{ $match: batchFilter }] : []),
        { $group: { _id: { b: '$batchIds', s: '$stageId' }, count: { $sum: 1 } } },
      ]),
      this.leadModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$stageId',
            count: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
            assigned: { $sum: { $cond: [{ $ifNull: ['$assignedTo', false] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const totals = emptyCounts();
    let active = 0;
    let assigned = 0;
    for (const t of totalsAgg) {
      const s = t._id ? String(t._id) : NO_STAGE;
      totals.total += t.count;
      totals.byStage[s] = (totals.byStage[s] || 0) + t.count;
      active += t.active;
      assigned += t.assigned;
    }

    const byBatch = new Map<string, Counts>();
    for (const g of perBatch) {
      const b = String(g._id?.b ?? '');
      if (!b) continue;
      const s = g._id?.s ? String(g._id.s) : NO_STAGE;
      const c = byBatch.get(b) || byBatch.set(b, emptyCounts()).get(b)!;
      c.total += g.count;
      c.byStage[s] = (c.byStage[s] || 0) + g.count;
    }
    const batches = await this.batchModel
      .find({ upskillabId: { $in: [...byBatch.keys()] } })
      .select('upskillabId batchCode courseId courseName status startDate')
      .lean();
    const batchInfo = new Map(batches.map((b: any) => [b.upskillabId, b]));
    // Batches don't always carry the course name – fill it from the course.
    const missing = [...new Set(batches.filter((b: any) => !b.courseName && b.courseId).map((b: any) => b.courseId))];
    if (missing.length) {
      const courses = await this.courseModel.find({ upskillabId: { $in: missing } }).select('upskillabId courseName').lean();
      const names = new Map(courses.map((c: any) => [c.upskillabId, c.courseName]));
      for (const b of batches as any[]) if (!b.courseName && b.courseId) b.courseName = names.get(b.courseId);
    }
    const rows = [...byBatch.entries()].map(([batchId, c]) => {
      const b: any = batchInfo.get(batchId) || {};
      return {
        batchId,
        batchCode: b.batchCode || batchId,
        courseId: b.courseId,
        courseName: b.courseName,
        status: b.status,
        startDate: b.startDate,
        ...c,
      };
    });
    rows.sort((a, b) => b.total - a.total || String(a.batchCode).localeCompare(String(b.batchCode)));

    return {
      groupBy: 'batch',
      stages: this.stagesOut(stageList, !!totals.byStage[NO_STAGE]),
      totals: { ...totals, active, assigned },
      rows,
    };
  }

  async stageReport(q: EnrolledStageReportQuery, user: any) {
    if (q.groupBy !== 'counsellor') return this.batchStageReport(q, user);
    this.assertAccess(user);

    const visible = await this.visibleUserIds(user);
    const and = this.baseMatch(q);
    if (visible) and.push({ assignedTo: { $in: this.toObjectIds(visible) } });

    const [stageList, grouped, course, batch] = await Promise.all([
      this.stages.list(),
      this.leadModel.aggregate([
        { $match: and.length ? { $and: and } : {} },
        {
          $group: {
            _id: { a: '$assignedTo', s: '$stageId' },
            count: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
          },
        },
      ]),
      q.courseId ? this.courseModel.findOne({ upskillabId: String(q.courseId) }).select('upskillabId courseName').lean() : null,
      q.batchId ? this.batchModel.findOne({ upskillabId: String(q.batchId) }).select('upskillabId batchCode courseName status startDate').lean() : null,
    ]);

    // direct counts per assignee
    const direct = new Map<string, Counts>();
    const totals = emptyCounts();
    const unassigned = emptyCounts();
    let activeStudents = 0;
    for (const g of grouped) {
      const a = g._id?.a ? String(g._id.a) : '';
      const s = g._id?.s ? String(g._id.s) : NO_STAGE;
      totals.total += g.count;
      totals.byStage[s] = (totals.byStage[s] || 0) + g.count;
      activeStudents += g.active || 0;
      const bucket = a ? direct.get(a) || direct.set(a, emptyCounts()).get(a)! : unassigned;
      bucket.total += g.count;
      bucket.byStage[s] = (bucket.byStage[s] || 0) + g.count;
    }

    const team = q.team === 'true';
    const levelFilter = q.level && q.level !== 'all' ? Number(q.level) : null;
    const children = team || levelFilter !== null ? await this.childrenMap() : new Map<string, string[]>();

    // Candidate row users: everyone visible (scoped) or everyone with students (admin).
    let candidateIds: string[];
    if (visible) candidateIds = [...visible];
    else if (levelFilter !== null) {
      const levelUsers = await this.userModel.db
        .collection('users')
        .find({ status: { $ne: 'resigned' } }, { projection: { _id: 1 } })
        .toArray();
      candidateIds = levelUsers.map((u: any) => String(u._id));
    } else candidateIds = [...direct.keys()];

    const info = await this.userLevels([...new Set([...candidateIds, ...direct.keys()])]);

    const rowIds = candidateIds.filter((id) => {
      const u = info.get(id);
      if (!u) return false;
      if (levelFilter !== null) return u.level === levelFilter;
      return (direct.get(id)?.total || 0) > 0;
    });

    const rows = rowIds.map((id) => {
      const u = info.get(id)!;
      const members = team ? [...this.descendants(id, children)].filter((m) => !visible || visible.has(m)) : [];
      const counts = emptyCounts();
      for (const m of [id, ...members]) {
        const c = direct.get(m);
        if (!c) continue;
        counts.total += c.total;
        for (const [k, v] of Object.entries(c.byStage)) counts.byStage[k] = (counts.byStage[k] || 0) + v;
      }
      return {
        userId: id,
        name: u.name,
        employeeId: u.employeeId,
        roleName: u.roleName,
        level: u.level,
        status: u.status,
        teamSize: team ? members.length + 1 : 1,
        ...counts,
      };
    });
    rows.sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)));

    const stagesOut = this.stagesOut(stageList, !!totals.byStage[NO_STAGE]);

    return {
      groupBy: 'counsellor',
      course: course ? { id: course.upskillabId, name: (course as any).courseName } : q.courseId ? { id: q.courseId, name: q.courseId } : null,
      batch: batch
        ? { id: batch.upskillabId, code: (batch as any).batchCode, status: (batch as any).status, startDate: (batch as any).startDate }
        : q.batchId ? { id: q.batchId, code: q.batchId } : null,
      filters: { level: levelFilter, team, active: q.active || 'all', fromDate: q.fromDate, toDate: q.toDate },
      stages: stagesOut,
      totals: { ...totals, active: activeStudents, assigned: totals.total - unassigned.total },
      unassigned: visible ? null : unassigned,
      rows,
    };
  }

  /** Students behind a report cell (drill-down / export). */
  async stageReportStudents(q: EnrolledStageStudentsQuery, user: any) {
    this.assertAccess(user);

    const visible = await this.visibleUserIds(user);
    const and = this.baseMatch(q);
    if (visible) and.push({ assignedTo: { $in: this.toObjectIds(visible) } });

    if (q.stageId === NO_STAGE) and.push({ stageId: null });
    else if (q.stageId) {
      if (!Types.ObjectId.isValid(q.stageId)) throw new BadRequestException('Invalid stage');
      and.push({ stageId: new Types.ObjectId(q.stageId) });
    }

    if (q.userId === 'unassigned') {
      and.push({ assignedTo: null });
    } else if (q.userId) {
      if (!Types.ObjectId.isValid(q.userId)) throw new BadRequestException('Invalid user');
      if (visible && !visible.has(q.userId)) throw new ForbiddenException('This user is outside your team');
      let ids = [q.userId];
      if (q.team === 'true') {
        const children = await this.childrenMap();
        ids = [q.userId, ...[...this.descendants(q.userId, children)].filter((m) => !visible || visible.has(m))];
      }
      and.push({ assignedTo: { $in: this.toObjectIds(ids) } });
    }

    if (q.search?.trim()) {
      const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
      and.push({ $or: [{ fullName: rx }, { email: rx }, { mobileNumber: rx }, { username: rx }] });
    }

    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(Math.max(1, Number(q.limit) || 25), 5000);
    const match = { $and: and };
    const [data, total] = await Promise.all([
      this.leadModel
        .find(match)
        .select('fullName email mobileNumber username isActive status stageId stageName assignedTo assignedDate lastActivityAt lastActivityType studentCreatedAt paymentSummary batchStatuses')
        .sort({ stageName: 1, fullName: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('assignedTo', 'name employeeId')
        .lean(),
      this.leadModel.countDocuments(match),
    ]);
    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }
}
