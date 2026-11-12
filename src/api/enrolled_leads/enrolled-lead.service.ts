import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EnrolledLead } from 'src/schema/enrolled_leads/enrolled-lead.schema';
import {
  EnrolledLeadAction,
  EnrolledLeadHistory,
} from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';
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
import {
  AssignEnrolledLeadsDto,
  BulkStageDto,
  CatalogQueryDto,
  EnrolledCallFeedbackDto,
  EnrolledLeadQueryDto,
  LogEnrolledActivityDto,
} from 'src/dto/enrolled_leads/enrolled-lead.dto';
import { UserLogic } from '../user/user.logic';
import {
  getBusinessTimezone,
  startOfDayInTimezone,
} from '../order_management/financial/order-financial.util';
import {
  EnrolledLeadStageService,
  escapeRegex,
} from './enrolled-lead-stage.service';
import { EnrolledLeadSyncService } from './enrolled-lead-sync.service';
import { normalizeBatchStatus } from './enrolled-lead.mapper';
import { CallLog } from 'src/schema/call-log.schema';
import { SmartfloService } from '../smartflo/smartflo.service';

const M = PERMISSIONS.ENROLLED_LEADS;
const LIST_PROJECTION = '-raw -orders';

@Injectable()
export class EnrolledLeadService {
  constructor(
    @InjectModel(EnrolledLead.name)
    private readonly leadModel: Model<EnrolledLead>,
    @InjectModel(EnrolledLeadHistory.name)
    private readonly historyModel: Model<EnrolledLeadHistory>,
    @InjectModel(UpskillabCourse.name)
    private readonly courseModel: Model<UpskillabCourse>,
    @InjectModel(UpskillabBatch.name)
    private readonly batchModel: Model<UpskillabBatch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly userLogic: UserLogic,
    private readonly stages: EnrolledLeadStageService,
    private readonly sync: EnrolledLeadSyncService,
    @InjectModel(CallLog.name) private readonly callLogModel: Model<CallLog>,
    private readonly smartflo: SmartfloService,
  ) {}

  // =========================================================
  // SCOPE
  // =========================================================

  private canSeeAll(user: any) {
    return (
      isAdminUser(user) || hasPermission(user, M.MODULE, M.ACTIONS.READ_ALL)
    );
  }

  /** null = every lead; otherwise leads assigned to the user or their team. */
  private async scopeMatch(user: any): Promise<Record<string, any> | null> {
    if (this.canSeeAll(user)) return null;
    const userId = String(user?.userId || user?._id || '');
    let ids = [userId];
    try {
      const users = await this.userLogic.getUsersUnder({
        userId,
        roleName: 'user',
      });
      ids = [
        ...new Set([
          userId,
          ...users.map((u: any) => u?._id?.toString?.()).filter(Boolean),
        ]),
      ];
    } catch {
      // only own leads
    }
    return {
      assignedTo: {
        $in: ids
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      },
    };
  }

  private async findAccessible(id: string, user: any, projection?: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid id');
    const scope = await this.scopeMatch(user);
    const query = this.leadModel.findOne({
      _id: new Types.ObjectId(id),
      ...(scope || {}),
    });
    if (projection) query.select(projection);
    const lead = await query.lean();
    if (!lead) throw new NotFoundException('Enrolled lead not found');
    return lead;
  }

  // =========================================================
  // LIST
  // =========================================================

