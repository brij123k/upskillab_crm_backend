import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { hasPermission } from 'src/common/utils/has-permission.util';

const FULL_ACCESS = PERMISSIONS.ENROLLED_LEADS.ACTIONS.FULL_ACCESS;

/**
 * Like PermissionGuard, but `enrolled_leads:full_access` also allows every
 * enrolled-leads action. Which leads are visible is decided by the service
 * (full access = leads assigned to the user and their team).
 */
@Injectable()
export class EnrolledPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get(PERMISSION_KEY, context.getHandler());
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user?.permissions)
      throw new ForbiddenException('Permissions not found');

    const { module, action } = required;
    if (
      hasPermission(user, module, action) ||
      hasPermission(user, module, FULL_ACCESS)
    ) {
      return true;
    }
    throw new ForbiddenException('You do not have permission for this action');
  }
}
