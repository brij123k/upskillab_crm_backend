import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsMongoId, IsOptional, IsString } from 'class-validator';
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
  @IsOptional()
  permissions?: PermissionDto[];

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  isSuperAdmin:boolean;


}
