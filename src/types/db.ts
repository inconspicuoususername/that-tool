import {
  oaiResponses,
  projects,
  tasks,
  subTasks,
  taskGithubInfo,
} from "@/lib/db/schema";
import { InferSelectModel } from "drizzle-orm";

// export const projectsSchema = createSelectSchema(projects);
// export const tasksSchema = createSelectSchema(tasks);
// export const taskGithubInfoSchema = createSelectSchema(taskGithubInfo);
// export const subTasksSchema = createSelectSchema(subTasks);
// export const oaiResponsesSchema = createSelectSchema(oaiResponses);

// export type ProjectRecord = z.infer<typeof projectsSchema>;
// export type TaskRecord = z.infer<typeof tasksSchema>;
// export type TaskGithubInfoRecord = z.infer<typeof taskGithubInfoSchema>;
// export type SubTaskRecord = z.infer<typeof subTasksSchema>;
// export type OAIResponseRecord = z.infer<typeof oaiResponsesSchema>;

export type ProjectRecord = InferSelectModel<typeof projects>;
export type TaskRecord = InferSelectModel<typeof tasks>;
export type TaskGithubInfoRecord = InferSelectModel<typeof taskGithubInfo>;
export type SubTaskRecord = InferSelectModel<typeof subTasks>;
export type OAIResponseRecord = InferSelectModel<typeof oaiResponses>;
