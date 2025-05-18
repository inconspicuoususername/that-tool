import { z } from "zod";

export const startTaskSchema = z.object({
  openaiModel: z.string(),
  projectName: z.string(),
  prompt: z.string(),
  notifyURL: z.string().url().optional(),
});

export type StartTaskRequest = z.infer<typeof startTaskSchema>;

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
