CREATE TABLE "ttl_agent"."oai_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" uuid,
	"response" jsonb NOT NULL,
	"oai_response_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ttl_agent"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"model_name" text NOT NULL,
	"prompt" text NOT NULL,
	"work_dir" text NOT NULL,
	"log_file" text NOT NULL,
	"current_oai_response_id" text,
	"webhook_url" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ttl_agent"."oai_responses" ADD CONSTRAINT "oai_responses_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE no action ON UPDATE no action;