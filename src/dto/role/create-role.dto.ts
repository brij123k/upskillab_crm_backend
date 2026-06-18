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

@ApiProperty({
  example: '685f12cbe0f4b3d8f3f4a123',
  required: false,
})
@IsOptional()
@IsMongoId()
levelId?: string;

  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  @IsOptional()
  permissions?: PermissionDto[];

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  isSuperAdmin:boolean;


}
