import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCallLogDto {
  @ApiProperty({ description: 'Numeric Lead ID' })
  @IsNumber()
  leadId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  userId?: string; // mobile may send, web can use token

  @ApiProperty({ description: 'Call duration in seconds' })
  @IsNumber()
  duration: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outcome: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  stageId?: string;

  @ApiPropertyOptional({
    description: 'Call review submitted after call',
  })
  @IsOptional()
  @IsString()
  remark?: string;
}
