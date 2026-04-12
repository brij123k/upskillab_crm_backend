import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class CreateLeadStageDto {
  @ApiProperty({
    example: 'New',
    enum: ['New', 'Contacted', 'Prospect', 'Converted'],
  })
  @IsString()
  name: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  order: number;
}

export class UpdateLeadStageDto extends PartialType(
  CreateLeadStageDto,
) {}