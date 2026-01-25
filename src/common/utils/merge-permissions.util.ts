export function mergePermissions(
  rolePermissions: any[] = [],
  profilePermissions: any[] = [],
) {
  const map = new Map<string, Set<string>>();

  const add = (module: string, actions: string[]) => {
    if (!map.has(module)) {
      map.set(module, new Set());
    }
    actions.forEach((a) => map.get(module)!.add(a));
  };

  rolePermissions.forEach((p) =>
    add(p.module, p.actions),
  );
  profilePermissions.forEach((p) =>
    add(p.module, p.actions),
  );

  return Array.from(map.entries()).map(
    ([module, actions]) => ({
      module,
      actions: Array.from(actions),
    }),
  );
}
