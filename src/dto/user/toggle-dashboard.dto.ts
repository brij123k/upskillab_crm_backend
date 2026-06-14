import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString,IsObject } from 'class-validator';

export class ToggleDashboardDto {
  @ApiPropertyOptional({
    description: 'Department ID',
  })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'Reporting Manager User ID',
  })
  @IsOptional()
  @IsString()
  reportingSeniorId?: string;

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
  @IsString()
  education?: string;

  @ApiPropertyOptional()
  @IsOptional()
  salary?: number;

  @ApiPropertyOptional({
    example: [
      { module: 'leads', actions: ['read', 'create'] },
    ],
  })
  @IsOptional()
  @IsArray()
  extraAccessControls?: {
    module: string;
    actions: string[];
  }[];

  @ApiPropertyOptional()
  @IsOptional()
  profileImage?: string;

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