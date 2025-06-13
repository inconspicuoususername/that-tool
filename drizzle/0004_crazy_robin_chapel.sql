ALTER TABLE "ttl_agent"."sub_tasks" ADD COLUMN "help_query" text;--> statement-breakpoint
ALTER TABLE "ttl_agent"."sub_tasks" ADD COLUMN "previous_sub_task_id" integer;