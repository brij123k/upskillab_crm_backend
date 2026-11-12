import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ENROLLED_LEAD_ACTIVITY_TYPES } from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';

export class EnrolledLeadQueryDto {
  @ApiPropertyOptional({ description: 'Name, email, mobile or username' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'CRM stage id' })
  @IsOptional()
  @IsMongoId()
  stageId?: string;

  @ApiPropertyOptional({
    enum: ['active', 'inactive'],
    description: 'Upstream isActive',
  })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  active?: 'active' | 'inactive';

  @ApiPropertyOptional({ description: 'Upstream student status (exact value)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  status?: string;

  @ApiPropertyOptional({ description: 'Upskillab course id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  courseId?: string;

  @ApiPropertyOptional({ description: 'Upskillab batch id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchId?: string;

  @ApiPropertyOptional({
    description: 'Batch status (exact value, e.g. ongoing)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchStatus?: string;

  @ApiPropertyOptional({ description: 'User id, or "unassigned"' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Enrolled (student created) from, YYYY-MM-DD',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Enrolled (student created) to, YYYY-MM-DD',
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class CatalogQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Batches only: Upskillab course id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  courseId?: string;

  @ApiPropertyOptional({ description: 'Batches only: batch status' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class LogEnrolledActivityDto {
  @ApiProperty({ enum: ENROLLED_LEAD_ACTIVITY_TYPES })
  @IsIn(ENROLLED_LEAD_ACTIVITY_TYPES as unknown as string[])
  type: (typeof ENROLLED_LEAD_ACTIVITY_TYPES)[number];

  @ApiPropertyOptional({ description: 'Move the lead to this stage' })
  @ValidateIf(
    (dto) => dto.type === 'stage_changed' || dto.stageId !== undefined,
  )
  @IsMongoId()
  stageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AssignEnrolledLeadsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  ids: string[];

  @ApiPropertyOptional({ description: 'User id; omit or null to unassign' })
  @IsOptional()
  @IsMongoId()
  assignedTo?: string;
}

export class BulkStageDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  ids: string[];

  @ApiProperty()
  @IsMongoId()
  stageId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class EnrolledStageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}

export class UpdateEnrolledStageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Make this the stage new students get' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Details filled in after a call with an enrolled lead (same as the lead page). */
export class EnrolledCallFeedbackDto {
  @ApiProperty({ description: 'Enrolled lead stage after the call' })
  @IsMongoId()
  stageId: string;

  @ApiProperty({ description: 'Call outcome' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  outcome: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remark?: string;
}
