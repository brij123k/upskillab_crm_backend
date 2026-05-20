import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { LeadSource } from 'src/schema/lead_management/lead.schema';

export class CreateSourceCampaignDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: LeadSource })
  @IsEnum(LeadSource)
  source: LeadSource;

  @ApiProperty()
  @IsMongoId()
  defaultStageId: string;

  @ApiProperty()
  @IsMongoId()
  defaultPoolId: string;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSourceCampaignDto extends PartialType(CreateSourceCampaignDto) {}

export class PublicSourceLeadDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;
}
