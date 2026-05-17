import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreatePerformanceWarningDto } from 'src/dto/performance-warning/create-performance-warning.dto';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';
import { PerformanceWarningData } from './performance-warning.data';
import { UserData } from 'src/api/user/user.data';

@Injectable()
export class PerformanceWarningLogic {
  constructor(
    private readonly data: PerformanceWarningData,
    private readonly userData: UserData,
    private readonly notificationEngine: NotificationEngineService,
  ) {}

  private isAdminRole(role: any) {
    const name = role?.name?.toString()?.toLowerCase();
    return name === 'admin' || !!role?.isSuperAdmin;
  }

  async create(dto: CreatePerformanceWarningDto, issuedBy: string) {
    if (!dto.userId) {
      throw new BadRequestException('userId is required');
    }

    const warning = await this.data.create({
      userId: new Types.ObjectId(dto.userId),
      type: dto.type,
      notes: dto.notes,
      issuedBy: new Types.ObjectId(issuedBy),
    });

    const targetUser = await this.userData.findById(dto.userId);
    const recipientIds = targetUser && this.isAdminRole(targetUser.role) ? [] : [dto.userId];

    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.PERFORMANCE_WARNING,
      actorId: issuedBy,
      recipients: {
        userIds: recipientIds,
      },
      title: `Performance warning: ${dto.type}`,
      message: dto.notes,
      entity: {
        type: NOTIFICATION_ENTITY.USER,
        id: dto.userId,
      },
      metadata: {
        warningId: warning._id.toString(),
        type: dto.type,
        redirectUrl: `/bd/my-warnings/${warning._id.toString()}`,
      },
    });

    return {
      success: true,
      data: warning,
    };
  }

  findAll(filters: any = {}) {
    return this.data.findAll(filters);
  }

  async findOne(id: string) {
    const warning = await this.data.findById(id);
    if (!warning) {
      throw new NotFoundException('Performance warning not found');
    }
    return warning;
  }

  async findMyWarning(userId: string, id: string) {
    const warning = await this.data.findByUserAndId(userId, id);
    if (!warning) {
      throw new NotFoundException('Performance warning not found');
    }
    return warning;
  }
}
