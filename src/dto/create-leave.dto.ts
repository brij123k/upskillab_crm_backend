import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { LeaveType } from 'src/schema/leave.schema';

export class CreateLeaveDto {
  @ApiProperty()
  @IsString()
  subject: string;

  @ApiProperty()
  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @ApiProperty()
  @IsDateString()
  leaveFrom: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsDateString()
  leaveTo?: string;

  @ApiProperty()
  @IsString()
  reason: string;

  @ApiProperty()
  @IsMongoId()
  reportToUserId: string;

  @ApiProperty({
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  reportToUserIds?: string[];
}