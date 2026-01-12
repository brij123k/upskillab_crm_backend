import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class PermissionDto {
  @ApiProperty({ example: 'leads' })
  @IsString()
  module: string;

  @ApiProperty({
    example: ['create', 'read', 'update'],
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  actions: string[];
}
