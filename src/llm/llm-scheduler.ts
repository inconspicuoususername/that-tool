import { db } from "@/lib/db";
import { subTasks, tasks } from "@/lib/db/schema";
import { executeTask } from "./prompt";
import { eq } from "drizzle-orm";
import { ToolsService } from "./services/tools";
import { EditCodeService } from "./services/editcode";
import { TerminalService } from "./services/terminal";
import { SubTaskRecord } from "@/types/db";
import { TaskService } from "./task-service";
export interface SubtaskInstance {
  context: {
    currentPrompt: string;
    terminalService: TerminalService;
    toolsService: ToolsService;
    editCodeService: EditCodeService;
  };
  subtask: SubTaskRecord;
  promise: Promise<void>;
}

interface LLMResult {
  commitMessage: string;
  commitDescription: string;
}

type SubtaskCompleteCallback = (
  subtask: SubTaskRecord,
  error: Error | null,
  result: LLMResult | null
) => void;

export class LLMScheduler {
  private runningTasks: SubtaskInstance[] = [];
  private completeCallbacks: Map<number, SubtaskCompleteCallback> = new Map();
  constructor() {}

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

  public async executeTask(task: SubTaskRecord) {
    const updatedSubtaskRecord = await db
      .update(subTasks)
      .set({
        status: "running",
      })
      .where(eq(subTasks.id, task.id))
      .returning();

    const updatedSubtask = updatedSubtaskRecord[0];

    if (!updatedSubtask) {
      throw new Error(
        `Error while updating subtask status to running: Task ID: ${task.id}`
      );
    }

    console.log("Executing task:", updatedSubtask);
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
        this._onTaskComplete(subtask, null, res);
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

  private async _onTaskComplete(
    subtask: SubtaskInstance,
    error: Error | null,
    result: LLMResult | null
  ) {
    console.log("Task completed:", subtask);
    console.log("Error:", error);
    console.log("Result:", result);

    const updatedSubtaskRecord = await db
      .update(subTasks)
      .set({
        status: "complete",
        error: error?.message,
      })
      .where(eq(subTasks.id, subtask.subtask.id))
      .returning();

    const updatedSubtask = updatedSubtaskRecord[0];

    this.completeCallbacks.get(updatedSubtask.id)?.(
      updatedSubtask,
      error,
      result
    );
  }
}
