import { BadRequestException, Injectable, NotFoundException, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
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
import { Order, PaymentMode } from 'src/schema/order_Management/order.schema';

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
  private async getUserAndSubordinateIds(userId: string): Promise<string[]> {
    try {
      const users = await this.userLogic.getUsersUnder({
        userId,
        roleName: 'user',
      });

      const ids = users
        .map((user: any) => user?._id?.toString?.())
        .filter(Boolean);

      ids.push(userId);
      return [...new Set(ids)];
    } catch {
      return [userId];
    }
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
          status: 'active',
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

async sourceCampaignStageSummaryReport(
  query: any,
  user: any,
) {
  const now = new Date();

  // =========================================================
  // DEFAULT DATE RANGE
  // Current calendar month
  // =========================================================

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0,
  );

  let endDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  // =========================================================
  // DATE FILTER
  // Same logic as Orders API
  // =========================================================

  if (query.dateFilter) {
    const filter =
      String(query.dateFilter).toLowerCase();

    // -------------------------------------------------------
    // TODAY
    // -------------------------------------------------------

    if (filter === 'today') {
      startDate = new Date(now);
      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }

    // -------------------------------------------------------
    // WEEK
    // Last 7 days
    // Same as Orders API
    // -------------------------------------------------------

    else if (filter === 'week') {
      startDate = new Date(now);

      startDate.setDate(
        startDate.getDate() - 7,
      );

      endDate = new Date(now);
    }

    // -------------------------------------------------------
    // MONTH
    // Current calendar month
    // -------------------------------------------------------

    else if (filter === 'month') {
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    }

    // -------------------------------------------------------
    // YEAR
    // Current calendar year
    // -------------------------------------------------------

    else if (filter === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    }
  }

  // =========================================================
  // SINGLE DATE
  // Example:
  // ?date=2026-08-15
  //
  // This overrides dateFilter.
  // =========================================================

  if (query.date) {
    const singleDate =
      new Date(query.date);

    if (
      !Number.isNaN(
        singleDate.getTime(),
      )
    ) {
      startDate =
        new Date(singleDate);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate =
        new Date(singleDate);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }
  }

  // =========================================================
  // CUSTOM FROM DATE
  // Overrides dateFilter
  // =========================================================

  if (query.fromDate) {
    const from =
      new Date(
        query.fromDate,
      );

    if (
      !Number.isNaN(
        from.getTime(),
      )
    ) {
      startDate =
        new Date(from);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );
    }
  }

  // =========================================================
  // CUSTOM TO DATE
  // Overrides dateFilter
  // =========================================================

  if (query.toDate) {
    const to =
      new Date(
        query.toDate,
      );

    if (
      !Number.isNaN(
        to.getTime(),
      )
    ) {
      endDate =
        new Date(to);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }
  }

  // =========================================================
  // INVALID DATE RANGE
  // =========================================================

  if (startDate > endDate) {
    return {
      data: {
        startDate,
        endDate,
        sourceCampaigns: [],
        data: [],
        totalsByCampaign: {},
        admissionDoneByCampaign: {},
        conversionPercentage: {},
        grandTotal: 0,
      },
    };
  }

  // =========================================================
  // BASE MATCH
  // =========================================================

  let match: any = {
    createdAt: {
      $gte: startDate,
      $lte: endDate,
    },
  };

  // =========================================================
  // FILTERS
  // =========================================================

  if (query.status) {
    match.status = query.status;
  }

  if (query.source) {
    match.source = query.source;
  }

  if (query.stageId) {
    match.stageId =
      new Types.ObjectId(
        query.stageId,
      );
  }

  if (query.poolId) {
    match.poolId =
      new Types.ObjectId(
        query.poolId,
      );
  }

  if (query.assignedTo) {
    match.assignedTo =
      query.assignedTo;
  }

  if (query.counsellorId) {
    match.assignedTo =
      query.counsellorId;
  }

  if (query.source_campaign) {
    match.source_campaign = {
      $regex:
        query.source_campaign,
      $options: 'i',
    };
  }

  // =========================================================
  // USER ACCESS FILTER
  // =========================================================

  if (!user.isSuperAdmin) {
  const users =
    await this.userLogic.getUsersUnder(user);

  const accessibleUserIds =
    users.map((u) =>
      u._id.toString(),
    );

  accessibleUserIds.push(
    user.userId,
  );

  match.assignedTo = {
    $in: [
      ...new Set(
        accessibleUserIds,
      ),
    ],
  };
}
  // =========================================================
  // AGGREGATION
  // =========================================================

  const rows =
    await this.leadModel.aggregate([
      {
        $match: match,
      },
      {
        $lookup: {
          from: 'leadstages',

          localField:
            'stageId',

          foreignField:
            '_id',

          as: 'stage',
        },
      },

      {
        $unwind: {
          path: '$stage',

          preserveNullAndEmptyArrays:
            true,
        },
      },

      // -----------------------------------------------------
      // GROUP BY STAGE + CAMPAIGN
      // -----------------------------------------------------

      {
        $group: {
          _id: {
            stageId: {
              $ifNull: [
                '$stage._id',
                null,
              ],
            },

            stageName: {
              $ifNull: [
                '$stage.name',
                'Unknown',
              ],
            },

            stageOrder: {
              $ifNull: [
                '$stage.order',
                999999,
              ],
            },

            campaign: {
              $ifNull: [
                '$source_campaign',
                'Unknown',
              ],
            },
          },

          count: {
            $sum: 1,
          },
        },
      },

      // -----------------------------------------------------
      // SORT
      // -----------------------------------------------------

      {
        $sort: {
          '_id.stageOrder': 1,
          '_id.stageName': 1,
          '_id.campaign': 1,
        },
      },
    ]);

  // =========================================================
  // CAMPAIGNS
  // =========================================================

  const campaigns =
    Array.from(
      new Set(
        rows
          .map(
            (item) =>
              item._id.campaign,
          )
          .filter(Boolean),
      ),
    ).sort(
      (a, b) =>
        String(a).localeCompare(
          String(b),
        ),
    );

  // =========================================================
  // STAGE MAP
  // =========================================================

  const stageMap =
    new Map<string, any>();

  rows.forEach(
    (item) => {
      const key =
        item._id.stageName;

      const existing =
        stageMap.get(key) || {
          sourceCampaignName:
            key,

          stageOrder:
            item._id.stageOrder,

          total: 0,
        };

      existing[
        item._id.campaign
      ] =
        item.count;

      existing.total +=
        item.count;

      stageMap.set(
        key,
        existing,
      );
    },
  );

  // =========================================================
  // DATA
  // =========================================================

  const data =
    Array.from(
      stageMap.values(),
    )
      .map(
        (row: any) => {
          const finalRow: any = {
            sourceCampaignName:
              row.sourceCampaignName,

            total:
              row.total,
          };

          campaigns.forEach(
            (campaign) => {
              finalRow[campaign] =
                row[campaign] || 0;
            },
          );

          return finalRow;
        },
      )
      .sort(
        (a, b) => {
          const aRow =
            stageMap.get(
              a.sourceCampaignName,
            );

          const bRow =
            stageMap.get(
              b.sourceCampaignName,
            );

          return (
            (aRow?.stageOrder ||
              999999) -
            (bRow?.stageOrder ||
              999999)
          );
        },
      );

  // =========================================================
  // TOTALS
  // =========================================================

  const totalsByCampaign:
    Record<string, number> = {};

  const admissionDoneByCampaign:
    Record<string, number> = {};

  const conversionPercentage:
    Record<string, number> = {};

  campaigns.forEach(
    (campaign) => {
      totalsByCampaign[
        campaign
      ] = 0;

      admissionDoneByCampaign[
        campaign
      ] = 0;
    },
  );

  // =========================================================
  // CALCULATE TOTALS
  // =========================================================

  rows.forEach(
    (row) => {
      const campaign =
        row._id.campaign;

      const stageName =
        row._id.stageName
          ?.toLowerCase()
          .trim();

      totalsByCampaign[
        campaign
      ] =
        (
          totalsByCampaign[
            campaign
          ] || 0
        ) + row.count;

      if (
        stageName ===
        'admission done'
      ) {
        admissionDoneByCampaign[
          campaign
        ] =
          (
            admissionDoneByCampaign[
              campaign
            ] || 0
          ) + row.count;
      }
    },
  );

  // =========================================================
  // CONVERSION %
  // =========================================================

  campaigns.forEach(
    (campaign) => {
      conversionPercentage[
        campaign
      ] =
        totalsByCampaign[
          campaign
        ] > 0
          ? Number(
              (
                (
                  admissionDoneByCampaign[
                    campaign
                  ] /
                  totalsByCampaign[
                    campaign
                  ]
                ) *
                100
              ).toFixed(2),
            )
          : 0;
    },
  );

  // =========================================================
  // GRAND TOTAL
  // =========================================================

  const grandTotal =
    rows.reduce(
      (sum, row) =>
        sum + row.count,
      0,
    );

  // =========================================================
  // RESPONSE
  // =========================================================

  return {
    data: {
      startDate,
      endDate,

      sourceCampaigns:
        campaigns,

      data,

      totalsByCampaign,

      admissionDoneByCampaign,

      conversionPercentage,

      grandTotal,
    },
  };
}

