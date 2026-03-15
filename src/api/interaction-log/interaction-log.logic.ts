import { Injectable, NotFoundException } from "@nestjs/common";
import { InteractionLogData } from "./interaction-log.data";
import { LeadHistoryLogic } from "../lead_management/lead-history/lead-history.logic";
import { UserActivityLogic } from "../user-activity/user-activity.logic";
import { LeadLogic } from "../lead_management/lead/lead.logic";
import { LeadActionType } from "src/schema/lead_management/lead-history.schema";
import { UserLogic } from "../user/user.logic";

@Injectable()
export class InteractionLogLogic {

  constructor(
    private readonly data: InteractionLogData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,
    private readonly leadLogic: LeadLogic,
    private readonly userLogic: UserLogic,
  ) {}

  async create(dto: any, currentUserId: string) {

    const log = await this.data.create({
      ...dto,
      userId: dto.userId || currentUserId,
      interactionAt: dto.interactionAt || new Date(),
    });

    // change stage if provided
    if (dto.stageId) {
      await this.leadLogic.changeStagebyLeadId(
        dto.leadId,
        dto.stageId,
        currentUserId,
      );
    }

    // Lead history
    await this.leadHistoryLogic.log({
      leadId: dto.leadId.toString(),
      actionType: LeadActionType.INTERACTION_LOG,
      actionBy: currentUserId,
      reason:dto.outcome,
      changes: dto,
    });

    // User activity
    await this.userActivityLogic.log({
      userId: currentUserId,
      action: 'INTERACTION_LOG_CREATED',
      referenceType: 'LEAD',
      referenceId: dto.leadId.toString(),
      meta: { message: dto.outcome },
    });

    return {
      message: 'Interaction log created successfully',
      logId: log._id,
    };
  }

  getByLead(leadId: number) {
    return this.data.findByLeadId(leadId);
  }

  async update(id: string, dto: any, userId: string) {

    const exist = await this.data.findById(id);
    if (!exist) throw new NotFoundException('Log not found');

    return this.data.update(id, dto);
  }

  async getByUsers(filter: any, userId: string) {

  if (filter.group == 'true') {

    const users = await this.userLogic.getUsersUnder(userId);

    const accessibleUserIds = users.map((u) =>
      u._id.toString(),
    );

    accessibleUserIds.push(userId);

    if (!accessibleUserIds.length) {
      return this.data.findAllWithUserIds(
        filter,
        [userId],
      );
    }

    return this.data.findAllWithUserIds(
      filter,
      accessibleUserIds,
    );

  } else {

    return this.data.findInteractionLogsWithPagination(
      filter,
      userId,
    );

  }
}


}