import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateTaskDto } from 'src/dto/task/create-task.dto';
import { UpdateTaskDto } from 'src/dto/task/update-task.dto';
import { TaskStatus } from 'src/schema/task.schema';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';
import { TaskData } from './task.data';

@Injectable()
export class TaskLogic {
  constructor(
    private readonly data: TaskData,
    private readonly notificationEngine: NotificationEngineService,
  ) {}

  private async notifyAssignee(task: any, actorId: string, previousAssigneeId?: string) {
    const assigneeId = task.assignTo?.toString();
    if (!assigneeId) return;
    if (previousAssigneeId && previousAssigneeId === assigneeId) return;

    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.TASK_ASSIGNED,
      actorId,
      recipients: {
        userIds: [assigneeId],
      },
      title: 'New task assigned',
      message: task.title
        ? `You have been assigned a task: ${task.title}`
        : 'You have been assigned a new task',
      entity: {
        type: NOTIFICATION_ENTITY.TASK,
        id: task._id.toString(),
      },
      metadata: {
        taskId: task._id.toString(),
        dueDate: task.dueDate,
        status: task.status,
      },
    });
  }

  async create(dto: CreateTaskDto, currentUserId: string) {
    if (!dto.assignTo) {
      throw new BadRequestException('assignTo is required');
    }

    const task = await this.data.create({
      title: dto.title,
      description: dto.description,
      assignTo: new Types.ObjectId(dto.assignTo),
      assignedBy: new Types.ObjectId(dto.assignedBy || currentUserId),
      dueDate: new Date(dto.dueDate),
      reletedLeadIds: dto.reletedLeadIds || [],
      status: dto.status || TaskStatus.PENDING,
    });

    await this.notifyAssignee(task, currentUserId);

    return {
      success: true,
      data: task,
    };
  }

  async update(id: string, dto: UpdateTaskDto) {
    const existing = await this.data.findById(id);
    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const payload: any = {};
    let assigneeChanged = false;
    let previousAssigneeId: string | undefined;
    if (dto.title !== undefined) payload.title = dto.title;
    if (dto.description !== undefined) payload.description = dto.description;
    if (dto.assignTo !== undefined) {
      previousAssigneeId = existing.assignTo?.toString();
      payload.assignTo = new Types.ObjectId(dto.assignTo);
      assigneeChanged = previousAssigneeId !== dto.assignTo;
    }
    if (dto.assignedBy !== undefined) payload.assignedBy = new Types.ObjectId(dto.assignedBy);
    if (dto.dueDate !== undefined) payload.dueDate = new Date(dto.dueDate);
    if (dto.reletedLeadIds !== undefined) payload.reletedLeadIds = dto.reletedLeadIds;
    if (dto.status !== undefined) payload.status = dto.status;

    const updated = await this.data.update(id, payload);

    if (assigneeChanged) {
      await this.notifyAssignee(updated, payload.assignedBy?.toString() || existing.assignedBy?.toString(), previousAssigneeId);
    }

    return {
      success: true,
      data: updated,
    };
  }

  async updateStatus(id: string, status: TaskStatus) {
    const task = await this.data.findById(id);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const updated = await this.data.update(id, { status });
    return {
      success: true,
      data: updated,
    };
  }

  async updateMyStatus(id: string, status: TaskStatus, userId: string) {
    const task = await this.data.findByUserAndId(userId, id);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const updated = await this.data.update(id, { status });
    return {
      success: true,
      data: updated,
    };
  }

  delete(id: string) {
    return this.data.delete(id);
  }

  getAll(filters: any = {}) {
    return this.data.findAll(filters);
  }

  getMyTasks(userId: string, filters: any = {}) {
    return this.data.findAllByUser(userId, filters);
  }

  getMyTaskById(userId: string, id: string) {
    return this.data.findByUserAndId(userId, id);
  }

  getById(id: string) {
    return this.data.findById(id);
  }
}
