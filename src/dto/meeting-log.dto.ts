import { IsNumber, IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateMeetingDTO {
  @IsNumber()
  leadId: number;

  @IsString()
  meetingType: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  stageId?: string;

  @IsDateString()
  startedAt: Date;

  @IsNumber()
  duration: number;

  @IsString()
  feedback:string;
}

export class UpdateMeetingDTO {
  @IsOptional()
  @IsString()
  meetingType?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  stageId?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: Date;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsNumber()
  feedback?: number;
}
