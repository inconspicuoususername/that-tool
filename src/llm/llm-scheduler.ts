import { db } from "@/lib/db";
import { subTasks, tasks } from "@/lib/db/schema";
import { executeTask } from "./prompt";
import { eq } from "drizzle-orm";
import { ToolsService } from "./services/tools";
import { EditCodeService } from "./services/editcode";
import { TerminalService } from "./services/terminal";
import { ProjectRecord, SubTaskRecord } from "@/types/db";
import {
  SubtaskInstance,
  SubtaskCompleteCallback,
  LLMResult,
  LLMHelpRequest,
} from "@/types/llm-scheduler";
import winston from "winston";
import fs from "fs/promises";

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
      task.promise = Promise.resolve();
      this.runningTasks = this.runningTasks.filter((t) => t !== task);
      this.completeCallbacks.delete(task.subtask.id);
      await db
        .update(subTasks)
        .set({ status: "killed" })
        .where(eq(subTasks.id, task.subtask.id));
    }
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
    } satisfies SubtaskInstance;

    subtask.promise = executeTask(subtask)
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
      throw new Error("Subtask not found");
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
