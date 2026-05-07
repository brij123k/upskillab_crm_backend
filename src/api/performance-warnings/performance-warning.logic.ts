import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreatePerformanceWarningDto } from 'src/dto/performance-warning/create-performance-warning.dto';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';
import { PerformanceWarningData } from './performance-warning.data';

@Injectable()
export class PerformanceWarningLogic {
  constructor(
    private readonly data: PerformanceWarningData,
    private readonly notificationEngine: NotificationEngineService,
  ) {}

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

    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.PERFORMANCE_WARNING,
      actorId: issuedBy,
      recipients: {
        userIds: [dto.userId],
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
}
