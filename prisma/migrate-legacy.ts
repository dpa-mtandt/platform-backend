/**
 * Legacy data migration — merges the DISTINCT, valuable data from the three
 * original apps into the unified platform DB. Idempotent (safe to re-run):
 * de-dupes users by email, courses by slug, categories by slug, dashboards by
 * key, and relies on unique constraints for enrollments/certs/assignments.
 * Never overwrites existing platform (seed) records; only adds what's new.
 *
 * Run: node --experimental-sqlite node_modules/tsx/dist/cli.mjs prisma/migrate-legacy.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';

const prisma = new PrismaClient();
const { Pool } = pg;

const ETKP_URL = 'postgresql://postgres:Inter%401118@localhost:5432/mtandt_training_portal';
const FB_URL = 'postgresql://postgres:Inter%401118@localhost:5432/employee_feedback';
const DASH_DB = 'C:/Users/Abhijeet Pandey/Desktop/Dashboard/Mtandt Group/dashboard-portal/backend/prisma/dev.db';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// role mappings — migrated accounts never become platform super admins
const ETKP_ROLE: Record<string, string[]> = { SUPER_ADMIN: ['LMS_ADMIN'], TRAINING_ADMIN: ['LMS_ADMIN'], TRAINER: ['LMS_ADMIN'], DEPARTMENT_MANAGER: ['LMS_LEARNER'], EMPLOYEE: ['LMS_LEARNER'] };
const DASH_ROLE: Record<string, string[]> = { SUPER_ADMIN: ['DASHBOARD_ADMIN'], USER: ['DASHBOARD_VIEWER'] };
const FB_ROLE: Record<string, string[]> = { super_admin: ['FEEDBACK_MANAGER'], company_admin: ['FEEDBACK_MANAGER'], employee: ['FEEDBACK_USER'] };
const DASH_KEY_ALIAS: Record<string, string> = { 'fleet-management': 'fleet' };

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

async function main() {
  const etkp = new Pool({ connectionString: ETKP_URL });
  const fb = new Pool({ connectionString: FB_URL });
  const dash = new DatabaseSync(DASH_DB);

  const roles = await prisma.role.findMany({ select: { id: true, key: true } });
  const roleByKey = new Map(roles.map((r) => [r.key, r.id]));

  const emailMap = new Map<string, string>(); // email -> platform userId
  const created = new Set<string>();
  const existing = new Set<string>();

  async function ensureUser(rawEmail: string, name: string, hash: string, designation: string | null, roleKeys: string[]) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!email || !hash) return null;
    let u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) {
      u = await prisma.user.create({ data: { email, name: name || email, passwordHash: hash, designation: designation || null, status: 'ACTIVE' }, select: { id: true } });
      created.add(email);
      bump('users.created');
    } else if (!created.has(email) && !existing.has(email)) {
      existing.add(email);
      bump('users.existing(kept)');
    }
    emailMap.set(email, u.id);
    // assign roles only to users this migration created — never touch platform/seed users
    if (created.has(email)) {
      for (const key of roleKeys) {
        const roleId = roleByKey.get(key);
        if (roleId) await prisma.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId } }, update: {}, create: { userId: u.id, roleId } });
      }
    }
    return u.id;
  }

  // ── 1. USERS (all three sources) ────────────────────────────────────────────
  console.log('› Users…');
  const etkpUsers = (await etkp.query('SELECT id, email, name, "passwordHash", role, designation FROM users')).rows as any[];
  const etkpUserById = new Map<string, any>();
  for (const u of etkpUsers) {
    etkpUserById.set(u.id, u);
    await ensureUser(u.email, u.name, u.passwordHash, u.designation, ETKP_ROLE[u.role] ?? ['LMS_LEARNER']);
  }
  const fbUsers = (await fb.query('SELECT email, name, password, role, designation FROM users')).rows as any[];
  for (const u of fbUsers) await ensureUser(u.email, u.name, u.password, u.designation, FB_ROLE[u.role] ?? ['FEEDBACK_USER']);
  const dashUsers = dash.prepare('SELECT email, name, "passwordHash", role FROM users').all() as any[];
  const dashUserEmailById = new Map<string, string>();
  for (const u of dash.prepare('SELECT id, email FROM users').all() as any[]) dashUserEmailById.set(u.id, u.email);
  for (const u of dashUsers) await ensureUser(u.email, u.name, u.passwordHash, null, DASH_ROLE[u.role] ?? ['DASHBOARD_VIEWER']);

  const userIdFor = (etkpUserId: string | null) => {
    if (!etkpUserId) return null;
    const src = etkpUserById.get(etkpUserId);
    return src ? emailMap.get((src.email || '').toLowerCase()) ?? null : null;
  };

  // ── 2. LMS CATEGORIES (ETKP) ────────────────────────────────────────────────
  console.log('› LMS categories…');
  const catMap = new Map<string, string>(); // etkp categoryId -> platform categoryId
  for (const c of (await etkp.query('SELECT id, name, slug, description FROM categories')).rows as any[]) {
    const slug = c.slug || slugify(c.name);
    let cat = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (!cat) {
      cat = await prisma.category.create({ data: { name: c.name, slug, description: c.description ?? null }, select: { id: true } });
      bump('categories.created');
    } else bump('categories.existing');
    catMap.set(c.id, cat.id);
  }

  // ── 3. LMS COURSES + content (ETKP) ─────────────────────────────────────────
  console.log('› LMS courses…');
  const courseMap = new Map<string, string>(); // etkp courseId -> platform courseId
  for (const c of (await etkp.query('SELECT * FROM courses')).rows as any[]) {
    let existingCourse = await prisma.course.findUnique({ where: { slug: c.slug }, select: { id: true } });
    if (existingCourse) {
      courseMap.set(c.id, existingCourse.id);
      bump('courses.existing(kept)');
      continue;
    }
    const created = await prisma.course.create({
      data: {
        title: c.title,
        slug: c.slug,
        description: c.description ?? null,
        summary: c.summary ?? null,
        thumbnailUrl: c.thumbnailUrl ?? null,
        difficulty: c.difficulty,
        estimatedMinutes: c.estimatedMinutes ?? 0,
        status: c.status,
        isFeatured: c.isFeatured ?? false,
        publishedAt: c.publishedAt ?? null,
        ...(c.categoryId && catMap.get(c.categoryId) ? { category: { connect: { id: catMap.get(c.categoryId) } } } : {}),
        ...(userIdFor(c.createdById) ? { createdBy: { connect: { id: userIdFor(c.createdById)! } } } : {}),
      },
      select: { id: true },
    });
    courseMap.set(c.id, created.id);
    bump('courses.created');

    // sections + lessons (+ video) for this new course
    const sections = (await etkp.query('SELECT * FROM sections WHERE "courseId"=$1 ORDER BY "orderIndex"', [c.id])).rows as any[];
    for (const s of sections) {
      const ns = await prisma.section.create({ data: { courseId: created.id, title: s.title, description: s.description ?? null, orderIndex: s.orderIndex ?? 0 }, select: { id: true } });
      bump('sections.created');
      const lessons = (await etkp.query('SELECT * FROM lessons WHERE "sectionId"=$1 ORDER BY "orderIndex"', [s.id])).rows as any[];
      for (const l of lessons) {
        const video = (await etkp.query('SELECT * FROM videos WHERE "lessonId"=$1', [l.id])).rows[0] as any;
        await prisma.lesson.create({
          data: {
            sectionId: ns.id,
            title: l.title,
            type: l.type,
            content: l.content ?? null,
            notes: l.notes ?? null,
            orderIndex: l.orderIndex ?? 0,
            estimatedMinutes: l.estimatedMinutes ?? 0,
            isPreview: l.isPreview ?? false,
            ...(video && video.url ? { video: { create: { title: video.title || l.title, url: video.url, thumbnailUrl: video.thumbnailUrl ?? null, duration: video.duration ?? 0, provider: video.provider ?? null } } } : {}),
          },
        });
        bump('lessons.created');
      }
    }

    // quizzes + questions + options for this new course
    const quizzes = (await etkp.query('SELECT * FROM quizzes WHERE "courseId"=$1', [c.id])).rows as any[];
    for (const q of quizzes) {
      const nq = await prisma.quiz.create({
        data: {
          title: q.title,
          description: q.description ?? null,
          passPercentage: q.passPercentage ?? 70,
          durationMinutes: q.durationMinutes ?? null,
          randomize: q.randomize ?? false,
          maxAttempts: q.maxAttempts ?? null,
          showAnswers: q.showAnswers ?? true,
          isPublished: q.isPublished ?? false,
          course: { connect: { id: created.id } },
          ...(userIdFor(q.createdById) ? { createdBy: { connect: { id: userIdFor(q.createdById)! } } } : {}),
        },
        select: { id: true },
      });
      bump('quizzes.created');
      const questions = (await etkp.query('SELECT * FROM questions WHERE "quizId"=$1 ORDER BY "orderIndex"', [q.id])).rows as any[];
      for (const qn of questions) {
        const opts = (await etkp.query('SELECT * FROM question_options WHERE "questionId"=$1 ORDER BY "orderIndex"', [qn.id])).rows as any[];
        await prisma.question.create({
          data: {
            quizId: nq.id,
            type: qn.type,
            text: qn.text,
            explanation: qn.explanation ?? null,
            points: qn.points ?? 1,
            orderIndex: qn.orderIndex ?? 0,
            options: { create: opts.map((o) => ({ text: o.text, isCorrect: o.isCorrect ?? false, orderIndex: o.orderIndex ?? 0 })) },
          },
        });
        bump('questions.created');
      }
    }
  }

  // ── 4. ENROLLMENTS (ETKP) ───────────────────────────────────────────────────
  console.log('› Enrollments…');
  for (const e of (await etkp.query('SELECT * FROM enrollments')).rows as any[]) {
    const userId = userIdFor(e.userId);
    const courseId = courseMap.get(e.courseId);
    if (!userId || !courseId) { bump('enrollments.skipped'); continue; }
    try {
      await prisma.enrollment.upsert({
        where: { userId_courseId: { userId, courseId } },
        update: {},
        create: { userId, courseId, status: e.status, progressPercent: e.progressPercent ?? 0, assignedAt: e.assignedAt ?? new Date(), startedAt: e.startedAt ?? null, completedAt: e.completedAt ?? null, lastAccessedAt: e.lastAccessedAt ?? null, dueDate: e.dueDate ?? null },
      });
      bump('enrollments.migrated');
    } catch { bump('enrollments.skipped'); }
  }

  // ── 5. CERTIFICATES (ETKP) — the valuable earned artifacts ──────────────────
  console.log('› Certificates…');
  for (const c of (await etkp.query('SELECT * FROM certificates')).rows as any[]) {
    const userId = userIdFor(c.userId);
    const courseId = courseMap.get(c.courseId);
    if (!userId || !courseId) { bump('certificates.skipped'); continue; }
    const [dupByPair, dupByNo] = await Promise.all([
      prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } }),
      prisma.certificate.findUnique({ where: { certificateNo: c.certificateNo }, select: { id: true } }),
    ]);
    if (dupByPair || dupByNo) { bump('certificates.duplicate'); continue; }
    try {
      await prisma.certificate.create({ data: { certificateNo: c.certificateNo, userId, courseId, completionDate: c.completionDate ?? new Date(), issuedAt: c.issuedAt ?? new Date(), qrData: c.qrData ?? null } });
      bump('certificates.migrated');
    } catch { bump('certificates.duplicate'); }
  }

  // ── 6. DASHBOARDS (dashboard-portal) ────────────────────────────────────────
  console.log('› Dashboards…');
  const dashMap = new Map<string, string>(); // dev.db dashboardId -> platform dashboardId
  let sort = 10;
  for (const d of dash.prepare('SELECT * FROM dashboards').all() as any[]) {
    let key = slugify(String(d.name).replace(/dashboard/i, '').trim());
    key = DASH_KEY_ALIAS[key] ?? key;
    let pd = await prisma.dashboard.findUnique({ where: { key }, select: { id: true } });
    if (!pd) {
      pd = await prisma.dashboard.create({
        data: {
          key,
          name: d.name,
          description: d.description ?? null,
          category: d.category ?? null,
          secureEmbedUrl: d.secureEmbedUrl ?? null,
          workspaceId: d.workspaceId ?? null,
          reportId: d.reportId ?? null,
          datasetId: d.datasetId ?? null,
          embedUrl: d.embedUrl ?? null,
          isActive: !!d.active,
          allowExport: !!d.allowExport,
          sortOrder: sort++,
        },
        select: { id: true },
      });
      bump('dashboards.created');
    } else bump('dashboards.existing(kept)');
    dashMap.set(d.id, pd.id);
  }

  // ── 7. DASHBOARD ASSIGNMENTS (user_dashboards) ──────────────────────────────
  console.log('› Dashboard access…');
  for (const ud of dash.prepare('SELECT * FROM user_dashboards').all() as any[]) {
    const email = (dashUserEmailById.get(ud.userId) || '').toLowerCase();
    const userId = emailMap.get(email);
    const dashboardId = dashMap.get(ud.dashboardId);
    if (!userId || !dashboardId) { bump('access.skipped'); continue; }
    try {
      await prisma.dashboardAccess.upsert({ where: { userId_dashboardId: { userId, dashboardId } }, update: {}, create: { userId, dashboardId } });
      bump('access.migrated');
    } catch { bump('access.skipped'); }
  }

  // ── 8. FEEDBACK — source has 0 records; nothing to migrate ──────────────────
  const fbCount = Number((await fb.query('SELECT count(*)::int AS c FROM feedback')).rows[0].c);
  bump('feedback.records(source)', fbCount);

  await etkp.end();
  await fb.end();

  console.log('\n✅ Migration complete. Summary:');
  for (const [k, v] of Object.entries(stats).sort()) console.log(`   ${k}: ${v}`);
}

main()
  .catch((e) => { console.error('❌ Migration failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