async allEmployeesStagesReport(query: any, user: any) {
  const match: any = {};

  // Date filter
  if (query.assignedDate) {
    const singleDate = new Date(query.assignedDate);

    if (!Number.isNaN(singleDate.getTime())) {
      const startDate = new Date(singleDate);
      const endDate = new Date(singleDate);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  } else if (query.assignedDateFilter) {
    const now = new Date();

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    const dateFilter = query.assignedDateFilter
      .toString()
      .toLowerCase();

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
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (dateFilter === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    }

    if (startDate && endDate) {
      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  } else if (
    query.assignedDateFrom &&
    query.assignedDateTo
  ) {
    const from = new Date(query.assignedDateFrom);
    const to = new Date(query.assignedDateTo);

    if (
      !Number.isNaN(from.getTime()) &&
      !Number.isNaN(to.getTime())
    ) {
      const startDate = new Date(from);
      const endDate = new Date(to);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  }

  const currentUserId = user.userId?.toString();

  const currentUser = await this.userModel
    .findById(currentUserId)
    .lean();

  if (!currentUser) {
    return {
      totalLeads: 0,
      totalEmployees: 0,
      employees: [],
    };
  }

  const currentLevel = this.resolveLevel(query.level || 1);

  const selectedLevel = this.resolveLevel(
    query.level,
  );

  if (selectedLevel === null) {
    return {
      totalLeads: 0,
      totalEmployees: 0,
      employees: [],
    };
  }

  let baseUserIds: string[] = [];

  // Get employees for selected level
  if (user.isSuperAdmin || user.role === 'Admin') {
    const levelUsers =
      await this.getUserIdsByRoleLevel(
        selectedLevel,
      );

    baseUserIds = levelUsers.map((id: any) =>
      id.toString(),
    );
  } else {
    if (currentLevel === null) {
      return {
        totalLeads: 0,
        totalEmployees: 0,
        employees: [],
      };
    }

    if (selectedLevel > currentLevel) {
      return {
        totalLeads: 0,
        totalEmployees: 0,
        employees: [],
      };
    }

    if (selectedLevel === currentLevel) {
      baseUserIds = [currentUserId];
    } else {
      const levelUsers =
        await this.getUserIdsByRoleLevel(
          selectedLevel,
        );

      baseUserIds = levelUsers.map((id: any) =>
        id.toString(),
      );
    }
  }

  baseUserIds = [
    ...new Set(
      baseUserIds
        .filter(Boolean)
        .map((id) => id.toString()),
    ),
  ];

  if (!baseUserIds.length) {
    return {
      totalLeads: 0,
      totalEmployees: 0,
      employees: [],
    };
  }

  const isTeam =
    query.team === true ||
    query.team === 'true';

  /**
   * Build employee -> team members map
   */
  const teamMap = new Map<string, string[]>();

  // if (isTeam) {
    for (const employeeId of baseUserIds) {
      const employee = await this.userModel
        .findById(employeeId)
        .lean();

      if (!employee) {
        continue;
      }

      const underUsers =
        await this.userLogic.getDirectUsersUnder(
          employee,
        );

      const memberIds = [
        employeeId,
        ...underUsers.map((u: any) =>
          u._id.toString(),
        ),
      ];

      teamMap.set(
        employeeId,
        [...new Set(memberIds)],
      );
    }
  // } else {
  //   for (const employeeId of baseUserIds) {
  //     teamMap.set(employeeId, [employeeId]);
  //   }
  // }

  // Get all users required for the report
  const allUserIds = [
    ...new Set(
      Array.from(teamMap.values()).flat(),
    ),
  ];

  if (!allUserIds.length) {
    return {
      totalLeads: 0,
      totalEmployees: 0,
      employees: [],
    };
  }

  const leadMatch = {
    ...match,
    assignedTo: {
      $in: allUserIds,
    },
  };

  const employeeResults =
    await this.leadModel.aggregate([
      {
        $match: leadMatch,
      },
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
      {
        $unwind: {
          path: '$employee',
          preserveNullAndEmptyArrays: true,
        },
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
            assignedUserId: {
              $cond: [
                {
                  $ifNull: [
                    '$assignedTo',
                    false,
                  ],
                },
                {
                  $toString: '$assignedTo',
                },
                'unassigned',
              ],
            },

            stageName: {
              $ifNull: [
                '$stage.name',
                'Unknown',
              ],
            },
          },

          count: {
            $sum: 1,
          },
        },
      },
    ]);

  // User -> stage counts
  const userStageMap =
    new Map<string, Map<string, number>>();

  employeeResults.forEach((item) => {
    const userId =
      item._id.assignedUserId;

    if (!userStageMap.has(userId)) {
      userStageMap.set(
        userId,
        new Map<string, number>(),
      );
    }

    const stageMap =
      userStageMap.get(userId)!;

    stageMap.set(
      item._id.stageName,
      item.count,
    );
  });

  // Load complete base employee details
  const baseEmployees =
    await this.userModel
      .find({
        _id: {
          $in: baseUserIds,
        },
      })
      .select(
        '_id name email number employeeId level roleLevel',
      )
      .lean();

  const employeeDetailsMap =
    new Map<string, any>();

  baseEmployees.forEach((employee: any) => {
    employeeDetailsMap.set(
      employee._id.toString(),
      employee,
    );
  });

  // Combine each employee's team
  const employees = baseUserIds
    .map((baseEmployeeId) => {
      const employee =
        employeeDetailsMap.get(
          baseEmployeeId,
        );

      if (!employee) {
        return null;
      }

      const memberIds =
        teamMap.get(
          baseEmployeeId,
        ) || [baseEmployeeId];

      const combinedStages =
        new Map<string, number>();

      let totalLead = 0;

      memberIds.forEach((memberId) => {
        const stageMap =
          userStageMap.get(memberId);

        if (!stageMap) {
          return;
        }

        stageMap.forEach(
          (count, stageName) => {
            combinedStages.set(
              stageName,
              (combinedStages.get(
                stageName,
              ) || 0) + count,
            );

            totalLead += count;
          },
        );
      });

      const stages = Array.from(
        combinedStages.entries(),
      )
        .map(([leadStage, count]) => ({
          leadStage,
          count,
        }))
        .sort((a, b) =>
          a.leadStage.localeCompare(
            b.leadStage,
          ),
        );

      return {
        employeeId:
          baseEmployeeId,

        employeeName:
          employee.name || 'Unknown',

        employeeEmail:
          employee.email || null,

        employeeNumber:
          employee.number || null,

        employeeEmployeeId:
          employee.employeeId || null,

        employeeLevel:
          employee.level ??
          employee.roleLevel ??
          null,

        totalLead,

        stages,

        ...(isTeam && {
          team: true,
          teamSize: memberIds.length,
        }),
      };
    })
    .filter(Boolean);

  employees.sort(
    (a: any, b: any) =>
      b.totalLead - a.totalLead,
  );

  const totalLeads =
    employees.reduce(
      (sum: number, employee: any) =>
        sum + employee.totalLead,
      0,
    );

  return {
    totalLeads,

    totalEmployees:
      employees.length,

    employees,

    filters: {
      level:
        query.level || null,

      team:
        isTeam,

      assignedDate:
        query.assignedDate || null,

      assignedDateFilter:
        query.assignedDateFilter || null,

      assignedDateFrom:
        query.assignedDateFrom || null,

      assignedDateTo:
        query.assignedDateTo || null,
    },
  };
}

async employeeTeamStagesReport(
  employeeId: string,
  query: any,
  user: any,
) {
  const match: any = {};

  // =========================================================
  // DATE FILTER
  // =========================================================

  if (query.assignedDate) {
    const singleDate = new Date(query.assignedDate);

    if (!Number.isNaN(singleDate.getTime())) {
      const startDate = new Date(singleDate);
      const endDate = new Date(singleDate);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  } else if (query.assignedDateFilter) {
    const now = new Date();

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    const dateFilter = query.assignedDateFilter
      .toString()
      .toLowerCase();

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
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (dateFilter === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    }

    if (startDate && endDate) {
      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  } else if (
    query.assignedDateFrom &&
    query.assignedDateTo
  ) {
    const from = new Date(query.assignedDateFrom);
    const to = new Date(query.assignedDateTo);

    if (
      !Number.isNaN(from.getTime()) &&
      !Number.isNaN(to.getTime())
    ) {
      const startDate = new Date(from);
      const endDate = new Date(to);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  }

  // =========================================================
  // GET SELECTED EMPLOYEE
  // =========================================================

  const selectedEmployee =
    await this.userModel
      .findById(employeeId)
      .select(
        '_id name email number employeeId level roleLevel role status',
      )
      .lean();

  if (!selectedEmployee) {
    return {
      employee: null,
      totalDirectEmployees: 0,
      employees: [],
    };
  }

  // =========================================================
  // CURRENT USER
  // =========================================================

  const currentUserId =
    user.userId?.toString();

  const currentUser =
    await this.userModel
      .findById(currentUserId)
      .lean();

  if (!currentUser) {
    return {
      employee: null,
      totalDirectEmployees: 0,
      employees: [],
    };
  }

  // =========================================================
  // ADMIN ACCESS
  // =========================================================

  const isAdmin =
    user.isSuperAdmin ||
    user.role === 'Admin';

  // =========================================================
  // NON ADMIN ACCESS
  // =========================================================

  if (!isAdmin) {
    const currentUserUnderUsers =
      await this.userLogic.getDirectUsersUnder(
        currentUser,
      );

    const accessibleUserIds = new Set(
      [
        currentUserId,
        ...currentUserUnderUsers.map(
          (u: any) =>
            u._id.toString(),
        ),
      ],
    );

    if (
      !accessibleUserIds.has(
        employeeId.toString(),
      )
    ) {
      return {
        employee: null,
        totalDirectEmployees: 0,
        employees: [],
      };
    }
  }

  // =========================================================
  // GET SELECTED EMPLOYEE DIRECT MEMBERS
  // =========================================================

  const directMembers =
    await this.userLogic.getDirectUsersUnder(
      selectedEmployee,
    );

  const directMemberMap =
    new Map<string, any>();

  directMembers.forEach((member: any) => {
    const memberId =
      member._id?.toString();

    if (
      memberId &&
      memberId !== employeeId.toString()
    ) {
      directMemberMap.set(
        memberId,
        member,
      );
    }
  });

  const uniqueDirectMembers =
    Array.from(
      directMemberMap.values(),
    );

  // =========================================================
  // BUILD TEAM MAP
  //
  // Selected Employee
  //     ↓
  // Direct Members
  //
  // And for every direct member:
  //
  // Direct Member
  //     ↓
  // Their Direct Members
  // =========================================================

  const teamMap =
    new Map<string, any[]>();

  // Selected employee's team
  teamMap.set(
    employeeId.toString(),
    uniqueDirectMembers,
  );

  // Get team for every direct employee
  await Promise.all(
    uniqueDirectMembers.map(
      async (member: any) => {
        const memberId =
          member._id.toString();

        const memberUnderUsers =
          await this.userLogic.getDirectUsersUnder(
            member,
          );

        const uniqueMemberUnderUsersMap =
          new Map<string, any>();

        memberUnderUsers.forEach(
          (underUser: any) => {
            const underUserId =
              underUser._id?.toString();

            if (
              underUserId &&
              underUserId !== memberId
            ) {
              uniqueMemberUnderUsersMap.set(
                underUserId,
                underUser,
              );
            }
          },
        );

        teamMap.set(
          memberId,
          Array.from(
            uniqueMemberUnderUsersMap.values(),
          ),
        );
      },
    ),
  );

  // =========================================================
  // GET ALL USERS REQUIRED FOR LEAD DATA
  // =========================================================

  const allRequiredIds =
    new Set<string>();

  // Selected employee
  allRequiredIds.add(
    employeeId.toString(),
  );

  // Selected employee direct members
  uniqueDirectMembers.forEach(
    (member: any) => {
      allRequiredIds.add(
        member._id.toString(),
      );
    },
  );

  // Direct members' teams
  teamMap.forEach(
    (members: any[], parentId: string) => {
      allRequiredIds.add(parentId);

      members.forEach(
        (member: any) => {
          if (member?._id) {
            allRequiredIds.add(
              member._id.toString(),
            );
          }
        },
      );
    },
  );

  const allRequiredUserIds =
    Array.from(allRequiredIds);

  // =========================================================
  // GET LEAD DATA
  // =========================================================

  const employeeLeadResults =
    await this.leadModel.aggregate([
      {
        $match: {
          ...match,
          assignedTo: {
            $in: allRequiredUserIds,
          },
        },
      },

      {
        $addFields: {
          assignedUserId: {
            $cond: [
              {
                $ifNull: [
                  '$assignedTo',
                  false,
                ],
              },
              {
                $toString:
                  '$assignedTo',
              },
              null,
            ],
          },
        },
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
            assignedUserId:
              '$assignedUserId',

            stageName: {
              $ifNull: [
                '$stage.name',
                'Unknown',
              ],
            },
          },

          count: {
            $sum: 1,
          },
        },
      },
    ]);

  // =========================================================
  // USER -> STAGE MAP
  // =========================================================

  const userStageMap =
    new Map<
      string,
      Map<string, number>
    >();

  employeeLeadResults.forEach(
    (item: any) => {
      const userId =
        item._id.assignedUserId;

      if (!userId) {
        return;
      }

      if (
        !userStageMap.has(userId)
      ) {
        userStageMap.set(
          userId,
          new Map<string, number>(),
        );
      }

      userStageMap
        .get(userId)!
        .set(
          item._id.stageName,
          item.count,
        );
    },
  );

  // =========================================================
  // BUILD OWN LEAD REPORT
  // =========================================================

  const buildOwnLeadReport = (
    employee: any,
  ) => {
    const id =
      employee._id.toString();

    const stageMap =
      userStageMap.get(id);

    let totalLead = 0;

    const stages = stageMap
      ? Array.from(
          stageMap.entries(),
        )
          .map(
            ([leadStage, count]) => {
              totalLead += count;

              return {
                leadStage,
                count,
              };
            },
          )
          .sort((a, b) =>
            a.leadStage.localeCompare(
              b.leadStage,
            ),
          )
      : [];

    return {
      employeeId: id,

      employeeName:
        employee.name || 'Unknown',

      employeeEmail:
        employee.email || null,

      employeeNumber:
        employee.number || null,

      employeeEmployeeId:
        employee.employeeId || null,

      employeeLevel:
        employee.level ??
        employee.roleLevel ??
        null,

      totalLead,

      stages,
    };
  };

  // =========================================================
  // BUILD COMBINED EMPLOYEE REPORT
  //
  // OWN DATA
  // +
  // DIRECT TEAM DATA
  // =========================================================

  const buildCombinedEmployeeReport = (
    employee: any,
    teamMembers: any[],
  ) => {
    const employeeIdString =
      employee._id.toString();

    // No team -> own data only
    if (teamMembers.length === 0) {
      return {
        ...buildOwnLeadReport(
          employee,
        ),

        teamSize: 0,
        hasTeam: false,
      };
    }

    const combinedStages =
      new Map<string, number>();

    let totalLead = 0;

    const combinedIds = [
      employeeIdString,

      ...teamMembers.map(
        (member: any) =>
          member._id.toString(),
      ),
    ];

    // Combine employee + team leads
    combinedIds.forEach(
      (memberId) => {
        const stageMap =
          userStageMap.get(memberId);

        if (!stageMap) {
          return;
        }

        stageMap.forEach(
          (count, stageName) => {
            combinedStages.set(
              stageName,
              (combinedStages.get(
                stageName,
              ) || 0) + count,
            );

            totalLead += count;
          },
        );
      },
    );

    const stages =
      Array.from(
        combinedStages.entries(),
      )
        .map(
          ([leadStage, count]) => ({
            leadStage,
            count,
          }),
        )
        .sort((a, b) =>
          a.leadStage.localeCompare(
            b.leadStage,
          ),
        );

    return {
      employeeId:
        employeeIdString,

      employeeName:
        employee.name || 'Unknown',

      employeeEmail:
        employee.email || null,

      employeeNumber:
        employee.number || null,

      employeeEmployeeId:
        employee.employeeId || null,

      employeeLevel:
        employee.level ??
        employee.roleLevel ??
        null,

      totalLead,

      stages,

      teamSize:
        teamMembers.length,

      hasTeam: true,
    };
  };

  // =========================================================
  // SELECTED EMPLOYEE
  //
  // OWN + DIRECT TEAM
  // =========================================================

  const employeeReport =
    buildCombinedEmployeeReport(
      selectedEmployee,
      uniqueDirectMembers,
    );

  // =========================================================
  // BUILD DIRECT MEMBERS REPORT
  //
  // IMPORTANT:
  //
  // Previously:
  //
  // buildOwnLeadReport(member)
  //
  // Now:
  //
  // buildCombinedEmployeeReport(
  //   member,
  //   member's team
  // )
  //
  // So each employee also returns
  // combined data.
  // =========================================================

  const employees =
    await Promise.all(
      uniqueDirectMembers.map(
        async (member: any) => {
          const memberId =
            member._id.toString();

          const memberTeam =
            teamMap.get(memberId) || [];

          return buildCombinedEmployeeReport(
            member,
            memberTeam,
          );
        },
      ),
    );

  // =========================================================
  // SORT MEMBERS
  // =========================================================

  employees.sort(
    (a: any, b: any) =>
      b.totalLead - a.totalLead,
  );

  // =========================================================
  // FINAL RESPONSE
  // =========================================================

  return {
    employee: {
      ...employeeReport,
    },

    totalDirectEmployees:
      employees.length,

    employees,

    filters: {
      assignedDate:
        query.assignedDate || null,

      assignedDateFilter:
        query.assignedDateFilter || null,

      assignedDateFrom:
        query.assignedDateFrom || null,

      assignedDateTo:
        query.assignedDateTo || null,
    },
  };
}

async employeeStageLeadsReport(
  employeeId: string,
  query: any,
  user: any,
) {
  const match: any = {};
  console.log('employeeStageLeadsReport query:', query);
  /*
   * ==========================================
   * PAGINATION
   * Default:
   * page = 1
   * limit = 10
   * ==========================================
   */

  const page = Math.max(
    parseInt(query.page, 10) || 1,
    1,
  );

  const limit = Math.min(
    Math.max(
      parseInt(query.limit, 10) || 10,
      1,
    ),
    100,
  );

  const skip = (page - 1) * limit;

  /*
   * ==========================================
   * DATE FILTER
   * ==========================================
   */

  if (query.assignedDate) {
    const singleDate = new Date(query.assignedDate);

    if (!Number.isNaN(singleDate.getTime())) {
      const startDate = new Date(singleDate);
      const endDate = new Date(singleDate);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  } else if (query.assignedDateFilter) {
    const now = new Date();

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    const dateFilter = query.assignedDateFilter
      .toString()
      .toLowerCase();

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
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    } else if (dateFilter === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    }

    if (startDate && endDate) {
      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  } else if (
    query.assignedDateFrom &&
    query.assignedDateTo
  ) {
    const from = new Date(query.assignedDateFrom);
    const to = new Date(query.assignedDateTo);

    if (
      !Number.isNaN(from.getTime()) &&
      !Number.isNaN(to.getTime())
    ) {
      const startDate = new Date(from);
      const endDate = new Date(to);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      match.assignedDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }
  }

  /*
   * ==========================================
   * GET SELECTED EMPLOYEE
   * ==========================================
   */

  const employee = await this.userModel
    .findById(employeeId)
    .select(
      '_id name email number employeeId level roleLevel status',
    )
    .lean();

  if (!employee) {
    return {
      employee: null,
      stageName: query.stageName || null,
      totalLeads: 0,
      page,
      limit,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      leads: [],
    };
  }

  /*
   * ==========================================
   * CURRENT USER
   * ==========================================
   */

  const currentUserId =
    user.userId?.toString();

  const currentUser =
    await this.userModel
      .findById(currentUserId)
      .lean();

  if (!currentUser) {
    return {
      employee: null,
      stageName: query.stageName || null,
      totalLeads: 0,
      page,
      limit,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      leads: [],
    };
  }

  const isAdmin =
    user.isSuperAdmin ||
    user.role === 'Admin';

  /*
   * ==========================================
   * CHECK ACCESS
   * ==========================================
   */

  if (!isAdmin) {
    const underUsers =
      await this.userLogic.getDirectUsersUnder(
        currentUser,
      );

    const accessibleIds = new Set([
      currentUserId,
      ...underUsers.map((u: any) =>
        u._id.toString(),
      ),
    ]);

    if (
      !accessibleIds.has(
        employeeId.toString(),
      )
    ) {
      return {
        employee: null,
        stageName: query.stageName || null,
        totalLeads: 0,
        page,
        limit,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
        leads: [],
      };
    }
  }

  /*
   * ==========================================
   * TEAM MODE
   *
   * false:
   * selected employee only
   *
   * true:
   * selected employee + all users under him
   * ==========================================
   */

  const isTeam =
    query.team === true ||
    query.team === 'true';

  let employeeIds = [
    employeeId.toString(),
  ];

  // if (isTeam) {
    const underUsers =
      await this.userLogic.getDirectUsersUnder(
        employee,
      );

    employeeIds = [
      employeeId.toString(),
      ...underUsers
        .map((u: any) =>
          u._id?.toString(),
        )
        .filter(Boolean),
    ];

    employeeIds = [
      ...new Set(employeeIds),
    ];
  // }

  /*
   * ==========================================
   * STAGE FILTER
   * ==========================================
   */

  const stageName =
    query.stageName?.toString().trim();

  /*
   * ==========================================
   * BASE PIPELINE
   * ==========================================
   */

  const pipeline: any[] = [
    {
      $match: {
        ...match,
        assignedTo: {
          $in: employeeIds,
        },
      },
    },

    /*
     * Convert assignedTo to ObjectId
     */

    {
      $addFields: {
        assignedUserObjectId: {
          $convert: {
            input: '$assignedTo',
            to: 'objectId',
            onError: null,
            onNull: null,
          },
        },
      },
    },

    /*
     * Get employee
     */

    {
      $lookup: {
        from: 'users',
        localField: 'assignedUserObjectId',
        foreignField: '_id',
        as: 'assignedEmployee',
      },
    },

    {
      $unwind: {
        path: '$assignedEmployee',
        preserveNullAndEmptyArrays: true,
      },
    },

    /*
     * Get stage
     */

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
  ];

  /*
   * ==========================================
   * STAGE NAME FILTER
   * ==========================================
   */

  if (stageName) {
    pipeline.push({
      $match: {
        'stage.name': stageName,
      },
    });
  }

  /*
   * ==========================================
   * SORT
   * ==========================================
   */

  pipeline.push({
    $sort: {
      assignedDate: -1,
      _id: -1,
    },
  });

  /*
   * ==========================================
   * GET TOTAL COUNT
   *
   * IMPORTANT:
   * Count happens BEFORE skip/limit.
   * ==========================================
   */

  const countPipeline = [
    ...pipeline,
    {
      $count: 'total',
    },
  ];

  const countResult =
    await this.leadModel.aggregate(
      countPipeline,
    );

  const totalLeads =
    countResult[0]?.total || 0;

  /*
   * ==========================================
   * PAGINATION
   * ==========================================
   */

  pipeline.push({
    $skip: skip,
  });

  pipeline.push({
    $limit: limit,
  });

  /*
   * ==========================================
   * PROJECT
   * ==========================================
   */

  pipeline.push({
    $project: {
      _id: 1,

      leadId: {
        $toString: '$leadId',
      },

      assignedDate: 1,

      assignedTo: {
        $cond: [
          {
            $ifNull: [
              '$assignedTo',
              false,
            ],
          },
          {
            $toString: '$assignedTo',
          },
          null,
        ],
      },

      employee: {
        employeeId: {
          $toString:
            '$assignedEmployee._id',
        },

        name:
          '$assignedEmployee.name',

        email:
          '$assignedEmployee.email',

        number:
          '$assignedEmployee.number',

        employeeIdNumber:
          '$assignedEmployee.employeeId',
      },

      stage: {
        id: {
          $toString:
            '$stage._id',
        },

        name:
          '$stage.name',
      },

      name: 1,
      email: 1,
      number: 1,
      phone: 1,
      source: 1,
      course: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  });

  /*
   * ==========================================
   * GET PAGINATED LEADS
   * ==========================================
   */

  const leads =
    await this.leadModel.aggregate(
      pipeline,
    );

  /*
   * ==========================================
   * PAGINATION INFORMATION
   * ==========================================
   */

  const totalPages =
    totalLeads > 0
      ? Math.ceil(
          totalLeads / limit,
        )
      : 0;

  const hasNextPage =
    page < totalPages;

  const hasPreviousPage =
    page > 1 && totalPages > 0;

  /*
   * ==========================================
   * RESPONSE
   * ==========================================
   */

  return {
    employee: {
      employeeId:
        employee._id.toString(),

      employeeName:
        employee.name || 'Unknown',

      employeeEmail:
        employee.email || null,

      employeeNumber:
        employee.number || null,

      employeeEmployeeId:
        employee.employeeId || null,
    },

    stageName:
      stageName || 'ALL',

    team: isTeam,

    teamSize:
      isTeam
        ? employeeIds.length - 1
        : 0,

    totalLeads,

    pagination: {
      page,
      limit,
      totalLeads,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    },

    leads,

    filters: {
      assignedDate:
        query.assignedDate || null,

      assignedDateFilter:
        query.assignedDateFilter || null,

      assignedDateFrom:
        query.assignedDateFrom || null,

      assignedDateTo:
        query.assignedDateTo || null,

      stageName:
        stageName || null,

      team:
        isTeam,
    },
  };
}


async poolWiseDataReport(query: any) {
  const now = new Date();

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  );

  let endDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  // Date filters
  if (query.dateFilter) {
    const filter = query.dateFilter
      .toString()
      .toLowerCase();

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
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

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
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
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

  // Level
  const levelNumber = this.resolveLevel(
    query.level,
  );

  if (levelNumber === null) {
    return {
      startDate,
      endDate,
      poolWiseData: [],
    };
  }

  const levelUserIds =
    await this.getUserIdsByRoleLevel(
      levelNumber,
    );

  if (!levelUserIds.length) {
    return {
      startDate,
      endDate,
      poolWiseData: [],
    };
  }

  const baseUserIds = [
    ...new Set(
      levelUserIds.map((id: any) =>
        id.toString(),
      ),
    ),
  ];

  // Team filter
  const isTeam =
    query.team === true ||
    query.team === 'true';

  let userIds: string[] = [];

  if (isTeam) {
    const teamUserIds = new Set<string>();

    for (const employeeId of baseUserIds) {
      const employee =
        await this.userModel
          .findById(employeeId)
          .lean();

      if (!employee) {
        continue;
      }

      // Always include the employee
      teamUserIds.add(employeeId);

      // Add all users under employee
      const usersUnder =
        await this.userLogic.getUsersUnder(
          employee,
        );

      usersUnder.forEach((u: any) => {
        if (u?._id) {
          teamUserIds.add(
            u._id.toString(),
          );
        }
      });
    }

    userIds = Array.from(teamUserIds);
  } else {
    userIds = baseUserIds;
  }

  if (!userIds.length) {
    return {
      startDate,
      endDate,
      poolWiseData: [],
    };
  }

  // Get all pools
  const allPools =
    await this.poolModel
      .find()
      .lean();

  // Lead filter
  const leadMatch: any = {
    createdAt: {
      $gte: startDate,
      $lte: endDate,
    },

    assignedTo: {
      $in: userIds,
    },
  };

  // Stage-wise pool data
  const stageData =
    await this.leadModel.aggregate([
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
            stageName: {
              $ifNull: [
                '$stage.name',
                'Unknown',
              ],
            },
          },

          count: {
            $sum: 1,
          },
        },
      },
    ]);

  // Total leads per pool
  const totalLeads =
    await this.leadModel.aggregate([
      {
        $match: leadMatch,
      },
      {
        $group: {
          _id: '$poolId',

          totalLead: {
            $sum: 1,
          },
        },
      },
    ]);

  // Total map
  const totalMap =
    new Map<string, number>();

  totalLeads.forEach((item) => {
    if (item._id) {
      totalMap.set(
        item._id.toString(),
        item.totalLead,
      );
    }
  });

  // Stage map
  const stageMap =
    new Map<string, any[]>();

  stageData.forEach((item) => {
    const poolId =
      item._id.poolId?.toString();

    if (!poolId) {
      return;
    }

    if (!stageMap.has(poolId)) {
      stageMap.set(
        poolId,
        [],
      );
    }

    stageMap.get(poolId)!.push({
      stage:
        item._id.stageName,

      count:
        item.count,
    });
  });

  // Final response
  const report =
    allPools.map((pool) => {
      const poolId =
        pool._id.toString();

      const stages =
        stageMap.get(poolId) || [];

      const totalLead =
        totalMap.get(poolId) || 0;

      return {
        poolId,

        poolName:
          pool.name || 'Unknown',

        totalLead,

        stages,
      };
    });

  return {
    startDate,
    endDate,

    level:
      levelNumber,

    team:
      isTeam,

    totalLeads:
      report.reduce(
        (sum, pool) =>
          sum + pool.totalLead,
        0,
      ),

    poolWiseData:
      report,
  };
}

async poolWiseLeadsReport(query: any) {
  console.log('poolWiseLeadsReport query:', query);
  const now = new Date();
  const page = Math.max(
    parseInt(query.page, 10) || 1,
    1,
  );

  const limit = Math.min(
    Math.max(
      parseInt(query.limit, 10) || 10,
      1,
    ),
    100,
  );

  const skip = (page - 1) * limit;

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  );

  let endDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  /*
   * ==========================================
   * DATE FILTER
   * ==========================================
   */

  if (query.dateFilter) {
    const filter = query.dateFilter
      .toString()
      .toLowerCase();

    if (filter === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'week') {
      startDate = new Date(now);
      startDate.setDate(
        startDate.getDate() - 6,
      );
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'month') {
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

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
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
      );

      endDate = new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999,
      );
    }
  }

  /*
   * ==========================================
   * CUSTOM FROM DATE
   * ==========================================
   */

  if (query.fromDate) {
    const from = new Date(query.fromDate);

    if (!Number.isNaN(from.getTime())) {
      startDate = new Date(from);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );
    }
  }

  /*
   * ==========================================
   * CUSTOM TO DATE
   * ==========================================
   */

  if (query.toDate) {
    const to = new Date(query.toDate);

    if (!Number.isNaN(to.getTime())) {
      endDate = new Date(to);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }
  }

  /*
   * ==========================================
   * POOL ID
   * ==========================================
   */

  const poolId =
    query.poolId?.toString().trim();

  if (!poolId) {
    console.log('poolWiseLeadsReport: poolId is required');
    return {
      startDate,
      endDate,
      poolId: null,
      stageName:
        query.stageName || null,
      totalLeads: 0,

      pagination: {
        page,
        limit,
        totalLeads: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },

      leads: [],
    };
  }

  /*
   * ==========================================
   * STAGE NAME
   * ==========================================
   */

  const stageName =
    query.stageName
      ?.toString()
      .trim();

  /*
   * ==========================================
   * LEVEL
   * ==========================================
   */

  const levelNumber =
    this.resolveLevel(
      query.level,
    );

  if (levelNumber === null) {
    return {
      startDate,
      endDate,
      poolId,
      stageName:
        stageName || null,
      totalLeads: 0,

      pagination: {
        page,
        limit,
        totalLeads: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },

      leads: [],
    };
  }

  /*
   * ==========================================
   * GET USERS BY LEVEL
   * ==========================================
   */

  const levelUserIds =
    await this.getUserIdsByRoleLevel(
      levelNumber,
    );
    console.log('poolWiseLeadsReport: levelUserIds:', levelUserIds);
  if (!levelUserIds.length) {
    return {
      startDate,
      endDate,
      poolId,
      stageName:
        stageName || null,
      totalLeads: 0,

      pagination: {
        page,
        limit,
        totalLeads: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },

      leads: [],
    };
  }

  /*
   * ==========================================
   * BASE USER IDS
   * ==========================================
   */

  const baseUserIds = [
    ...new Set(
      levelUserIds.map((id: any) =>
        id.toString(),
      ),
    ),
  ];

  /*
   * ==========================================
   * TEAM FILTER
   * ==========================================
   */

  const isTeam =
    query.team === true ||
    query.team === 'true';

  let userIds: string[] = [];

  if (isTeam) {
    const teamUserIds =
      new Set<string>();

    for (const employeeId of baseUserIds) {
      const employee =
        await this.userModel
          .findById(employeeId)
          .lean();

      if (!employee) {
        continue;
      }

      /*
       * Include employee himself
       */

      teamUserIds.add(
        employeeId,
      );

      /*
       * Include everyone under employee
       */

      const usersUnder =
        await this.userLogic.getUsersUnder(
          employee,
        );

      usersUnder.forEach(
        (u: any) => {
          if (u?._id) {
            teamUserIds.add(
              u._id.toString(),
            );
          }
        },
      );
    }

    userIds =
      Array.from(
        teamUserIds,
      );
  } else {
    userIds = baseUserIds;
  }

  if (!userIds.length) {
    return {
      startDate,
      endDate,
      poolId,
      stageName:
        stageName || null,
      totalLeads: 0,

      pagination: {
        page,
        limit,
        totalLeads: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },

      leads: [],
    };
  }

  /*
   * ==========================================
   * VERIFY POOL EXISTS
   * ==========================================
   */

  const pool =
    await this.poolModel
      .findById(poolId)
      .select('_id name')
      .lean();

  if (!pool) {
    console.log('poolWiseLeadsReport: pool not found for poolId:', poolId);
    return {
      startDate,
      endDate,
      poolId,
      poolName: null,
      stageName:
        stageName || null,
      totalLeads: 0,

      pagination: {
        page,
        limit,
        totalLeads: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },

      leads: [],
    };
  }

  /*
   * ==========================================
   * BASE LEAD MATCH
   * ==========================================
   *
   * Same filters as poolWiseDataReport
   */

  const leadMatch: any = {
    createdAt: {
      $gte: startDate,
      $lte: endDate,
    },

    assignedTo: {
      $in: userIds,
    },

    poolId: new Types.ObjectId(poolId),
  };

  /*
   * ==========================================
   * PIPELINE
   * ==========================================
   */

  const pipeline: any[] = [
    {
      $match: leadMatch,
    },

    /*
     * Get assigned employee
     */

    {
      $addFields: {
        assignedUserObjectId: {
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
        localField:
          'assignedUserObjectId',
        foreignField: '_id',
        as: 'assignedEmployee',
      },
    },

    {
      $unwind: {
        path: '$assignedEmployee',
        preserveNullAndEmptyArrays: true,
      },
    },

    /*
     * Get stage
     */

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
  ];

  /*
   * ==========================================
   * STAGE FILTER
   * ==========================================
   */

  if (stageName) {
    pipeline.push({
      $match: {
        'stage.name': stageName,
      },
    });
  }

  /*
   * ==========================================
   * SORT
   * ==========================================
   */

  pipeline.push({
    $sort: {
      createdAt: -1,
      _id: -1,
    },
  });

  /*
   * ==========================================
   * COUNT BEFORE PAGINATION
   * ==========================================
   */

  const countPipeline = [
    ...pipeline,
    {
      $count: 'total',
    },
  ];

  const countResult =
    await this.leadModel.aggregate(
      countPipeline,
    );

  const totalLeads =
    countResult[0]?.total || 0;

  /*
   * ==========================================
   * PAGINATION
   * ==========================================
   */

  pipeline.push({
    $skip: skip,
  });

  pipeline.push({
    $limit: limit,
  });

  /*
   * ==========================================
   * RESPONSE FIELDS
   * ==========================================
   */

  pipeline.push({
    $project: {
      _id: 1,

      leadId: {
        $toString: '$leadId',
      },

      poolId: {
        $toString: '$poolId',
      },

      assignedDate: 1,

      createdAt: 1,

      updatedAt: 1,

      assignedTo: {
        $cond: [
          {
            $ifNull: [
              '$assignedTo',
              false,
            ],
          },

          {
            $toString:
              '$assignedTo',
          },

          null,
        ],
      },

      employee: {
        id: {
          $toString:
            '$assignedEmployee._id',
        },

        employeeId:
          '$assignedEmployee.employeeId',

        name:
          '$assignedEmployee.name',

        email:
          '$assignedEmployee.email',

        number:
          '$assignedEmployee.number',
      },

      stage: {
        id: {
          $toString:
            '$stage._id',
        },

        name:
          '$stage.name',
      },

      /*
       * Common lead information
       */

      name: 1,
      email: 1,
      number: 1,
      phone: 1,
      source: 1,
      course: 1,
      status: 1,
    },
  });

  /*
   * ==========================================
   * EXECUTE
   * ==========================================
   */

  const leads =
    await this.leadModel.aggregate(
      pipeline,
    );
console.log('poolWiseLeadsReport: leads:', leads);
  /*
   * ==========================================
   * PAGINATION INFO
   * ==========================================
   */

  const totalPages =
    totalLeads > 0
      ? Math.ceil(
          totalLeads / limit,
        )
      : 0;

  const hasNextPage =
    page < totalPages;

  const hasPreviousPage =
    page > 1 &&
    totalPages > 0;

  /*
   * ==========================================
   * FINAL RESPONSE
   * ==========================================
   */

  return {
    startDate,
    endDate,

    level:
      levelNumber,

    team:
      isTeam,

    poolId:
      pool._id.toString(),

    poolName:
      pool.name || 'Unknown',

    stageName:
      stageName || 'ALL',

    totalLeads,

    pagination: {
      page,
      limit,
      totalLeads,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    },

    leads,

    filters: {
      dateFilter:
        query.dateFilter || null,

      fromDate:
        query.fromDate || null,

      toDate:
        query.toDate || null,

      level:
        query.level || null,

      team:
        isTeam,

      poolId,

      stageName:
        stageName || null,
    },
  };
}

