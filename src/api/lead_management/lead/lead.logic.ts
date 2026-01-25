import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadData } from './lead.data';
import { LeadStatus } from 'src/schema/lead_management/lead.schema';
import { CreateLeadDto, UpdateLeadDto } from 'src/dto/lead-management/lead.dto';
import { LeadHistoryLogic } from '../lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { ProfileData } from 'src/api/profile/profile.data';

@Injectable()
export class LeadLogic {
  constructor(
    private readonly leadData: LeadData,
    private readonly profileData: ProfileData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
  ) {}

  async create(dto: CreateLeadDto, userId: string) {
    console.log(dto)
    const lead = await this.leadData.create({
      ...dto,
      modifiedBy: userId,
      modifiedAt: new Date(),
    });

    await this.leadHistoryLogic.log({
      leadId: lead._id.toString(),
      actionType: LeadActionType.CREATED,
      actionBy: userId,
      changes: dto,
    });

    return lead;
  }

findAll(filters: any) {
  return this.leadData.findAllWithFilters(filters);
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
      modifiedBy: userId,
      modifiedAt: new Date(),
    });

    await this.leadHistoryLogic.log({
      leadId: id,
      actionType: LeadActionType.UPDATED,
      actionBy: userId,
      changes: {
            from: existingLead,
            to: lead,
        },
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

    await this.leadHistoryLogic.log({
      leadId: id,
      actionType: LeadActionType.STATUS_CHANGED,
      actionBy: userId,
      changes: {
        status: {
          from: existingLead.status,
          to: status,
        },
      },
    });

    return {
      message: 'Lead status updated successfully',
      lead,
    };
  }



  async changeStage(
    id: string,
    stageId: string,
    userId: string,
  ) {
    const existingLead = await this.leadData.findById(id);
    if (!existingLead) throw new NotFoundException('Lead not found');

    const lead = await this.leadData.update(id, {
      stageId,
      modifiedBy: userId,
      modifiedAt: new Date(),
    });

    await this.leadHistoryLogic.log({
      leadId: id,
      actionType: LeadActionType.STAGE_CHANGED,
      actionBy: userId,
      changes: {
        status: {
          from: existingLead.stageId,
          to: stageId,
        },
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
  },
  currentUserId: string,
) {
  const { leadIds, assignedTo, departmentId } = dto;
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
  if (assignedTo && !departmentId) {
    updatePayload.assignedTo = assignedTo;
  }

  // 🔹 CASE 2: ONLY departmentId
  if (departmentId && !assignedTo) {
    updatePayload.departmentId = departmentId;
  }

  // 🔹 CASE 3: BOTH assignTo + departmentId
  if (assignedTo && departmentId) {
    // 🔥 validate user department
    const user = await this.profileData.findByUserId(assignedTo);
    if (!user || user.departmentId?.toString() !== departmentId) {
      throw new BadRequestException(
        'Assigned user does not belong to this department',
      );
    }

    updatePayload.assignedTo = assignedTo;
    updatePayload.departmentId = departmentId;
  }

  // 🔹 Update leads
  const result = await this.leadData.bulkUpdate(
    leadIds,
    updatePayload,
  );

  // 🔹 History
  for (const lead of leads) {
    await this.leadHistoryLogic.log({
      leadId: lead._id.toString(),
      actionType: assignedTo
        ? LeadActionType.ASSIGNED
        : LeadActionType.UPDATED,
      fromUser: lead.assignedTo?.toString(),
      toUser: assignedTo,
      actionBy: currentUserId,
      changes: updatePayload,
    });
  }

  return {
    message: 'Leads updated successfully',
    modifiedCount: result.modifiedCount,
  };
}

  async pullBackAndReassign(
    leadIds: string[],
    newAssignedTo: string,
    currentUserId: string,
  ) {
    const leads = await this.leadData.findByIds(leadIds);

    const result = await this.leadData.pullBackAndReassign(
      leadIds,
      newAssignedTo,
      currentUserId,
    );

    for (const lead of leads) {
      await this.leadHistoryLogic.log({
        leadId: lead._id.toString(),
        actionType: LeadActionType.REASSIGNED,
        fromUser: lead.assignedTo?.toString(),
        toUser: newAssignedTo,
        actionBy: currentUserId,
        changes: {
          assignedTo: {
            from: lead.assignedTo,
            to: newAssignedTo,
          },
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

// async getLeadsByDepartment(departmentId: string) {
//   return this.leadData.findByDepartmentId(departmentId);
// }

}
