import { Router, type RequestHandler } from "express";

import { serviceMesh } from "@/services/mesh";
import { createManualSubtaskRequestSchema } from "@/types/manual";

const createManualSubtask: RequestHandler = async (req, res) => {
  const validated = createManualSubtaskRequestSchema.safeParse(req.body);
  if (!validated.success) {
    res.status(400).json({ error: validated.error.message });
    return;
  }

  const result = await serviceMesh.taskService.createManualSubtask(
    validated.data,
  );
  
  res.json(result);
};

export const manualRouter = Router();
manualRouter.post("/subtask", createManualSubtask);
