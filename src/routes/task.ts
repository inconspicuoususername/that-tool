import {
  startTaskRequestSchema,
  getTaskSchema,
  beginEpicRequestSchema,
  updateProjectRequestSchema,
} from "@/types/api";
import { Router, Request, Response, RequestHandler } from "express";
import { serviceMesh } from "@/llm/mesh";
import { GithubInstallationError } from "@/lib/github";

const startTask: RequestHandler = async (req, res) => {
  req.body;
  const validated = startTaskRequestSchema.safeParse(req.body);

  if (!validated.success) {
    res.status(400).json({ error: validated.error.message });
    return;
  }

  try {
    const result = await serviceMesh.taskService.addTask(validated.data);
    res.json(result);
  } catch (error) {
    if (error instanceof GithubInstallationError) {
      console.info(error);
      res.status(400).json({ error: error.message });
    } else if (error instanceof Error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    } else {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
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

const beginEpic: RequestHandler = async (req, res) => {
  const epicID = beginEpicRequestSchema.safeParse(req.body);

  if (!epicID.success) {
    res.status(400).json({ error: epicID.error.message });
    return;
  }

  try {
    const result = await serviceMesh.issueService.completeEpic(epicID.data);
    res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
};

const updateProject: RequestHandler = async (req, res) => {
  const body = updateProjectRequestSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const result = await serviceMesh.taskService.updateProject(body.data);
    res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
};

const taskRouter = Router();

taskRouter.post("/start", startTask);
taskRouter.get("/:id/status", getTaskStatus);
taskRouter.get("/:id/logs", getTaskLogs);
taskRouter.get("/:id/files", getTaskFiles);
taskRouter.get("/:id", getTask);
taskRouter.post("/begin-epic", beginEpic);
taskRouter.post("/update-project", updateProject);

export { taskRouter };
