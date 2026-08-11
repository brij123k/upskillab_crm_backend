import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VariableDto {
  @IsOptional()
  @IsBoolean({
    message: 'dynamic must be a boolean',
  })
  dynamic: boolean = true;

  @IsString({
    message: 'variable value must be a string',
  })
  value: string;
}

export class TemplateHeaderDto {
  @IsString({
    message: 'header.type must be a string',
  })
  @IsIn(
    ['text', 'image', 'video', 'document'],
    {
      message:
        'header.type must be one of: text, image, video, document',
    },
  )
  type: 'text' | 'image' | 'video' | 'document';

  @IsOptional()
  @IsString({
    message: 'header.text must be a string',
  })
  text?: string;

  @IsOptional()
  @IsString({
    message: 'header.link must be a string',
  })
  link?: string;

  @IsOptional()
  @IsString({
    message: 'header.filename must be a string',
  })
  filename?: string;
}

export class TemplateButtonsDto {
  @IsArray({
    message: 'buttons.params must be an array',
  })
  @IsString({
    each: true,
    message:
      'every value inside buttons.params must be a string',
  })
  params: string[];
}

export class BulkWhatsappDto {
  @IsString({
    message: 'from is required and must be a string',
  })
  from: string;

  @IsString({
    message:
      'templateName is required and must be a string',
  })
  templateName: string;

  @IsOptional()
  @IsArray({
    message: 'leadIds must be an array',
  })
  @IsString({
    each: true,
    message: 'every leadId must be a string',
  })
  leadIds?: string[];

  @IsOptional()
  @IsArray({
    message: 'phoneNumbers must be an array',
  })
  @IsString({
    each: true,
    message:
      'every phone number must be a string',
  })
  phoneNumbers?: string[];

  // BODY VARIABLES
  @IsOptional()
  @IsArray({
    message: 'variables must be an array',
  })
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  variables?: VariableDto[];

  // HEADER
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateHeaderDto)
  header?: TemplateHeaderDto;

  // HEADER VARIABLES
  @IsOptional()
  @IsArray({
    message:
      'headerVariables must be an array',
  })
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  headerVariables?: VariableDto[];

  // BUTTONS
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateButtonsDto)
  buttons?: TemplateButtonsDto;
}