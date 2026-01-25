import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, isEmail, IsEnum, IsMongoId, IsOptional, IsString, Length, Matches } from 'class-validator';

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
    reportingManagerId?: string;

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
}