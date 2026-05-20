import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoleModule } from './api/roles/role.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/services/common.module';
import { UserModule } from './api/user/user.module';
import { DepartmentModule } from './api/departments/department.module';
import { AuthModule } from './common/auth.module';
import { LeadStageModule } from './api/lead_management/lead-stage/lead-stage.module';
import { LeadModule } from './api/lead_management/lead/lead.module';
import { callLogModule } from './api/call-logs/call-log.module';
import { UserActivityModule } from './api/user-activity/user-activity.module';
import { AppAuthModule } from './api/auth/app-auth/app-auth.module';
import { MeetingLogModule } from './api/meeting-logs/meeting-log.module';
import { NotificationModule } from './notifications/notification.module';
import { LeadScheduleModule } from './api/lead_management/lead-schedule/lead-schedule.module';
import { PoolModule } from './api/pool/pool.module';
import { InteractionLogModule } from './api/interaction-log/lead-interaction-log.module';
import { OrderModule } from './api/order_management/order.module';
import { PaymentModule } from './api/order_management/payment/payment.module';
import { LoanPartnerModule } from './api/order_management/loan-partner/loan-partner.module';
import { SubscriptionModule } from './api/order_management/subscription/subscription.module';
import { SmartfloModule } from './api/smartflo/smartflo.module';
import { TaskModule } from './api/tasks/task.module';
import { AnnouncementModule } from './api/announcements/announcement.module';
import { PerformanceWarningModule } from './api/performance-warnings/performance-warning.module';
import { LeaveModule } from './api/leaves/leave.module';
import { SourceCampaignModule } from './api/source-campaigns/source-campaign.module';
@Module({
  imports: [
ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    DatabaseModule,
    RoleModule,
    CommonModule,
    UserModule,
    DepartmentModule,
    LeadStageModule,
    LeadModule,
    callLogModule,
    InteractionLogModule,
    UserActivityModule,
    AppAuthModule,
    MeetingLogModule,
    NotificationModule,
    LeadScheduleModule,
    PoolModule,
    OrderModule,
    PaymentModule,
    LoanPartnerModule,
    SubscriptionModule,
    SmartfloModule,
    TaskModule,
    AnnouncementModule,
    PerformanceWarningModule,
    LeaveModule,
    SourceCampaignModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
