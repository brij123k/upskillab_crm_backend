import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, isEmail, IsEnum, IsMongoId, IsOptional, IsString,IsObject, Length, Matches } from 'class-validator';

export class ChangeUserDto {
    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    @Length(3, 50, { message: 'Name must be between 2 and 50 characters' })
    @Matches(/^[a-zA-Z ]+$/, {
        message: 'Name can contain only letters and spaces',
    })
    name?: string;

    @ApiPropertyOptional()
    @IsEmail({}, { message: 'Invalid email format' })
    email?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    @Matches(/^[6-9]\d{9}$/, {
        message: 'Number must be a valid 10-digit Indian mobile number',
    })
    number?: string;


    @ApiPropertyOptional()
    @IsOptional()
    @IsMongoId({ message: 'Invalid role id' })
    role?: string;

    @ApiPropertyOptional()
    @IsOptional()
    departmentId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    reportingSeniorId?: string;

@ApiPropertyOptional({
    type: [String],
    description: 'Array of Pool IDs',
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each poolId must be a valid Mongo ID' })
  poolIds?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    education?: string;

    @ApiPropertyOptional()
    @IsOptional()
    salary?: number;

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