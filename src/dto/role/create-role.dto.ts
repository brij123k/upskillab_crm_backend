import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PermissionDto } from './permission.dto';

export class CreateRoleDto {
  @ApiProperty({ example: 'Sales Manager' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Sales Manager' })
  @IsMongoId()
  @IsOptional()
  reportingRole:string;
  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  permissions: PermissionDto[];
}
