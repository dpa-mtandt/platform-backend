-- Display name only: LMS module key stays "LMS" for permissions/routes.
UPDATE "modules"
SET "name" = 'Training',
    "description" = COALESCE("description", 'Courses, quizzes and certificates'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'LMS'
  AND ("name" ILIKE '%learning%' OR "name" = 'LMS');
