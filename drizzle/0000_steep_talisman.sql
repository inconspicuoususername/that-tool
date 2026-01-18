CREATE SCHEMA IF NOT EXISTS "ttl_agent";

CREATE TABLE "ttl_agent"."oai_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"sub_task_id" integer,
	"response" jsonb NOT NULL,
	"oai_response_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ttl_agent"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ttl_agent"."sub_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"model_name" text NOT NULL,
	"prompt" text NOT NULL,
	"work_dir" text NOT NULL,
	"log_file" text NOT NULL,
	"current_oai_response_id" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ttl_agent"."task_github_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"private_access_token" text NOT NULL,
	"start_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"pull_request" jsonb
);
--> statement-breakpoint
CREATE TABLE "ttl_agent"."tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"initial_prompt" text NOT NULL,
	"current_prompt" text NOT NULL,
	"webhook_url" text,
	"current_sub_task_id" integer,
	"type" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"github_info_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ttl_agent"."oai_responses" ADD CONSTRAINT "oai_responses_sub_task_id_sub_tasks_id_fk" FOREIGN KEY ("sub_task_id") REFERENCES "ttl_agent"."sub_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ttl_agent"."sub_tasks" ADD CONSTRAINT "sub_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_github_info" ADD CONSTRAINT "task_github_info_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE no action ON UPDATE no action;