import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/apiError';
import { usersService } from './users.service';
import { createUserSchema } from './users.validation';

/** Column headers of the import sheet, in order. Header matching is case-insensitive. */
const COLUMNS = ['Name', 'Email', 'Password', 'Employee ID', 'Designation', 'Phone', 'Department', 'Company', 'Roles', 'Status'] as const;
const SAMPLE_EMAIL = 'sample.person@example.com'; // the template's example row — skipped on import

interface Actor {
  id: string;
  isSuperAdmin: boolean;
  permissions: string[];
}

// ── Template ─────────────────────────────────────────────────────────────────

/** Build the .xlsx import template: a Users sheet to fill + a Reference sheet of valid values. */
export async function buildImportTemplate(): Promise<Buffer> {
  const [roles, departments, companies] = await Promise.all([
    prisma.role.findMany({ orderBy: { name: 'asc' }, select: { name: true, key: true } }),
    prisma.department.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
    prisma.company.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MTANDT Enterprise Platform';

  const ws = wb.addWorksheet('Users');
  const header = ws.addRow(COLUMNS as unknown as string[]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAE300' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });

  const example = ws.addRow(['Asha Verma', SAMPLE_EMAIL, '', 'EMP1001', 'Site Engineer', '9876543210', departments[0]?.name ?? 'Operations', companies[0]?.name ?? 'MTANDT Pvt Ltd', 'Learner, Feedback Contributor', 'ACTIVE']);
  example.font = { italic: true, color: { argb: 'FF94A3B8' } };

  COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(14, c.length + 4)));
  ws.getColumn(2).width = 30;
  ws.getColumn(9).width = 34;

  // Instructions live as a cell comment (not a data row, so they aren't parsed on import).
  ws.getCell('A1').note =
    'Fill one row per user below. Name + Email are required. Leave Password blank to auto-generate a temporary one (shown after import). ' +
    'Roles = comma-separated names or keys (see the Reference tab). Department/Company must already exist. ' +
    'Status = ACTIVE / INACTIVE / SUSPENDED. Delete the grey sample row before importing.';

  const ref = wb.addWorksheet('Reference');
  ref.addRow(['How to fill the Users sheet']).font = { bold: true, size: 12 };
  ref.addRow(['• Name + Email are required. Leave Password blank and a temporary one is generated and shown after import.']);
  ref.addRow(['• Roles: comma-separated, using the names or keys listed below (e.g. "Learner, Feedback Contributor").']);
  ref.addRow(['• Department / Company must already exist — create them under Admin → Organization first.']);
  ref.addRow(['• Delete the grey sample row in the Users tab before importing.']);
  ref.addRow([]);
  ref.addRow(['Valid Roles', 'Departments', 'Companies', 'Statuses']).font = { bold: true };
  const statuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
  const maxLen = Math.max(roles.length, departments.length, companies.length, statuses.length);
  for (let i = 0; i < maxLen; i++) {
    ref.addRow([roles[i]?.name ?? '', departments[i]?.name ?? '', companies[i]?.name ?? '', statuses[i] ?? '']);
  }
  ref.columns.forEach((c) => (c.width = 28));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Import ───────────────────────────────────────────────────────────────────

export interface ImportRowResult {
  row: number;
  name: string;
  email: string;
  status: 'created' | 'error';
  message?: string;
  /** Present only when we auto-generated the password, so the admin can share it. */
  password?: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  failed: number;
  results: ImportRowResult[];
}

/** A password that satisfies the strong-password rules (upper + lower + digit, ≥8). */
function generatePassword(): string {
  return `Mt${randomBytes(4).toString('hex')}A7`;
}

/** Robustly read a cell as trimmed text (handles rich text, hyperlinks, formulas). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('text' in o) return String(o.text ?? '').trim();
    if ('result' in o) return String(o.result ?? '').trim();
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('').trim();
    if ('hyperlink' in o) return String(o.hyperlink ?? '').trim();
  }
  return String(v).trim();
}

export async function importUsersFromXlsx(buffer: Buffer, actor: Actor): Promise<ImportSummary> {
  const wb = new ExcelJS.Workbook();
  try {
    // `as never` bridges a Buffer generic skew between @types/node and exceljs.
    await wb.xlsx.load(buffer as never);
  } catch {
    throw ApiError.badRequest('Could not read the file — please upload the .xlsx template.');
  }
  const ws = wb.getWorksheet('Users') ?? wb.worksheets[0];
  if (!ws) throw ApiError.badRequest('The workbook has no sheet to import.');

  // Map header label → column index (case-insensitive, order-independent).
  const colOf: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = cellText(cell.value).toLowerCase();
    if (key) colOf[key] = col;
  });
  if (!colOf['name'] || !colOf['email']) {
    throw ApiError.badRequest('The sheet must have at least "Name" and "Email" columns (use the template).');
  }
  const field = (row: ExcelJS.Row, name: string): string => {
    const col = colOf[name.toLowerCase()];
    return col ? cellText(row.getCell(col).value) : '';
  };

  const [roles, departments, companies] = await Promise.all([
    prisma.role.findMany({ select: { id: true, name: true, key: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.company.findMany({ select: { id: true, name: true } }),
  ]);
  const roleId = new Map<string, string>();
  roles.forEach((r) => {
    roleId.set(r.name.toLowerCase(), r.id);
    roleId.set(r.key.toLowerCase(), r.id);
  });
  const deptId = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const compId = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]));

  const results: ImportRowResult[] = [];
  const seen = new Set<string>();
  let created = 0;
  let failed = 0;
  let total = 0;

  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const name = field(row, 'Name');
    const email = field(row, 'Email').toLowerCase();
    if (!name && !email) continue; // blank row
    if (email === SAMPLE_EMAIL) continue; // the untouched example row

    total++;
    const record = (status: ImportRowResult['status'], message?: string, password?: string) => {
      results.push({ row: rn, name, email, status, message, password });
      if (status === 'created') created++;
      else failed++;
    };

    try {
      if (!name || name.length < 2) { record('error', 'Name is required (min 2 characters)'); continue; }
      if (!email) { record('error', 'Email is required'); continue; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { record('error', `Invalid email "${email}"`); continue; }
      if (seen.has(email)) { record('error', 'Duplicate email within the file'); continue; }

      const roleIds: string[] = [];
      const rolesRaw = field(row, 'Roles');
      if (rolesRaw) {
        for (const r of rolesRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
          const id = roleId.get(r.toLowerCase());
          if (!id) throw new Error(`Unknown role "${r}"`);
          roleIds.push(id);
        }
      }

      let departmentId: string | undefined;
      const deptRaw = field(row, 'Department');
      if (deptRaw) {
        const id = deptId.get(deptRaw.toLowerCase());
        if (!id) throw new Error(`Unknown department "${deptRaw}" (create it first)`);
        departmentId = id;
      }

      let companyId: string | undefined;
      const compRaw = field(row, 'Company');
      if (compRaw) {
        const id = compId.get(compRaw.toLowerCase());
        if (!id) throw new Error(`Unknown company "${compRaw}" (create it first)`);
        companyId = id;
      }

      const statusRaw = field(row, 'Status').toUpperCase();
      const status = (['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const).find((s) => s === statusRaw) ?? 'ACTIVE';

      let password = field(row, 'Password');
      const generated = !password;
      if (generated) password = generatePassword();

      const parsed = createUserSchema.safeParse({
        name,
        email,
        password,
        employeeId: field(row, 'Employee ID') || null,
        designation: field(row, 'Designation') || null,
        phone: field(row, 'Phone') || null,
        status,
        departmentId,
        companyId,
        roleIds,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid data');

      const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (exists) {
        seen.add(email);
        record('error', 'A user with this email already exists');
        continue;
      }

      await usersService.create(parsed.data, actor);
      seen.add(email);
      record('created', undefined, generated ? password : undefined);
    } catch (err) {
      record('error', err instanceof Error ? err.message : 'Failed to create user');
    }
  }

  return { total, created, failed, results };
}
