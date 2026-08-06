import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GetTemplateDto {
  @ApiProperty({
    example: '1459497515392771',
    description: 'WhatsApp template ID',
  })
  @IsString()
  @IsNotEmpty()
  id: string;
}