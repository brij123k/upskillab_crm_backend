import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class PersonalDetailsDto {
  @ApiPropertyOptional({ example: '1998-05-21' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: ['Male', 'Female', 'Other'] })
  @IsOptional()
  @IsIn(['Male', 'Female', 'Other', ''])
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^$|^\d{12}$/, { message: 'Aadhaar number must be 12 digits' })
  aadhaarNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^$|^[A-Za-z]{5}\d{4}[A-Za-z]$/, { message: 'Invalid PAN number' })
  panNumber?: string;
}
