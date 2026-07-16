import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreateLeavePolicyDto {
  @ApiProperty({
    description: 'Role ID',
    example: '685a4f8b9c7d2e0012345678',
  })
  @IsMongoId()
  @IsNotEmpty()
  roleId: string;

  @ApiProperty({
    description: 'Policy year',
    example: 2027,
  })
  @IsInt()
  @Min(2025)
  @Max(2100)
  year: number;

  @ApiProperty({
    description: 'Monthly Casual Leave allocation',
    example: 3,
  })
  @IsInt()
  @Min(0)
  monthlyCL: number;

  @ApiProperty({
    description: 'Monthly Earned Leave allocation',
    example: 3,
  })
  @IsInt()
  @Min(0)
  monthlyEL: number;

  @ApiPropertyOptional({
    description: 'Allow earned leave carry forward',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allowEarnedLeaveCarryForward?: boolean = true;

  @ApiPropertyOptional({
    description: 'Allow earned leave encashment',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allowEarnedLeaveEncashment?: boolean = true;

  @ApiPropertyOptional({
    description: 'Maximum EL allowed to carry forward',
    example: 30,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCarryForwardEL?: number = 0;

  @ApiPropertyOptional({
    description: 'Policy active status',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateLeavePolicyDto {
  @ApiPropertyOptional({
    description: 'Monthly Casual Leave allocation',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyCL?: number;

  @ApiPropertyOptional({
    description: 'Monthly Earned Leave allocation',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyEL?: number;

  @ApiPropertyOptional({
    description: 'Allow earned leave carry forward',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allowEarnedLeaveCarryForward?: boolean;

  @ApiPropertyOptional({
    description: 'Allow earned leave encashment',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  allowEarnedLeaveEncashment?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum EL carry forward',
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCarryForwardEL?: number;

  @ApiPropertyOptional({
    description: 'Policy active status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}