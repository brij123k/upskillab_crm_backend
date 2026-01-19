import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId } from 'class-validator';

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
}