async stateWiseReport(
  query: any,
  user: any,
) {
  const now = new Date();

  // =========================================================
  // PAGINATION
  // =========================================================

  const page = Math.max(
    1,
    Number(query.page) || 1,
  );

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number(query.limit) || 10,
    ),
  );

  const skip =
    (page - 1) * limit;

  // =========================================================
  // DATE RANGE
  // =========================================================

  const getFilterRange = (
    filter: any,
  ) => {
    const value = String(
      filter || 'today',
    )
      .trim()
      .toLowerCase();

    let startDate: Date;
    let endDate: Date;

    if (value === 'today') {
      startDate = new Date(now);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'week') {
      startDate = new Date(now);

      startDate.setDate(
        startDate.getDate() - 6,
      );

      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'month') {
      // First day of current month
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      // Today only
      endDate = new Date(now);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'year') {
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0,
      );

      // Today only
      endDate = new Date(now);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else {
      throw new BadRequestException(
        `Invalid date filter: ${filter}`,
      );
    }

    return {
      startDate,
      endDate,
    };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
  ) => {
    if (
      !fromValue ||
      !toValue
    ) {
      throw new BadRequestException(
        'fromDate and toDate are both required',
      );
    }

    const startDate =
      new Date(fromValue);

    const endDate =
      new Date(toValue);

    if (
      Number.isNaN(
        startDate.getTime(),
      ) ||
      Number.isNaN(
        endDate.getTime(),
      )
    ) {
      throw new BadRequestException(
        'Invalid custom date range',
      );
    }

    startDate.setHours(
      0,
      0,
      0,
      0,
    );

    endDate.setHours(
      23,
      59,
      59,
      999,
    );

    if (
      startDate > endDate
    ) {
      throw new BadRequestException(
        'fromDate cannot be greater than toDate',
      );
    }

    const diffDays =
      Math.floor(
        (
          endDate.getTime() -
          startDate.getTime()
        ) /
          (
            1000 *
            60 *
            60 *
            24
          ),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        'Date range cannot be more than 31 days',
      );
    }

    return {
      startDate,
      endDate,
    };
  };

  let dateRange: {
    startDate: Date;
    endDate: Date;
  };

  if (
    query.fromDate ||
    query.toDate
  ) {
    dateRange =
      getCustomRange(
        query.fromDate,
        query.toDate,
      );
  } else {
    dateRange =
      getFilterRange(
        query.dateFilter ||
          'today',
      );
  }

  const {
    startDate,
    endDate,
  } = dateRange;

  // =========================================================
  // LEAD MATCH
  // =========================================================

  const leadMatch: any = {
    createdAt: {
      $gte: startDate,
      $lte: endDate,
    },
  };

  if (query.state) {
    leadMatch.state = {
      $regex: String(
        query.state,
      ),
      $options: 'i',
    };
  }

  if (
    query.source_campaign
  ) {
    leadMatch.source_campaign = {
      $regex: String(
        query.source_campaign,
      ),
      $options: 'i',
    };
  }

  // =========================================================
  // GET SELECTED LEADS
  // =========================================================

  const selectedLeads =
    await this.leadModel
      .find(leadMatch)
      .select(
        `
          _id
          leadId
          name
          phone
          mobile
          email
          state
          source_campaign
          stageId
          createdAt
          assignedTo
          assignedDate
        `,
      )
      .lean();

  // =========================================================
  // GET STAGES
  // =========================================================

  const stageIds = [
    ...new Set(
      selectedLeads
        .map(
          (lead: any) =>
            lead.stageId?.toString(),
        )
        .filter(Boolean),
    ),
  ];

  const stages =
    stageIds.length
      ? await this.leadStageModel
          .find({
            _id: {
              $in: stageIds,
            },
          })
          .select(
            '_id name',
          )
          .lean()
      : [];

  const stageMap =
    new Map<string, string>();

  stages.forEach(
    (stage: any) => {
      stageMap.set(
        stage._id.toString(),
        stage.name ||
          'Unknown',
      );
    },
  );

  // =========================================================
  // LEAD EMAILS / PHONES
  // =========================================================

  const leadEmails = [
    ...new Set(
      selectedLeads
        .map(
          (lead: any) =>
            lead.email,
        )
        .filter(Boolean)
        .map(
          (email: any) =>
            String(email)
              .trim()
              .toLowerCase(),
        ),
    ),
  ];

  const leadPhones = [
    ...new Set(
      selectedLeads
        .map(
          (lead: any) =>
            lead.phone ||
            lead.mobile,
        )
        .filter(Boolean)
        .map(
          (phone: any) =>
            String(phone).trim(),
        ),
    ),
  ];

  // =========================================================
  // GET ORDERS ONLY FOR SELECTED LEADS
  // =========================================================

  let orders: any[] = [];

  if (
    leadEmails.length ||
    leadPhones.length
  ) {
    const orderOrConditions: any[] =
      [];

    if (
      leadEmails.length
    ) {
      orderOrConditions.push({
        $expr: {
          $in: [
            {
              $toLower: {
                $ifNull: [
                  '$email',
                  '',
                ],
              },
            },
            leadEmails,
          ],
        },
      });
    }

    if (
      leadPhones.length
    ) {
      orderOrConditions.push({
        mobile: {
          $in: leadPhones,
        },
      });
    }

    orders =
      await this.orderModel
        .aggregate([
          {
            $match: {
              Approved: true,

              $or:
                orderOrConditions,
            },
          },

          {
            $addFields: {
              revenue: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $eq: [
                          '$paymentMode',
                          PaymentMode.LOAN,
                        ],
                      },

                      then: {
                        $ifNull: [
                          '$loanDetails.disbursementAmount',
                          0,
                        ],
                      },
                    },

                    {
                      case: {
                        $eq: [
                          '$paymentMode',
                          PaymentMode.LUMPSUM,
                        ],
                      },

                      then: {
                        $ifNull: [
                          '$lumpsumDetails.totalReceived',
                          0,
                        ],
                      },
                    },
                  ],

                  default: 0,
                },
              },

              normalizedEmail: {
                $toLower: {
                  $ifNull: [
                    '$email',
                    '',
                  ],
                },
              },
            },
          },

          {
            $project: {
              _id: 1,
              email: 1,
              mobile: 1,
              normalizedEmail: 1,
              revenue: 1,
            },
          },
        ]);
  }

  // =========================================================
  // MAP SELECTED LEAD TO STATE / CAMPAIGN
  // =========================================================

  const leadByEmail =
    new Map<string, any>();

  const leadByPhone =
    new Map<string, any>();

  selectedLeads.forEach(
    (lead: any) => {
      if (lead.email) {
        leadByEmail.set(
          String(lead.email)
            .trim()
            .toLowerCase(),
          lead,
        );
      }

      const phone =
        lead.phone ||
        lead.mobile;

      if (phone) {
        leadByPhone.set(
          String(phone).trim(),
          lead,
        );
      }
    },
  );

  // =========================================================
  // REPORT MAP
  // =========================================================

  const campaignMap =
    new Map<string, any>();

  const ensureState = (
    campaignName: string,
    stateName: string,
  ) => {
    if (
      !campaignMap.has(
        campaignName,
      )
    ) {
      campaignMap.set(
        campaignName,
        {
          campaignName,

          totalLeads: 0,

          totalAdmissionDone: 0,

          totalRegistrationDone: 0,

          totalRevenue: 0,

          statesMap:
            new Map<string, any>(),
        },
      );
    }

    const campaign =
      campaignMap.get(
        campaignName,
      );

    if (
      !campaign.statesMap.has(
        stateName,
      )
    ) {
      campaign.statesMap.set(
        stateName,
        {
          state: stateName,

          totalLeads: 0,

          pcatScheduled: 0,

          pcatDone: 0,

          registrationDone: 0,

          admissionDone: 0,

          revenue: 0,

          stages: {},
        },
      );
    }

    return {
      campaign,

      state:
        campaign.statesMap.get(
          stateName,
        ),
    };
  };

  // =========================================================
  // PROCESS SELECTED LEADS
  // =========================================================

  selectedLeads.forEach(
    (lead: any) => {
      const campaignName =
        lead.source_campaign ||
        'Unknown';

      const stateName =
        lead.state ||
        'Unknown';

      const stageName =
        lead.stageId
          ? stageMap.get(
              lead.stageId.toString(),
            ) || 'Unknown'
          : 'Unknown';

      const item =
        ensureState(
          campaignName,
          stateName,
        );

      item.state.totalLeads +=
        1;

      item.campaign.totalLeads +=
        1;

      item.state.stages[
        stageName
      ] =
        (
          item.state.stages[
            stageName
          ] || 0
        ) + 1;

      const normalizedStage =
        String(stageName)
          .toLowerCase()
          .trim();

      if (
        normalizedStage ===
          'pcat schedule' ||
        normalizedStage ===
          'pcat scheduled'
      ) {
        item.state.pcatScheduled +=
          1;
      } else if (
        normalizedStage ===
        'pcat done'
      ) {
        item.state.pcatDone +=
          1;
      } else if (
        normalizedStage ===
        'registration done'
      ) {
        item.state.registrationDone +=
          1;
      } else if (
        normalizedStage ===
        'admission done'
      ) {
        item.state.admissionDone +=
          1;
      }
    },
  );

  // =========================================================
  // PROCESS REVENUE
  // =========================================================

  orders.forEach(
    (order: any) => {
      let lead: any = null;

      if (
        order.normalizedEmail
      ) {
        lead =
          leadByEmail.get(
            order.normalizedEmail,
          );
      }

      if (
        !lead &&
        order.mobile
      ) {
        lead =
          leadByPhone.get(
            String(
              order.mobile,
            ).trim(),
          );
      }

      if (!lead) {
        return;
      }

      const campaignName =
        lead.source_campaign ||
        'Unknown';

      const stateName =
        lead.state ||
        'Unknown';

      const item =
        ensureState(
          campaignName,
          stateName,
        );

      item.state.revenue +=
        Number(
          order.revenue,
        ) || 0;
    },
  );

  // =========================================================
  // BUILD COMPLETE CAMPAIGN REPORT
  // =========================================================

  const completeReport =
    Array.from(
      campaignMap.values(),
    ).map(
      (campaign: any) => {
        const states =
          Array.from(
            campaign.statesMap.values(),
          ).map(
            (state: any) => ({
              ...state,

              conversionPercentage:
                state.totalLeads >
                0
                  ? Number(
                      (
                        (
                          state.admissionDone /
                          state.totalLeads
                        ) *
                        100
                      ).toFixed(2),
                    )
                  : 0,

              registrationPercentage:
                state.totalLeads >
                0
                  ? Number(
                      (
                        (
                          state.registrationDone /
                          state.totalLeads
                        ) *
                        100
                      ).toFixed(2),
                    )
                  : 0,
            }),
          );

        campaign.totalAdmissionDone =
          states.reduce(
            (
              sum,
              state,
            ) =>
              sum +
              state.admissionDone,
            0,
          );

        campaign.totalRegistrationDone =
          states.reduce(
            (
              sum,
              state,
            ) =>
              sum +
              state.registrationDone,
            0,
          );

        campaign.totalRevenue =
          states.reduce(
            (
              sum,
              state,
            ) =>
              sum +
              state.revenue,
            0,
          );

        campaign.states =
          states.sort(
            (a, b) =>
              b.totalLeads -
              a.totalLeads,
          );

        delete campaign.statesMap;

        return campaign;
      },
    );

  // =========================================================
  // SORT CAMPAIGNS
  // =========================================================

  completeReport.sort(
    (a, b) =>
      b.totalLeads -
      a.totalLeads,
  );

  // =========================================================
  // CAMPAIGN PAGINATION
  //
  // IMPORTANT:
  // We paginate campaigns ONLY.
  //
  // States inside each campaign remain complete.
  // =========================================================

  const totalCampaigns =
    completeReport.length;

  const totalPages =
    Math.ceil(
      totalCampaigns /
        limit,
    );

  const paginatedReport =
    completeReport.slice(
      skip,
      skip + limit,
    );

  // =========================================================
  // DEBUG
  // =========================================================

  console.log(
    'stateWiseReport pagination',
    {
      page,

      limit,

      skip,

      totalCampaigns,

      totalPages,

      returnedCampaigns:
        paginatedReport.length,

      campaignNames:
        paginatedReport.map(
          (item) =>
            item.campaignName,
        ),
    },
  );
