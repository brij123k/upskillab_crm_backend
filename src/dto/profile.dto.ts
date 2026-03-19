import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  reportingSeniorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  education?: string;

  @ApiPropertyOptional()
  @IsOptional()
  salary?: number;

  @ApiPropertyOptional({
    description: 'Legacy single pool ID (kept for backward compatibility)',
  })
  @IsOptional()
  @IsString()
  poolId?: string;

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
  profileImage?: string;

  @ApiPropertyOptional({
    example: [{ module: 'leads', actions: ['read'] }],
  })
  @IsOptional()
  @IsArray()
  extraAccessControls?: {
    module: string;
    actions: string[];
  }[];
}
import { PartialType } from '@nestjs/swagger';

export class UpdateProfileDto extends PartialType(CreateProfileDto) {}