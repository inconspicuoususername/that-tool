import { db } from "@/lib/db";
import { and, eq, not, or } from "drizzle-orm";
import { existsSync } from "fs";
import { GitHubWrapper } from "@/lib/github/index";
import {
  projects,
  tasks,
  subTasks,
  taskGithubInfo,
  oaiResponses,
} from "@/lib/db/schema";
import { StartTaskRequest, GithubStartTaskRequest } from "@/types/api";

import fs from "fs/promises";
import path from "path";
import {
  ProjectRecord,
  SubTaskRecord,
  TaskGithubInfoRecord,
  TaskRecord,
} from "@/types/db";
import archiver from "archiver";
import { shouldExcludeDirectory } from "./services/directory-tree";
import { LLMScheduler } from "./llm-scheduler";
import { Logger } from "@/lib/basic-logger";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";

export class TaskService {
  constructor(
    private projectsRootDir: string,
    private logsDir: string,
    private llmScheduler: LLMScheduler,
    private github: GitHubWrapper,
    private logger: Logger
  ) {
    this._init();
  }

  private async _init() {
    // Create logs directory
    this.logger.info("Initializing TaskService");

    this.logger.info("Creating logs directory:", this.logsDir);
    await fs.mkdir(this.logsDir, { recursive: true });
    this.logger.info("Creating projects root directory:", this.projectsRootDir);
    await fs.mkdir(this.projectsRootDir, { recursive: true });

    this.logger.info("Registering webhook callback");
    this.github.registerWebhookCallback(this.onPullRequestReview);
    this.logger.info("Initializing webhooks for incomplete tasks");
    await this._initAndRescheduleIncompleteTasks();
  }

