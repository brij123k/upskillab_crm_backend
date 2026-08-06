import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class SendTemplateDto {
  @IsString()
  from: string;

  @IsString()
  campaignName: string;

  @IsString()
  to: string;

  @IsString()
  templateName: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  otp?: string;

  @IsOptional()
  @IsObject()
  language?: {
    code: string;
  };

  @IsOptional()
  @IsObject()
  components?: {
    body?: {
      params: string[];
    };

    header?: {
      type: string;
      text: string;
    };
  };
}