import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class ReassignLeadDto {
  @ApiProperty({
    description: 'New user ID to assign leads',
  })
  @IsMongoId()
  newAssignedTo: string;

  @ApiProperty({
    description: 'Lead IDs to pull back & reassign',
  })
  @IsArray()
  @IsMongoId({ each: true })
  leadIds: string[];

    @ApiPropertyOptional({
      description:'Explain why Assigned him'
    })
    @IsString()
    reason:string
}
