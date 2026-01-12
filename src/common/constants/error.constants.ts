import { BadRequestException } from "@nestjs/common";

export const ERROR_MESSAGES = {
  // AUTH
  INVALID_CREDENTIALS: 'Invalid email or password',
  UNAUTHORIZED: 'Unauthorized access',
  TOKEN_EXPIRED: 'Token expired',

  // USER
  USER_NOT_FOUND: 'User not found',
  USER_BLOCKED: 'User is blocked',
  EMAIL_EXISTS: 'Email already exists',

  // ROLE
  ROLE_NOT_FOUND: 'Role not found',
  ACCESS_DENIED: 'You do not have permission',

  // OTP
  OTP_INVALID: 'Invalid OTP',
  OTP_EXPIRED: 'OTP expired',

  
};

export class AppError {
  static badRequest(message: string, errors?: any) {
    throw new BadRequestException({
      success: false,
      message,
      errors,
    });
  }
}
