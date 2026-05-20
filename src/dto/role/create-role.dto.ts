import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsMongoId, IsOptional, IsString, Min } from 'class-validator';
import { PermissionDto } from './permission.dto';

export class CreateRoleDto {
  @ApiProperty({ example: 'Sales Manager' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Sales Manager' })
  @IsMongoId()
  @IsOptional()
  reportingRole:string;

  @ApiProperty({ example: 2, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  level?: number;

  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  @IsOptional()
  permissions?: PermissionDto[];

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  isSuperAdmin:boolean;


}
