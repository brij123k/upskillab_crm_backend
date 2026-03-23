import { IsNumber, IsString } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateLoanPartnerDto {
@ApiProperty() 
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  type: string;

  @ApiProperty()
  @IsNumber()
  submissionCharge: number;
}


export class UpdateLoanPartnerDto extends PartialType(
  CreateLoanPartnerDto,
) {}