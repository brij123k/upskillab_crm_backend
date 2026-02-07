import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification } from './schemas/notification.schema';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  /* =============================
     LIST NOTIFICATIONS
  ============================== */
  async list(userId: string, page = 1, limit = 20) {
    console.log(userId,"1")
    const skip = (page - 1) * limit;

    const data = await this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await this.notificationModel.countDocuments({ userId });

    return {
      data,
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  /* =============================
     UNREAD COUNT
  ============================== */
  async unreadCount(userId: string) {
    const count = await this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });

    return { count };
  }

  /* =============================
     MARK SINGLE AS READ
  ============================== */
  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.notificationModel.findOneAndUpdate(
      {
        _id: notificationId,
        userId: new Types.ObjectId(userId),
        isRead: false,
      },
      {
        isRead: true,
        readAt: new Date(),
      },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    const unreadCount = await this.unreadCount(userId);

    // 🔔 Sync all tabs via socket
    this.notificationGateway.emitUnreadCount(userId, unreadCount.count);

    return notification;
  }

  /* =============================
     MARK ALL AS READ
  ============================== */
  async markAllAsRead(userId: string) {
    console.log(userId,"2")
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      {
        isRead: true,
        readAt: new Date(),
      },
    );

    // 🔔 Sync socket
    this.notificationGateway.emitUnreadCount(userId, 0);

    return { message: 'All notifications marked as read' };
  }
}
