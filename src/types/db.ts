import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
  oaiResponses,
  projects,
  tasks,
  subTasks,
  taskGithubInfo,
} from "@/lib/db/schema";

export const projectsSchema = createSelectSchema(projects);
export const tasksSchema = createSelectSchema(tasks);
export const taskGithubInfoSchema = createSelectSchema(taskGithubInfo).extend({
  pullRequest: z
    .object({
      id: z.number(),
      number: z.number(),
      state: z.string(),
      title: z.string(),
      body: z.string().nullable(),
      url: z.string(),
    })
    .nullable(),
});
export const subTasksSchema = createSelectSchema(subTasks).extend({
  output: z.union([
    z.object({
      type: z.literal("help_request"),
      query: z.string(),
    }),
    z.object({
      type: z.literal("tool_result"),
      toolName: z.string(),
      result: z.any(),
    }),
  ]),
});
export const oaiResponsesSchema = createSelectSchema(oaiResponses);

export type ProjectRecord = z.infer<typeof projectsSchema>;
export type TaskRecord = z.infer<typeof tasksSchema>;
export type TaskGithubInfoRecord = z.infer<typeof taskGithubInfoSchema>;
export type SubTaskRecord = z.infer<typeof subTasksSchema>;
export type OAIResponseRecord = z.infer<typeof oaiResponsesSchema>;
