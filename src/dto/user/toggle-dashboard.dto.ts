import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class ToggleDashboardDto {
  @ApiPropertyOptional({
    description: 'Department ID',
  })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'Reporting Manager User ID',
  })
  @IsOptional()
  @IsString()
  reportingSeniorId?: string;

  @ApiPropertyOptional({
    description: 'Array of Pool IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each poolId must be valid' })
  poolIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  education?: string;

  @ApiPropertyOptional()
  @IsOptional()
  salary?: number;

  @ApiPropertyOptional({
    example: [
      { module: 'leads', actions: ['read', 'create'] },
    ],
  })
  @IsOptional()
  @IsArray()
  extraAccessControls?: {
    module: string;
    actions: string[];
  }[];

  @ApiPropertyOptional()
  @IsOptional()
  profileImage?: string;
}