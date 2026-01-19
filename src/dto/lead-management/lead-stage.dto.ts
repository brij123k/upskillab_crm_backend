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

  @ApiProperty({ example: '65fa1c9b2a3f1e00123abcd' })
  @IsString()
  departmentId: string;
}

export class UpdateLeadStageDto extends PartialType(
  CreateLeadStageDto,
) {}