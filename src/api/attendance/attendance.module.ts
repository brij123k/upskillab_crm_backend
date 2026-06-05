import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceController } from './attendance.controller';
import { AttendanceData } from './attendance.data';
import { AttendanceLogic } from './attendance.logic';
import { Attendance, AttendanceSchema } from 'src/schema/attendance.schema';
import { KraModule } from '../KRA/kra.module';
import { ProfileModule } from '../profile/profile.module';
import { LeaveModule } from '../leaves/leave.module';

@Module({
  imports: [
    KraModule,
    ProfileModule,
    LeaveModule,
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
    ]),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceLogic, AttendanceData],
  exports: [AttendanceLogic],
})
export class AttendanceModule {}
