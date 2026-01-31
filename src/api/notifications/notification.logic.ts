import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification } from 'src/schema/notification.schema';

@Injectable()
export class NotificationLogic {
  constructor(
    @InjectModel(Notification.name)
    private readonly model: Model<Notification>,
  ) {}

  send(data: any) {
    return this.model.create(data);
  } 
}
