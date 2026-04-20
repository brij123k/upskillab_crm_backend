import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadData } from './lead.data';
import { Lead, LeadStatus } from 'src/schema/lead_management/lead.schema';
import { CreateLeadDto, UpdateLeadDto } from 'src/dto/lead-management/lead.dto';
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
import { Pool } from 'src/schema/Pool.schema';

@Injectable()
export class LeadLogic {
  constructor(
    private readonly leadData: LeadData,
    private readonly profileData: ProfileData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userLogic: UserLogic,
    @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,

    @InjectModel(LeadStage.name)
    private readonly leadStageModel: Model<LeadStage>,

    @InjectModel(MeetingLog.name)
    private meetingLogModel: Model<MeetingLog>,

    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,

    @InjectModel(Pool.name)
    private readonly poolModel: Model<Pool>,

    private readonly userActivityLogic: UserActivityLogic,
    private readonly notificationEngine: NotificationEngineService,
  ) { }

  async create(dto: CreateLeadDto, userId: string) {
    const lead = await this.leadData.create({
      ...dto,
      modifiedBy: userId,
      stageId:new Types.ObjectId(dto.stageId),
      assignedTo:dto.assignedTo?dto.assignedTo:userId,
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
    
    // const salesManagers = await this.userModel.find({
    //   roleName: 'sales_manager',   // adjust if needed
    //   status: 'active',
    // }).select('_id');

    // const managerIds = salesManagers.map(u => u._id.toString());

    // // 3️⃣ Emit notification event
    // await this.notificationEngine.handleEvent({
    //   event: NOTIFICATION_EVENT.LEAD_ASSIGNED,
    //   actorId: actorId,

    //   recipients: {
    //     userIds: managerIds, // 🔥 Sales Managers only
    //   },

    //   title: 'Lead Assigned',
    //   message: `A lead has been assigned to a sales executive.`,

    //   entity: {
    //     type: NOTIFICATION_ENTITY.LEAD,
    //     id: lead._id.toString(),
    //   },

    //   metadata: {
    //     redirectUrl: `/leads/${lead._id}`,
    //   },
    // });

    return lead;
  }

  async findAll(filters: any, user: any) {
    // 🔥 Admin → see everything
    if (user.isSuperAdmin) {
      return this.leadData.findAllWithFilters(filters);
    }
    const Pool= await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
    let poolId: string | undefined = undefined;

if (Pool?._id) {
  poolId = Pool._id.toString();
}

    const users = await this.userLogic.getUsersUnder(user.userId);
    const accessibleUserIds = users.map((u) => u._id.toString());
    accessibleUserIds.push(user.userId)
    if (!accessibleUserIds || !accessibleUserIds.length) {
      return this.leadData.findAllWithFiltersUserIds(
        filters,
        [user.userId],
        poolId
      );
    }

    // 🔥 Apply hierarchy filter
    return this.leadData.findAllWithFiltersUserIds(
      filters,
      accessibleUserIds,
      poolId
    );
  }

  async stageSummaryReport(query: any, user: any) {
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

    const match: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (query.status) match.status = query.status;
    if (query.source) match.source = query.source;
    if (query.stageId) match.stageId = new Types.ObjectId(query.stageId);
    if (query.poolId) match.poolId = new Types.ObjectId(query.poolId);
    if (query.assignedTo) match.assignedTo = query.assignedTo;
    if (query.counsellorId) match.assignedTo = query.counsellorId;

    if (!user.isSuperAdmin) {
      const Pool = await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
      const users = await this.userLogic.getUsersUnder(user.userId);
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

  async allEmployeesStagesReport(user: any) {
    const match: any = {};

    if (!user.isSuperAdmin) {
      const Pool = await this.poolModel.findOne({ pool_owner: user.userId }).select('_id');
      const users = await this.userLogic.getUsersUnder(user.userId);
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

  async findOne(id: string) {
    const lead = await this.leadData.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, userId: string) {
    const existingLead = await this.leadData.findById(id);
    if (!existingLead) throw new NotFoundException('Lead not found');

    const lead = await this.leadData.update(id, {
      ...dto,
      assignedTo:dto.assignedTo===""?existingLead.assignedTo:dto.assignedTo,
      stageId:new Types.ObjectId(dto.stageId),
      poolId:new Types.ObjectId(dto.poolId),
      modifiedBy: userId,
      modifiedAt: new Date(),
    });
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

    return lead;
  }

  // async delete(id: string) {
  //   const lead = await this.leadData.delete(id);
  //   if (!lead) throw new NotFoundException('Lead not found');

  //   await this.leadHistoryLogic.log({
  //     leadId: id,
  //     actionType: LeadActionType.DELETED,
  //     actionBy: lead.modifiedBy,
  //   });

  //   return { message: 'Lead deleted successfully' };
  // }

  async changeStatus(
    id: string,
    status: LeadStatus,
    userId: string,
  ) {
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
      lead,
    };
  }

  async getLeadByLeadId(
    leadId: number
  ) {
    return await this.leadData.getByLeadId(leadId)
  }


  async changeStage(
    id: string,
    stageId: string,
    userId: string,
  ) {
    const existingLead = await this.leadData.findById(id);
    if (!existingLead) throw new NotFoundException('Lead not found');
    const existstage = await this.leadStageModel.findById(stageId)
    if (!existstage) throw new NotFoundException('Stage not found');
    const lead = await this.leadData.update(id, {
      stageId:new Types.ObjectId(stageId),
      modifiedBy: userId,
      modifiedAt: new Date(),
    });

    if (!lead) {
      throw new NotFoundException("Lead Not found")
    }
    const stage = existingLead.stageId as any;
    await this.leadHistoryLogic.log({
      leadId: lead?.leadId.toString(),
      actionType: LeadActionType.STAGE_CHANGED,
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
      from:stage.name,
      to:existstage.name},
  });

    return {
      message: 'Lead stage updated successfully',
      lead,
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
    });

    if (!lead) {
      throw new NotFoundException("Lead Not found")
    }
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

    // 🔹 CASE 1: ONLY assignTo
    // if (assignedTo && !departmentId) {
    //   updatePayload.assignedTo = assignedTo;
    // }

    // 🔹 CASE 2: ONLY departmentId
    // if (departmentId && !assignedTo) {
    //   updatePayload.departmentId = departmentId;
    // }

    // 🔹 CASE 3: BOTH assignTo + departmentId
    if (assignedTo) {
      // 🔥 validate user department
      const user = await this.profileData.findByUserId(assignedTo);
      if (!user){
        throw new BadRequestException(
          'Assigned user does not belong to this department',
        );
      }

      updatePayload.assignedTo = assignedTo;
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
   

    await this.userActivityLogic.log({
    userId: currentUserId,
    action: 'Lead_Assignment',
    referenceType: 'LEAD',
    referenceId: lead?.leadId.toString(),
    meta: {
      message:"Lead Stage changed",
      fromUser: lead.assignedTo?.toString(),
      toUser: assignedTo,

    },
  });
   }
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

  async getLeadsByUser(userId: string) {
    return this.leadData.findByUserId(userId);
  }
  async getLeadsByLeadIds(leadIds: number[]) {
    return this.leadData.getLeadsByLeadIds(leadIds)
  }
  // async getLeadsByDepartment(departmentId: string) {
  //   return this.leadData.findByDepartmentId(departmentId);
  // }
  async getDuplicateLeads() {
    return this.leadData.findDuplicateLeads()
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
}
