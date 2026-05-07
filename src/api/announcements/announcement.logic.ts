import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateAnnouncementDto } from 'src/dto/announcement/create-announcement.dto';
import { Announcement, AnnouncementAudience } from 'src/schema/announcement.schema';
import { AnnouncementData } from './announcement.data';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';
import { ProfileData } from 'src/api/profile/profile.data';
import { UserData } from 'src/api/user/user.data';

@Injectable()
export class AnnouncementLogic {
  constructor(
    private readonly data: AnnouncementData,
    private readonly profileData: ProfileData,
    private readonly userData: UserData,
    private readonly notificationEngine: NotificationEngineService,
  ) {}

  private isAdminRole(role: any) {
    const name = role?.name?.toString()?.toLowerCase();
    return name === 'admin' || !!role?.isSuperAdmin;
  }

  private async resolveRecipients(dto: CreateAnnouncementDto, creatorId: string) {
    const creatorObjectId = creatorId.toString();

    if (dto.audience === AnnouncementAudience.SELECTED_USERS) {
      const userIds = [...new Set((dto.userIds || []).map((id) => id.toString()))];
      return userIds.filter((id) => id !== creatorObjectId);
    }

    if (dto.audience === AnnouncementAudience.DEPARTMENT) {
      if (!dto.departmentId) {
        throw new BadRequestException('departmentId is required for department audience');
      }

      const deptProfiles = await this.profileData.getBydepId(dto.departmentId);

      return deptProfiles
        .map((profile: any) => profile.userId?._id?.toString() || profile.userId?.toString())
        .filter(Boolean)
        .filter((id: string) => id !== creatorObjectId);
    }

    const users = await this.userData.getAllUsers();
    return users
      .filter((user) => !this.isAdminRole(user.role))
      .map((user) => user._id.toString())
      .filter((id) => id !== creatorObjectId);
  }

  private async sendNotifications(recipientIds: string[], announcement: Announcement, actorId: string) {
    if (!recipientIds.length) return;

    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.ADMIN_BROADCAST,
      actorId,
      recipients: {
        userIds: recipientIds,
      },
      title: announcement.title,
      message: announcement.message,
      entity: {
        type: NOTIFICATION_ENTITY.SYSTEM,
        id: announcement._id.toString(),
      },
      metadata: {
        announcementId: announcement._id.toString(),
        audience: announcement.audience,
        departmentId: announcement.departmentId?.toString() || null,
        userIds: recipientIds,
      },
    });
  }

  async create(dto: CreateAnnouncementDto, creatorId: string) {
    if (dto.audience === AnnouncementAudience.DEPARTMENT && !dto.departmentId) {
      throw new BadRequestException('departmentId is required for department audience');
    }

    if (dto.audience === AnnouncementAudience.SELECTED_USERS && !dto.userIds?.length) {
      throw new BadRequestException('userIds are required for selected users audience');
    }

    const recipientUserIds = await this.resolveRecipients(dto, creatorId);

    const announcement = await this.data.create({
      title: dto.title,
      message: dto.message,
      audience: dto.audience,
      departmentId: dto.departmentId ? new Types.ObjectId(dto.departmentId) : null,
      userIds: dto.userIds?.length ? dto.userIds.map((id) => new Types.ObjectId(id)) : [],
      createdBy: new Types.ObjectId(creatorId),
      recipientUserIds: recipientUserIds.map((id) => new Types.ObjectId(id)),
    });

    await this.sendNotifications(recipientUserIds, announcement, creatorId);

    return {
      success: true,
      data: announcement,
      recipientCount: recipientUserIds.length,
    };
  }

  async findAll(query: any) {
    return this.data.findAll(query);
  }

  async findOne(id: string) {
    const announcement = await this.data.findById(id);
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }
    return announcement;
  }
}
