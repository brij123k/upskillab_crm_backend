import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsMongoId, IsOptional, IsString, ValidateIf } from 'class-validator';
import { AnnouncementAudience } from 'src/schema/announcement.schema';

export class CreateAnnouncementDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  message: string;

  @ApiProperty({ enum: AnnouncementAudience })
  @IsEnum(AnnouncementAudience)
  audience: AnnouncementAudience;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.audience === AnnouncementAudience.DEPARTMENT)
  @IsMongoId()
  departmentId?: string;

  @ApiProperty({ required: false, type: [String] })
  @ValidateIf((o) => o.audience === AnnouncementAudience.SELECTED_USERS)
  @IsArray()
  @Type(() => String)
  userIds?: string[];
}
