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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
