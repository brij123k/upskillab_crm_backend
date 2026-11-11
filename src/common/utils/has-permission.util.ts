/**
 * Same matching rules as PermissionGuard, usable inside services when an
 * endpoint needs an *additional* permission depending on the request data.
 */
export function hasPermission(
  user: any,
  module: string,
  action: string,
): boolean {
  const permissions: any[] = user?.permissions || [];
  return permissions.some((perm: any) => {
    const actions: string[] = perm?.actions || [];
    if (
      perm?.module === '*' &&
      (actions.includes('*') || actions.includes(action))
    ) {
      return true;
    }
    return (
      perm?.module === module &&
      (actions.includes('*') || actions.includes(action))
    );
  });
}

export function isAdminUser(user: any): boolean {
  const roleName = String(
    user?.roleName || user?.role?.name || '',
  ).toLowerCase();
  return roleName === 'admin';
}
