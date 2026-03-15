import { IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateInteractionLogDto {

  @IsNumber()
  leadId: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsString()
  outcome: string;

  @IsOptional()
  stageId?: string;

  @IsOptional()
  interactionAt?: Date;

}