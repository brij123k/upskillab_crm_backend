import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomMessageReplyDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  title: string;
}

export class CustomMessageButtonDto {
  @IsString()
  @IsIn(['reply'])
  type: 'reply';

  @IsObject()
  @ValidateNested()
  @Type(() => CustomMessageReplyDto)
  reply: CustomMessageReplyDto;
}

export class CustomMessageSectionRowDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CustomMessageSectionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomMessageSectionRowDto)
  rows: CustomMessageSectionRowDto[];
}

export class CustomMessageActionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomMessageButtonDto)
  buttons?: CustomMessageButtonDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomMessageSectionDto)
  sections?: CustomMessageSectionDto[];
}

export class CustomMessageHeaderDto {
  @IsString()
  @IsIn([
    'text',
    'image',
    'video',
    'document',
  ])
  type: 'text' | 'image' | 'video' | 'document';

  @IsOptional()
  @IsString()
  text?: string;
}

export class CustomMessageInteractiveDto {
  @IsString()
  @IsIn(['button', 'list'])
  type: 'button' | 'list';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomMessageHeaderDto)
  header?: CustomMessageHeaderDto;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsString()
  footer?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => CustomMessageActionDto)
  action: CustomMessageActionDto;
}

export class BulkCustomMessageDto {
  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  campaignName: string;

  @IsArray()
  @IsNotEmpty()
  leadIds: string[];

  @IsString()
  @IsIn([
    'text',
    'image',
    'video',
    'document',
    'interactive',
  ])
  type:
    | 'text'
    | 'image'
    | 'video'
    | 'document'
    | 'interactive';

  /*
   * Common body.
   *
   * For:
   * text     -> text body
   * image    -> caption
   * video    -> caption
   * document -> caption
   * interactive -> interactive body
   */
  @IsOptional()
  @IsString()
  body?: string;

  /*
   * Used for image/video/document.
   */
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  /*
   * Used for document.
   */
  @IsOptional()
  @IsString()
  filename?: string;

  /*
   * Used only when type = interactive.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomMessageInteractiveDto)
  interactive?: CustomMessageInteractiveDto;
}