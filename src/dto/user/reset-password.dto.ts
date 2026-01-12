import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsStrongPassword, Length } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;

    @ApiProperty({
    description: 'OTP sent to email',
    example: '123456',
  })
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiProperty()
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
  newPassword: string;
}
