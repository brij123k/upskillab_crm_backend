import {
  IsEnum,
  IsNotEmpty,
  IsString,
} from 'class-validator';

import { AttendanceStatus } from 'src/schema/attendance.schema';

export class ChangeAttendanceStatusDto {
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsString()
  @IsNotEmpty()
  remark: string;
}