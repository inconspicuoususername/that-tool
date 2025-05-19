import { TaskRecord } from "@/types/db";
import { db } from "@/lib/db";
import { oaiResponses, tasks } from "@/lib/db/schema";
import { StartTaskRequest } from "@/types/api";
import path from "path";
import fs from "fs/promises";
import { executeTask } from "./prompt";
import { eq } from "drizzle-orm";
import { PROJECTS_ROOT_DIR, LOG_DIR } from "@/lib/env";
import { existsSync } from "fs";
import { record } from "zod";
import { shouldExcludeDirectory } from "@/services/directory-tree";
import archiver from "archiver";

export interface Task {
  id: string;
  prompt: string;
  projectName: string;
  workDir: string;
  dbRecord: TaskRecord;
  promise: Promise<void>;
}

export class LLMScheduler {
  private runningTasks: Task[] = [];
  constructor(private projectsRootDir: string, private logsDir: string) {
    this._init();
  }

  private async _init() {
    // Create logs directory
    await fs.mkdir(this.logsDir, { recursive: true });
    await fs.mkdir(this.projectsRootDir, { recursive: true });
  }

  public async addTask(task: StartTaskRequest) {
    // this.newTaskQueue.push(task);
    const workDir = path.join(this.projectsRootDir, task.projectName);
    if (existsSync(workDir)) {
      await fs.rm(workDir, { recursive: true, force: true });
    }

    await fs.mkdir(workDir, { recursive: true });

    // Create log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(
      this.logsDir,
      `task-${timestamp}-${task.projectName}.log`
    );

    const taskRecord = await db
      .insert(tasks)
      .values({
        projectName: task.projectName,
        prompt: task.prompt,
        webhookURL: task.notifyURL,
        modelName: task.openaiModel,
        workDir: workDir,
        logFile: logFile,
      })
      .returning();

    this.runTask(taskRecord[0]);

    return {
      id: taskRecord[0].id,
      status: "pending",
    };
  }

  private async runTask(record: TaskRecord) {
    const task = {
      id: record.id,
      prompt: record.prompt,
      projectName: record.projectName,
      workDir: record.workDir,
      dbRecord: record,
      promise: executeTask(record)
        .then(() => {
          this._onTaskComplete(task, null);
        })
        .catch((error) => {
          console.error("Error:", error);
          this._onTaskComplete(task, error);
        }),
    };

    this.runningTasks.push(task);
  }

  public async getTaskStatus(id: string) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });
    if (!task) {
      return {
        success: false,
        error: "Task not found",
      };
    }

    return {
      success: true,
      status: task.status,
      error: task.error,
    };
  }

  public async getTaskLogs(id: string) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });
    if (!task) {
      return {
        success: false,
        error: "Task not found",
      };
    }

    const logs = await fs.readFile(task.logFile, "utf-8");
    return {
      success: true,
      logs: logs,
    };
  }

  public async getTask(id: string) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });

    if (!task) {
      return {
        success: false,
        error: "Task not found",
      };
    }

    return {
      success: true,
      task: task,
    };
  }

  public async getTaskFiles(id: string): Promise<{
    success: boolean;
    error?: string;
    files?: {
      filename: string;
      stream: archiver.Archiver;
    };
  }> {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });

    if (!task) {
      return {
        success: false,
        error: "Task not found",
      };
    }

    const fpath = task.workDir;

    const files = await fs.readdir(fpath);

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    for (const file of files) {
      if (shouldExcludeDirectory(file)) {
        continue;
      }
      const stat = await fs.stat(path.join(fpath, file));
      if (stat.isDirectory()) {
        archive.directory(path.join(fpath, file), file);
      } else {
        archive.append(file, { name: file });
      }
    }

    // archive.pipe()

    return {
      success: true,
      files: {
        filename: `${task.projectName}-${task.id}.zip`,
        stream: archive,
      },
    };
  }

  private async _onTaskComplete(task: Task, error: Error | null) {
    const newRecord = await db
      .update(tasks)
      .set({
        status: error ? "error" : "complete",
        error: error?.message,
      })
      .where(eq(tasks.id, task.id))
      .returning();

    if (task.dbRecord.webhookURL) {
      await fetch(task.dbRecord.webhookURL, {
        method: "POST",
        body: JSON.stringify({
          ...newRecord[0],
        }),
      });
    }
  }

  //   public getNextTask(): TaskDef | null {
  //     return this.newTaskQueue.shift() || null;
  //   }
}

export const llmScheduler = new LLMScheduler(PROJECTS_ROOT_DIR, LOG_DIR);
