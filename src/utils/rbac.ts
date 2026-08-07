import { prisma } from '../config/prisma';

/**
 * The fully-resolved access profile for a user, computed fresh from the database.
 *
 * Effective permissions = (permissions from all of the user's roles)
 *                         ∪ (direct ALLOW grants)
 *                         ∖ (direct DENY grants)      ← DENY always wins.
 *
 * A super admin bypasses the permission set entirely (isSuperAdmin === true) and
 * is considered to have access to every active module.
 *
 * `modules` is the set of module keys the user may open — derived from the
 * namespaces of their effective permissions (or every active module, for a
 * super admin). This is the single source of truth for what the launcher shows
 * and what `requireModule` enforces.
 */
export interface ResolvedAccess {
  id: string;
  email: string;
  name: string;
  status: string;
  isSuperAdmin: boolean;
  roles: string[]; // role keys
  permissions: Set<string>; // permission keys
  modules: Set<string>; // accessible module keys
  departmentId: string | null;
  companyId: string | null;
}

export async function resolveUserAccess(userId: string): Promise<ResolvedAccess | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      departmentId: true,
      companyId: true,
      userRoles: {
        select: {
          role: {
            select: {
              key: true,
              isSuperAdmin: true,
              rolePermissions: {
                select: { permission: { select: { key: true, moduleKey: true } } },
              },
            },
          },
        },
      },
      userPermissions: {
        select: { effect: true, permission: { select: { key: true, moduleKey: true } } },
      },
    },
  });
  if (!user) return null;

  const isSuperAdmin = user.userRoles.some((ur) => ur.role.isSuperAdmin);
  const roles = user.userRoles.map((ur) => ur.role.key);

  // Gather ALLOW (roles + direct allow) as permKey → moduleKey, then subtract DENY.
  const allow = new Map<string, string>();
  for (const ur of user.userRoles) {
    for (const rp of ur.role.rolePermissions) {
      allow.set(rp.permission.key, rp.permission.moduleKey);
    }
  }
  const deny = new Set<string>();
  for (const up of user.userPermissions) {
    if (up.effect === 'DENY') deny.add(up.permission.key);
    else allow.set(up.permission.key, up.permission.moduleKey);
  }
  for (const key of deny) allow.delete(key);

  const permissions = new Set(allow.keys());

  let modules: Set<string>;
  if (isSuperAdmin) {
    const active = await prisma.module.findMany({ where: { isActive: true }, select: { key: true } });
    modules = new Set(active.map((m) => m.key));
  } else {
    modules = new Set(allow.values());
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    isSuperAdmin,
    roles,
    permissions,
    modules,
    departmentId: user.departmentId,
    companyId: user.companyId,
  };
}
