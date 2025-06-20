ALTER TABLE "ttl_agent"."projects"
ALTER COLUMN "default_base_branch"
SET DEFAULT 'main';
--> statement-breakpoint
UPDATE "ttl_agent"."projects"
SET "default_base_branch" = 'main'
WHERE "default_base_branch" IS NULL;
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects"
ALTER COLUMN "default_base_branch"
SET NOT NULL;