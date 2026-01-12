import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString, IsStrongPassword, Length, Matches } from 'class-validator';
import { UserStatus } from 'src/schema/user.schema';

export class RegisterUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @Length(3, 50, { message: 'Name must be between 2 and 50 characters' })
  @Matches(/^[a-zA-Z ]+$/, {
    message: 'Name can contain only letters and spaces',
  })
  name: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Number must be a valid 10-digit Indian mobile number',
  })
  number: string;

  @ApiProperty()
  @IsString()
  
  @IsStrongPassword(
    {
      minLength: 8,
      minUppercase: 1,
      minLowercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'Password must contain uppercase, lowercase, number, and special character',
    },
  )
  password: string;

  @ApiProperty({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status: UserStatus;

  @ApiProperty()
  @IsMongoId({ message: 'Invalid role id' })
  role: string;
}