  private async _initAndRescheduleIncompleteTasks() {
    const incompleteTasks = await db
      .select()
      .from(tasks)
      .where(
        and(not(eq(tasks.status, "complete")), not(eq(tasks.status, "error")))
      );

    this.logger.info("Found", incompleteTasks.length, "incomplete tasks");

    for (const task of incompleteTasks) {
      if (task.status === "running") {
        this.logger.warn(
          "Found running task that was never finalized. Continuing."
        );

        continue;
      }
      if (task.type !== "github") {
        continue;
      }

      const githubInfo = (await db.query.taskGithubInfo.findFirst({
        where: eq(taskGithubInfo.id, task.githubInfoId!),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        continue;
      }

      this.logger.info(
        "Registering reference to github client for task:",
        task.id
      );
      await this.github.setupClient(
        githubInfo.privateAccessToken,
        githubInfo.owner,
        githubInfo.repo
      );

      const currentSubTask = await db.query.subTasks.findFirst({
        where: and(
          eq(subTasks.taskId, task.id),
          not(eq(subTasks.status, "complete"))
        ),
      });

      if (!currentSubTask) {
        continue;
      }

      const newSubtask = await this.resetSubtask(task, currentSubTask);

      this.llmScheduler.executeTask(newSubtask);
    }
  }

  private async resetSubtask(task: TaskRecord, subtask: SubTaskRecord) {
    const subtaskRecord = await db
      .update(subTasks)
      .set({
        status: "pending",
      })
      .where(eq(subTasks.id, subtask.id))
      .returning();

    await db.delete(oaiResponses).where(eq(oaiResponses.subTaskId, subtask.id));

    return subtaskRecord[0];
  }

  private onPullRequestReview: HandlerFunction<"pull_request_review"> = async (
    event
  ) => {
    this.logger.info("Pull request review event received:", event);
    const dbtasks = await db
      .select()
      .from(tasks)
      .innerJoin(taskGithubInfo, eq(tasks.githubInfoId, taskGithubInfo.id))
      .where(
        and(
          eq(taskGithubInfo.repo, event.payload.repository.name),
          eq(taskGithubInfo.owner, event.payload.repository.owner.login),
          eq(tasks.status, "awaiting_approval")
        )
      );

    for (const dbtask of dbtasks) {
      const task = dbtask.tasks;
      const githubInfo = dbtask.task_github_info as TaskGithubInfoRecord;
      if (!githubInfo.pullRequest) {
        this.logger.warn("No pull request found for task:", task.id);
        continue;
      }
      if (task?.type == "github") {
        if (
          event.payload.pull_request.number === githubInfo.pullRequest?.number
        ) {
          this.logger.info("Pull request review event received");
          if (event.payload.review.state === "approved") {
            this.logger.info("Pull request approved");
            this._onTaskApproved(task);
          }
          //reschedule the task, continue the loop
          else {
            this.logger.info("Pull request not approved");
            if (!event.payload.review.body) {
              this.logger.error("No review body found on pull request.");
              return;
            }
            const newPrompt =
              "\n\nYou created a pull request with the following details: " +
              "PR Number: " +
              githubInfo.pullRequest?.number +
              "\nTitle: " +
              githubInfo.pullRequest?.title +
              "\nDescription: " +
              githubInfo.pullRequest?.body +
              "\n\nThe pull request has been reviewed. The reviewer has outlined some issues you need to fix:\n\n" +
              "```\n" +
              event.payload.review.body! +
              "\n```\n\n" +
              "Please fix the issues and commit your changes.";

            const currentSubTask = await db.query.subTasks.findFirst({
              where: eq(subTasks.id, task.currentSubTaskId!),
            });

            if (!currentSubTask) {
              throw new Error("Current subtask not found.");
            }

            const newSubTask = await this.createContinuationSubTask(
              task,
              currentSubTask,
              newPrompt
            );

            this.logger.info("Rescheduling task:", task.id);
            await this.scheduleTask(task, newSubTask);
          }
        }
      }
    }
  };

  private async setupProject(
    task: TaskGithubInfoRecord,
    project: ProjectRecord
  ) {
    const projectBaseDir = path.join(this.projectsRootDir, project.projectName);
    if (existsSync(projectBaseDir)) {
      await fs.rm(projectBaseDir, { recursive: true, force: true });
    }

    this.logger.info("Cloning repo:", task.repo, task.owner);

    await this.github.cloneRepo(
      task.privateAccessToken,
      task.repo,
      task.owner,
      projectBaseDir
    );

    if (task.startBranch) {
      await this.github.checkoutBranch(projectBaseDir, task.startBranch);
    }

    return projectBaseDir;
  }

  private async getProject(projectName: string) {
    this.logger.info("Getting project:", projectName);
    let projectRecord = await db.query.projects.findFirst({
      where: eq(projects.projectName, projectName),
    });

    if (!projectRecord) {
      this.logger.info("Project not found, creating project");
      const dbReturn = await db
        .insert(projects)
        .values({
          projectName,
        })
        .returning();
      projectRecord = dbReturn[0];
    }
    return projectRecord;
  }

  private async createTask(
    projectRecord: ProjectRecord,
    task: StartTaskRequest
  ) {
    const taskRecord = await db
      .insert(tasks)
      .values({
        initialPrompt: task.prompt,
        currentPrompt: task.prompt,
        type: task.type,
        webhookURL: task.notifyURL,
        projectId: projectRecord.id,
      })
      .returning();

    let githubInfoRecord: TaskGithubInfoRecord | null = null;

    if (task.type === "github") {
      const githubInfo = await db
        .insert(taskGithubInfo)
        .values({
          taskId: taskRecord[0].id,
          owner: task.owner,
          repo: task.repo,
          privateAccessToken: task.privateAccessToken,
          startBranch: task.startBranch,
          targetBranch: task.targetBranch,
          pullRequest: null,
        })
        .returning();
      githubInfoRecord = {
        ...githubInfo[0],
        pullRequest: null,
      };

      await db
        .update(tasks)
        .set({
          githubInfoId: githubInfoRecord.id,
        })
        .where(eq(tasks.id, taskRecord[0].id));
    }

    return {
      taskRecord: taskRecord[0],
      githubInfoRecord,
    };
  }

  private async createSubTask(
    taskId: number,
    modelName: string,
    prompt: string,
    workDir: string,
    logFile: string,
    status: "pending" | "running" | "complete"
  ) {
    const subTaskRecord = await db
      .insert(subTasks)
      .values({
        taskId,
        modelName,
        status,
        workDir,
        logFile,
        prompt,
      })
      .returning();

    return subTaskRecord[0];
  }

  private async createContinuationSubTask(
    task: TaskRecord,
    previousSubTask: SubTaskRecord,
    prompt: string
  ) {
    const currentPrompt = task.currentPrompt + "\n\n" + prompt;
    const subTaskRecord = await db
      .insert(subTasks)
      .values({
        taskId: task.id,
        modelName: previousSubTask.modelName,
        prompt: currentPrompt,
        workDir: previousSubTask.workDir,
        logFile: previousSubTask.logFile,
        status: "pending",
      })
      .returning();

    await db
      .update(tasks)
      .set({
        currentSubTaskId: subTaskRecord[0].id,
        currentPrompt,
      })
      .where(eq(tasks.id, task.id));

    return subTaskRecord[0];
  }

  public async addTask(startTask: StartTaskRequest) {
    // this.newTaskQueue.push(task);
    // const workDir = path.join(this.projectsRootDir, task.projectName);
    // if (existsSync(workDir)) {
    //   await fs.rm(workDir, { recursive: true, force: true });
    // }

    // await fs.mkdir(workDir, { recursive: true });
    this.logger.info("New task added:", startTask);

    const projectRecord = await this.getProject(startTask.projectName);

    if (!projectRecord) {
      return {
        success: false,
        error: "Project not found",
      };
    }

    const { taskRecord, githubInfoRecord } = await this.createTask(
      projectRecord,
      startTask
    );

    this.logger.info("Task record created:", taskRecord.id);

    // Create log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(
      this.logsDir,
      `task-${timestamp}-${startTask.projectName}.log`
    );

    // let setup: SubTaskRecord;
    let workDir: string;

    if (startTask.type === "github") {
      this.logger.info("Setting up github");
      await this.github.setupClient(
        startTask.privateAccessToken,
        startTask.owner,
        startTask.repo
      );
      workDir = await this.setupProject(githubInfoRecord!, projectRecord);
    } else {
      this.logger.info("Setting up local");
      workDir = path.join(this.projectsRootDir, startTask.projectName);
    }

    const setup = await this.createSubTask(
      taskRecord.id,
      startTask.openaiModel,
      startTask.prompt,
      workDir,
      logFile,
      "pending"
    );

    await this.scheduleTask(taskRecord, setup);
  }

  public async scheduleTask(taskRecord: TaskRecord, subtask: SubTaskRecord) {
    await db
      .update(tasks)
      .set({
        currentSubTaskId: subtask.id,
        status: "running",
      })
      .where(eq(tasks.id, taskRecord.id));

    this.logger.info("Adding complete callback for subtask:", subtask.id);

    this.llmScheduler.addCompleteCallback(
      subtask.id,
      this.onSubTaskComplete.bind(this)
    );

    this.llmScheduler.executeTask(subtask);
  }

  public async getCurrentSubTaskStatus(id: string) {
    const task = await db.query.subTasks.findFirst({
      where: eq(subTasks.taskId, parseInt(id)),
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

  public async getSubTaskLogs(id: string) {
    const task = await db.query.subTasks.findFirst({
      where: eq(subTasks.id, parseInt(id)),
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
      where: eq(tasks.id, parseInt(id)),
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

    const fpath = subTask.workDir;

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

  public async onSubTaskComplete(
    subtask: SubTaskRecord,
    error: Error | null,
    output: {
      commitMessage: string;
      commitDescription: string;
    } | null
  ) {
    this.llmScheduler.removeCompleteCallback(subtask.id);
    this.logger.info("On task complete:", subtask.id, error, output);
    if (subtask.error) {
      this.logger.error("Task failed:", subtask.error);
      const updatedTask = await db
        .update(tasks)
        .set({
          status: "error",
        })
        .where(eq(tasks.id, subtask.taskId))
        .returning();

      await this._finalizeTask(updatedTask[0]);
      return;
    }

    if (subtask.status === "complete") {
      await db
        .update(tasks)
        .set({
          status: "awaiting_approval",
        })
        .where(eq(tasks.id, subtask.taskId));
    }

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, subtask.taskId),
    });

    if (!task) {
      this.logger.error("Task not found:", subtask.taskId);
      return;
    }

    if (task?.type === "github") {
      this.logger.info("On github task complete:", task);
      const githubInfo = (await db.query.taskGithubInfo.findFirst({
        where: eq(taskGithubInfo.id, task.githubInfoId!),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        throw new Error("Github info not found. Malformed task.");
      }

      if (!githubInfo.pullRequest) {
        this.logger.info("Creating branch:", githubInfo.targetBranch);
        await this.github.createBranch(
          subtask.workDir,
          githubInfo.targetBranch
        );
        this.logger.info("Checking out branch:", githubInfo.targetBranch);
        await this.github.checkoutBranch(
          subtask.workDir,
          githubInfo.targetBranch
        );
      }
      this.logger.info("Committing and pushing:", githubInfo.targetBranch);
      await this.github.commitAndPush(
        subtask.workDir,
        githubInfo.targetBranch,
        output?.commitMessage || "No commit message."
      );
      if (!githubInfo.pullRequest) {
        this.logger.info("Creating pull request:", githubInfo.targetBranch);
        const pullRequest = await this.github.createPullRequest({
          owner: githubInfo.owner,
          repo: githubInfo.repo,
          title: output?.commitMessage || "No commit message.",
          head: githubInfo.targetBranch,
          base: githubInfo.startBranch,
          body: output?.commitDescription || "No commit description.",
        });

        await db
          .update(taskGithubInfo)
          .set({
            pullRequest: pullRequest.data,
          })
          .where(eq(taskGithubInfo.id, githubInfo.id));
      }
    } else {
      await this._onTaskApproved(task);
    }
  }

  private async _onTaskApproved(task: TaskRecord) {
    const newRecord = await db
      .update(tasks)
      .set({
        status: "complete",
      })
      .where(eq(tasks.id, task.id))
      .returning();

    if (newRecord[0].webhookURL) {
      await fetch(newRecord[0].webhookURL, {
        method: "POST",
        body: JSON.stringify({
          ...newRecord[0],
        }),
      });
    }

    await this._finalizeTask(task);
  }

  private async _finalizeTask(task: TaskRecord) {
    if (task.type === "github") {
      const githubInfo = (await db.query.taskGithubInfo.findFirst({
        where: eq(taskGithubInfo.id, task.githubInfoId!),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        throw new Error("Github info not found. Malformed task.");
      }

      await this.github.releaseClient(githubInfo.owner, githubInfo.repo);
    }
  }
}
