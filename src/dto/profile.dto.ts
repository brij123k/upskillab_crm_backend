import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  reportingSenierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  education?: string;

  @ApiPropertyOptional()
  @IsOptional()
  salary?: number;

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