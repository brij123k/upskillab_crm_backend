import { BadRequestException, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { LeadData } from './lead.data';
import { Lead, LeadStatus } from 'src/schema/lead_management/lead.schema';
import { CreateLeadDto,UpskillabLeadDto, UpdateLeadDto } from 'src/dto/lead-management/lead.dto';
import { LeadHistoryLogic } from '../lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { ProfileData } from 'src/api/profile/profile.data';
import { MergeLeadsDTO } from 'src/dto/lead-management/MergeLeadsDTO';
import { CallLog } from 'src/schema/call-log.schema';
import { InjectModel } from '@nestjs/mongoose';
import { MeetingLog } from 'src/schema/meeting-log.schema';
import { Model, Types } from 'mongoose';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';
import { UserLogic } from 'src/api/user/user.logic';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';
import { UserActivityLogic } from 'src/api/user-activity/user-activity.logic';
import { User } from 'src/schema/user.schema';
import { Role } from 'src/schema/role.schema';
import { Pool } from 'src/schema/Pool.schema';
import { MaskSetting } from 'src/schema/mask.schema';
import { LeadStageHistoryService } from '../LeadStageHistory/LeadStageHistory.service';
import { Order } from 'src/schema/order_Management/order.schema';

@Injectable()
export class LeadLogic {
  constructor(
    private readonly leadData: LeadData,
    private readonly profileData: ProfileData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userLogic: UserLogic,
    @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,

     @InjectModel(MaskSetting.name)
    private readonly maskSettingModel: Model<MaskSetting>,

    @InjectModel(LeadStage.name)
    private readonly leadStageModel: Model<LeadStage>,

    @InjectModel(MeetingLog.name)
    private meetingLogModel: Model<MeetingLog>,

    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,

    @InjectModel(Pool.name)
    private readonly poolModel: Model<Pool>,

    @InjectModel(Order.name)
    private readonly orderModel: Model<Order>,

    @InjectModel(User.name)
    private readonly userModel: Model<User>,

    @InjectModel(Role.name)
    private readonly roleModel: Model<Role>,

    private readonly userActivityLogic: UserActivityLogic,
    private readonly notificationEngine: NotificationEngineService,
    private readonly leadStageHistoryService:LeadStageHistoryService,
  ) { }

  private canViewLeadDetails(user?: any) {
    return Boolean(
      user?.isSuperAdmin ||
      user?.roleName?.toString()?.toLowerCase() === 'admin',
    );
  }

  private maskPhone(phone?: string) {
    if (!phone) return phone;
    const digits = phone.replace(/\d(?=\d{4})/g, '*');
    return digits;
  }

  private maskEmail(email?: string) {
    if (!email) return email;

    const [localPart, domain] = email.split('@');
    if (!domain) return email;

    if (localPart.length <= 1) {
      return `*@${domain}`;
    }

    if (localPart.length === 2) {
      return `${localPart[0]}*@${domain}`;
    }

    return `${localPart[0]}${'*'.repeat(localPart.length - 2)}${localPart[localPart.length - 1]}@${domain}`;
  }

  private maskLeadPayload(
  payload: any,
  settings: {
    emailMask: boolean;
    phoneMask: boolean;
  },
): any {
  if (Array.isArray(payload)) {
    return payload.map((item) =>
      this.maskLeadPayload(item, settings),
    );
  }

  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const plain =
    typeof payload.toObject === 'function'
      ? payload.toObject()
      : { ...payload };

  if (plain.phone && settings.phoneMask) {
    plain.phone = this.maskPhone(plain.phone);
  }

  if (plain.email && settings.emailMask) {
    plain.email = this.maskEmail(plain.email);
  }

  if (Array.isArray(plain.data)) {
    plain.data = plain.data.map((item: any) =>
      this.maskLeadPayload(item, settings),
    );
  }

  if (plain.lead) {
    plain.lead = this.maskLeadPayload(
      plain.lead,
      settings,
    );
  }

  if (Array.isArray(plain.leads)) {
    plain.leads = plain.leads.map((item: any) =>
      this.maskLeadPayload(item, settings),
    );
  }

  return plain;
}

  private async  maskLeadResponse<T>(payload: T, user?: any):  Promise<T> {
    if (this.canViewLeadDetails(user)) {
      return payload;
    }
    const settings = await this.getSettings()
    return this.maskLeadPayload(payload,settings);
  }

  private resolveLevel(level: any): number | null {
    if (level === undefined || level === null || String(level).trim() === '') {
      return 1;
    }

    const levelNumber = Number(level);
    return Number.isNaN(levelNumber) ? null : levelNumber;
  }

  private async getUserIdsByRoleLevel(level: any): Promise<string[]> {
    const levelNumber = this.resolveLevel(level);
    if (levelNumber === null) return [];

    const roles = await this.roleModel.find({ level: levelNumber }).select('_id').lean();
    if (!roles.length) return [];

    const roleIds = roles.map((role) => role._id);
    const roleIdStrings = roleIds.map((roleId) => roleId.toString());

    const users = await this.userModel.aggregate([
      {
        $addFields: {
          normalizedRoleId: {
            $convert: {
              input: '$role',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $match: {
          $or: [
            { role: { $in: roleIds } },
            { normalizedRoleId: { $in: roleIdStrings } },
          ],
        },
      },
      {
        $project: {
          _id: 1,
        },
      },
    ]);

    return users.map((user) => user._id.toString());
  }

  async create(dto: CreateLeadDto, user: any) {
    const userId = user?.userId;
    const assignedTo = dto.assignedTo ? dto.assignedTo : userId;
    const lead = await this.leadData.create({
      ...dto,
      city: dto.city,
      state: dto.state,
      modifiedBy: userId,
      stageId:new Types.ObjectId(dto.stageId),
      assignedTo,
      assignedDate: dto.assignedDate ? new Date(dto.assignedDate) : new Date(),
      poolId:new Types.ObjectId(dto.poolId),
      modifiedAt: new Date(),
    });

    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.CREATED,
      actionBy: userId,
      changes: dto,
    });

      await this.userActivityLogic.log({
    userId: userId,
    action: 'Lead_Created',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead created",
      lead},
  });
    if(dto.assignedTo){
await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.LEAD_ASSIGNED,
      actorId: userId,
      recipients: {
        userIds: [dto.assignedTo],
      },
      title: 'Lead Assigned',
      message: `A lead has been assigned to You.`,
      entity: {
        type: NOTIFICATION_ENTITY.LEAD,
        id: lead._id.toString(),
      },

      metadata: {
        redirectUrl: `leads`,
      },
    });
    }
    return this.maskLeadResponse(lead, user);
  }

  async createByUpskillab(dto: UpskillabLeadDto) {
    const getAdmin = await this.userModel.findOne({ role: '696f88b60841bc5572ee2385' }).select('_id');
    const NewLead = await this.leadStageModel.findOne({ name: 'New Lead' }).select('_id');
    const assignedTo =  getAdmin?._id?getAdmin._id:"";
    const lead = await this.leadData.create({
      ...dto,
      stageId:new Types.ObjectId(NewLead?._id),
      assignedTo,
      source:"webiste",
      source_campaign:"enquiry form",
      assignedDate: dto.assignedDate ? new Date(dto.assignedDate) : new Date(),
      modifiedAt: new Date(),
    });

    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.CREATED,
      actionBy: "",
      changes: {
        dto,
        message:"Lead Added from Upskillab"
      },
    });
    return {"message":"Lead Added succefully"};
  }

  async findAll(filters: any, user: any) {
    if (user.isSuperAdmin) {
      console.log(filters)
      return this.maskLeadResponse(await this.leadData.findAllWithFilters(filters), user);
    }
    const Pool= await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
    let poolId: string | undefined = undefined;

    if (Pool?._id) {
      poolId = Pool._id.toString();
    }

    const users = await this.userLogic.getUsersUnder(user);
    const accessibleUserIds = users.map((u) => u._id.toString());
    accessibleUserIds.push(user.userId)
    if (!accessibleUserIds || !accessibleUserIds.length) {
      return this.maskLeadResponse(await this.leadData.findAllWithFiltersUserIds(
        filters,
        [user.userId],
        poolId
      ), user);
    }

    // 🔥 Apply hierarchy filter
    return this.maskLeadResponse(await this.leadData.findAllWithFiltersUserIds(
      filters,
      accessibleUserIds,
      poolId
    ), user);
  }

  async stageSummaryReport(query: any, user: any) {
    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (query.assignedDate) {
      const singleDate = new Date(query.assignedDate);
      if (!Number.isNaN(singleDate.getTime())) {
        startDate = new Date(singleDate);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(singleDate);
        endDate.setHours(23, 59, 59, 999);
      }
    } else if (query.assignedDateFilter) {
      const dateFilter = query.assignedDateFilter.toString().toLowerCase();
      if (dateFilter === 'today') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'week') {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (dateFilter === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      }
    }

    if (query.assignedDateFrom && query.assignedDateTo) {
      const from = new Date(query.assignedDateFrom);
      const to = new Date(query.assignedDateTo);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        startDate = new Date(from);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    if (!startDate || !endDate) {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    let match: any = {
      assignedDate: { $gte: startDate, $lte: endDate },
    };

    if (query.status) match.status = query.status;
    if (query.source) match.source = query.source;
    if (query.stageId) match.stageId = new Types.ObjectId(query.stageId);
    if (query.poolId) match.poolId = new Types.ObjectId(query.poolId);
    if (query.assignedTo) match.assignedTo = query.assignedTo;
    if (query.counsellorId) match.assignedTo = query.counsellorId;

    if (!user.isSuperAdmin) {
      const Pool = await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
      const users = await this.userLogic.getUsersUnder(user);
      const accessibleUserIds = users.map((u) => u._id.toString());
      accessibleUserIds.push(user.userId);

      if (Pool?._id) {
        match.$or = [
          { assignedTo: { $in: accessibleUserIds } },
          { poolId: Pool._id },
        ];
      } else {
        match.assignedTo = { $in: accessibleUserIds };
      }
    }

    const stageResults = await this.leadModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'leadstages',
          localField: 'stageId',
          foreignField: '_id',
          as: 'stage',
        },
      },
      { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$stage.name', 'Unknown'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id': 1 } },
    ]);
    const totalLead = stageResults.reduce((sum, item) => sum + item.count, 0);
    const report = stageResults.map((item) => ({
      leadStage: item._id,
      count: item.count,
    }));

    return {
      totalLead,
      startDate,
      endDate,
      report,
    };
  }

  async sourceCampaignStageSummaryReport(query: any, user: any) {
    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (query.date) {
      const singleDate = new Date(query.date);
      if (!Number.isNaN(singleDate.getTime())) {
        startDate = new Date(singleDate);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(singleDate);
        endDate.setHours(23, 59, 59, 999);
      }
    } else if (query.dateFilter) {
      const dateFilter = query.dateFilter.toString().toLowerCase();
      if (dateFilter === 'today') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'week') {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (dateFilter === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      }
    }

    if (query.fromDate && query.toDate) {
      const from = new Date(query.fromDate);
      const to = new Date(query.toDate);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        startDate = new Date(from);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    if (!startDate || !endDate) {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    let match: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (query.status) match.status = query.status;
    if (query.source) match.source = query.source;
    if (query.stageId) match.stageId = new Types.ObjectId(query.stageId);
    if (query.poolId) match.poolId = new Types.ObjectId(query.poolId);
    if (query.assignedTo) match.assignedTo = query.assignedTo;
    if (query.counsellorId) match.assignedTo = query.counsellorId;
    if (query.source_campaign) {
      match.source_campaign = { $regex: query.source_campaign, $options: 'i' };
    }

    if (!user.isSuperAdmin) {
      const Pool = await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
      const users = await this.userLogic.getUsersUnder(user);
      const accessibleUserIds = users.map((u) => u._id.toString());
      accessibleUserIds.push(user.userId);

      if (Pool?._id) {
        match.$or = [
          { assignedTo: { $in: accessibleUserIds } },
          { poolId: Pool._id },
        ];
      } else {
        match.assignedTo = { $in: accessibleUserIds };
      }
    }

    const rows = await this.leadModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'leadstages',
          localField: 'stageId',
          foreignField: '_id',
          as: 'stage',
        },
      },
      { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            stageId: { $ifNull: ['$stage._id', null] },
            stageName: { $ifNull: ['$stage.name', 'Unknown'] },
            stageOrder: { $ifNull: ['$stage.order', 999999] },
            campaign: { $ifNull: ['$source_campaign', 'Unknown'] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.stageOrder': 1, '_id.stageName': 1, '_id.campaign': 1 } },
    ]);

    const campaigns = Array.from(
      new Set(rows.map((item) => item._id.campaign).filter(Boolean)),
    ).sort((a, b) => String(a).localeCompare(String(b)));

    const stageMap = new Map<string, any>();
    rows.forEach((item) => {
      const key = item._id.stageName;
      const existing = stageMap.get(key) || {
        sourceCampaignName: key,
        stageOrder: item._id.stageOrder,
        total: 0,
      };
      existing[item._id.campaign] = item.count;
      existing.total += item.count;
      stageMap.set(key, existing);
    });

    const data = Array.from(stageMap.values()).map((row: any) => {
      const finalRow: any = {
        sourceCampaignName: row.sourceCampaignName,
        total: row.total,
      };

      campaigns.forEach((campaign) => {
        finalRow[campaign] = row[campaign] || 0;
      });

      return finalRow;
    }).sort((a, b) => {
      const aRow = stageMap.get(a.sourceCampaignName);
      const bRow = stageMap.get(b.sourceCampaignName);
      return (aRow?.stageOrder || 999999) - (bRow?.stageOrder || 999999);
    });

    const totalsByCampaign: Record<string, number> = {};
const admissionDoneByCampaign: Record<string, number> = {};
const conversionPercentage: Record<string, number> = {};

campaigns.forEach((campaign) => {
  totalsByCampaign[campaign] = 0;
  admissionDoneByCampaign[campaign] = 0;
});

rows.forEach((row) => {
  const campaign = row._id.campaign;
  const stageName = row._id.stageName
    ?.toLowerCase()
    .trim();

  totalsByCampaign[campaign] += row.count;

  if (stageName === 'admission done') {
    admissionDoneByCampaign[campaign] += row.count;
  }
});

campaigns.forEach((campaign) => {
  conversionPercentage[campaign] =
    totalsByCampaign[campaign] > 0
      ? Number(
          (
            (admissionDoneByCampaign[campaign] /
              totalsByCampaign[campaign]) *
            100
          ).toFixed(2),
        )
      : 0;
});

const grandTotal = rows.reduce(
  (sum, row) => sum + row.count,
  0,
);

return {
  data: {
    startDate,
    endDate,
    sourceCampaigns: campaigns,
    data,
    totalsByCampaign,
    admissionDoneByCampaign,
    conversionPercentage,
    grandTotal,
  },
};
  }

  async allEmployeesStagesReport(query: any, user: any) {
    let match: any = {};

    if (!user.isSuperAdmin) {
      const Pool = await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
      const users = await this.userLogic.getUsersUnder(user);
      const accessibleUserIds = users.map((u) => u._id.toString());
      accessibleUserIds.push(user.userId);

      if (Pool?._id) {
        match.$or = [
          { assignedTo: { $in: accessibleUserIds } },
          { poolId: Pool._id },
        ];
      } else {
        match.assignedTo = { $in: accessibleUserIds };
      }
    }

    if (query.assignedDate) {
      const singleDate = new Date(query.assignedDate);
      if (!Number.isNaN(singleDate.getTime())) {
        const startDate = new Date(singleDate);
        const endDate = new Date(singleDate);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        match.assignedDate = { $gte: startDate, $lte: endDate };
      }
    } else if (query.assignedDateFilter) {
      const now = new Date();
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      const dateFilter = query.assignedDateFilter.toString().toLowerCase();

      if (dateFilter === 'today') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'week') {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (dateFilter === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      }

      if (startDate && endDate) {
        match.assignedDate = { $gte: startDate, $lte: endDate };
      }
    } else if (query.assignedDateFrom && query.assignedDateTo) {
      const from = new Date(query.assignedDateFrom);
      const to = new Date(query.assignedDateTo);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        const startDate = new Date(from);
        const endDate = new Date(to);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        match.assignedDate = { $gte: startDate, $lte: endDate };
      }
    }

    const employeeResults = await this.leadModel.aggregate([
      { $match: match },
      {
        $addFields: {
          employeeLookupId: {
            $cond: [
              { $and: [
                { $ne: ['$assignedTo', null] },
                { $ne: ['$assignedTo', false] },
                { $eq: [{ $type: '$assignedTo' }, 'objectId'] },
              ] },
              '$assignedTo',
              {
                $cond: [
                  { $and: [
                    { $ne: ['$assignedTo', null] },
                    { $ne: ['$assignedTo', false] },
                  ] },
                  { $toObjectId: '$assignedTo' },
                  null,
                ],
              },
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'employeeLookupId',
          foreignField: '_id',
          as: 'employee',
        },
      },
      { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'leadstages',
          localField: 'stageId',
          foreignField: '_id',
          as: 'stage',
        },
      },
      { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            employeeId: {
              $cond: [
                { $ifNull: ['$assignedTo', false] },
                { $toString: '$assignedTo' },
                'unassigned',
              ],
            },
            employeeName: { $ifNull: ['$employee.name', 'Unassigned'] },
            employeeEmail: '$employee.email',
            employeeNumber: '$employee.number',
            employeeEmployeeId: '$employee.employeeId',
            stageName: { $ifNull: ['$stage.name', 'Unknown'] },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          '_id.employeeName': 1,
          '_id.stageName': 1,
        },
      },
    ]);

    const grouped = new Map<string, any>();
    employeeResults.forEach((item) => {
      const empId = item._id.employeeId;
      const existing = grouped.get(empId) || {
        employeeId: empId,
        employeeName: item._id.employeeName,
        employeeEmail: item._id.employeeEmail || null,
        employeeNumber: item._id.employeeNumber || null,
        employeeEmployeeId: item._id.employeeEmployeeId || null,
        totalLead: 0,
        stages: [],
      };

      existing.stages.push({
        leadStage: item._id.stageName,
        count: item.count,
      });
      existing.totalLead += item.count;
      grouped.set(empId, existing);
    });

    const employees = Array.from(grouped.values());
    const totalLeads = employees.reduce((sum, emp) => sum + emp.totalLead, 0);

    return {
      totalLeads,
      totalEmployees: employees.length,
      employees: employees.sort((a, b) => b.totalLead - a.totalLead),
    };
  }

 async poolWiseDataReport(query: any) {
  const now = new Date();
  let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // ✅ Date Filters (keep same)
  if (query.dateFilter) {
    const filter = query.dateFilter.toLowerCase();

    if (filter === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'week') {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (filter === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
  }

  if (query.fromDate) {
    const from = new Date(query.fromDate);
    if (!Number.isNaN(from.getTime())) {
      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);
    }
  }

  if (query.toDate) {
    const to = new Date(query.toDate);
    if (!Number.isNaN(to.getTime())) {
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    }
  }

  const levelNumber = this.resolveLevel(query.level);
  if (levelNumber === null) {
    return {
      startDate,
      endDate,
      poolWiseData: [],
    };
  }

  const levelUserIds = await this.getUserIdsByRoleLevel(levelNumber);
  if (!levelUserIds.length) {
    return {
      startDate,
      endDate,
      poolWiseData: [],
    };
  }

  const userObjectIds = levelUserIds.map((id) =>id);

  // ✅ Get all pools
  const allPools = await this.poolModel.find().lean();

  // ✅ Aggregate leads dynamically by stage
  const leadMatch: any = {
    createdAt: { $gte: startDate, $lte: endDate },
    assignedTo: { $in: userObjectIds },
  };

  const stageData = await this.leadModel.aggregate([
    {
      $match: leadMatch,
    },
    {
      $lookup: {
        from: 'leadstages',
        localField: 'stageId',
        foreignField: '_id',
        as: 'stage',
      },
    },
    {
      $unwind: {
        path: '$stage',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: {
          poolId: '$poolId',
          stageName: { $ifNull: ['$stage.name', 'Unknown'] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // ✅ Total leads per pool
  const totalLeads = await this.leadModel.aggregate([
    {
      $match: leadMatch,
    },
    {
      $group: {
        _id: '$poolId',
        totalLead: { $sum: 1 },
      },
    },
  ]);

  // ✅ Convert to maps
  const totalMap = new Map();
  totalLeads.forEach((t) => {
    totalMap.set(t._id?.toString(), t.totalLead);
  });

  const stageMap = new Map();

  stageData.forEach((item) => {
    const poolId = item._id.poolId?.toString();
    if (!stageMap.has(poolId)) {
      stageMap.set(poolId, []);
    }

    stageMap.get(poolId).push({
      stage: item._id.stageName,
      count: item.count,
    });
  });

  // ✅ Final response
  const report = allPools.map((pool) => {
    const poolId = pool._id.toString();
    const stages = stageMap.get(poolId) || [];
    const totalLead = totalMap.get(poolId) || 0;

    return {
      poolId,
      poolName: pool.name || 'Unknown',
      totalLead,
      stages,
    };
  });

  return {
    startDate,
    endDate,
    poolWiseData: report,
  };
}

async stateWiseReport(query: any, user: any) {
  const now = new Date();
  let startDate = new Date();
  let endDate = new Date();

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  if (query.dateFilter) {
    const filter = query.dateFilter.toLowerCase();

    if (filter === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (filter === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
  }

  if (query.fromDate && query.toDate) {
    startDate = new Date(query.fromDate);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(query.toDate);
    endDate.setHours(23, 59, 59, 999);
  }

  const leadMatch: any = {
    createdAt: { $gte: startDate, $lte: endDate },
  };
  const revenueLeadMatch: any = {};

  if (query.state) {
    const stateFilter = { $regex: query.state, $options: 'i' };
    leadMatch.state = stateFilter;
    revenueLeadMatch['lead.state'] = stateFilter;
  }

  if (query.source_campaign) {
    const campaignFilter = {
      $regex: query.source_campaign,
      $options: 'i',
    };
    leadMatch.source_campaign = campaignFilter;
    revenueLeadMatch['lead.source_campaign'] = campaignFilter;
  }

  if (!user.isSuperAdmin) {
    const pool = await this.poolModel
      .findOne({ pool_owner: user.userId })
      .select('_id');
    const users = await this.userLogic.getUsersUnder(user);
    const accessibleUserIds = [
      ...new Set([...users.map((item) => item._id.toString()), user.userId]),
    ]
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (pool?._id) {
      leadMatch.$or = [
        { assignedTo: { $in: accessibleUserIds } },
        { poolId: pool._id },
      ];
      revenueLeadMatch.$or = [
        { 'lead.assignedTo': { $in: accessibleUserIds } },
        { 'lead.poolId': pool._id },
      ];
    } else {
      leadMatch.assignedTo = { $in: accessibleUserIds };
      revenueLeadMatch['lead.assignedTo'] = {
        $in: accessibleUserIds,
      };
    }
  }

  const leadResults = await this.leadModel.aggregate([
    { $match: leadMatch },
    {
      $lookup: {
        from: 'leadstages',
        localField: 'stageId',
        foreignField: '_id',
        as: 'stage',
      },
    },
    { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          state: { $ifNull: ['$state', 'Unknown'] },
          sourceCampaign: { $ifNull: ['$source_campaign', 'Unknown'] },
          stage: { $ifNull: ['$stage.name', 'Unknown'] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Revenue is filtered by the order date, then attributed to the matching
  // lead's campaign and state. Phone is included because many leads/orders
  // do not share a usable email address.
  const revenueResults = await this.orderModel.aggregate([
    {
      $match: {
        Approved: true,
        orderDate: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $lookup: {
        from: 'leads',
        let: { orderEmail: '$email', orderMobile: '$mobile' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$$orderEmail', ''] }, ''] },
                      { $eq: ['$email', '$$orderEmail'] },
                    ],
                  },
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$$orderMobile', ''] }, ''] },
                      { $eq: ['$phone', '$$orderMobile'] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $addFields: {
              emailMatch: { $eq: ['$email', '$$orderEmail'] },
            },
          },
          { $sort: { emailMatch: -1, createdAt: -1 } },
          // One order must be attributed once, not once for every duplicate lead.
          { $limit: 1 },
        ],
        as: 'lead',
      },
    },
    { $unwind: '$lead' },
    { $match: revenueLeadMatch },
    {
      $group: {
        _id: {
          state: { $ifNull: ['$lead.state', 'Unknown'] },
          sourceCampaign: {
            $ifNull: ['$lead.source_campaign', 'Unknown'],
          },
        },
        revenue: {
          $sum: { $ifNull: ['$countedRevenue', '$finalFee'] },
        },
      },
    },
  ]);
  const campaignMap = new Map<string, any>();
  const ensureState = (campaignName: string, state: string) => {
    if (!campaignMap.has(campaignName)) {
      campaignMap.set(campaignName, {
        campaignName,
        totalLeads: 0,
        totalAdmissionDone: 0,
        totalRevenue: 0,
        statesMap: new Map<string, any>(),
      });
    }

    const campaign = campaignMap.get(campaignName);
    if (!campaign.statesMap.has(state)) {
      campaign.statesMap.set(state, {
        state,
        totalLeads: 0,
        pcatScheduled: 0,
        pcatDone: 0,
        registrationDone: 0,
        admissionDone: 0,
        revenue: 0,
        stages: {},
      });
    }

    return {
      campaign,
      state: campaign.statesMap.get(state),
    };
  };

  leadResults.forEach((row) => {
    const campaignName = row._id.sourceCampaign;
    const stateName = row._id.state;
    const stage = row._id.stage;
    const item = ensureState(campaignName, stateName);

    item.state.totalLeads += row.count;
    item.state.stages[stage] = (item.state.stages[stage] || 0) + row.count;
    item.campaign.totalLeads += row.count;

    const stageName = stage.toLowerCase().trim();
    if (stageName === 'pcat schedule' || stageName === 'pcat scheduled') {
      item.state.pcatScheduled += row.count;
    } else if (stageName === 'pcat done') {
      item.state.pcatDone += row.count;
    } else if (stageName === 'registration done') {
      item.state.registrationDone += row.count;
    } else if (stageName === 'admission done') {
      item.state.admissionDone += row.count;
    }
  });

  // Keep revenue-only campaign/state rows too. An order can be in this date
  // range even when its lead was created before the selected range.
  revenueResults.forEach((row) => {
    const item = ensureState(row._id.sourceCampaign, row._id.state);
    item.state.revenue = Number(row.revenue) || 0;
  });

  const report = Array.from(campaignMap.values()).map((campaign: any) => {
    const states = Array.from(campaign.statesMap.values()).map(
      (state: any) => ({
        ...state,
        conversionPercentage:
          state.totalLeads > 0
            ? Number(
                ((state.admissionDone / state.totalLeads) * 100).toFixed(2),
              )
            : 0,
      }),
    );

    campaign.totalAdmissionDone = states.reduce(
      (sum, state) => sum + state.admissionDone,
      0,
    );
    campaign.totalRevenue = states.reduce(
      (sum, state) => sum + state.revenue,
      0,
    );
    campaign.states = states.sort((a, b) => b.totalLeads - a.totalLeads);
    delete campaign.statesMap;

    return campaign;
  });

  return {
    startDate,
    endDate,
    data: report.sort((a, b) => b.totalLeads - a.totalLeads),
  };
}
async stateWiseEmployeeReport(query: any, user: any) {
  const now = new Date();
  let startDate = new Date();
  let endDate = new Date();

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  if (query.dateFilter) {
    const filter = query.dateFilter.toLowerCase();

    if (filter === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (filter === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
  }

  if (query.fromDate && query.toDate) {
    startDate = new Date(query.fromDate);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(query.toDate);
    endDate.setHours(23, 59, 59, 999);
  }

  const leadMatch: any = {
    createdAt: { $gte: startDate, $lte: endDate },
  };
  const revenueLeadMatch: any = {};
  const revenueOrderMatch: any = {};

  if (query.state) {
    const stateFilter = { $regex: query.state, $options: 'i' };
    leadMatch.state = stateFilter;
    revenueLeadMatch['lead.state'] = stateFilter;
  }

  if (query.source) {
    leadMatch.source = query.source;
    revenueLeadMatch['lead.source'] = query.source;
  }

  if (query.status) {
    leadMatch.status = query.status;
    revenueLeadMatch['lead.status'] = query.status;
  }

  if (query.stageId) {
    const stageId = new Types.ObjectId(query.stageId);
    leadMatch.stageId = stageId;
    revenueLeadMatch['lead.stageId'] = stageId;
  }

  if (query.poolId) {
    const poolId = new Types.ObjectId(query.poolId);
    leadMatch.poolId = poolId;
    revenueLeadMatch['lead.poolId'] = poolId;
  }

  const requestedEmployeeId = query.counsellorId || query.assignedTo;
  if (requestedEmployeeId && Types.ObjectId.isValid(requestedEmployeeId)) {
    const employeeId = new Types.ObjectId(requestedEmployeeId);
    leadMatch.assignedTo = employeeId;
    revenueOrderMatch.counsellorId = employeeId;
  }

  let accessibleUserIds: Types.ObjectId[] = [];
  let poolId: any = null;

  if (!user.isSuperAdmin) {
    const pool = await this.poolModel
      .findOne({ pool_owner: user.userId })
      .select('_id');
    poolId = pool?._id;
    const users = await this.userLogic.getUsersUnder(user);
    accessibleUserIds = [
      ...new Set([...users.map((item) => item._id.toString()), user.userId]),
    ]
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (poolId) {
      leadMatch.$or = [
        { assignedTo: { $in: accessibleUserIds } },
        { poolId },
      ];
    } else {
      leadMatch.assignedTo = { $in: accessibleUserIds };
    }
  }

  const leadResults = await this.leadModel.aggregate([
    { $match: leadMatch },
    {
      $lookup: {
        from: 'leadstages',
        localField: 'stageId',
        foreignField: '_id',
        as: 'stage',
      },
    },
    { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        employeeLookupId: {
          $convert: {
            input: '$assignedTo',
            to: 'objectId',
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'employeeLookupId',
        foreignField: '_id',
        as: 'employee',
      },
    },
    { $unwind: { path: '$employee', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: {
          state: { $ifNull: ['$state', 'Unknown'] },
          employeeId: { $ifNull: ['$employee._id', null] },
          employeeName: { $ifNull: ['$employee.name', 'Unassigned'] },
          employeeEmail: { $ifNull: ['$employee.email', ''] },
          employeeCode: { $ifNull: ['$employee.employeeId', ''] },
          stage: { $ifNull: ['$stage.name', 'Unknown'] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Revenue is owned by the employee who created the order (counsellorId),
  // while state is read from the related lead. Match both email and mobile so
  // valid orders are not lost when one contact field differs or is empty.
  const revenuePipeline: any[] = [
    {
      $match: {
        Approved: true,
        orderDate: { $gte: startDate, $lte: endDate },
        ...revenueOrderMatch,
      },
    },
    {
      $lookup: {
        from: 'leads',
        let: { orderEmail: '$email', orderMobile: '$mobile' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$$orderEmail', ''] }, ''] },
                      { $eq: ['$email', '$$orderEmail'] },
                    ],
                  },
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$$orderMobile', ''] }, ''] },
                      { $eq: ['$phone', '$$orderMobile'] },
                    ],
                  },
                ],
              },
            },
          },
          { $addFields: { emailMatch: { $eq: ['$email', '$$orderEmail'] } } },
          { $sort: { emailMatch: -1, createdAt: -1 } },
          { $limit: 1 },
        ],
        as: 'lead',
      },
    },
    { $unwind: '$lead' },
    { $match: revenueLeadMatch },
  ];

  if (!user.isSuperAdmin) {
    if (poolId) {
      revenuePipeline.push({
        $match: {
          $or: [
            { counsellorId: { $in: accessibleUserIds } },
            { 'lead.poolId': poolId },
          ],
        },
      });
    } else {
      revenuePipeline.push({
        $match: { counsellorId: { $in: accessibleUserIds } },
      });
    }
  }

  revenuePipeline.push(
    {
      $group: {
        _id: {
          state: { $ifNull: ['$lead.state', 'Unknown'] },
          employeeId: '$counsellorId',
        },
        revenue: { $sum: { $ifNull: ['$countedRevenue', '$finalFee'] } },
      },
    },
    {
      $addFields: {
        employeeLookupId: {
          $convert: {
            input: '$_id.employeeId',
            to: 'objectId',
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'employeeLookupId',
        foreignField: '_id',
        as: 'employee',
      },
    },
    { $unwind: { path: '$employee', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        _id: 1,
        revenue: 1,
        employeeName: { $ifNull: ['$employee.name', 'Unknown'] },
        employeeEmail: { $ifNull: ['$employee.email', ''] },
        employeeCode: { $ifNull: ['$employee.employeeId', ''] },
      },
    },
  );

  const revenueResults = await this.orderModel.aggregate(revenuePipeline);
  const employeeMap = new Map<string, any>();
  const ensureEmployeeState = (
    employeeId: string,
    employeeName: string,
    employeeEmail: string,
    employeeCode: string,
    state: string,
  ) => {
    if (!employeeMap.has(employeeId)) {
      employeeMap.set(employeeId, {
        employeeId,
        employeeName,
        employeeEmail,
        employeeCode,
        totalLeads: 0,
        totalAdmissionDone: 0,
        totalRevenue: 0,
        statesMap: new Map<string, any>(),
      });
    }

    const employee = employeeMap.get(employeeId);
    if (!employee.statesMap.has(state)) {
      employee.statesMap.set(state, {
        state,
        totalLeads: 0,
        pcatScheduled: 0,
        pcatDone: 0,
        registrationDone: 0,
        admissionDone: 0,
        revenue: 0,
        stages: {},
      });
    }

    return { employee, state: employee.statesMap.get(state) };
  };

  leadResults.forEach((row) => {
    const employeeId = row._id.employeeId?.toString() || 'unassigned';
    const item = ensureEmployeeState(
      employeeId,
      row._id.employeeName,
      row._id.employeeEmail,
      row._id.employeeCode,
      row._id.state,
    );
    const stage = row._id.stage;

    item.state.totalLeads += row.count;
    item.state.stages[stage] = (item.state.stages[stage] || 0) + row.count;
    item.employee.totalLeads += row.count;

    const stageName = stage.toLowerCase().trim();
    if (stageName === 'pcat schedule' || stageName === 'pcat scheduled') {
      item.state.pcatScheduled += row.count;
    } else if (stageName === 'pcat done') {
      item.state.pcatDone += row.count;
    } else if (stageName === 'registration done') {
      item.state.registrationDone += row.count;
    } else if (stageName === 'admission done') {
      item.state.admissionDone += row.count;
    }
  });

  // Include states that only have approved orders during this range.
  revenueResults.forEach((row) => {
    const employeeId = row._id.employeeId?.toString() || 'unknown';
    const item = ensureEmployeeState(
      employeeId,
      row.employeeName,
      row.employeeEmail,
      row.employeeCode,
      row._id.state,
    );
    item.state.revenue = Number(row.revenue) || 0;
  });

  const report = Array.from(employeeMap.values()).map((employee: any) => {
    const states = Array.from(employee.statesMap.values()).map(
      (state: any) => ({
        ...state,
        conversionPercentage:
          state.totalLeads > 0
            ? Number(
                ((state.admissionDone / state.totalLeads) * 100).toFixed(2),
              )
            : 0,
      }),
    );

    employee.totalAdmissionDone = states.reduce(
      (sum, state) => sum + state.admissionDone,
      0,
    );
    employee.totalRevenue = states.reduce(
      (sum, state) => sum + state.revenue,
      0,
    );
    employee.states = states.sort((a, b) => b.totalLeads - a.totalLeads);
    delete employee.statesMap;

    return employee;
  });

  return {
    startDate,
    endDate,
    data: report.sort((a, b) => b.totalLeads - a.totalLeads),
  };
}
  async findOne(id: string, user: any) {
    const lead = await this.leadData.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');
    return this.maskLeadResponse(lead, user);
  }



  async update(id: string, dto: UpdateLeadDto, user: any) {
    const userId = user?.userId;
    const existingLead = await this.leadData.findById(id);
    if (!existingLead) throw new NotFoundException('Lead not found');
    const leadStage = await this.leadStageModel.findById(new Types.ObjectId(dto.stageId));
    if (!leadStage) throw new NotFoundException('Lead Stage not found');
    const updateData: any = {
      ...dto,
      assignedTo: dto.assignedTo === "" ? existingLead.assignedTo : dto.assignedTo,
      stageId: dto.stageId ? new Types.ObjectId(dto.stageId) : existingLead.stageId,
      poolId: dto.poolId ? new Types.ObjectId(dto.poolId) : existingLead.poolId,
      modifiedBy: userId,
      modifiedAt: new Date(),
    };

    if (dto.assignedTo && dto.assignedTo !== existingLead.assignedTo?.toString()) {
      updateData.assignedDate = new Date();
    }

      if (
    dto.stageId &&
    dto.stageId !== existingLead.stageId?.toString()
  ) {
    this.leadStageHistoryService.createHistory({leadId:id,stageId:dto.stageId,stageName:leadStage.name,userId});  
    updateData.stageChangedAt = new Date();
  }


    const lead = await this.leadData.update(id, updateData);
    if (!lead) {
      throw new NotFoundException("Lead Not found")
    }

    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.UPDATED,
      actionBy: userId,
      changes: {
        from: existingLead,
        to: lead,
      },
    });

    await this.userActivityLogic.log({
    userId: userId,
    action: 'Lead_Updated',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead Updated",
      from:existingLead,
      to:lead},
  });

    return this.maskLeadResponse(lead, user);
  }


  async changeStatus(
    id: string,
    status: LeadStatus,
    user: any,
  ) {
    const userId = user?.userId;
    const existingLead = await this.leadData.findById(id);
    if (!existingLead) throw new NotFoundException('Lead not found');

    const lead = await this.leadData.update(id, {
      status,
      modifiedBy: userId,
      modifiedAt: new Date(),
    });
    if (!lead) {
      throw new NotFoundException("Lead Not found")
    }
    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.STATUS_CHANGED,
      actionBy: userId,
      changes: {
        status: {
          from: existingLead.status,
          to: status,
        },
      },
    });

    await this.userActivityLogic.log({
    userId: userId,
    action: 'Lead_Status',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead Status changed",
      from:existingLead.status,
      to:status},
  });

    return {
      message: 'Lead status updated successfully',
      lead: this.maskLeadResponse(lead, user),
    };
  }

  async getLeadByLeadId(
    leadId: number,
    user: any,
  ) {
    const lead = await this.leadData.getByLeadId(leadId);
    return this.maskLeadResponse(lead, user);
  }


  async registerForPcat(
    leadId: number,
    user: any,
  ) {
    console.log('hi')
    // 1️⃣ fetch ongoing exam
    let ongoingExam: any = null;
    try {
      const resp = await axios.get('https://api.upskillab.com/pcat/exams/ongoing/exam');
      console.log(resp)
      if (resp && resp.status >= 200 && resp.status < 300) {
        ongoingExam = resp.data && resp.data._id ? resp.data : null;
      }
    } catch (err) {
      // swallow; we'll handle absence below
      ongoingExam = null;
    }

    if (!ongoingExam || !ongoingExam._id) {
      throw new BadRequestException('No ongoing PCAT exam found');
    }

    // 2️⃣ get lead details
    const lead = await this.leadData.getByLeadId(leadId);
    if (!lead) throw new NotFoundException('Lead not found');

    if (!lead.name || !lead.phone) {
      throw new BadRequestException('Lead name and phone are required for PCAT registration');
    }

    // 3️⃣ call external register endpoint
    const payload = {
      examId: ongoingExam._id,
      name: lead.name,
      email: lead.email || '',
      number: lead.phone,
    };

    try {
      const registerResp = await axios.post('https://api.upskillab.com/pcat-users/register', payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      console.log(registerResp)

      if (!(registerResp && registerResp.status >= 200 && registerResp.status < 300)) {
        throw new InternalServerErrorException('PCAT register API failed');
      }
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'PCAT registration failed';
      throw new InternalServerErrorException(message);
    }
    console.log(user)
    const leadStage = await this.leadStageModel.findOne({ name: 'PCAT Schedule' });
    if (!leadStage) throw new NotFoundException('Lead Stage not found');
    // 4️⃣ update lead status and log
    this.leadStageHistoryService.createHistory({leadId:lead._id.toString(),stageId:leadStage._id.toString(),stageName:leadStage.name,userId:user?.userId});  
    const updated = await this.leadData.update(lead._id.toString(), {
      stageId: leadStage._id,
      status: LeadStatus.PCAT_REGISTERED,
      modifiedBy: user?.userId,
      modifiedAt: new Date(),
    });
    

    // await this.leadHistoryLogic.log({
    //   leadId: lead.leadId.toString(),
    //   actionType: LeadActionType.STATUS_CHANGED,
    //   actionBy: user?.userId,
    //   changes: {
    //     status: {
    //       from: lead.status,
    //       to: 'pcat_registered',
    //     },
    //   },
    // });

    await this.userActivityLogic.log({
      userId: user?.userId,
      action: 'Lead_PCAT_Registered',
      referenceType: 'LEAD',
      referenceId: lead.leadId.toString(),
      meta: { message: 'Lead registered for PCAT', examId: ongoingExam._id },
    });

    return {
      message: 'Lead registered for PCAT successfully',
      exam: ongoingExam,
      lead: this.maskLeadResponse(updated, user),
    };
  }


  async changeStage(
    id: string,
    dto: any,
    user: any,
  ) {
    const userId = user?.userId;
    const existingLead = await this.leadData.findById(id);
    if (!existingLead) throw new NotFoundException('Lead not found');
    const existstage = await this.leadStageModel.findById(dto.stageId)
    if (!existstage) throw new NotFoundException('Stage not found');
    const lead = await this.leadData.update(id, {
      stageId:new Types.ObjectId(dto.stageId),
      modifiedBy: userId,
      modifiedAt: new Date(),
      stageChangedAt:new Date(),
    });
    
    if (!lead) {
      throw new NotFoundException("Lead Not found")
    }
    const stage = existingLead.stageId as any;
    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.STAGE_CHANGED,
      actionBy: userId,
      reason:dto.reason,
      changes: {
        status: {
          from: stage.name,
          to: existstage.name,
        },
      },
    });
    this.leadStageHistoryService.createHistory({leadId:existingLead._id.toString(),stageId:existstage._id.toString(),stageName:existstage.name,userId:user?.userId});  
    await this.userActivityLogic.log({
    userId: userId,
    action: 'Lead_Stage',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead Stage changed",
      from:stage.name,
      to:existstage.name},
  });

    return {
      message: 'Lead stage updated successfully',
      lead: this.maskLeadResponse(lead, user),
    };
  }

  async changeStagebyLeadId(
    leadId: number,
    stageId: string,
    userId: string,
  ) {
    const existingLead = await this.leadData.getByLeadId(leadId);
    if (!existingLead) throw new NotFoundException('Lead not found');
    const existstage = await this.leadStageModel.findById(stageId)
    if (!existstage) throw new NotFoundException('Lead not found');
    const lead = await this.leadData.update(existingLead._id.toString(), {
      stageId:new Types.ObjectId(stageId),
      modifiedBy: userId,
      modifiedAt: new Date(),
      stageChangedAt:new Date(),
    });

    if (!lead) {
      throw new NotFoundException("Lead Not found")
    }
    this.leadStageHistoryService.createHistory({leadId:existingLead._id.toString(),stageId:stageId,stageName:existstage.name,userId});  
    const stage = existingLead.stageId as any;
    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.STAGE_CHANGED_CallS,
      actionBy: userId,
      changes: {
        status: {
          from: stage.name,
          to: existstage.name,
        },
      },
    });

  await this.userActivityLogic.log({
    userId: userId,
    action: 'Lead_Stage',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead Stage changed",
                from: stage.name,
          to: existstage.name

    },
  });

    return {
      message: 'Lead stage updated successfully',
      lead,
    };
  }

  async assignLeads(
    dto: {
      leadIds: string[];
      assignedTo?: string;
      departmentId?: string;
      reason: string;
    },
    currentUserId: string,
  ) {
    const { leadIds, assignedTo, departmentId, reason } = dto;
    if (!assignedTo && !departmentId) {
      throw new BadRequestException(
        'assignTo or departmentId is required',
      );
    }

    const leads = await this.leadData.findByIds(leadIds);

    if (!leads.length) {
      throw new BadRequestException('No leads found');
    }

    let updatePayload: any = {
      modifiedBy: currentUserId,
    };

    if (assignedTo) {
      // 🔥 validate user department
      const user = await this.profileData.findByUserId(assignedTo);
      if (!user){
        throw new BadRequestException(
          'Assigned user does not belong to this department',
        );
      }

      updatePayload.assignedTo = assignedTo;
      updatePayload.assignedDate = new Date();
      updatePayload.departmentId = departmentId;
   

    // 🔹 Update leads
    const result = await this.leadData.bulkUpdate(
      leadIds,
      updatePayload,
    );

    // 🔹 History
    for (const lead of leads) {
      await this.leadHistoryLogic.log({
        leadId: lead?.leadId.toString(),
        actionType: assignedTo
          ? LeadActionType.ASSIGNED
          : LeadActionType.UPDATED,
        fromUser: lead.assignedTo?.toString(),
        toUser: assignedTo,
        actionBy: currentUserId,
        changes: updatePayload,
        reason: reason,
      });
   


   }
       await this.userActivityLogic.log({
    userId: currentUserId,
    action: 'Lead_Assignment',
    referenceType: 'LEAD',
    meta: {
      message:`${leads.length}Lead Assigned`,

    },
  });
     }
    if(assignedTo){
    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.LEAD_ASSIGNED,
      actorId: currentUserId,
      recipients: {
        userIds: [assignedTo],
      },

      title: 'Lead Assigned',
      message: `${leads.length} leads has been assigned to You.`,
      entity: {
        type: NOTIFICATION_ENTITY.LEAD,
        id: assignedTo.toString(),
      },

      metadata: {
        redirectUrl: `leads`,
      },
    });
    }

    return {
      message: 'Leads updated successfully'
      // modifiedCount: result.modifiedCount,
    };
  }

    async assignPool(
    dto: {
      leadIds: string[];
      poolId: string;
    },
    currentUserId: string,
  ) {
    const { leadIds, poolId } = dto;
    if (!poolId) {
      throw new BadRequestException('PoolId is required');
    }
    const poolExsist = await this.poolModel.findById(poolId);
    if(!poolExsist){
      throw new BadRequestException('Invalid PoolId');
    }
    const leads = await this.leadData.findByIds(leadIds);

    if (!leads.length) {
      throw new BadRequestException('No leads found');
    }

    let updatePayload: any = {
      modifiedBy: currentUserId,
      poolId: new Types.ObjectId(poolId),
    };

    // 🔹 Update leads
    const result = await this.leadData.bulkUpdate(
      leadIds,
      updatePayload,
    );

    // 🔹 History
    for (const lead of leads) {
      if(!lead.poolId){
      await this.leadHistoryLogic.log({
        leadId: lead?.leadId.toString(),
        actionType: LeadActionType.POOL_ADDED,
        actionBy: currentUserId,
        changes: {
          status:{
          from:"No Pool",
          to:poolExsist.name,
          }
        },
      });      
    }else{
     const Ispool = await this.poolModel.findById(new Types.ObjectId(lead.poolId))
      await this.leadHistoryLogic.log({
        leadId: lead?.leadId.toString(),
        actionType: LeadActionType.POOL_CHANGED,
        actionBy: currentUserId,
        changes: {
          status:{
            from :Ispool?.name,
            to:poolExsist.name,
          }
        },
      });
    }
    if(lead.assignedTo){
    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.LEAD_ASSIGNED,
      actorId: currentUserId,
      recipients: {
        userIds: [lead.assignedTo.toString()],
      },

      title: 'Lead Pool Changed',
      message: `LeadId #${lead.leadId} pool has been changed.`,
      entity: {
        type: NOTIFICATION_ENTITY.LEAD,
        id: lead.assignedTo.toString(),
      },

      metadata: {
        redirectUrl: `leads`,
      },
    });
    }
     }
    return {
      message: 'Pools updated successfully'
      // modifiedCount: result.modifiedCount,
    };
  }

      async bulkStagechange(
    dto: {
      leadIds: string[];
      stageId: string;
      reason:string;
    },
    currentUserId: string,
  ) {
    const { leadIds, stageId,reason } = dto;
    if (!stageId) {
      throw new BadRequestException('StageId is required');
    }
    const stageExsist = await this.leadStageModel.findById(new Types.ObjectId(stageId));
    if(!stageExsist){
      throw new BadRequestException('Invalid StageId');
    }
    const leads = await this.leadData.findByIds(leadIds);
    console.log(leads)
    if (!leads.length) {
      throw new BadRequestException('No leads found');
    }

    let updatePayload: any = {
      modifiedBy: currentUserId,
      stageId: stageId,
    };

    // 🔹 Update leads
    const result = await this.leadData.bulkUpdate(
      leadIds,
      updatePayload,
    );

    // 🔹 History
    for (const lead of leads) {
      const stage = await this.leadStageModel.findById(new Types.ObjectId(lead.stageId));
      console.log(lead,"!")
      this.leadStageHistoryService.createHistory({leadId:lead._id.toString(),stageId:stageId,stageName:stageExsist.name,userId:currentUserId});  
      console.log("added")
      await this.leadHistoryLogic.log({
        leadId: lead?.leadId.toString(),
        actionType: LeadActionType.STAGE_CHANGED,
        actionBy: currentUserId,
        changes: {
        status: {
          from:stage?.name || "No Stage",
          to:stageExsist.name,
        },
      },
      });      
     }
    return {
      message: 'stage updated successfully'
      // modifiedCount: result.modifiedCount,
    };
  }


  async pullBackAndReassign(
    leadIds: string[],
    newAssignedTo: string,
    currentUserId: string,
    reason: string,
  ) {
    const leads = await this.leadData.findByIds(leadIds);
    const user = await this.profileData.findByUserId(newAssignedTo);
      if (!user){
        throw new BadRequestException(
          'Assigned user does not belong to this department',
        );
      }

    const result = await this.leadData.pullBackAndReassign(
      leadIds,
      newAssignedTo,
      currentUserId,
    );

    for (const lead of leads) {
      await this.leadHistoryLogic.log({
        leadId: lead?.leadId.toString(),
        actionType: LeadActionType.REASSIGNED,
        fromUser: lead.assignedTo?.toString(),
        toUser: newAssignedTo,
        actionBy: currentUserId,

        changes: {
          assignedTo: {
            from: lead.assignedTo,
            to: newAssignedTo,
          },
          reason: reason,
        },
      });
      await this.userActivityLogic.log({
    userId: currentUserId,
    action: 'Lead_Reassignment',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead Stage changed",
      fromUser: lead.assignedTo?.toString(),
      toUser: newAssignedTo,

    },
  });
    }

    if(newAssignedTo){
    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.LEAD_ASSIGNED,
      actorId: currentUserId,
      recipients: {
        userIds: [newAssignedTo],
      },

      title: 'Lead Assigned',
      message: `${leads.length} leads has been assigned to You.`,
      entity: {
        type: NOTIFICATION_ENTITY.LEAD,
        id: newAssignedTo.toString(),
      },

      metadata: {
        redirectUrl: `leads`,
      },
    });
    }

    return {
      message: 'Leads pulled back and reassigned successfully',
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  async getLeadsByUser(userId: string, user: any) {
    const leads = await this.leadData.findByUserId(userId);
    return this.maskLeadResponse(leads, user);
  }
  async getLeadsByLeadIds(leadIds: number[], user: any) {
    const leads = await this.leadData.getLeadsByLeadIds(leadIds);
    return this.maskLeadResponse(leads, user);
  }
  // async getLeadsByDepartment(departmentId: string) {
  //   return this.leadData.findByDepartmentId(departmentId);
  // }
  async getDuplicateLeads(user: any) {
    const duplicates = await this.leadData.findDuplicateLeads();
    return this.maskLeadResponse(duplicates, user);
  }

  async mergeLeads(dto: MergeLeadsDTO, userId: string) {
    const { masterLeadId, duplicateLeadIds } = dto;

    // 1️⃣ Ensure master not in duplicates
    if (duplicateLeadIds.includes(masterLeadId)) {
      throw new Error('Master lead cannot be merged into itself');
    }

    const masterLeadIdNum = Number(masterLeadId);
    const duplicateLeadIdsNum = duplicateLeadIds.map(Number);
    // 2️⃣ Move all references
    await Promise.all([
      // Call Logs
      this.callLogModel.updateMany(
        { leadId: { $in: duplicateLeadIdsNum } },
        { $set: { leadId: masterLeadIdNum } },
      ),

      // Meeting Logs
      this.meetingLogModel.updateMany(
        { leadId: { $in: duplicateLeadIdsNum } },
        { $set: { leadId: masterLeadIdNum } },
      ),


      // Notes / Tasks / Deals (add others here)
    ]);
await this.userActivityLogic.log({
    userId: userId,
    action: 'Doublicate_Lead_merge',
    referenceType: 'LEAD',
    referenceId: masterLeadIdNum.toString(),
    meta: {
      message:`${duplicateLeadIds.length} Doublicate Leads  mearged`,
      masterLeadId: masterLeadId,
      duplicateLeadIdsNum: duplicateLeadIdsNum,

    },
  });

    // 3️⃣ Delete duplicate leads
    await this.leadModel.deleteMany({
      leadId: { $in: duplicateLeadIdsNum },
    });

    // 4️⃣ Store merge history (optional but recommended)
    // await this.leadHistoryLogic.log({
    //     leadId: lead?.leadId.toString(),
    //     actionType: LeadActionType.REASSIGNED,
    //     fromUser: lead.assignedTo?.toString(),
    //     toUser: newAssignedTo,
    //     actionBy: currentUserId,

    //     changes: {
    //       assignedTo: {
    //         from: lead.assignedTo,
    //         to: newAssignedTo,
    //       },
    //       reason: reason,
    //     },
    //   });

    return {
      message: 'Leads merged successfully',
      masterLeadId,
      mergedCount: duplicateLeadIds.length,
    };
  }

async getSettings() {
  let settings = await this.maskSettingModel.findOne();

  if (!settings) {
    settings = await this.maskSettingModel.create({
      emailMask: true,
      phoneMask: true,
    });
  }

  return settings;
}

async updateSettings(dto: any) {
  let settings = await this.maskSettingModel.findOne();

  if (!settings) {
    settings = await this.maskSettingModel.create(dto);
  } else {
    Object.assign(settings, dto);
    await settings.save();
  }

  return settings;
}
}