// =========================================================
  // SORT CAMPAIGNS
  // =========================================================

  completeReport.sort(
    (a, b) =>
      b.totalLeads -
      a.totalLeads,
  );

  // =========================================================
  // GLOBAL STATS
  //
  // IMPORTANT:
  // Calculate these BEFORE pagination.
  // Otherwise stats would only represent the current page.
  // =========================================================

  const totalLeads =
    completeReport.reduce(
      (sum, campaign) =>
        sum +
        Number(
          campaign.totalLeads || 0,
        ),
      0,
    );

  const totalAdmissionDone =
    completeReport.reduce(
      (sum, campaign) =>
        sum +
        Number(
          campaign.totalAdmissionDone ||
            0,
        ),
      0,
    );

  const totalRegistrationDone =
    completeReport.reduce(
      (sum, campaign) =>
        sum +
        Number(
          campaign.totalRegistrationDone ||
            0,
        ),
      0,
    );

  const totalRevenue =
    completeReport.reduce(
      (sum, campaign) =>
        sum +
        Number(
          campaign.totalRevenue || 0,
        ),
      0,
    );

  // =========================================================
  // CAMPAIGN PAGINATION
  //
  // IMPORTANT:
  // Pagination applies ONLY to campaigns.
  // Global stats above are NOT paginated.
  // =========================================================

  // =========================================================
  // FINAL RESPONSE
  // =========================================================

   return {
    startDate,

    endDate,

    // =======================================================
    // GLOBAL STATS
    // These represent ALL campaigns, not current page.
    // =======================================================

    totalLeads,

    totalAdmissionDone,

    totalRegistrationDone,

    totalRevenue,

    // =======================================================
    // PAGINATION
    // =======================================================

    page,

    limit,

    totalCampaigns,

    totalPages,

    hasNextPage:
      page < totalPages,

    hasPreviousPage:
      page > 1,

    data:
      paginatedReport,
  };
}


