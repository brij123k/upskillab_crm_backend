import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreatePoolDto {
  @IsString()
  name: string;

  @IsString()
  revenue_percentage:string;

  @IsBoolean()
  payment_internal:boolean;

  @IsString()
  pool_owner:string;
}
import { PartialType } from '@nestjs/swagger';

export class UpdatePoolDto extends PartialType(
  CreatePoolDto,
) {}
