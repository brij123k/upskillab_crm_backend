import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VariableDto {
  @IsOptional()
  @IsBoolean()
  dynamic?: boolean = true;

  @IsString()
  value: string;
}

export class BulkWhatsappDto {
  @IsString()
  from: string;

  @IsString()
  templateName: string;

  @IsOptional()
  @IsArray()
  leadIds?: string[];

  @IsOptional()
  @IsArray()
  phoneNumbers?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  variables?: VariableDto[];
}