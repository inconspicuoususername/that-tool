import {
  startTaskRequestSchema,
  getTaskSchema,
  beginEpicRequestSchema,
  updateProjectRequestSchema,
  getProjectIdSchema,
  paginationQuerySchema,
  tailLogsQuerySchema,
} from "@/types/api";
import { z } from "zod";
import { Router, RequestHandler } from "express";
import { serviceMesh } from "@/services/mesh";
import { GithubInstallationError } from "@/lib/github";
import { db } from "@/lib/db";
import { subTasks, tasks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const streamTaskLogs: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);
  const query = tailLogsQuerySchema.safeParse(req.query);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const subtaskId = query.data.subtaskId;

  const sendLogs = async () => {
    const result = await serviceMesh.taskService.tailTaskLogs(
      taskID.data,
      subtaskId,
    );
    res.write(`data: ${JSON.stringify(result)}\n\n`);
  };

  const interval = setInterval(() => {
    sendLogs().catch(() => {
      res.write(
        `data: ${JSON.stringify({ success: false, error: "Log stream unavailable" })}\n\n`,
      );
    });
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });

  await sendLogs();
};

const listProjects: RequestHandler = async (req, res) => {
  const query = paginationQuerySchema.safeParse(req.query);

  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, offset } = query.data;
  const result = await serviceMesh.taskService.listProjects(limit, offset);
  res.json(result);
};

const listProjectTasks: RequestHandler = async (req, res) => {
  const projectId = getProjectIdSchema.safeParse(req.params.projectId);
  const query = paginationQuerySchema.safeParse(req.query);

  if (!projectId.success) {
    res.status(400).json({ error: projectId.error.message });
    return;
  }

  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, offset } = query.data;
  const result = await serviceMesh.taskService.listProjectTasks(
    projectId.data,
    limit,
    offset,
  );
  res.json(result);
};

const listProjectSubtasks: RequestHandler = async (req, res) => {
  const projectId = getProjectIdSchema.safeParse(req.params.projectId);
  const query = paginationQuerySchema.safeParse(req.query);

  if (!projectId.success) {
    res.status(400).json({ error: projectId.error.message });
    return;
  }

  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, offset } = query.data;
  const result = await serviceMesh.taskService.listProjectSubtasks(
    projectId.data,
    limit,
    offset,
  );
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
  const query = tailLogsQuerySchema.safeParse(req.query);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const result = await serviceMesh.taskService.getSubTaskLogs(
    taskID.data,
    query.data.subtaskId,
  );
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

const tailTaskLogs: RequestHandler = async (req, res) => {
  const taskID = getTaskSchema.safeParse(req.params.id);
  const query = tailLogsQuerySchema.safeParse(req.query);

  if (!taskID.success) {
    res.status(400).json({ error: taskID.error.message });
    return;
  }

  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const result = await serviceMesh.taskService.tailTaskLogs(
    taskID.data,
    query.data.subtaskId,
  );
  res.json(result);
};

const streamTaskEvents: RequestHandler = async (req, res) => {
  const projectIdRaw = req.query.projectId;
  if (typeof projectIdRaw !== "string" || !projectIdRaw.trim()) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  const projectId = projectIdRaw.trim();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: unknown, event?: string) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const initial = async () => {
    const [tasksRows, subtasksRows] = await Promise.all([
      db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId)),
      db
        .select({ subtask: subTasks })
        .from(subTasks)
        .innerJoin(tasks, eq(subTasks.taskId, tasks.id))
        .where(eq(tasks.projectId, projectId)),
    ]);

    send(
      {
        tasks: tasksRows.map((t) => ({ id: t.id, status: t.status, type: t.type })),
        subtasks: subtasksRows.map((s) => ({
          id: s.subtask.id,
          taskId: s.subtask.taskId,
          status: s.subtask.status,
        })),
      },
      "snapshot",
    );

    return {
      tasks: new Map(tasksRows.map((t) => [t.id, t.status])),
      subtasks: new Map(
        subtasksRows.map((s) => [s.subtask.id, `${s.subtask.status}:${s.subtask.taskId}`]),
      ),
    };
  };

  let last = await initial();

  const interval = setInterval(async () => {
    try {
      const [tasksRows, subtasksRows] = await Promise.all([
        db
          .select({ id: tasks.id, status: tasks.status, type: tasks.type })
          .from(tasks)
          .where(eq(tasks.projectId, projectId)),
        db
          .select({ id: subTasks.id, status: subTasks.status, taskId: subTasks.taskId })
          .from(subTasks)
          .innerJoin(tasks, eq(subTasks.taskId, tasks.id))
          .where(eq(tasks.projectId, projectId)),
      ]);

      for (const task of tasksRows) {
        const prev = last.tasks.get(task.id);
        if (prev !== task.status) {
          send(task, "task");
          last.tasks.set(task.id, task.status);
        }
      }

      for (const subtask of subtasksRows) {
        const key = `${subtask.status}:${subtask.taskId}`;
        const prev = last.subtasks.get(subtask.id);
        if (prev !== key) {
          send(subtask, "subtask");
          last.subtasks.set(subtask.id, key);
        }
      }

      // heartbeat
      res.write(": ok\n\n");
    } catch (e) {
      send(
        { success: false, error: e instanceof Error ? e.message : "SSE error" },
        "error",
      );
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
};

const stopTaskSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

const stopTaskHandler: RequestHandler = async (req, res) => {
  const body = stopTaskSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await serviceMesh.taskService.stopTask(body.data.taskId);
  res.json(result);
};

const deleteTaskSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

const deleteTaskHandler: RequestHandler = async (req, res) => {
  const body = deleteTaskSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await serviceMesh.taskService.deleteTask(body.data.taskId);
  res.json(result);
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

taskRouter.get("/projects", listProjects);
taskRouter.get("/projects/:projectId/tasks", listProjectTasks);
taskRouter.get("/projects/:projectId/subtasks", listProjectSubtasks);
// taskRouter.post("/start", startTask);
taskRouter.get("/events/stream", streamTaskEvents);
taskRouter.get("/:id/status", getTaskStatus);
taskRouter.get("/:id/logs/stream", streamTaskLogs);
taskRouter.get("/:id/logs/tail", tailTaskLogs);
taskRouter.get("/:id/logs", getTaskLogs);
taskRouter.get("/:id/files", getTaskFiles);
taskRouter.get("/:id", getTask);
taskRouter.post("/stop", stopTaskHandler);
taskRouter.post("/delete", deleteTaskHandler);
taskRouter.post("/begin-epic", beginEpic);
taskRouter.post("/update-project", updateProject);

export { taskRouter };