  private buildMatch(query: EnrolledLeadQueryDto, includeStage = true) {
    const and: Record<string, any>[] = [];

    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      and.push({
        $or: [
          { fullName: rx },
          { email: rx },
          { mobileNumber: rx },
          { username: rx },
          { studentId: rx },
        ],
      });
    }
    if (includeStage && query.stageId) {
      and.push({ stageId: new Types.ObjectId(query.stageId) });
    }
    if (query.active === 'active') and.push({ isActive: true });
    if (query.active === 'inactive') and.push({ isActive: false });
    if (query.status) {
      and.push({ status: new RegExp(`^${escapeRegex(query.status)}$`, 'i') });
    }
    if (query.courseId) and.push({ courseIds: query.courseId });
    if (query.batchId) and.push({ batchIds: query.batchId });
    if (query.batchStatus) {
      and.push({ batchStatuses: normalizeBatchStatus(query.batchStatus) });
    }
    if (query.assignedTo === 'unassigned') {
      and.push({ assignedTo: null });
    } else if (query.assignedTo) {
      if (!Types.ObjectId.isValid(query.assignedTo)) {
        throw new BadRequestException('Invalid assignedTo');
      }
      and.push({ assignedTo: new Types.ObjectId(query.assignedTo) });
    }
    if (query.fromDate || query.toDate) {
      const tz = getBusinessTimezone();
      const range: Record<string, Date> = {};
      if (query.fromDate)
        range.$gte = startOfDayInTimezone(query.fromDate.slice(0, 10), tz);
      if (query.toDate) {
        range.$lt = new Date(
          startOfDayInTimezone(query.toDate.slice(0, 10), tz).getTime() +
            86_400_000,
        );
      }
      and.push({ studentCreatedAt: range });
    }
    return and;
  }

  async list(query: EnrolledLeadQueryDto, user: any) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const scope = await this.scopeMatch(user);

    const withScope = (and: Record<string, any>[]) => {
      const all = scope ? [scope, ...and] : and;
      return all.length ? { $and: all } : {};
    };
    const match = withScope(this.buildMatch(query));
    const matchWithoutStage = withScope(this.buildMatch(query, false));

    const [data, total, byStage, activeCounts] = await Promise.all([
      this.leadModel
        .find(match)
        .select(LIST_PROJECTION)
        .sort({ studentCreatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('assignedTo', 'name employeeId email')
        .lean(),
      this.leadModel.countDocuments(match),
      this.leadModel.aggregate([
        { $match: matchWithoutStage },
        {
          $group: {
            _id: '$stageId',
            stageName: { $first: '$stageName' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.leadModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
            inactive: {
              $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] },
            },
            unassigned: {
              $sum: { $cond: [{ $ifNull: ['$assignedTo', false] }, 0, 1] },
            },
          },
        },
      ]),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      stats: {
        total,
        active: activeCounts[0]?.active || 0,
        inactive: activeCounts[0]?.inactive || 0,
        unassigned: activeCounts[0]?.unassigned || 0,
        byStage: byStage.map((s) => ({
          stageId: s._id ? String(s._id) : null,
          stageName: s.stageName || 'No stage',
          count: s.count,
        })),
      },
    };
  }

  // =========================================================
  // DETAIL
  // =========================================================

  async getOne(id: string, user: any) {
    const lead: any = await this.findAccessible(id, user);
    const [assignee, history, courses, batches] = await Promise.all([
      lead.assignedTo
        ? this.userModel
            .findById(lead.assignedTo)
            .select('name employeeId email')
            .lean()
        : null,
      this.historyModel
        .find({ enrolledLeadId: lead._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('actionBy', 'name employeeId')
        .lean(),
      lead.courseIds?.length
        ? this.courseModel
            .find({ upskillabId: { $in: lead.courseIds } })
            .select('-data')
            .lean()
        : [],
      lead.batchIds?.length
        ? this.batchModel
            .find({ upskillabId: { $in: lead.batchIds } })
            .select('-data')
            .lean()
        : [],
    ]);
    return {
      ...lead,
      assignedTo: assignee,
      history,
      courseDetails: courses,
      batchDetails: batches,
    };
  }

  // =========================================================
  // ACTIVITY / STAGE
  // =========================================================

  async logActivity(id: string, dto: LogEnrolledActivityDto, user: any) {
    const lead: any = await this.findAccessible(
      id,
      user,
      '_id stageId stageName',
    );
    if (dto.type === EnrolledLeadAction.STAGE_CHANGED && !dto.stageId) {
      throw new BadRequestException('stageId is required to change the stage');
    }
    if (
      dto.type === EnrolledLeadAction.NOTE &&
      !dto.note?.trim() &&
      !dto.stageId
    ) {
      throw new BadRequestException('A note is required');
    }

    const now = new Date();
    const set: Record<string, any> = {
      lastActivityAt: now,
      lastActivityType: dto.type,
    };
    let toStage: string | undefined;
    if (dto.stageId) {
      const stage = await this.stages.findActive(dto.stageId);
      if (String(stage._id) !== String(lead.stageId)) {
        set.stageId = stage._id;
        set.stageName = stage.name;
        toStage = stage.name;
      }
    }

    await this.leadModel.updateOne({ _id: lead._id }, { $set: set });
    await this.historyModel.create({
      enrolledLeadId: lead._id,
      actionType: dto.type,
      fromStage: toStage ? lead.stageName : undefined,
      toStage,
      note: dto.note?.trim() || undefined,
      actionBy: this.actor(user),
    });
    return this.getOne(id, user);
  }

  async bulkStage(dto: BulkStageDto, user: any) {
    const stage = await this.stages.findActive(dto.stageId);
    const scope = await this.scopeMatch(user);
    const leads = await this.leadModel
      .find({
        _id: { $in: dto.ids.map((id) => new Types.ObjectId(id)) },
        ...(scope || {}),
      })
      .select('_id stageId stageName')
      .lean();
    const toChange = leads.filter(
      (l: any) => String(l.stageId) !== String(stage._id),
    );
    if (!toChange.length) return { updated: 0 };

    const now = new Date();
    await this.leadModel.updateMany(
      { _id: { $in: toChange.map((l) => l._id) } },
      {
        $set: {
          stageId: stage._id,
          stageName: stage.name,
          lastActivityAt: now,
          lastActivityType: EnrolledLeadAction.STAGE_CHANGED,
        },
      },
    );
    await this.historyModel.insertMany(
      toChange.map((l: any) => ({
        enrolledLeadId: l._id,
        actionType: EnrolledLeadAction.STAGE_CHANGED,
        fromStage: l.stageName,
        toStage: stage.name,
        note: dto.note?.trim() || undefined,
        actionBy: this.actor(user),
      })),
    );
    return { updated: toChange.length };
  }

  async assign(dto: AssignEnrolledLeadsDto, user: any) {
    let assignee: any = null;
    if (dto.assignedTo) {
      assignee = await this.userModel
        .findOne({ _id: dto.assignedTo, status: 'active' })
        .select('_id name')
        .lean();
      if (!assignee)
        throw new BadRequestException('Assignee not found or inactive');
    }
    const scope = await this.scopeMatch(user);
    const leads = await this.leadModel
      .find({
        _id: { $in: dto.ids.map((id) => new Types.ObjectId(id)) },
        ...(scope || {}),
      })
      .select('_id assignedTo')
      .lean();
    if (!leads.length)
      throw new ForbiddenException('No accessible leads in the selection');

    const now = new Date();
    await this.leadModel.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      assignee
        ? { $set: { assignedTo: assignee._id, assignedDate: now } }
        : { $unset: { assignedTo: 1, assignedDate: 1 } },
    );
    await this.historyModel.insertMany(
      leads.map((l: any) => ({
        enrolledLeadId: l._id,
        actionType: EnrolledLeadAction.ASSIGNED,
        note: assignee ? `Assigned to ${assignee.name}` : 'Unassigned',
        changes: {
          assignedTo: { from: l.assignedTo ?? null, to: assignee?._id ?? null },
        },
        actionBy: this.actor(user),
      })),
    );
    return { updated: leads.length };
  }

  // =========================================================
  // CALLS (Smartflo click to call, same flow as the lead page)
  // =========================================================

  /** Click to call: Smartflo rings the user's phone, then connects the student. */
  async startCall(id: string, user: any) {
    const lead: any = await this.findAccessible(
      id,
      user,
      '_id mobileNumber fullName',
    );
    const response = await this.smartflo.clickToCallEnrolled(lead, user);
    return {
      success: true,
      message: 'Call request sent to your phone',
      callId: response?.callId,
    };
  }

  /** Every call with this student (click to call + incoming). */
  async listCalls(id: string, user: any) {
    const lead: any = await this.findAccessible(id, user, '_id');
    return this.callLogModel
      .find({ enrolledLeadId: lead._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('userId', 'name employeeId')
      .populate('enrolledStageId', 'name')
      .lean();
  }

  /** The user's finished enrolled-lead calls that still need details. */
  async pendingCalls(user: any) {
    const userId = String(user?.userId || user?._id || '');
    const calls = await this.callLogModel
      .find({
        enrolledLeadId: { $exists: true, $ne: null },
        userId,
        isFormSubmitted: { $ne: true },
        startedAt: { $exists: true, $ne: null },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const leadIds = [
      ...new Set(calls.map((c: any) => String(c.enrolledLeadId))),
    ];
    const leads = leadIds.length
      ? await this.leadModel
          .find({ _id: { $in: leadIds.map((x) => new Types.ObjectId(x)) } })
          .select('fullName mobileNumber stageId stageName')
          .lean()
      : [];
    const byId = new Map(leads.map((l: any) => [String(l._id), l]));
    return calls.map((c: any) => ({
      callId: c._id,
      enrolledLeadId: c.enrolledLeadId,
      enrolledLead: byId.get(String(c.enrolledLeadId)) || null,
      duration: Number(c.duration) || 0,
      startedAt: c.startedAt,
      recording_url: c.recording_url,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Details after a call (stage + outcome + remark), like the lead page's
   * call feedback. Saved on the call log and in the student's history.
   */
  async submitCallFeedback(
    callId: string,
    dto: EnrolledCallFeedbackDto,
    user: any,
  ) {
    if (!Types.ObjectId.isValid(callId))
      throw new BadRequestException('Invalid call id');
    const call: any = await this.callLogModel.findById(callId);
    if (!call || !call.enrolledLeadId) {
      throw new NotFoundException('Enrolled lead call not found');
    }
    const userId = String(user?.userId || user?._id || '');
    if (String(call.userId) !== userId && !isAdminUser(user)) {
      throw new ForbiddenException(
        'Only the person who took this call can fill its details',
      );
    }
    if (call.isFormSubmitted) {
      throw new BadRequestException(
        'Details for this call were already submitted',
      );
    }

    const stage = await this.stages.findActive(dto.stageId);
    const lead: any = await this.leadModel
      .findById(call.enrolledLeadId)
      .select('_id stageId stageName')
      .lean();
    if (!lead) throw new NotFoundException('Enrolled lead not found');

    call.outcome = dto.outcome.trim();
    call.enrolledStageId = stage._id;
    call.isFormSubmitted = true;
    await call.save();

    const now = new Date();
    const stageChanged = String(lead.stageId) !== String(stage._id);
    await this.leadModel.updateOne(
      { _id: lead._id },
      {
        $set: {
          lastActivityAt: now,
          lastActivityType: EnrolledLeadAction.CALL,
          ...(stageChanged
            ? { stageId: stage._id, stageName: stage.name }
            : {}),
        },
      },
    );
    await this.historyModel.create({
      enrolledLeadId: lead._id,
      actionType: EnrolledLeadAction.CALL,
      fromStage: stageChanged ? lead.stageName : undefined,
      toStage: stageChanged ? stage.name : undefined,
      note: dto.remark?.trim() || undefined,
      actionBy: this.actor(user),
      changes: {
        callId: call._id,
        outcome: call.outcome,
        duration: Number(call.duration) || 0,
        startedAt: call.startedAt,
        recordingUrl: call.recording_url,
        stage: stage.name,
      },
    });
    return { success: true, message: 'Call details saved' };
  }

  private actor(user: any) {
    const id = String(user?.userId || user?._id || '');
    return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined;
  }

  // =========================================================
  // FILTER OPTIONS
  // =========================================================

  async meta() {
    const [stages, courses, batches, statuses, batchStatuses, lastSync] =
      await Promise.all([
        this.stages.list(),
        this.courseModel
          .find()
          .select('upskillabId courseName')
          .sort({ courseName: 1 })
          .lean(),
        this.batchModel
          .find()
          .select('upskillabId batchCode courseId courseName status startDate')
          .sort({ startDate: -1 })
          .lean(),
        this.leadModel.distinct('status'),
        this.leadModel.distinct('batchStatuses'),
        this.sync.getLastRun(),
      ]);
    return {
      stages,
      courses,
      batches,
      statuses: statuses.filter(Boolean).sort(),
      batchStatuses: [
        ...new Set(
          [...batchStatuses, ...batches.map((b: any) => b.status)].filter(
            Boolean,
          ),
        ),
      ].sort(),
      lastSync,
    };
  }

  // =========================================================
  // COURSES / BATCHES
  // =========================================================

  private async leadCounts(
    field: 'courseIds' | 'batchIds',
    ids: string[],
    user: any,
  ) {
    if (!ids.length) return new Map<string, number>();
    const scope = await this.scopeMatch(user);
    const rows = await this.leadModel.aggregate([
      { $match: { [field]: { $in: ids }, ...(scope || {}) } },
      { $unwind: `$${field}` },
      { $match: { [field]: { $in: ids } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  async listCourses(query: CatalogQueryDto, user: any) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const match: Record<string, any> = {};
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ courseName: rx }, { category: rx }, { language: rx }];
    }
    const [data, total] = await Promise.all([
      this.courseModel
        .find(match)
        .sort({ courseName: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.courseModel.countDocuments(match),
    ]);
    const counts = await this.leadCounts(
      'courseIds',
      data.map((c) => c.upskillabId),
      user,
    );
    return {
      data: data.map((c) => ({
        ...c,
        crmStudents: counts.get(c.upskillabId) || 0,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listBatches(query: CatalogQueryDto, user: any) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const match: Record<string, any> = {};
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ batchCode: rx }, { courseName: rx }, { teacherName: rx }];
    }
    if (query.courseId) match.courseId = query.courseId;
    if (query.status) match.status = normalizeBatchStatus(query.status);
    const [data, total] = await Promise.all([
      this.batchModel
        .find(match)
        .select('-data')
        .sort({ startDate: -1, batchCode: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.batchModel.countDocuments(match),
    ]);
    const counts = await this.leadCounts(
      'batchIds',
      data.map((b) => b.upskillabId),
      user,
    );
    return {
      data: data.map((b) => ({
        ...b,
        crmStudents: counts.get(b.upskillabId) || 0,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
