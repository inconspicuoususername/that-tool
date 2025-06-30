CREATE TABLE "ttl_agent"."memories" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"content" text NOT NULL,
	"file_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects" ALTER COLUMN "default_model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects" ADD COLUMN "should_have_memories" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ttl_agent"."projects" ADD COLUMN "memory_vector_store_id" text;--> statement-breakpoint
ALTER TABLE "ttl_agent"."memories" ADD CONSTRAINT "memories_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE cascade ON UPDATE no action;