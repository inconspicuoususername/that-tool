import { startTaskRequestSchema, getTaskSchema } from "@/types/api";
import { Router, Request, Response, RequestHandler } from "express";
import { newServiceMesh } from "@/llm/mesh";
import { PROJECTS_ROOT_DIR, LOG_DIR } from "@/lib/env";

const serviceMesh = newServiceMesh(PROJECTS_ROOT_DIR, LOG_DIR);

const startTask: RequestHandler = async (req, res) => {
  const validated = startTaskRequestSchema.safeParse(req.body);

  if (!validated.success) {
    res.status(400).json({ error: validated.error.message });
    return;
  }

  const result = await serviceMesh.taskService.addTask(validated.data);
  res.json(result);
};

const getTaskStatus: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await serviceMesh.taskService.getCurrentSubTaskStatus(
    taskID.data
  );
  res.json(result);
};

const getTaskLogs: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await serviceMesh.taskService.getSubTaskLogs(taskID.data);
  res.json(result);
};

const getTask: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await serviceMesh.taskService.getTask(taskID.data);
  res.json(result);
};

const getTaskFiles: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  const result = await serviceMesh.taskService.getSubTaskFiles(taskID.data);
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
