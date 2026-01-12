import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

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
  reportingManagerId?: string;

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
