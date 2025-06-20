import { z } from "zod";

export const createProjectSchema = z.object({
  projectName: z.string(),
});

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

export const baseStartTaskSchema = z.object({
  type: z.enum(["github", "local"]),
  prompt: z.string(),
  notifyURL: z.string().url().optional(),
  taskDependencies: z.array(z.number()).optional(),
});

export const localStartTaskSchema = baseStartTaskSchema.extend({
  type: z.literal("local"),
  projectName: z.string(),
});

export const githubStartTaskSchema = baseStartTaskSchema.extend({
  type: z.literal("github"),
  owner: z.string(),
  repo: z.string(),
  startBranch: z.string(),
  targetBranch: z.string(),
  linkedIssueNumber: z.number().optional(),
});

export const startTaskRequestSchema = z.discriminatedUnion("type", [
  localStartTaskSchema,
  githubStartTaskSchema,
]);

export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;

export type LocalStartTaskRequest = z.infer<typeof localStartTaskSchema>;

export type GithubStartTaskRequest = z.infer<typeof githubStartTaskSchema>;

export const startTaskResponseSchema = z.object({
  taskID: z.string(),
});

export type StartTaskResponse = z.infer<typeof startTaskResponseSchema>;

export const getTaskSchema = z.string().uuid();

export type GetTaskRequest = z.infer<typeof getTaskSchema>;

export const getTaskLogsResponseSchema = z.object({
  logs: z.string(),
});

export type GetTaskLogsResponse = z.infer<typeof getTaskLogsResponseSchema>;

export const beginEpicRequestSchema = z.object({
  issueId: z.number(),
  repo: z.string(),
  owner: z.string(),
  baseBranch: z.string().optional(),
});

export type BeginEpicRequest = z.infer<typeof beginEpicRequestSchema>;

export const updateProjectRequestSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  projectName: z.string().optional(),
  defaultBaseBranch: z.string().optional(),
  defaultModel: z.string().optional(),
  projectSpecification: z.string().optional(),
});

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
