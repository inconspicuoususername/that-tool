import { db } from "@/lib/db";
import { subTasks, tasks } from "@/lib/db/schema";
import { executeTask } from "./prompt";
import { eq } from "drizzle-orm";
import { ToolsService } from "./services/tools";
import { EditCodeService } from "./services/editcode";
import { TerminalService } from "./services/terminal";
import { SubTaskRecord } from "@/types/db";
import {
  SubtaskInstance,
  SubtaskCompleteCallback,
  LLMResult,
  LLMHelpRequest,
} from "@/types/llm-scheduler";
import winston from "winston";

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

  public async executeTask(task: SubTaskRecord) {
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

    this.logger.info("Executing task:", updatedSubtask);
    const context = this._setupTaskContext(
      updatedSubtask.workDir,
      updatedSubtask.prompt
    );
    const subtask = {
      context,
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
        this._onTaskComplete(subtask, error, null);
      });
    this.runningTasks.push(subtask);
    return subtask;
  }

  private _setupTaskContext(workDir: string, prompt: string) {
    const terminalService = new TerminalService(workDir);
    const editCodeService = new EditCodeService();
    const toolsService = new ToolsService(
      workDir,
      terminalService,
      editCodeService
    );

    return {
      currentPrompt: prompt,
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
      null,
      request
    );
  }

  private async _onTaskComplete(
    subtask: SubtaskInstance,
    error: Error | null,
    result: LLMResult | null
  ) {
    this.logger.info("Task completed:", subtask);
    this.logger.info("Error:", error);
    this.logger.info("Result:", result);

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
      error,
      result
    );
  }
}
