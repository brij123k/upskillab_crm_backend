import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({
    example: 'Engineering',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: '65fa1c9b2a3f1e00123abcd',
    description: 'Parent department ID (optional)',
  })
  @IsOptional()
  @IsString()
  parentDepartmentId?: string;
}
import { PartialType } from '@nestjs/swagger';

export class UpdateDepartmentDto extends PartialType(
  CreateDepartmentDto,
) {}
