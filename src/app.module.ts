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
    UserActivityModule,
    AppAuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
