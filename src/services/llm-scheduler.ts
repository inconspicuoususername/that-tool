import { db } from "@/lib/db";
import { subTasks, tasks } from "@/lib/db/schema";
import { executeTask } from "@/llm/prompt";
import { eq } from "drizzle-orm";
import { ToolsService } from "@/llm/services/tools";
import { EditCodeService } from "@/llm/services/editcode";
import { TerminalService } from "@/llm/services/terminal";
import { ProjectRecord, SubTaskRecord } from "@/types/db";
import {
  SubtaskInstance,
  SubtaskCompleteCallback,
  LLMResult,
  LLMHelpRequest,
} from "@/types/llm-scheduler";
import winston from "winston";
import fs from "fs/promises";
import archiver from "archiver";
import path from "path";
import { shouldExcludeDirectory } from "@/llm/services/directory-tree";

export class LLMScheduler {
  private runningTasks: SubtaskInstance[] = [];
  private completeCallbacks: Map<number, SubtaskCompleteCallback> = new Map();
  constructor(private logger: winston.Logger) {}

  //   const task = {
  //     id: taskRecord[0].id,
  //     context: this._setupTaskContext(setup.workDir, startTask.prompt),
  //     setup,
  //     promise: Promise.resolve(),
  //   } satisfies Task;

  //   this._executeTask(task);

  //   return {
  //     id: taskRecord[0].id,
  //     status: "pending",
  //   };
  // }

  public addCompleteCallback(
    subtaskId: number,
    callback: SubtaskCompleteCallback
  ) {
    this.completeCallbacks.set(subtaskId, callback);
  }

  public removeCompleteCallback(subtaskId: number) {
    this.completeCallbacks.delete(subtaskId);
  }

  public async stopTaskIfExists(taskId: number) {
    const task = this.runningTasks.find((t) => t.subtask.taskId === taskId);
    if (task) {
      task.subtask.status = "killed";
      task.abortController.abort();
      task.promise.catch(() => {});
      this.runningTasks = this.runningTasks.filter((t) => t !== task);
      this.completeCallbacks.delete(task.subtask.id);
      await db
        .update(subTasks)
        .set({ status: "killed" })
        .where(eq(subTasks.id, task.subtask.id));
    }
  }

  public async getSubTaskFiles(id: string): Promise<{
    success: boolean;
    error?: string;
    files?: {
      filename: string;
      stream: archiver.Archiver;
    };
  }> {
    const subTask = await db.query.subTasks.findFirst({
      where: eq(subTasks.id, parseInt(id)),
    });

    if (!subTask) {
      return {
        success: false,
        error: "SubTask not found",
      };
    }

    const fpath = await this.getSubtaskWorkDir(subTask.id);

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
        filename: `${subTask.taskId}-${
          subTask.id
        }-${new Date().toISOString()}.zip`,
        stream: archive,
      },
    };
  }

  public async executeTask(
    project: ProjectRecord,
    task: SubTaskRecord,
    workDir: string,
    logFile: string
  ) {
    const updatedSubtaskRecord = await db
      .update(subTasks)
      .set({
        status: "running",
      })
      .where(eq(subTasks.id, task.id))
      .returning();

    const updatedSubtask = updatedSubtaskRecord[0] as SubTaskRecord;

    if (!updatedSubtask) {
      throw new Error(
        `Error while updating subtask status to running: Task ID: ${task.id}`
      );
    }

    this.logger.info("Executing task", {
      taskId: updatedSubtask.taskId,
      subtaskId: updatedSubtask.id,
    });
    const context = this._setupTaskContext(workDir);
    const subtask = {
      context,
      project,
      setup: {
        workDir,
        logFile,
        currentPrompt: updatedSubtask.prompt,
      },
      subtask: updatedSubtask,
      promise: Promise.resolve(),
      abortController: new AbortController(),
    } satisfies SubtaskInstance;

    subtask.promise = executeTask(subtask, subtask.abortController.signal)
      .then((res) => {
        if (res.type === "tool_result") {
          this._onTaskComplete(subtask, null, res);
        } else if (res.type === "help_request") {
          this._onLLMAskForHelp(subtask, res);
        }
      })
      .catch((error) => {
        this.logger.error("Error executing task:", {
          error: error.message,
          stack: error.stack,
        });
        this._onTaskComplete(subtask, error, null);
      });
    this.runningTasks.push(subtask);
    return subtask;
  }

  public async getSubtaskLogs(subtaskId: number) {
    const subtask = this.runningTasks.find((t) => t.subtask.id === subtaskId);
    if (!subtask) {
      // Subtasks that already finished are removed from `runningTasks`, but their
      // log files still exist on disk.
      const subTaskRecord = await db.query.subTasks.findFirst({
        where: eq(subTasks.id, subtaskId),
      });

      if (!subTaskRecord) {
        throw new Error("Subtask not found");
      }

      throw new Error("Subtask is not running");
    }

    return await fs.readFile(subtask.setup.logFile, "utf-8");
  }

  public async getSubtaskWorkDir(subtaskId: number) {
    const subtask = this.runningTasks.find((t) => t.subtask.id === subtaskId);
    if (!subtask) {
      throw new Error("Subtask not found");
    }
    return subtask.setup.workDir;
  }

  private _setupTaskContext(workDir: string) {
    const terminalService = new TerminalService(workDir);
    const editCodeService = new EditCodeService();
    const toolsService = new ToolsService(
      workDir,
      terminalService,
      editCodeService
    );

    return {
      terminalService,
      editCodeService,
      toolsService,
    } as SubtaskInstance["context"];
  }

  private async _onLLMAskForHelp(
    subtask: SubtaskInstance,
    request: LLMHelpRequest
  ) {
    const updatedSubtaskRecord = await db
      .update(subTasks)
      .set({
        status: "complete",
        output: request,
      })
      .where(eq(subTasks.id, subtask.subtask.id))
      .returning();

    const updatedSubtask = updatedSubtaskRecord[0] as SubTaskRecord;

    if (!updatedSubtask) {
      throw new Error(
        `Error while updating subtask status to help_requested: Task ID: ${subtask.subtask.id}`
      );
    }

    this.completeCallbacks.get(updatedSubtask.id)?.(
      updatedSubtask,
      subtask.setup,
      null,
      request
    );
  }

  private async _onTaskComplete(
    subtask: SubtaskInstance,
    error: Error | null,
    result: LLMResult | null
  ) {
    this.logger.info("Task completed:", {
      subtaskId: subtask.subtask.id,
      error: error?.message,
      result: result,
    });

    const updatedSubtaskRecord = await db
      .update(subTasks)
      .set({
        status: "complete",
        error: error?.message,
        output: result ?? null,
      })
      .where(eq(subTasks.id, subtask.subtask.id))
      .returning();

    const updatedSubtask = updatedSubtaskRecord[0] as SubTaskRecord;

    this.completeCallbacks.get(updatedSubtask.id)?.(
      updatedSubtask,
      subtask.setup,
      error,
      result
    );
  }
}
