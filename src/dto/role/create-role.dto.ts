import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';
import { PermissionDto } from './permission.dto';

export class CreateRoleDto {
  @ApiProperty({ example: 'Sales Manager' })
  @IsString()
  name: string;

  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  permissions: PermissionDto[];
}
