import { z } from "zod";

export const createManualSubtaskRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new_task"),
    projectId: z.string().uuid(),
    linkedIssueNumber: z.number().optional(),
    prompt: z.string().min(1),
  }),
  z.object({
    mode: z.literal("existing_task"),
    taskId: z.coerce.number().int().positive(),
    prompt: z.string().min(1),
  }),
]);

export type CreateManualSubtaskRequest = z.infer<typeof createManualSubtaskRequestSchema>;
