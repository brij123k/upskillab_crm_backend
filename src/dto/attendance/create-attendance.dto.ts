import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { AttendanceLeaveType, AttendanceStatus } from 'src/schema/attendance.schema';

export class CreateAttendanceDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;

  @ApiProperty()
  @IsDateString()
  loginTime: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  logoutTime?: string;

  @ApiProperty({ enum: AttendanceStatus, required: false })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ enum: AttendanceLeaveType, required: false })
  @IsOptional()
  @IsEnum(AttendanceLeaveType)
  leaveType?: AttendanceLeaveType;
}
