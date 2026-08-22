import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export enum AttendanceRecheckAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class ReviewAttendanceRecheckRequestDto {
  @IsEnum(AttendanceRecheckAction)
  action: AttendanceRecheckAction;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  remark?: string;
}