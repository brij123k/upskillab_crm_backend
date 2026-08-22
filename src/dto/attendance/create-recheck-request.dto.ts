import {
  IsEnum,
  IsNotEmpty,
  IsString,
} from 'class-validator';

import { AttendanceStatus } from 'src/schema/attendance.schema';

export class CreateAttendanceRecheckRequestDto {
  @IsEnum(AttendanceStatus)
  requestedStatus: AttendanceStatus;

  @IsString()
  @IsNotEmpty()
  requestReason: string;
}