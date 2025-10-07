ALTER TABLE "ttl_agent"."projects"
ADD COLUMN "before_start_shell_script" text DEFAULT 'pnpm install';
ALTER TABLE "ttl_agent"."projects"
ALTER COLUMN "before_start_shell_script" DROP DEFAULT;