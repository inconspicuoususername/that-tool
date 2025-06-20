ALTER TABLE "ttl_agent"."task_github_info"
ALTER COLUMN "task_id"
SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects"
ADD COLUMN "repo" text;
--> statement-breakpoint
UPDATE "ttl_agent"."projects"
SET "repo" = "ttl_agent"."task_github_info"."repo"
FROM "ttl_agent"."task_github_info"
    JOIN "ttl_agent"."tasks" ON "ttl_agent"."tasks"."id" = "ttl_agent"."task_github_info"."task_id"
WHERE "ttl_agent"."projects"."id" = "ttl_agent"."tasks"."project_id";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects"
ALTER COLUMN "repo"
SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects"
ADD COLUMN "owner" text;
--> statement-breakpoint
UPDATE "ttl_agent"."projects"
SET "owner" = "ttl_agent"."task_github_info"."owner"
FROM "ttl_agent"."task_github_info"
    JOIN "ttl_agent"."tasks" ON "ttl_agent"."tasks"."id" = "ttl_agent"."task_github_info"."task_id"
WHERE "ttl_agent"."projects"."id" = "ttl_agent"."tasks"."project_id";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects"
ALTER COLUMN "owner"
SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_github_info" DROP COLUMN "owner";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_github_info" DROP COLUMN "repo";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."tasks" DROP COLUMN "github_info_id";