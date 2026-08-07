-- External apps (CRM / ERP / HCM): a module can point at an external URL that
-- opens in a new tab instead of an in-app route. Super admins set the URL; the
-- CRM/ERP/HCM module rows themselves are ensured idempotently on server boot.
ALTER TABLE "modules" ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "modules" ADD COLUMN "externalUrl" TEXT;
