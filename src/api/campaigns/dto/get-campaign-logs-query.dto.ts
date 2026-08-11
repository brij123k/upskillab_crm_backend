import {
  IsOptional,
  IsString,
  IsIn,
  Max,
  Min,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetCampaignLogsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED',
  ])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}