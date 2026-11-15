import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { PersonalDetailsDto } from 'src/dto/user/personal-details.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString,IsObject } from 'class-validator';

export class CreateProfileDto {
  @ApiPropertyOptional({ type: PersonalDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalDetailsDto)
  personalDetails?: PersonalDetailsDto;

  @ApiPropertyOptional()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  reportingSeniorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  education?: string;

  @ApiPropertyOptional()
  @IsOptional()
  salary?: number;

  @ApiPropertyOptional({
    description: 'Legacy single pool ID (kept for backward compatibility)',
  })
  @IsOptional()
  @IsString()
  poolId?: string;

  @ApiPropertyOptional({
    description: 'Array of Pool IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each poolId must be valid' })
  poolIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  profileImage?: string;

  @ApiPropertyOptional({
    example: [{ module: 'leads', actions: ['read'] }],
  })
  @IsOptional()
  @IsArray()
  extraAccessControls?: {
    module: string;
    actions: string[];
  }[];

  @ApiPropertyOptional({
    example: "add address",
  })
  @IsOptional()
 @IsObject()
  address?: {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
};
   @ApiPropertyOptional({
    example: "add bank Detail",
  })
  @IsOptional()
  @IsObject()
bankDetails?: {
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  branchName?: string;
  accountType?: string;
};

 @ApiPropertyOptional({
    example: "add Education",
  })
  @IsOptional()
 @IsArray()
educationalDetails?: {
  qualification?: string;
  instituteName?: string;
  boardOrUniversity?: string;
  passingYear?: number;
  percentageOrCGPA?: string;
}[];

 @ApiPropertyOptional({
    example: "add documeny",
  })
  @IsOptional()
  @IsObject()
documents?: {
  aadhaarFront?: string;
  aadhaarBack?: string;
  panCard?: string;
  educationalCertificates?: string[];
};


}
import { PartialType } from '@nestjs/swagger';

export class UpdateProfileDto extends PartialType(CreateProfileDto) {}