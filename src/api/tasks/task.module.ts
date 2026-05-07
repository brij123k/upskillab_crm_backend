import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TaskController } from './task.controller';
import { TaskData } from './task.data';
import { TaskLogic } from './task.logic';
import { Task, TaskSchema } from 'src/schema/task.schema';
import { NotificationModule } from 'src/notifications/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
    ]),
    NotificationModule,
  ],
  controllers: [TaskController],
  providers: [TaskLogic, TaskData],
  exports: [TaskLogic],
})
export class TaskModule {}