async stateWiseEmployeeReport(query: any, user: any) {
  const now = new Date();

  // =========================================================
  // HELPERS
  // =========================================================

  const toIdString = (value: any): string => {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return '';
    }

    if (
      typeof value === 'object' &&
      value._id !== undefined &&
      value._id !== null
    ) {
      return String(value._id);
    }

    try {
      return String(value);
    } catch {
      return '';
    }
  };

  const validIds = (values: any[]): string[] => {
    return [
      ...new Set(
        (values || [])
          .map((value: any): string => toIdString(value))
          .filter(
            (id: string): id is string =>
              Boolean(id) &&
              Types.ObjectId.isValid(id),
          ),
      ),
    ];
  };

  const normalizeEmail = (
    value: any,
  ): string => {
    return value
      ? String(value)
          .trim()
          .toLowerCase()
      : '';
  };

  const normalizePhone = (
    value: any,
  ): string => {
    if (!value) return '';

    return String(value)
      .trim()
      .replace(/\D/g, '');
  };

  const getPhoneVariants = (
    value: any,
  ): string[] => {
    const normalized =
      normalizePhone(value);

    if (!normalized) {
      return [];
    }

    const variants = new Set<string>();

    variants.add(normalized);

    // Last 10 digits helps when one side contains
    // +91 / country code and the other does not.
    if (normalized.length >= 10) {
      variants.add(
        normalized.slice(-10),
      );
    }

    return [
      ...variants,
    ];
  };

  const round2 = (
    value: number,
  ): number => {
    return Number(
      (Number(value) || 0).toFixed(2),
    );
  };

  // =========================================================
  // DATE RANGE
  // =========================================================

  const getFilterRange = (
    filter: any,
  ) => {
    const value = String(
      filter || '',
    ).toLowerCase();

    let startDate: Date;
    let endDate: Date;

    if (value === 'today') {
      startDate = new Date(now);
      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'week') {
      startDate = new Date(now);
      startDate.setDate(
        startDate.getDate() - 6,
      );
      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'month') {
      // Current calendar month: 1st -> today
      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else if (value === 'year') {
      // Current calendar year: Jan 1 -> today
      startDate = new Date(
        now.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    } else {
      throw new BadRequestException(
        `Invalid date filter: ${filter}`,
      );
    }

    return {
      $gte: startDate,
      $lte: endDate,
    };
  };

  const getCustomRange = (
    fromValue: any,
    toValue: any,
  ) => {
    if (
      !fromValue ||
      !toValue
    ) {
      throw new BadRequestException(
        'fromDate and toDate are both required',
      );
    }

    const startDate =
      new Date(fromValue);

    const endDate =
      new Date(toValue);

    if (
      Number.isNaN(
        startDate.getTime(),
      ) ||
      Number.isNaN(
        endDate.getTime(),
      )
    ) {
      throw new BadRequestException(
        'Invalid custom date range',
      );
    }

    startDate.setHours(
      0,
      0,
      0,
      0,
    );

    endDate.setHours(
      23,
      59,
      59,
      999,
    );

    if (
      startDate > endDate
    ) {
      throw new BadRequestException(
        'fromDate cannot be greater than toDate',
      );
    }

    const diffDays =
      Math.floor(
        (
          endDate.getTime() -
          startDate.getTime()
        ) /
          (1000 *
            60 *
            60 *
            24),
      ) + 1;

    if (diffDays > 31) {
      throw new BadRequestException(
        'Date range cannot be more than 31 days',
      );
    }

    return {
      $gte: startDate,
      $lte: endDate,
    };
  };

  let dateRange: any;

  if (
    query.fromDate ||
    query.toDate
  ) {
    dateRange =
      getCustomRange(
        query.fromDate,
        query.toDate,
      );
  } else {
    dateRange =
      getFilterRange(
        query.dateFilter ||
          'today',
      );
  }

  const startDate =
    dateRange.$gte;

  const endDate =
    dateRange.$lte;

  // =========================================================
  // PAGINATION
  // =========================================================

  const page = Math.max(
    1,
    Number(query.page) || 1,
  );

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number(query.limit) || 10,
    ),
  );

  const skip =
    (page - 1) * limit;

  // =========================================================
  // LEVEL FILTER
  // =========================================================

  const levelNumber =
    query.level !==
      undefined &&
    query.level !== null &&
    query.level !== ''
      ? this.resolveLevel(
          query.level,
        )
      : null;

  if (
    query.level !==
      undefined &&
    levelNumber === null
  ) {
    return {
      startDate,
      endDate,
      dateFilter:
        query.dateFilter ||
        'today',
      level: null,
      team: false,
      page,
      limit,
      totalEmployees: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      totalLeads: 0,
      totalRegistrationDone: 0,
      totalAdmissionDone: 0,
      totalRevenue: 0,
      registrationPercentage: 0,
      conversionPercentage: 0,
      data: [],
    };
  }

  // =========================================================
  // TEAM FILTER
  // =========================================================

  const isTeam =
    query.team === true ||
    query.team === 'true';

  // =========================================================
  // ROOT ACTIVE EMPLOYEES
  //
  // IMPORTANT:
  // We start from ACTIVE employees.
  //
  // If level is supplied:
  // only active employees belonging to that level.
  //
  // If employeeId/counsellorId is supplied:
  // only that employee becomes the root.
  // =========================================================

  const requestedEmployeeId =
    query.counsellorId ||
    query.assignedTo ||
    query.employeeId;

  // =========================================================
  // ACCESS CONTROL
  //
  // ADMIN:
  //   Can view all active employees.
  //
  // BD:
  //   Can view only himself and his complete hierarchy.
  // =========================================================

  const loggedInRole =
    typeof user?.role === 'object'
      ? String(
          user?.role?.name ||
            '',
        )
          .trim()
          .toLowerCase()
      : String(
          user?.role ||
            user?.roleName ||
            '',
        )
          .trim()
          .toLowerCase();

  const isAdmin =
    loggedInRole === 'admin';

  const isBd =
    loggedInRole === 'bd';

  const loggedInUserId =
    toIdString(
      user?._id ||
        user?.userId ||
        user?.id,
    );

  const userMatch: any = {
    status: 'active',
  };

  if (
    levelNumber !== null
  ) {
    const levelUserIds =
      await this.getUserIdsByRoleLevel(
        levelNumber,
      );

    if (
      !levelUserIds?.length
    ) {
      return {
        startDate,
        endDate,
        dateFilter:
          query.dateFilter ||
          'today',
        level: levelNumber,
        team: isTeam,
        page,
        limit,
        totalEmployees: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
        totalLeads: 0,
        totalRegistrationDone: 0,
        totalAdmissionDone: 0,
        totalRevenue: 0,
        registrationPercentage: 0,
        conversionPercentage: 0,
        data: [],
      };
    }

    userMatch._id = {
      $in: levelUserIds,
    };
  }

  if (
    requestedEmployeeId &&
    Types.ObjectId.isValid(
      String(
        requestedEmployeeId,
      ),
    )
  ) {
    userMatch._id =
      new Types.ObjectId(
        String(
          requestedEmployeeId,
        ),
      );
  }

  // ---------------------------------------------------------
  // BD ACCESS
  // ---------------------------------------------------------

  if (
    isBd &&
    !isAdmin
  ) {
    if (
      !loggedInUserId ||
      !Types.ObjectId.isValid(
        loggedInUserId,
      )
    ) {
      throw new BadRequestException(
        'Logged-in BD employee ID is invalid',
      );
    }

    const bdHierarchy =
      await this.getUserAndSubordinateIds(
        loggedInUserId,
      );

    const bdAllowedIds =
      new Set<string>(
        validIds([
          loggedInUserId,
          ...(bdHierarchy || []),
        ]),
      );

    // If a specific employee is requested,
    // it must belong to the BD hierarchy.
    if (
      requestedEmployeeId
    ) {
      const requestedId =
        toIdString(
          requestedEmployeeId,
        );

      if (
        !requestedId ||
        !bdAllowedIds.has(
          requestedId,
        )
      ) {
        throw new BadRequestException(
          'You are not allowed to view this employee data',
        );
      }

      userMatch._id =
        requestedId;
    } else {
      // No employee selected:
      // BD gets ONLY his own hierarchy.
      userMatch._id = {
        $in:
          Array.from(
            bdAllowedIds,
          ),
      };
    }
  }

  const rootUsers =
    await this.userModel
      .find(userMatch)
      .select(
        '_id name email employeeId role status',
      )
      .lean();

  if (!rootUsers.length) {
    return {
      startDate,
      endDate,
      dateFilter:
        query.dateFilter ||
        'today',
      level: levelNumber,
      team: isTeam,
      page,
      limit,
      totalEmployees: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      totalLeads: 0,
      totalRegistrationDone: 0,
      totalAdmissionDone: 0,
      totalRevenue: 0,
      registrationPercentage: 0,
      conversionPercentage: 0,
      data: [],
    };
  }

  // =========================================================
  // BUILD COMPLETE ACTIVE TEAM FOR EACH ROOT
  //
  // team=false:
  //   root itself only
  //
  // team=true:
  //   root + all active descendants
  //
  // teamSize:
  //   descendants only
  //   NEVER includes root employee
  // =========================================================

  const teamMap =
    new Map<
      string,
      string[]
    >();

  const teamSizeMap =
    new Map<
      string,
      number
    >();

  const employeeLookup =
    new Map<
      string,
      any
    >();

  rootUsers.forEach(
    (employee: any) => {
      employeeLookup.set(
        employee._id.toString(),
        employee,
      );
    },
  );

  for (const rootUser of rootUsers) {
    const rootId =
      rootUser._id.toString();

    let memberIds: string[] = [
      rootId,
    ];

    if (isTeam) {
      const subordinateIds =
        await this.getUserAndSubordinateIds(
          rootId,
        );

      const uniqueIds: string[] =
        validIds([
          rootId,
          ...(subordinateIds || []),
        ]);

      // Only ACTIVE employees are allowed
      const activeMembers =
        await this.userModel
          .find({
            _id: {
              $in: uniqueIds,
            },
            status: 'active',
          })
          .select('_id')
          .lean();

      const activeIds =
        activeMembers.map(
          (item: any) =>
            item._id.toString(),
        );

      // Root itself should always be present
      if (
        !activeIds.includes(
          rootId,
        )
      ) {
        activeIds.push(
          rootId,
        );
      }

      memberIds = [
        ...new Set(
          activeIds,
        ),
      ];
    }

    teamMap.set(
      rootId,
      memberIds,
    );

    // IMPORTANT:
    // teamSize = descendants only
    teamSizeMap.set(
      rootId,
      Math.max(
        0,
        memberIds.length - 1,
      ),
    );
  }

  // =========================================================
  // ALL EMPLOYEES WHO CAN OWN LEADS
  // =========================================================

  const allAllowedUserIds = [
    ...new Set(
      Array.from(
        teamMap.values(),
      )
        .flat()
        .map((id) =>
          String(id),
        ),
    ),
  ];

  // =========================================================
  // SELECT LEADS
  //
  // VERY IMPORTANT:
  //
  // Lead selection is ALWAYS based on:
  //   assignedTo + assignedDate
  //
  // team=false:
  //   root employee's assigned leads
  //
  // team=true:
  //   root + complete active subtree's assigned leads
  //
  // We do NOT filter leads by createdAt.
  // =========================================================

  const leadMatch: any = {
    normalizedAssignedTo: {
      $in: allAllowedUserIds,
    },

    assignedDate: {
      $gte: startDate,
      $lte: endDate,
    },
  };

  if (query.state) {
    leadMatch.state = {
      $regex: String(
        query.state,
      ),
      $options: 'i',
    };
  }

  if (query.source) {
    leadMatch.source =
      query.source;
  }

  if (query.source_campaign) {
    leadMatch.source_campaign =
      query.source_campaign;
  }

  if (query.status) {
    leadMatch.status =
      query.status;
  }

  if (
    query.stageId &&
    Types.ObjectId.isValid(
      String(
        query.stageId,
      ),
    )
  ) {
    leadMatch.stageId =
      new Types.ObjectId(
        String(
          query.stageId,
        ),
      );
  }

  const selectedLeads =
    await this.leadModel.aggregate([
      {
        $addFields: {
          normalizedAssignedTo: {
            $convert: {
              input:
                '$assignedTo',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      },

      {
        $match: leadMatch,
      },

      {
        $project: {
          _id: 1,
          leadId: 1,
          name: 1,
          phone: 1,
          mobile: 1,
          email: 1,
          state: 1,
          source: 1,
          source_campaign: 1,
          status: 1,
          stageId: 1,
          assignedTo: 1,
          assignedDate: 1,
          createdAt: 1,
        },
      },
    ]);

  // =========================================================
  // DEBUGGING INFORMATION
  // =========================================================

  console.log(
    '[stateWiseEmployeeReport] Root employees:',
    rootUsers.length,
  );

  console.log(
    '[stateWiseEmployeeReport] Root employee IDs:',
    rootUsers.map(
      (item: any) =>
        item._id.toString(),
    ),
  );

  console.log(
    '[stateWiseEmployeeReport] Team:',
    isTeam,
  );

  console.log(
    '[stateWiseEmployeeReport] Allowed employees:',
    allAllowedUserIds.length,
  );

  console.log(
    '[stateWiseEmployeeReport] Selected leads:',
    selectedLeads.length,
  );

  // =========================================================
  // ACTIVE EMPLOYEE INFORMATION
  //
  // Fetch ALL employees that can own the selected leads.
  // This is important because team members may not be rootUsers.
  // =========================================================

  const activeEmployeeIds: string[] =
    validIds([
      ...allAllowedUserIds,
      ...selectedLeads.map(
        (lead: any) =>
          toIdString(lead?.assignedTo),
      ),
    ]);

  const activeEmployees =
    activeEmployeeIds.length
      ? await this.userModel
          .find({
            _id: {
              $in: activeEmployeeIds,
            },
            status: 'active',
          })
          .select(
            '_id name email employeeId role status',
          )
          .lean()
      : [];

  const employeeInfoMap =
    new Map<string, any>();

  activeEmployees.forEach(
    (employee: any) => {
      employeeInfoMap.set(
        employee._id.toString(),
        employee,
      );
    },
  );

  // =========================================================
  // STAGES
  // =========================================================

  const stageIds =
    [
      ...new Set(
        selectedLeads
          .map(
            (lead: any) => {
              if (
                !lead.stageId
              ) {
                return null;
              }

              const id =
                toIdString(
                  lead.stageId,
                );

              if (
                !id ||
                !Types.ObjectId.isValid(
                  id,
                )
              ) {
                return null;
              }

              return id;
            },
          )
          .filter(Boolean),
      ),
    ] as string[];

  const stages =
    stageIds.length
      ? await this.leadStageModel
          .find({
            _id: {
              $in: stageIds,
            },
          })
          .select(
            '_id name',
          )
          .lean()
      : [];

  const stageMap =
    new Map<
      string,
      string
    >();

  stages.forEach(
    (stage: any) => {
      stageMap.set(
        stage._id.toString(),
        stage.name ||
          'Unknown',
      );
    },
  );

  // =========================================================
  // PREPARE LEAD CONTACT MAPS
  //
  // We use:
  //   lead.email
  //   lead.phone
  //   lead.mobile
  //
  // Orders can match using email OR number.
  // =========================================================

  const leadByEmail =
    new Map<
      string,
      any[]
    >();

  const leadByPhone =
    new Map<
      string,
      any[]
    >();

  selectedLeads.forEach(
    (lead: any) => {
      const email =
        normalizeEmail(
          lead.email,
        );

      if (email) {
        const existing =
          leadByEmail.get(
            email,
          ) || [];

        existing.push(
          lead,
        );

        leadByEmail.set(
          email,
          existing,
        );
      }

      const phoneValues = [
        lead.phone,
        lead.mobile,
      ];

      for (const phone of phoneValues) {
        const variants =
          getPhoneVariants(
            phone,
          );

        for (const variant of variants) {
          const existing =
            leadByPhone.get(
              variant,
            ) || [];

          // Avoid adding same lead twice
          if (
            !existing.some(
              (item) =>
                item._id.toString() ===
                lead._id.toString(),
            )
          ) {
            existing.push(
              lead,
            );
          }

          leadByPhone.set(
            variant,
            existing,
          );
        }
      }
    },
  );

  // =========================================================
  // GET ORDERS OF SELECTED LEADS
  //
  // IMPORTANT:
  //
  // We do NOT apply order date here.
  //
  // Requirement:
  // 1. Get leads assigned to employees in date range.
  // 2. Find orders belonging to those leads.
  //
  // Matching:
  //   lead email OR lead phone/mobile
  //
  // Revenue:
  //   LOAN    -> loanDetails.disbursementAmount
  //   LUMPSUM -> lumpsumDetails.totalReceived
  // =========================================================

  let orderResults: any[] = [];

  const leadEmails =
    [
      ...new Set(
        selectedLeads
          .map(
            (lead: any) =>
              normalizeEmail(
                lead.email,
              ),
          )
          .filter(Boolean),
      ),
    ];

  const leadPhones =
    [
      ...new Set(
        selectedLeads
          .flatMap(
            (lead: any) => [
              ...getPhoneVariants(
                lead.phone,
              ),
              ...getPhoneVariants(
                lead.mobile,
              ),
            ],
          )
          .filter(Boolean),
      ),
    ];

  if (
    leadEmails.length ||
    leadPhones.length
  ) {
    orderResults =
      await this.orderModel.aggregate([
        {
          $addFields: {
            normalizedEmail: {
              $toLower: {
                $trim: {
                  input: {
                    $ifNull: [
                      '$email',
                      '',
                    ],
                  },
                },
              },
            },

            normalizedMobile: {
              $convert: {
                input:
                  '$mobile',
                to: 'string',
                onError: '',
                onNull: '',
              },
            },

            normalizedPhone: {
              $convert: {
                input:
                  '$phone',
                to: 'string',
                onError: '',
                onNull: '',
              },
            },

            calculatedRevenue: {
              $switch: {
                branches: [
                  {
                    case: {
                      $eq: [
                        '$paymentMode',
                        PaymentMode.LOAN,
                      ],
                    },
                    then: {
                      $convert: {
                        input:
                          '$loanDetails.disbursementAmount',
                        to: 'double',
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },

                  {
                    case: {
                      $eq: [
                        '$paymentMode',
                        PaymentMode.LUMPSUM,
                      ],
                    },
                    then: {
                      $convert: {
                        input:
                          '$lumpsumDetails.totalReceived',
                        to: 'double',
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },
                ],
                default: 0,
              },
            },
          },
        },

        {
          $match: {
            Approved: true,

            $or: [
              ...(leadEmails.length
                ? [
                    {
                      normalizedEmail: {
                        $in:
                          leadEmails,
                      },
                    },
                  ]
                : []),

              ...(leadPhones.length
                ? [
                    {
                      normalizedMobile: {
                        $in:
                          leadPhones,
                      },
                    },

                    {
                      normalizedPhone: {
                        $in:
                          leadPhones,
                      },
                    },
                  ]
                : []),
            ],
          },
        },

        {
          $project: {
            _id: 1,
            email: 1,
            mobile: 1,
            phone: 1,
            counsellorId: 1,
            paymentMode: 1,
            calculatedRevenue: 1,
          },
        },
      ]);
  }

  console.log(
    '[stateWiseEmployeeReport] Selected lead emails:',
    leadEmails.length,
  );

  console.log(
    '[stateWiseEmployeeReport] Selected lead phones:',
    leadPhones.length,
  );

  console.log(
    '[stateWiseEmployeeReport] Matching approved orders:',
    orderResults.length,
  );

  // =========================================================
  // MAP ORDER -> LEAD
  //
  // IMPORTANT:
  // Revenue is assigned to the ACTUAL matching lead.
  //
  // This fixes the old bug where revenue was only assigned
  // when employeeLeads.length === 1.
  // =========================================================

  const revenueByLeadId =
    new Map<
      string,
      number
    >();

  const matchedOrderIds =
    new Set<string>();

  orderResults.forEach(
    (order: any) => {
      const email =
        normalizeEmail(
          order.email,
        );

      const phoneValues = [
        order.mobile,
        order.phone,
      ];

      let matchedLeads: any[] =
        [];

      // Prefer email match
      if (email) {
        matchedLeads =
          leadByEmail.get(
            email,
          ) || [];
      }

      // If email did not match,
      // try phone/mobile.
      if (
        !matchedLeads.length
      ) {
        for (const phone of phoneValues) {
          const variants =
            getPhoneVariants(
              phone,
            );

          for (const variant of variants) {
            const matches =
              leadByPhone.get(
                variant,
              ) || [];

            if (
              matches.length
            ) {
              matchedLeads =
                matches;
              break;
            }
          }

          if (
            matchedLeads.length
          ) {
            break;
          }
        }
      }

      if (
        !matchedLeads.length
      ) {
        return;
      }

      const revenue =
        Number(
          order.calculatedRevenue,
        ) || 0;

      // Normally one contact belongs to one lead.
      // If duplicate leads have the same contact,
      // assign the order only once to avoid revenue
      // being duplicated.
      const matchedLead =
        matchedLeads[0];

      const leadId =
        matchedLead._id.toString();

      revenueByLeadId.set(
        leadId,
        (
          revenueByLeadId.get(
            leadId,
          ) || 0
        ) + revenue,
      );

      if (order._id) {
        matchedOrderIds.add(
          order._id.toString(),
        );
      }
    },
  );

  console.log(
    '[stateWiseEmployeeReport] Orders mapped to leads:',
    matchedOrderIds.size,
  );

  // =========================================================
  // EMPLOYEE STATS
  // =========================================================

  const employeeStats =
    new Map<
      string,
      any
    >();

  const createStateStats =
    (
      stateName: string,
    ) => ({
      state:
        stateName ||
        'Unknown',

      totalLeads: 0,

      pcatScheduled: 0,

      pcatDone: 0,

      registrationDone: 0,

      admissionDone: 0,

      revenue: 0,

      stages: {},
    });

  const ensureEmployee =
    (
      employeeId: string,
    ) => {
      if (
        !employeeStats.has(
          employeeId,
        )
      ) {
        employeeStats.set(
          employeeId,
          {
            totalLeads: 0,

            pcatScheduled: 0,

            pcatDone: 0,

            registrationDone: 0,

            admissionDone: 0,

            totalRevenue: 0,

            statesMap:
              new Map<
                string,
                any
              >(),
          },
        );
      }

      return employeeStats.get(
        employeeId,
      );
    };

  // =========================================================
  // PROCESS EVERY SELECTED LEAD
  // =========================================================

  selectedLeads.forEach(
    (lead: any) => {
      const employeeId =
        toIdString(
          lead.assignedTo,
        );

      if (!employeeId) {
        return;
      }

      // Only active employees
      const employee =
        employeeInfoMap.get(
          employeeId,
        );

      if (!employee) {
        return;
      }

      const stats =
        ensureEmployee(
          employeeId,
        );

      const state =
        lead.state ||
        'Unknown';

      if (
        !stats.statesMap.has(
          state,
        )
      ) {
        stats.statesMap.set(
          state,
          createStateStats(
            state,
          ),
        );
      }

      const stateStats =
        stats.statesMap.get(
          state,
        );

      // -------------------------------------------------------
      // LEAD COUNT
      // -------------------------------------------------------

      stats.totalLeads += 1;

      stateStats.totalLeads += 1;

      // -------------------------------------------------------
      // STAGE
      // -------------------------------------------------------

      const stageName =
        lead.stageId
          ? stageMap.get(
              toIdString(
                lead.stageId,
              ) || '',
            ) ||
            'Unknown'
          : 'Unknown';

      stateStats.stages[
        stageName
      ] =
        (
          stateStats.stages[
            stageName
          ] || 0
        ) + 1;

      const normalizedStage =
        String(
          stageName,
        )
          .toLowerCase()
          .trim()
          .replace(
            /\s+/g,
            ' ',
          );

      // -------------------------------------------------------
      // PCAT SCHEDULED
      // -------------------------------------------------------

      if (
        normalizedStage ===
          'pcat schedule' ||
        normalizedStage ===
          'pcat scheduled'
      ) {
        stats.pcatScheduled += 1;

        stateStats.pcatScheduled +=
          1;
      }

      // -------------------------------------------------------
      // PCAT DONE
      // -------------------------------------------------------

      if (
        normalizedStage ===
          'pcat done'
      ) {
        stats.pcatDone += 1;

        stateStats.pcatDone += 1;
      }

      // -------------------------------------------------------
      // REGISTRATION DONE
      // -------------------------------------------------------

      if (
        normalizedStage ===
          'registration done'
      ) {
        stats.registrationDone +=
          1;

        stateStats.registrationDone +=
          1;
      }

      // -------------------------------------------------------
      // ADMISSION DONE
      // -------------------------------------------------------

      if (
        normalizedStage ===
          'admission done'
      ) {
        stats.admissionDone +=
          1;

        stateStats.admissionDone +=
          1;
      }

      // -------------------------------------------------------
      // REVENUE FOR THIS EXACT LEAD
      // -------------------------------------------------------

      const leadId =
        lead._id.toString();

      const leadRevenue =
        Number(
          revenueByLeadId.get(
            leadId,
          ) || 0,
        );

      if (
        leadRevenue > 0
      ) {
        stats.totalRevenue +=
          leadRevenue;

        stateStats.revenue +=
          leadRevenue;
      }
    },
  );

  // =========================================================
  // MAKE SURE EVERY ACTIVE EMPLOYEE EXISTS
  //
  // This is important:
  //
  // An active employee with 0 leads must still appear.
  // =========================================================

  activeEmployees.forEach(
    (employee: any) => {
      const employeeId =
        employee._id.toString();

      ensureEmployee(
        employeeId,
      );
    },
  );

  // =========================================================
  // BUILD INDIVIDUAL EMPLOYEE REPORT
  // =========================================================

  const individualEmployeeMap =
    new Map<
      string,
      any
    >();

  employeeStats.forEach(
    (
      stats: any,
      employeeId: string,
    ) => {
      const employee =
        employeeInfoMap.get(
          employeeId,
        );

      if (!employee) {
        return;
      }

      const states =
        Array.from(
          stats.statesMap.values(),
        )
          .map(
            (state: any) => {
              const conversionPercentage =
                state.totalLeads >
                0
                  ? round2(
                      (
                        state.admissionDone /
                        state.totalLeads
                      ) * 100,
                    )
                  : 0;

              const registrationConversionPercentage =
                state.totalLeads >
                0
                  ? round2(
                      (
                        state.registrationDone /
                        state.totalLeads
                      ) * 100,
                    )
                  : 0;

              return {
                ...state,

                revenue:
                  Number(
                    state.revenue,
                  ) || 0,

                conversionPercentage,

                registrationConversionPercentage,
              };
            },
          )
          .sort(
            (
              a: any,
              b: any,
            ) =>
              b.totalLeads -
              a.totalLeads,
          );

      const totalRegistrationDone =
        Number(
          stats.registrationDone ||
            0,
        );

      const totalAdmissionDone =
        Number(
          stats.admissionDone ||
            0,
        );

      const totalLeads =
        Number(
          stats.totalLeads ||
            0,
        );

      const totalRevenue =
        states.reduce(
          (
            sum: number,
            state: any,
          ) =>
            sum +
            (
              Number(
                state.revenue,
              ) || 0
            ),
          0,
        );

      individualEmployeeMap.set(
        employeeId,
        {
          employeeId,

          employeeName:
            employee.name ||
            'Unknown',

          employeeEmail:
            employee.email ||
            '',

          employeeCode:
            employee.employeeId ||
            '',

          totalLeads,

          totalAdmissionDone,

          totalRegistrationDone,

          totalRevenue:
            round2(
              totalRevenue,
            ),

          conversionPercentage:
            totalLeads > 0
              ? round2(
                  (
                    totalAdmissionDone /
                    totalLeads
                  ) * 100,
                )
              : 0,

          registrationConversionPercentage:
            totalLeads > 0
              ? round2(
                  (
                    totalRegistrationDone /
                    totalLeads
                  ) * 100,
                )
              : 0,

          states,
        },
      );
    },
  );

  // =========================================================
  // BUILD FINAL REPORT
  //
  // TEAM = FALSE
  //   Each root employee's own leads
  //
  // TEAM = TRUE
  //   Each root employee gets:
  //   root + complete active subtree
  // =========================================================

  let report: any[] = [];

  if (!isTeam) {
    report =
      rootUsers.map(
        (rootUser: any) => {
          const rootId =
            rootUser._id.toString();

          const employee =
            individualEmployeeMap.get(
              rootId,
            );

          const stats =
            employee ||
            {
              employeeId:
                rootId,

              employeeName:
                rootUser.name ||
                'Unknown',

              employeeEmail:
                rootUser.email ||
                '',

              employeeCode:
                rootUser.employeeId ||
                '',

              totalLeads: 0,

              totalAdmissionDone: 0,

              totalRegistrationDone: 0,

              totalRevenue: 0,

              conversionPercentage: 0,

              registrationConversionPercentage: 0,

              states: [],
            };

          return {
            ...stats,

            employeeId:
              rootId,

            team: false,

            teamSize:
              teamSizeMap.get(
                rootId,
              ) || 0,
          };
        },
      );
  } else {
    report =
      rootUsers.map(
        (rootUser: any) => {
          const rootId =
            rootUser._id.toString();

          const memberIds =
            teamMap.get(
              rootId,
            ) || [rootId];

          // ---------------------------------------------------
          // COMBINED TEAM STATS
          // ---------------------------------------------------

          let totalLeads = 0;

          let totalAdmissionDone = 0;

          let totalRegistrationDone = 0;

          let totalRevenue = 0;

          const combinedStates =
            new Map<
              string,
              any
            >();

          memberIds.forEach(
            (
              memberId: string,
            ) => {
              const member =
                individualEmployeeMap.get(
                  memberId,
                );

              if (!member) {
                return;
              }

              totalLeads +=
                Number(
                  member.totalLeads ||
                    0,
                );

              totalAdmissionDone +=
                Number(
                  member.totalAdmissionDone ||
                    0,
                );

              totalRegistrationDone +=
                Number(
                  member.totalRegistrationDone ||
                    0,
                );

              totalRevenue +=
                Number(
                  member.totalRevenue ||
                    0,
                );

              (
                member.states ||
                []
              ).forEach(
                (
                  state: any,
                ) => {
                  const stateName =
                    state.state ||
                    'Unknown';

                  if (
                    !combinedStates.has(
                      stateName,
                    )
                  ) {
                    combinedStates.set(
                      stateName,
                      createStateStats(
                        stateName,
                      ),
                    );
                  }

                  const target =
                    combinedStates.get(
                      stateName,
                    );

                  target.totalLeads +=
                    Number(
                      state.totalLeads ||
                        0,
                    );

                  target.pcatScheduled +=
                    Number(
                      state.pcatScheduled ||
                        0,
                    );

                  target.pcatDone +=
                    Number(
                      state.pcatDone ||
                        0,
                    );

                  target.registrationDone +=
                    Number(
                      state.registrationDone ||
                        0,
                    );

                  target.admissionDone +=
                    Number(
                      state.admissionDone ||
                        0,
                    );

                  target.revenue +=
                    Number(
                      state.revenue ||
                        0,
                    );

                  Object.entries(
                    state.stages ||
                      {},
                  ).forEach(
                    ([
                      stageName,
                      count,
                    ]) => {
                      target.stages[
                        stageName
                      ] =
                        (
                          target.stages[
                            stageName
                          ] || 0
                        ) +
                        Number(
                          count,
                        );
                    },
                  );
                },
              );
            },
          );

          // ---------------------------------------------------
          // FINAL TEAM STATES
          // ---------------------------------------------------

          const states =
            Array.from(
              combinedStates.values(),
            )
              .map(
                (state: any) => ({
                  ...state,

                  revenue:
                    round2(
                      Number(
                        state.revenue ||
                          0,
                      ),
                    ),

                  conversionPercentage:
                    state.totalLeads >
                    0
                      ? round2(
                          (
                            state.admissionDone /
                            state.totalLeads
                          ) * 100,
                        )
                      : 0,

                  registrationConversionPercentage:
                    state.totalLeads >
                    0
                      ? round2(
                          (
                            state.registrationDone /
                            state.totalLeads
                          ) * 100,
                        )
                      : 0,
                }),
              )
              .sort(
                (
                  a: any,
                  b: any,
                ) =>
                  b.totalLeads -
                  a.totalLeads,
              );

          return {
            employeeId:
              rootId,

            employeeName:
              rootUser.name ||
              'Unknown',

            employeeEmail:
              rootUser.email ||
              '',

            employeeCode:
              rootUser.employeeId ||
              '',

            totalLeads,

            totalAdmissionDone,

            totalRegistrationDone,

            totalRevenue:
              round2(
                totalRevenue,
              ),

            conversionPercentage:
              totalLeads > 0
                ? round2(
                    (
                      totalAdmissionDone /
                      totalLeads
                    ) * 100,
                  )
                : 0,

            registrationConversionPercentage:
              totalLeads > 0
                ? round2(
                    (
                      totalRegistrationDone /
                      totalLeads
                    ) * 100,
                  )
                : 0,

            states,

            team: true,

            // Descendants only.
            // Root employee is NOT counted.
            teamSize:
              teamSizeMap.get(
                rootId,
              ) || 0,
          };
        },
      );
  }

  // =========================================================
  // SORT
  // =========================================================

  report.sort(
    (
      a: any,
      b: any,
    ) => {
      // First by leads
      const leadDifference =
        Number(
          b.totalLeads || 0,
        ) -
        Number(
          a.totalLeads || 0,
        );

      if (
        leadDifference !== 0
      ) {
        return leadDifference;
      }

      // Then revenue
      return (
        Number(
          b.totalRevenue || 0,
        ) -
        Number(
          a.totalRevenue || 0,
        )
      );
    },
  );

  // =========================================================
  // GLOBAL STATS
  //
  // Calculate BEFORE PAGINATION.
  // =========================================================

  const totalEmployees =
    report.length;

  const totalLeads =
    report.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee.totalLeads ||
            0,
        ),
      0,
    );

  const totalRegistrationDone =
    report.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee.totalRegistrationDone ||
            0,
        ),
      0,
    );

  const totalAdmissionDone =
    report.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee.totalAdmissionDone ||
            0,
        ),
      0,
    );

  const totalRevenue =
    report.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee.totalRevenue ||
            0,
        ),
      0,
    );

  const registrationPercentage =
    totalLeads > 0
      ? round2(
          (
            totalRegistrationDone /
            totalLeads
          ) * 100,
        )
      : 0;

  const conversionPercentage =
    totalLeads > 0
      ? round2(
          (
            totalAdmissionDone /
            totalLeads
          ) * 100,
        )
      : 0;

  // =========================================================
  // PAGINATION
  //
  // Pagination is ONLY applied here.
  // Therefore global revenue/lead/conversion totals
  // are not affected by page number.
  // =========================================================

  const totalPages =
    Math.ceil(
      totalEmployees /
        limit,
    );

  const paginatedReport =
    report.slice(
      skip,
      skip + limit,
    );

  // =========================================================
  // FINAL RESPONSE
  // =========================================================

  return {
    startDate,

    endDate,

    dateFilter:
      query.dateFilter ||
      'today',

    fromDate:
      startDate,

    toDate:
      endDate,

    level:
      levelNumber,

    team:
      isTeam,

    page,

    limit,

    totalEmployees,

    totalPages,

    hasNextPage:
      page < totalPages,

    hasPreviousPage:
      page > 1,

    // Global stats
    totalLeads,

    totalRegistrationDone,

    totalAdmissionDone,

    totalRevenue:
      round2(
        totalRevenue,
      ),

    registrationPercentage,

    conversionPercentage,

    data:
      paginatedReport,
  };
}

