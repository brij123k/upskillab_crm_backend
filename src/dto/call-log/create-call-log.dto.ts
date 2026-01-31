import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { CallOutcome } from 'src/schema/call-log.schema';

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
  
  @ApiProperty({ enum: CallOutcome })
  @IsEnum(CallOutcome)
  status?: CallOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  stageId?: string;
}
