import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceController } from './attendance.controller';
import { AttendanceData } from './attendance.data';
import { AttendanceLogic } from './attendance.logic';
import { Attendance, AttendanceSchema } from 'src/schema/attendance.schema';
import { KraModule } from '../KRA/kra.module';
import { ProfileModule } from '../profile/profile.module';
import { LeaveModule } from '../leaves/leave.module';
import {
  AttendanceRecheckRequest,
  AttendanceRecheckRequestSchema,
} from 'src/schema/attendance-recheck-request.schema';

import {
  AttendanceRecheckController,
} from './attendance-recheck.controller';

import {
  AttendanceRecheckLogic,
} from './attendance-recheck.logic';

import {
  AttendanceRecheckData,
} from './attendance-recheck.data';
import { HolidayModule } from '../holiday/holiday.module';
@Module({
  imports: [
    KraModule,
    ProfileModule,
    LeaveModule,
    HolidayModule,
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
      {
        name: AttendanceRecheckRequest.name,
        schema: AttendanceRecheckRequestSchema,
      },
    ]),
  ],
  controllers: [
    AttendanceController,
    AttendanceRecheckController,
  ],

  providers: [
    AttendanceLogic,
    AttendanceData,
    AttendanceRecheckLogic,
    AttendanceRecheckData,
  ],
  exports: [AttendanceLogic],
})
export class AttendanceModule {}
