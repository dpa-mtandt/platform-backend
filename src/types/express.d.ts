import type { RequestAuditEntry } from '../utils/audit';

/** Augment Express Request with the fully-resolved authenticated principal. */
declare global {
  namespace Express {
    interface UserPrincipal {
      id: string;
      email: string;
      name: string;
      status: string;
      isSuperAdmin: boolean;
      roles: string[]; // role keys
      permissions: Set<string>; // effective permission keys
      modules: Set<string>; // accessible module keys
      departmentId: string | null;
      companyId: string | null;
    }
    interface Request {
      user?: UserPrincipal;
      /** Record an audit entry for this request (actor + IP + UA auto-filled). */
      audit?: (entry: RequestAuditEntry) => void;
    }
  }
}

export {};
