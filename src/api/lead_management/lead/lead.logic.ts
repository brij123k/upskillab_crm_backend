import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadData } from './lead.data';
import { LeadStatus } from 'src/schema/lead_management/lead.schema';
import { CreateLeadDto, UpdateLeadDto } from 'src/dto/lead-management/lead.dto';
import { LeadHistoryLogic } from '../lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';

@Injectable()
export class LeadLogic {
  constructor(
    private readonly leadData: LeadData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
  ) {}

  async create(dto: CreateLeadDto, userId: string) {
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

  async assignLeads(
  dto: {
    leadIds?: string[];
    departmentId?: string;
    assignedTo?: string;
  },
  currentUserId: string,
) {
  const { leadIds, departmentId, assignedTo } = dto;

  if (!leadIds && !departmentId) {
    throw new BadRequestException(
      'Either leadIds or departmentId is required',
    );
  }

  let finalLeadIds: string[] = [];
  let leadsForHistory: any[] = [];

  // 🔹 1. Leads from leadIds
  if (leadIds?.length) {
    const leads = await this.leadData.findByIds(leadIds);
    leadsForHistory.push(...leads);
    finalLeadIds.push(...leads.map((l) => l._id.toString()));
  }

  // 🔹 2. Leads from department
  if (departmentId) {
    const deptLeads =
      await this.leadData.findIdsByDepartment(departmentId);

    leadsForHistory.push(...deptLeads);
    finalLeadIds.push(
      ...deptLeads.map((l) => l._id.toString()),
    );
  }

  // 🔹 Remove duplicates
  finalLeadIds = [...new Set(finalLeadIds)];

  if (!finalLeadIds.length) {
    throw new BadRequestException('No leads found to assign');
  }

  // 🔹 Update leads
  const result = await this.leadData.assignLeadsByIds(
    finalLeadIds,
    assignedTo || '',
    currentUserId,
  );

  // 🔹 History logging
  for (const lead of leadsForHistory) {
    await this.leadHistoryLogic.log({
      leadId: lead._id,
      actionType: LeadActionType.ASSIGNED,
      fromUser: lead.assignedTo,
      toUser: assignedTo,
      actionBy: currentUserId,
      changes: {
        assignedTo: {
          from: lead.assignedTo,
          to: assignedTo,
        },
      },
    });
  }

  return {
    message: 'Leads assigned successfully',
    totalAssigned: finalLeadIds.length,
    matchedCount: result.matchedCount,
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

async getLeadsByDepartment(departmentId: string) {
  return this.leadData.findByDepartmentId(departmentId);
}

}
