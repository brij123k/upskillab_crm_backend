import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class AssignLeadDto {
  @ApiPropertyOptional({
    description: 'User ID to whom leads will be assigned',
  })
  @IsMongoId()
  @IsOptional()
  assignedTo?: string;

  @ApiProperty({
    description: 'Array of Lead IDs',
    example: ['696cadcadcbcf508621922e6'],
  })
  @IsArray()
  @IsMongoId({ each: true })
  leadIds: string[];

  @ApiPropertyOptional({
    description: 'Department ID (optional)',
  })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiPropertyOptional({
    description:'Explain why Assigned him'
  })
  @IsString()
  reason:string
}
