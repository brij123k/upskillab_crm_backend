import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { LeadSource } from 'src/schema/lead_management/lead.schema';

export class CreateBootcampRegistrationDto {
  @ApiProperty({
    example: 'Abhishek Maurya',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    example: 'test@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: '9876543210',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    example: 'Software Developer',
  })
  @IsString()
  @IsNotEmpty()
  profession: string;

  @ApiProperty({
    example: 'Delhi',
  })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({
    enum: LeadSource,
    example: LeadSource.BOOTCAMP,
  })
  @IsEnum(LeadSource)
  source: LeadSource;
}