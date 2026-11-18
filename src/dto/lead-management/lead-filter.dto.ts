import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  IsBooleanString,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Multi-select filters accept a single value, a comma-separated list
 * (`?status=a,b`) or repeated params (`?status=a&status=b`).
 * Always normalised to a de-duplicated string array.
 */
const toList = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const list = Array.from(new Set(raw.map((v) => String(v).trim()).filter((v) => v && v !== 'all')));
  return list.length ? list : undefined;
};
import { LeadSource, LeadStatus } from 'src/schema/lead_management/lead.schema';

export class LeadFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
bulkSearch?: string;

  @ApiPropertyOptional({ enum: LeadStatus, isArray: true, description: 'One or more, comma separated' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsEnum(LeadStatus, { each: true })
  status?: LeadStatus[];

  @ApiPropertyOptional({ enum: LeadSource, isArray: true, description: 'One or more, comma separated' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsEnum(LeadSource, { each: true })
  source?: LeadSource[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source_compain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiPropertyOptional({ type: [String], description: 'One or more ids, comma separated' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsMongoId({ each: true })
  stageId?: string[];

  @ApiPropertyOptional({ type: [String], description: 'One or more ids, comma separated' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsMongoId({ each: true })
  poolId?: string[];

  @ApiPropertyOptional({ type: [String], description: 'One or more ids, comma separated' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsMongoId({ each: true })
  assignedTo?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  modifiedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @ApiPropertyOptional({
    example: 'today | week | month | year',
  })
  @IsOptional()
  @IsString()
  dateFilter?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-01-31' })
  @IsOptional()
  toDate?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 'employee' })
  @IsOptional()
  @IsString()
  groupBy?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional()
  @IsOptional()
  connected?:boolean;

  @ApiPropertyOptional()
  @IsOptional()
  scheduler?:boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'Search across city and state' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    example: 'today | week | month | year',
  })
  @IsOptional()
  @IsString()
  assignedDateFilter?:string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  assignedDateFrom?: string;

  @ApiPropertyOptional({ example: '2026-01-31' })
  @IsOptional()
  assignedDateTo?: string;

  @ApiPropertyOptional({ example: 'new | old | name_asc | name_desc | last_call_desc | last_call_asc' })
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  limit?: number;
}
