import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.get(
      PERMISSION_KEY,
      context.getHandler(),
    );

    // 🔓 If no permission required on endpoint
    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.permissions) {
      throw new ForbiddenException('Permissions not found');
    }

    const { module, action } = requiredPermission;

    const permissions = user.permissions;

    const hasAccess = permissions.some((perm) => {
      // 🔥 FULL SUPER ADMIN ACCESS
      if (perm.module === '*' && perm.actions.includes('*')) {
        return true;
      }

      // 🔥 MODULE WILDCARD
      if (perm.module === '*' && perm.actions.includes(action)) {
        return true;
      }

      // 🔥 MODULE MATCH
      if (perm.module === module) {
        // ACTION WILDCARD
        if (perm.actions.includes('*')) {
          return true;
        }

        // ACTION MATCH
        if (perm.actions.includes(action)) {
          return true;
        }
      }

      return false;
    });

    if (!hasAccess) {
      throw new ForbiddenException(
        `Access denied for ${module}:${action}`,
      );
    }

    return true;
  }
}
