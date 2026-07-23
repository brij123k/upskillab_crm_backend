import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class StageChangeDto {
  @ApiProperty({
    description: 'Array of Lead IDs',
    example: ['696cadcadcbcf508621922e6'],
  })
  @IsArray()
  @IsMongoId({ each: true })
  leadIds: string[];

    @ApiPropertyOptional({
    description: 'User ID to whom leads will be assigned Pool',
  })
  @IsMongoId()
  @IsOptional()
  stageId: string;

  @ApiProperty({
    description:"Add reason for stage change",
  })
  @IsString()
  reason:string;
}
