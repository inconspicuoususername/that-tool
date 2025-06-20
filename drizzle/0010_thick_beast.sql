ALTER TABLE "ttl_agent"."oai_responses" DROP CONSTRAINT "oai_responses_sub_task_id_sub_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."sub_tasks" DROP CONSTRAINT "sub_tasks_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_github_info" DROP CONSTRAINT "task_github_info_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."oai_responses" ADD CONSTRAINT "oai_responses_sub_task_id_sub_tasks_id_fk" FOREIGN KEY ("sub_task_id") REFERENCES "ttl_agent"."sub_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ttl_agent"."sub_tasks" ADD CONSTRAINT "sub_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_github_info" ADD CONSTRAINT "task_github_info_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE cascade ON UPDATE no action;