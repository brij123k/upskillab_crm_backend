import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelLeaveDto {
  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}