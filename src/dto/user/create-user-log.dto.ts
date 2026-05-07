import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserLogAction, UserLogStatus } from 'src/schema/user-log.schema';

export class CreateUserLogDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  device?: string;

  @ApiProperty({ enum: UserLogAction })
  @IsEnum(UserLogAction)
  action: UserLogAction;

  @ApiProperty({ enum: UserLogStatus })
  @IsEnum(UserLogStatus)
  status: UserLogStatus;

  @ApiProperty()
  @IsString()
  log: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
