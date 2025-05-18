import { z } from "zod";

export const oaiResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  response: z.any(),
  oaiResponseId: z.string(),
  createdAt: z.string(),
});
export const taskSchema = z.object({
  id: z.string(),
  projectName: z.string(),
  modelName: z.string(),
  prompt: z.string(),
  workDir: z.string(),
  logFile: z.string(),
  currentOAIResponseId: z.string().nullable(),
  webhookURL: z.string().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TaskRecord = z.infer<typeof taskSchema>;
export type OAIResponseRecord = z.infer<typeof oaiResponseSchema>;
