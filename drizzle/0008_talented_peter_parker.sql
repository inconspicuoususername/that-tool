CREATE TABLE "ttl_agent"."task_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"dependency_task_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects" ADD COLUMN "project_specification" text;--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects" ADD COLUMN "default_base_branch" text;--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_dependencies" ADD CONSTRAINT "task_dependencies_dependency_task_id_tasks_id_fk" FOREIGN KEY ("dependency_task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ttl_agent"."sub_tasks" DROP COLUMN "work_dir";--> statement-breakpoint
ALTER TABLE "ttl_agent"."sub_tasks" DROP COLUMN "log_file";