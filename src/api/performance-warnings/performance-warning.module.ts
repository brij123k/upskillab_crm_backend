import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModule } from 'src/api/user/user.module';
import { NotificationModule } from 'src/notifications/notification.module';
import { PerformanceWarning, PerformanceWarningSchema } from 'src/schema/performance-warning.schema';
import { PerformanceWarningController } from './performance-warning.controller';
import { PerformanceWarningMyController } from './performance-warning.my.controller';
import { PerformanceWarningData } from './performance-warning.data';
import { PerformanceWarningLogic } from './performance-warning.logic';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PerformanceWarning.name, schema: PerformanceWarningSchema },
    ]),
    NotificationModule,
    UserModule,
  ],
  controllers: [PerformanceWarningController, PerformanceWarningMyController],
  providers: [PerformanceWarningLogic, PerformanceWarningData],
  exports: [PerformanceWarningLogic],
})
export class PerformanceWarningModule {}
