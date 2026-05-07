import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateUserLogDto } from 'src/dto/user/create-user-log.dto';
import {
  UserLogAction,
  UserLogStatus,
} from 'src/schema/user-log.schema';
import { UserLogData } from './user-log.data';

@Injectable()
export class UserLogLogic {
  constructor(private readonly data: UserLogData) {}

  create(dto: CreateUserLogDto) {
    return this.data.create({
      ...dto,
      userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
    });
  }

  async logEvent(payload: {
    userId?: string;
    ip?: string;
    device?: string;
    action: UserLogAction;
    status: UserLogStatus;
    log: string;
    reason?: string;
    meta?: any;
  }) {
    return this.data.create({
      ...payload,
      userId: payload.userId ? new Types.ObjectId(payload.userId) : undefined,
    });
  }

  getByUser(userId: string) {
    return this.data.findByUser(userId);
  }

  getAll(filter: any = {}) {
    return this.data.findAll(filter);
  }
}
