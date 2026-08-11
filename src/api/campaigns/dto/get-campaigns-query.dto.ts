import {
  IsIn,
  IsOptional,
  IsString,
  Max,
  Min,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetCampaignsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsIn([
    'today',
    'this_week',
    'this_month',
    'custom',
  ])
  date?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

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