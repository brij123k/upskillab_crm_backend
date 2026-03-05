import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreatePoolDto {
  @IsString()
  name: string;
}
import { PartialType } from '@nestjs/swagger';

export class UpdatePoolDto extends PartialType(
  CreatePoolDto,
) {}
