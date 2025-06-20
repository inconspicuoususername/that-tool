ALTER TABLE "ttl_agent"."task_dependencies" DROP CONSTRAINT "task_dependencies_dependency_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "ttl_agent"."task_dependencies" ADD CONSTRAINT "task_dependencies_dependency_task_id_tasks_id_fk" FOREIGN KEY ("dependency_task_id") REFERENCES "ttl_agent"."tasks"("id") ON DELETE cascade ON UPDATE no action;