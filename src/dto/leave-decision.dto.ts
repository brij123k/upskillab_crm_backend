import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeaveStatus } from 'src/schema/leave.schema';

export class LeaveDecisionDto {
  @ApiProperty({
    enum: [LeaveStatus.APPROVED, LeaveStatus.REJECTED],
  })
  @IsEnum([LeaveStatus.APPROVED, LeaveStatus.REJECTED])
  status: LeaveStatus;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}