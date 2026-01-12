import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ERROR_MESSAGES } from '../constants/error.constants';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;

    if (!authHeader)
      throw new UnauthorizedException(ERROR_MESSAGES.UNAUTHORIZED);

    const token = authHeader.split(' ')[1];

    try {
      const decoded = this.jwtService.verify(token);
      req.user = decoded;
      return true;
    } catch {
      throw new UnauthorizedException(ERROR_MESSAGES.TOKEN_EXPIRED);
    }
  }
}