async stateWiseEmployeeTeamReport(
  query: any = {},
  loggedInUser: any,
) {
  // =========================================================
  // HELPERS
  // =========================================================

  const toIdString = (
    value: any,
  ): string => {
    if (!value) {
      return '';
    }

    if (
      typeof value === 'object' &&
      value._id
    ) {
      return String(
        value._id,
      );
    }

    if (
      typeof value === 'object' &&
      value.id
    ) {
      return String(
        value.id,
      );
    }

    try {
      return String(value);
    } catch {
      return '';
    }
  };

  const isValidObjectId = (
    value: any,
  ): boolean => {
    const id =
      toIdString(value);

    return Boolean(
      id &&
        Types.ObjectId.isValid(id),
    );
  };

  const getRequestedEmployeeId =
    (): string => {
      const value =
        query.employeeId ||
        query.counsellorId ||
        query.assignedTo;

      return toIdString(value);
    };

  // =========================================================
  // BASIC QUERY VALUES
  // =========================================================

  const employeeId =
    getRequestedEmployeeId();

  const isTeam =
    query.team === true ||
    query.team === 'true';

  // =========================================================
  // EMPLOYEE ID IS REQUIRED
  // =========================================================

  if (!employeeId) {
    throw new BadRequestException(
      'employeeId is required',
    );
  }

  if (
    !Types.ObjectId.isValid(
      employeeId,
    )
  ) {
    throw new BadRequestException(
      'Invalid employeeId',
    );
  }

  // =========================================================
  // LOGGED-IN USER ROLE
  //
  // Admin:
  //   Can access everything.
  //
  // BD:
  //   Can access himself and his complete hierarchy only.
  // =========================================================

  const loggedInRole =
    typeof loggedInUser?.role ===
    'object'
      ? String(
          loggedInUser?.role?.name ||
            '',
        )
          .trim()
          .toLowerCase()
      : String(
          loggedInUser?.role ||
            loggedInUser?.roleName ||
            '',
        )
          .trim()
          .toLowerCase();

  const isAdmin =
    loggedInRole ===
    'admin';

  const isBd =
    loggedInRole ===
    'bd';

  const loggedInUserId =
    toIdString(
      loggedInUser?._id ||
        loggedInUser?.userId ||
        loggedInUser?.id,
    );

  console.log(
    '[stateWiseEmployeeTeamReport] ACCESS',
    {
      loggedInRole,
      isAdmin,
      isBd,
      loggedInUserId,
      employeeId,
      team: isTeam,
    },
  );

  // =========================================================
  // GET SELECTED EMPLOYEE
  // =========================================================

  const parentEmployee =
    await this.userModel
      .findOne({
        _id:
          new Types.ObjectId(
            employeeId,
          ),
        status: 'active',
      })
      .populate(
        'role',
        'name level',
      )
      .select(
        '_id name email number employeeId role status createdAt',
      )
      .lean();

  if (!parentEmployee) {
    throw new BadRequestException(
      'Employee not found or inactive',
    );
  }

  // =========================================================
  // BD ACCESS CONTROL
  //
  // Admin bypasses this.
  //
  // BD can see:
  //   himself
  //   any employee under himself
  // =========================================================

  if (
    isBd &&
    !isAdmin
  ) {
    if (
      !loggedInUserId ||
      !Types.ObjectId.isValid(
        loggedInUserId,
      )
    ) {
      throw new BadRequestException(
        'Logged-in BD employee ID is invalid',
      );
    }

    const bdSubordinates =
      await this.getUserAndSubordinateIds(
        loggedInUserId,
      );

    const allowedIds =
      new Set<string>();

    allowedIds.add(
      loggedInUserId,
    );

    for (
      const item of
        bdSubordinates || []
    ) {
      const id =
        toIdString(item);

      if (
        id &&
        Types.ObjectId.isValid(id)
      ) {
        allowedIds.add(id);
      }
    }

    console.log(
      '[stateWiseEmployeeTeamReport] BD hierarchy',
      {
        loggedInUserId,
        allowedCount:
          allowedIds.size,
        requestedEmployeeId:
          employeeId,
      },
    );

    if (
      !allowedIds.has(
        employeeId,
      )
    ) {
      throw new ForbiddenException(
        'You are not allowed to view this employee hierarchy',
      );
    }
  }

  let levelNumber:
    | number
    | null = null;

  if (
    query.level !==
      undefined &&
    query.level !==
      null &&
    query.level !== ''
  ) {
    levelNumber =
      this.resolveLevel(
        query.level,
      );

    if (
      levelNumber === null
    ) {
      throw new BadRequestException(
        'Invalid level',
      );
    }

    const levelUserIds =
      await this.getUserIdsByRoleLevel(
        levelNumber,
      );

    const levelIds =
      new Set<string>();

    for (
      const item of
        levelUserIds || []
    ) {
      const id =
        toIdString(item);

      if (
        id &&
        Types.ObjectId.isValid(id)
      ) {
        levelIds.add(id);
      }
    }

    if (
      !levelIds.has(
        employeeId,
      )
    ) {
      throw new BadRequestException(
        'Selected employee does not belong to the requested level',
      );
    }
  }

  // =========================================================
  // GET DIRECT TEAM
  //
  // IMPORTANT:
  //
  // getUsersUnder() is used only for direct children.
  //
  // We do NOT use getUserAndSubordinateIds() here because
  // this API should return only one hierarchy level.
  // =========================================================

  let rawDirectTeam: any[] =
    [];

  if (isTeam) {
    rawDirectTeam =
      await this.userLogic.getUsersUnder(
        parentEmployee,
      );
  }

  console.log(
    '[stateWiseEmployeeTeamReport] RAW DIRECT TEAM',
    {
      parentId: employeeId,
      count:
        rawDirectTeam?.length || 0,
    },
  );

  // =========================================================
  // DIRECT TEAM IDS
  //
  // Remove:
  //   - invalid IDs
  //   - parent itself
  //   - duplicates
  // =========================================================

  const directTeamIds =
    [
      ...new Set(
        (
          rawDirectTeam || []
        )
          .map(
            (employee: any) =>
              toIdString(
                employee?._id ||
                  employee,
              ),
          )
          .filter(
            (
              id: string,
            ) =>
              Boolean(id) &&
              Types.ObjectId.isValid(
                id,
              ) &&
              id !== employeeId,
          ),
      ),
    ];

  console.log(
    '[stateWiseEmployeeTeamReport] DIRECT TEAM IDS',
    {
      parentId: employeeId,
      directTeamIds,
      count:
        directTeamIds.length,
    },
  );

  // =========================================================
  // GET ONLY ACTIVE DIRECT EMPLOYEES
  // =========================================================

  const directEmployees =
    directTeamIds.length
      ? await this.userModel
          .find({
            _id: {
              $in:
                directTeamIds.map(
                  (
                    id,
                  ) =>
                    new Types.ObjectId(
                      id,
                    ),
                ),
            },
            status: 'active',
          })
          .populate(
            'role',
            'name level',
          )
          .select(
            '_id name email number employeeId role status createdAt',
          )
          .lean()
      : [];

  // =========================================================
  // REMOVE ANY ACCIDENTAL PARENT DUPLICATE
  // =========================================================

  const cleanDirectEmployees =
    directEmployees.filter(
      (employee: any) =>
        toIdString(
          employee?._id,
        ) !== employeeId,
    );

  // =========================================================
  // SORT DIRECT EMPLOYEES
  //
  // Name initially.
  // We will sort again after metrics are loaded.
  // =========================================================

  cleanDirectEmployees.sort(
    (
      a: any,
      b: any,
    ) =>
      String(
        a?.name || '',
      ).localeCompare(
        String(
          b?.name || '',
        ),
      ),
  );

  console.log(
    '[stateWiseEmployeeTeamReport] ACTIVE DIRECT TEAM',
    {
      parentId: employeeId,
      count:
        cleanDirectEmployees.length,
      employees:
        cleanDirectEmployees.map(
          (employee: any) => ({
            id:
              toIdString(
                employee?._id,
              ),
            name:
              employee?.name,
          }),
        ),
    },
  );

  let parentTeamSize = 0;

  if (isTeam) {
    const subordinateIds =
      await this.getUserAndSubordinateIds(
        employeeId,
      );

    const uniqueIds =
      new Set<string>();

    for (
      const item of
        subordinateIds || []
    ) {
      const id =
        toIdString(item);

      if (
        id &&
        Types.ObjectId.isValid(id) &&
        id !== employeeId
      ) {
        uniqueIds.add(id);
      }
    }

    // Count only ACTIVE descendants.
    if (
      uniqueIds.size
    ) {
      parentTeamSize =
        await this.userModel.countDocuments(
          {
            _id: {
              $in:
                Array.from(
                  uniqueIds,
                ).map(
                  (
                    id,
                  ) =>
                    new Types.ObjectId(
                      id,
                    ),
                ),
            },
            status: 'active',
          },
        );
    }
  }

  const buildMetricQuery = (
    targetEmployeeId: string,
    includeTeam: boolean,
  ) => {
    const metricQuery: any = {
      employeeId:
        targetEmployeeId,

      team:
        includeTeam,
    };

    // ---------------------------------------------------------
    // DATE FILTER
    // ---------------------------------------------------------

    if (
      query.dateFilter
    ) {
      metricQuery.dateFilter =
        query.dateFilter;
    }

    if (
      query.fromDate
    ) {
      metricQuery.fromDate =
        query.fromDate;
    }

    if (
      query.toDate
    ) {
      metricQuery.toDate =
        query.toDate;
    }

    // ---------------------------------------------------------
    // LEAD FILTERS
    //
    // Keep these filters consistent with the main report.
    // ---------------------------------------------------------

    if (
      query.state
    ) {
      metricQuery.state =
        query.state;
    }

    if (
      query.source
    ) {
      metricQuery.source =
        query.source;
    }

    if (
      query.source_campaign
    ) {
      metricQuery.source_campaign =
        query.source_campaign;
    }

    if (
      query.status
    ) {
      metricQuery.status =
        query.status;
    }

    if (
      query.stageId
    ) {
      metricQuery.stageId =
        query.stageId;
    }

    return metricQuery;
  };

  let parentMetricReport: any =
    null;

  try {
    const result =
      await this.stateWiseEmployeeReport(
        buildMetricQuery(
          employeeId,
          true,
        ),
        loggedInUser,
      );

    if (
      result?.data?.length
    ) {
      parentMetricReport =
        result.data[0];
    }
  } catch (error: any) {
    console.error(
      '[stateWiseEmployeeTeamReport] Parent metric error',
      {
        employeeId,
        error:
          error?.message ||
          error,
      },
    );

    throw error;
  }

  if (!isTeam) {
    return {
      success: true,

      startDate:
        parentMetricReport?.startDate ||
        null,

      endDate:
        parentMetricReport?.endDate ||
        null,

      dateFilter:
        query.dateFilter ||
        'today',

      level:
        levelNumber,

      team: false,

      employeeId,

      parentEmployee: {
        ...(parentMetricReport || {}),

        employeeId,

        employeeName:
          parentEmployee?.name ||
          parentMetricReport?.employeeName ||
          'Unknown',

        employeeEmail:
          parentEmployee?.email ||
          parentMetricReport?.employeeEmail ||
          null,

        employeeNumber:
          parentEmployee?.number ||
          null,

        employeeCode:
          parentEmployee?.employeeId ||
          parentMetricReport?.employeeCode ||
          null,

        team: false,

        teamSize: 0,

        hasTeam:
          false,
      },

      data: [],

      totalEmployees: 0,
    };
  }

  // =========================================================
  // GET METRICS FOR EVERY DIRECT EMPLOYEE
  //
  // IMPORTANT:
  //
  // Each child is requested with team=true.
  //
  // Therefore:
  //
  // B report =
  // B + B's complete descendants
  //
  // C report =
  // C + C's complete descendants
  //
  // This gives correct drill-down numbers without putting
  // deeper employees directly inside A's `data`.
  // =========================================================

  const directReports =
    await Promise.all(
      cleanDirectEmployees.map(
        async (
          employee: any,
        ) => {
          const childId =
            toIdString(
              employee?._id,
            );

          if (
            !childId ||
            childId ===
              employeeId
          ) {
            return null;
          }

          try {
            const result =
              await this.stateWiseEmployeeReport(
                buildMetricQuery(
                  childId,
                  true,
                ),
                loggedInUser,
              );

            const metric =
              result?.data?.[0] ||
              {};

            // -------------------------------------------------
            // GET CHILD COMPLETE TEAM SIZE
            // -------------------------------------------------

            const childSubordinateIds =
              await this.getUserAndSubordinateIds(
                childId,
              );

            const childDescendantIds =
              new Set<string>();

            for (
              const item of
                childSubordinateIds ||
                []
            ) {
              const id =
                toIdString(item);

              if (
                id &&
                Types.ObjectId.isValid(
                  id,
                ) &&
                id !== childId
              ) {
                childDescendantIds.add(
                  id,
                );
              }
            }

            let childTeamSize =
              0;

            if (
              childDescendantIds.size
            ) {
              childTeamSize =
                await this.userModel.countDocuments(
                  {
                    _id: {
                      $in:
                        Array.from(
                          childDescendantIds,
                        ).map(
                          (
                            id,
                          ) =>
                            new Types.ObjectId(
                              id,
                            ),
                        ),
                    },
                    status:
                      'active',
                  },
                );
            }

            return {
              ...metric,

              employeeId:
                childId,

              employeeName:
                employee?.name ||
                metric?.employeeName ||
                'Unknown',

              employeeEmail:
                employee?.email ||
                metric?.employeeEmail ||
                null,

              employeeNumber:
                employee?.number ||
                null,

              employeeCode:
                employee?.employeeId ||
                metric?.employeeCode ||
                null,

              designation:
                typeof employee?.role ===
                'object'
                  ? employee?.role
                      ?.name ||
                    null
                  : null,

              level:
                typeof employee?.role ===
                'object'
                  ? employee?.role
                      ?.level ??
                    null
                  : null,

              team: true,

              teamSize:
                childTeamSize,

              hasTeam:
                childTeamSize > 0,
            };
          } catch (error: any) {
            console.error(
              '[stateWiseEmployeeTeamReport] Child metric error',
              {
                parentId:
                  employeeId,
                childId,
                error:
                  error?.message ||
                  error,
              },
            );

            // Do not break the entire hierarchy because one
            // employee has a metric problem.
            return {
              employeeId:
                childId,

              employeeName:
                employee?.name ||
                'Unknown',

              employeeEmail:
                employee?.email ||
                null,

              employeeNumber:
                employee?.number ||
                null,

              employeeCode:
                employee?.employeeId ||
                null,

              designation:
                typeof employee?.role ===
                'object'
                  ? employee?.role
                      ?.name ||
                    null
                  : null,

              level:
                typeof employee?.role ===
                'object'
                  ? employee?.role
                      ?.level ??
                    null
                  : null,

              totalLeads: 0,

              totalRegistrationDone:
                0,

              totalAdmissionDone:
                0,

              totalRevenue:
                0,

              registrationConversionPercentage:
                0,

              conversionPercentage:
                0,

              states: [],

              team: true,

              teamSize: 0,

              hasTeam: false,

              metricError: true,
            };
          }
        },
      ),
    );

  // =========================================================
  // REMOVE NULLS
  // =========================================================

  const cleanDirectReports =
    directReports.filter(
      (
        employee,
      ): employee is any =>
        Boolean(employee),
    );

  // =========================================================
  // SORT
  //
  // 1. Leads DESC
  // 2. Revenue DESC
  // 3. Name ASC
  // =========================================================

  cleanDirectReports.sort(
    (
      a: any,
      b: any,
    ) => {
      const leadDifference =
        Number(
          b?.totalLeads || 0,
        ) -
        Number(
          a?.totalLeads || 0,
        );

      if (
        leadDifference !==
        0
      ) {
        return leadDifference;
      }

      const revenueDifference =
        Number(
          b?.totalRevenue || 0,
        ) -
        Number(
          a?.totalRevenue || 0,
        );

      if (
        revenueDifference !==
        0
      ) {
        return revenueDifference;
      }

      return String(
        a?.employeeName ||
          '',
      ).localeCompare(
        String(
          b?.employeeName ||
            '',
        ),
      );
    },
  );

  // =========================================================
  // PARENT RESPONSE
  // =========================================================

  const parentReport = {
    ...(parentMetricReport || {}),

    employeeId,

    employeeName:
      parentEmployee?.name ||
      parentMetricReport?.employeeName ||
      'Unknown',

    employeeEmail:
      parentEmployee?.email ||
      parentMetricReport?.employeeEmail ||
      null,

    employeeNumber:
      parentEmployee?.number ||
      null,

    employeeCode:
      parentEmployee?.employeeId ||
      parentMetricReport?.employeeCode ||
      null,

    designation:
  (parentEmployee.role as any)?.name ?? null,

level:
  (parentEmployee.role as any)?.level ?? null,

    team: true,

    // ALL descendants, not just direct children.
    teamSize:
      parentTeamSize,

    hasTeam:
      parentTeamSize > 0,
  };

  // =========================================================
  // GLOBAL TOTALS OF DIRECT EMPLOYEES
  //
  // These totals intentionally use ONLY directReports.
  //
  // We do not sum the parent because parent already contains
  // the whole subtree and would double-count the team.
  // =========================================================

  const totalEmployees =
    cleanDirectReports.length;

  const totalLeads =
    cleanDirectReports.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee?.totalLeads ||
            0,
        ),
      0,
    );

  const totalRegistrationDone =
    cleanDirectReports.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee?.totalRegistrationDone ||
            0,
        ),
      0,
    );

  const totalAdmissionDone =
    cleanDirectReports.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee?.totalAdmissionDone ||
            0,
        ),
      0,
    );

  const totalRevenue =
    cleanDirectReports.reduce(
      (
        sum: number,
        employee: any,
      ) =>
        sum +
        Number(
          employee?.totalRevenue ||
            0,
        ),
      0,
    );

  const registrationPercentage =
    totalLeads > 0
      ? Number(
          (
            (
              totalRegistrationDone /
              totalLeads
            ) *
            100
          ).toFixed(2),
        )
      : 0;

  const conversionPercentage =
    totalLeads > 0
      ? Number(
          (
            (
              totalAdmissionDone /
              totalLeads
            ) *
            100
          ).toFixed(2),
        )
      : 0;

  // =========================================================
  // FINAL RESPONSE
  // =========================================================

  return {
    success: true,

    startDate:
      parentMetricReport?.startDate ||
      null,

    endDate:
      parentMetricReport?.endDate ||
      null,

    fromDate:
      parentMetricReport?.startDate ||
      null,

    toDate:
      parentMetricReport?.endDate ||
      null,

    dateFilter:
      query.dateFilter ||
      'today',

    level:
      levelNumber,

    team: true,

    employeeId,

    // =======================================================
    // SELECTED EMPLOYEE
    // =======================================================

    parentEmployee:
      parentReport,

    // =======================================================
    // ONLY DIRECT EMPLOYEES
    //
    // Parent is NEVER included here.
    // Grandchildren are NEVER included directly here.
    // =======================================================

    data:
      cleanDirectReports,

    // =======================================================
    // TEAM SUMMARY
    // =======================================================

    totalEmployees,

    totalLeads,

    totalRegistrationDone,

    totalAdmissionDone,

    totalRevenue:
      Number(
        totalRevenue.toFixed(2),
      ),

    registrationPercentage,

    conversionPercentage,

    teamSize:
      parentTeamSize,

    hasTeam:
      parentTeamSize > 0,

    // =======================================================
    // DEBUG INFO
    // =======================================================

    debug: {
      loggedInRole,

      isAdmin,

      isBd,

      loggedInUserId,

      selectedEmployeeId:
        employeeId,

      directTeamCount:
        cleanDirectEmployees.length,

      directReportCount:
        cleanDirectReports.length,

      totalHierarchySize:
        parentTeamSize,

      dateFilter:
        query.dateFilter ||
        'today',

      level:
        levelNumber,

      team:
        true,
    },
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
