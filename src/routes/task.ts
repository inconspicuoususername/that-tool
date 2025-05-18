import { startTaskSchema, getTaskSchema } from "@/types/api";
import { llmScheduler } from "@/llm/llm-scheduler";
import { Router, Request, Response, RequestHandler } from "express";

const startTask: RequestHandler = async (req, res) => {
  const validated = startTaskSchema.safeParse(req.body);

  if (!validated.success) {
    res.status(400).json({ error: validated.error.message });
    return;
  }

  const result = await llmScheduler.addTask(validated.data);
  res.json(result);
};

const getTaskStatus: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await llmScheduler.getTaskStatus(taskID.data);
  res.json(result);
};

const getTaskLogs: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await llmScheduler.getTaskLogs(taskID.data);
  res.json(result);
};

const getTask: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await llmScheduler.getTask(taskID.data);
  res.json(result);
};

const getTaskFiles: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await llmScheduler.getTaskFiles(taskID.data);
  if (!result.success || !result.files) {
    res.status(400).json({ error: result.error ?? "Failed to get task files" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.files.filename}"`
  );
  result.files.stream.pipe(res);

  result.files.stream.finalize();
};

const taskRouter = Router();

taskRouter.post("/start", startTask);
taskRouter.get("/:id/status", getTaskStatus);
taskRouter.get("/:id/logs", getTaskLogs);
taskRouter.get("/:id/files", getTaskFiles);
taskRouter.get("/:id", getTask);

export { taskRouter };
