import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { AttendanceStatus } from 'src/schema/attendance.schema';

export class UpdateAttendanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  loginTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  logoutTime?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
