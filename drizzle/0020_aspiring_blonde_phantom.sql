CREATE TABLE "ttl_agent"."pull_request_states" (
	"task_id" integer PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects" ALTER COLUMN "before_start_shell_script" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ttl_agent"."pull_request_states" ADD CONSTRAINT "pull_request_states_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE cascade ON UPDATE no action;