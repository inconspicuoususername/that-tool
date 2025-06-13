import { db } from "@/lib/db";
import { and, eq, not, or, sql } from "drizzle-orm";
import { existsSync } from "fs";
import { GithubInstallationError, GitHubWrapper } from "@/lib/github/index";
import {
  projects,
  tasks,
  subTasks,
  taskGithubInfo,
  oaiResponses,
} from "@/lib/db/schema";
import { StartTaskRequest } from "@/types/api";
import { LLMResult, LLMHelpRequest } from "@/types/llm-scheduler";

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
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";
import { env } from "@/lib/env";
import winston from "winston";

export class TaskService {
  constructor(
    private projectsRootDir: string,
    private logsDir: string,
    private llmScheduler: LLMScheduler,
    private github: GitHubWrapper,
    private logger: winston.Logger
  ) {
    this._init();
  }

  // private async test() {
  //   const task = await db.query.tasks.findFirst({
  //     where: eq(tasks.id, 51),
  //   });

  //   if (!task) {
  //     throw new Error("Task not found");
  //   }

  //   const a = {
  //     type: "help_request",
  //     query: `I updated the type signature in the router.post method, but I'm still encountering type errors. The error indicates a mismatch and refers to properties missing from the expected 'Application' type. Can you provide guidance on how to resolve this issue?`,
  //   };

  //   const st = await this.createContinuationSubTask(
  //     task,
  //     `In response to your question, the PM said:

  //     @You Hi, no problem. The issue seems to be the return statement in:

  //     \`\`\`
  //     if (!title || !description || !dueDate) {
  //         return res.status(400).json({ error: 'Title, description, and dueDate are required.' });
  //       }
  //     \`\`\`

  //     With the return statement, the function does not match the type signature of express' route handler. Without the return statement, the route handler should work.
  //     Hope that helps!`
  //   );

  //   console.log(st);
  // }

  private async _init() {
    // Create logs directory
    this.logger.info("Initializing TaskService");

    this.logger.info("Creating logs directory:", { logsDir: this.logsDir });
    await fs.mkdir(this.logsDir, { recursive: true });
    this.logger.info("Creating projects root directory:", this.projectsRootDir);
    await fs.mkdir(this.projectsRootDir, { recursive: true });

    this.logger.info(
      "Registering webhook callback on Github for pull_request_review and pull_request.closed"
    );
    this.github.githubApp.webhooks.on(
      ["pull_request_review", "pull_request.closed"],
      this.onWebhookHandler
    );
    this.logger.info("Initializing webhooks for incomplete tasks");
    await this._initAndRescheduleIncompleteTasks();

    // await this.test();
  }

  private async _initAndRescheduleIncompleteTasks() {
    const incompleteTasks = await db
      .select()
      .from(tasks)
      .where(or(eq(tasks.status, "running"), eq(tasks.status, "pending")));

    this.logger.info("Found " + incompleteTasks.length + " incomplete tasks");

    for (const task of incompleteTasks) {
      this.logger.info("Incomplete task:", task.id);
      if (task.type !== "github") {
        continue;
      }

      const githubInfo = (await db.query.taskGithubInfo.findFirst({
        where: eq(taskGithubInfo.id, task.githubInfoId!),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        continue;
      }

      try {
        this.logger.info("Checking github auth for task:", task.id);
        await this.github.checkAuth(githubInfo.owner, githubInfo.repo);
      } catch (error) {
        if (error instanceof GithubInstallationError) {
          // The github app is not installed on the repository anymore.
          //delete the task and move on.
          this.logger.warn(
            "Github installation error. Updating task and subtask to error state.",
            error.message
          );
          await db
            .update(tasks)
            .set({
              status: "error",
            })
            .where(eq(tasks.id, task.id));

          if (task.currentSubTaskId) {
            await db
              .update(subTasks)
              .set({
                error: error.message,
              })
              .where(eq(subTasks.id, task.currentSubTaskId));
          }

          continue;
        }
        throw error;
      }

      this.logger.info("Github auth checked for task:", task.id);

      // if (!githubInfo.pullRequest) {
      //   this.logger.warn(
      //     "Task is malformed: No pull request found for task:",
      //     task.id
      //   );
      //   if (task.currentSubTaskId) {
      //     await db
      //       .update(subTasks)
      //       .set({
      //         error: "Task is malformed: No pull request found for task.",
      //       })
      //       .where(eq(subTasks.id, task.currentSubTaskId));
      //   }
      //   await this.killAndRemoveTask(task);
      //   continue;
      // }

      if (!task.currentSubTaskId) {
        this.logger.warn("Task has no current subtask. Killing task.");
        await this.killAndRemoveTask(task);
        continue;
      }

      const currentSubTask = (await db.query.subTasks.findFirst({
        where: and(
          eq(subTasks.id, task.currentSubTaskId)
          // not(eq(subTasks.status, "complete"))
        ),
      })) as SubTaskRecord;

      if (!currentSubTask) {
        //The task never started, but we lost starting info. kill the task. if its a github task,
        //the issue crawler will pick up the issue and create a new task anyways.
        this.logger.warn(
          "Task never started, but we lost starting info. Killing task."
        );
        await this.killAndRemoveTask(task);
        continue;
      }

      if (currentSubTask.status === "complete") {
        //we have entered a broken task state. this usually means that the worker process was killed as approval was
        //given from a PR. it is recoverable, but not through the current webhook system, as prs would have to
        //be crawled and checked for new responses
        this.logger.warn(
          "Task is running, but subtask is in complete state. This usually means that the worker process was killed as approval was given from a PR. It is recoverable, but not through the current webhook system, as PRs would have to be crawled and checked for new responses."
        );
        continue;
      }

      const { workDir, logFile } = await this.setupSubTask(task, githubInfo);

      const newSubtask = await this.resetSubtask(
        currentSubTask,
        workDir,
        logFile
      );

      this.scheduleSubTask(newSubtask);
    }
  }

  private async resetSubtask(
    subtask: SubTaskRecord,
    workDir: string,
    logFile: string
  ) {
    const subtaskRecord = await db
      .update(subTasks)
      .set({
        status: "pending",
        workDir,
        logFile,
      })
      .where(eq(subTasks.id, subtask.id))
      .returning();

    await db.delete(oaiResponses).where(eq(oaiResponses.subTaskId, subtask.id));

    return subtaskRecord[0] as SubTaskRecord;
  }

  private onWebhookHandler: HandlerFunction<
    "pull_request_review" | "pull_request.closed"
  > = async (event) => {
    this.logger.info("Pull request event received.");
    if (
      (event.name === "pull_request_review" || event.name === "pull_request") &&
      event.payload.pull_request.number
    ) {
      const dbtasks = await db
        .select()
        .from(tasks)
        .innerJoin(taskGithubInfo, eq(tasks.githubInfoId, taskGithubInfo.id))
        .where(
          and(
            eq(taskGithubInfo.repo, event.payload.repository.name),
            eq(taskGithubInfo.owner, event.payload.repository.owner.login),
            eq(
              sql`${taskGithubInfo.pullRequest}->>'number'`,
              event.payload.pull_request.number
            ),
            or(
              eq(tasks.status, "awaiting_approval"),
              eq(tasks.status, "awaiting_help")
              // eq(tasks.status, "running"),
              // eq(tasks.status, "pending")
            )
          )
        );

      if (dbtasks.length === 0) {
        this.logger.warn(
          "No task found for pull request:",
          event.payload.pull_request.number
        );
        return;
      }

      for (const dbtask of dbtasks) {
        const task = dbtask.tasks;
        const githubInfo = dbtask.task_github_info as TaskGithubInfoRecord;
        if (!githubInfo.pullRequest) {
          this.logger.warn("No pull request found for task:", task.id);
          continue;
        }

        if (event.name === "pull_request_review") {
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

            const newSubTask = await this.setupAndScheduleContinuationSubTask(
              task,
              githubInfo,
              newPrompt
            );

            this.logger.info("Rescheduling task:", task.id);
            await this.scheduleSubTask(newSubTask);
          }
        } else if (event.name === "pull_request") {
          this.logger.info("Pull request event received");
          if (event.payload.action === "closed") {
            if (event.payload.pull_request.merged) {
              this.logger.info("Pull request merged event received");
              this._onTaskApproved(task);
            } else {
              this.logger.info("Pull request closed event received");
              this._onTaskClosed(task);
            }
          }
        }
      }
    }
  };

  public async setupAndScheduleContinuationSubTask(
    task: TaskRecord,
    githubInfo: TaskGithubInfoRecord,
    prompt: string
  ) {
    const setup = await this.setupSubTask(task, githubInfo);
    const newSubTask = await this.createContinuationSubTask(
      task,
      prompt,
      setup.workDir,
      setup.logFile
    );

    this.scheduleSubTask(newSubTask);

    return newSubTask;
  }

  private async setupProject(
    task: TaskGithubInfoRecord,
    project: ProjectRecord,
    overwrite = true
  ) {
    const projectBaseDir = path.join(this.projectsRootDir, project.projectName);
    if (existsSync(projectBaseDir) && overwrite) {
      await fs.rm(projectBaseDir, { recursive: true, force: true });
    }

    if (!existsSync(projectBaseDir)) {
      this.logger.info("Cloning repo:", task.repo, task.owner);
      await this.github.cloneRepo(task.repo, task.owner, projectBaseDir);
    } else {
      this.logger.info("Pulling repo:", task.repo, task.owner);
      await this.github.pullRepo(task.repo, task.owner, projectBaseDir);
    }

    if (task.startBranch) {
      this.logger.info("Checking out branch:", task.startBranch);
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
          startBranch: task.startBranch,
          targetBranch: task.targetBranch,
          pullRequest: null,
          linkedIssueNumber: task.linkedIssueNumber,
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
    status: "pending" | "running" | "complete",
    previousSubTaskId?: number
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
        previousSubTaskId,
      })
      .returning();

    return subTaskRecord[0] as SubTaskRecord;
  }

  private async createContinuationSubTask(
    task: TaskRecord,
    prompt: string,
    workDir: string,
    logFile: string
  ) {
    const previousSubTask = await db.query.subTasks.findFirst({
      where: eq(subTasks.id, task.currentSubTaskId!),
    });

    if (!previousSubTask) {
      throw new Error("Previous subtask not found");
    }
    // const currentPrompt = task.currentPrompt + "\n\n" + prompt;
    const subTaskRecord = await db
      .insert(subTasks)
      .values({
        taskId: task.id,
        modelName: previousSubTask.modelName,
        previousSubTaskId: previousSubTask.id,
        prompt: prompt,
        workDir: workDir,
        logFile: logFile,
        status: "pending",
      })
      .returning();

    return subTaskRecord[0] as SubTaskRecord;
  }

  public async addTask(startTask: StartTaskRequest) {
    // this.newTaskQueue.push(task);
    // const workDir = path.join(this.projectsRootDir, task.projectName);
    // if (existsSync(workDir)) {
    //   await fs.rm(workDir, { recursive: true, force: true });
    // }

    // await fs.mkdir(workDir, { recursive: true });
    this.logger.info("New task added:", startTask);
    if (startTask.type === "github") {
      await this.github.checkAuth(startTask.owner, startTask.repo);
    }

    const projectName =
      startTask.type === "github" ? startTask.repo : startTask.projectName;

    const projectRecord = await this.getProject(projectName);

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

    this.logger.info("Setting up subtask");
    const setup = await this.setupSubTask(taskRecord, githubInfoRecord!);

    this.logger.info("Creating subtask", {
      taskId: taskRecord.id,
      modelName: startTask.openaiModel,
      prompt: startTask.prompt,
      workDir: setup.workDir,
      logFile: setup.logFile,
    });
    const subtask = await this.createSubTask(
      taskRecord.id,
      startTask.openaiModel,
      startTask.prompt,
      setup.workDir,
      setup.logFile,
      "pending"
    );

    this.logger.info("Scheduling subtask", {
      subtaskId: subtask.id,
    });
    this.scheduleSubTask(subtask);

    return {
      taskId: taskRecord.id,
      subtaskId: subtask.id,
    };
  }

  public async killAndRemoveTask(taskRecord: TaskRecord) {
    this.logger.info("Killing and removing task:", taskRecord.id);
    await db
      .update(tasks)
      .set({ status: "killed" })
      .where(eq(tasks.id, taskRecord.id));

    this.llmScheduler.removeCompleteCallback(taskRecord.currentSubTaskId!);
    if (taskRecord.currentSubTaskId) {
      await db
        .update(subTasks)
        .set({ status: "killed" })
        .where(
          and(
            eq(subTasks.id, taskRecord.currentSubTaskId),
            eq(subTasks.status, "running")
          )
        );
    }
    this.llmScheduler.stopTaskIfExists(taskRecord.id);
  }

  public async setupSubTask(
    taskRecord: TaskRecord,
    githubInfoRecord: TaskGithubInfoRecord
  ) {
    const projectRecord = await db.query.projects.findFirst({
      where: eq(projects.id, taskRecord.projectId),
    });

    if (!projectRecord) {
      throw new Error("Project not found");
    }

    // Create log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(
      this.logsDir,
      "tasks",
      `task-${timestamp}-${projectRecord.projectName}.log`
    );

    this.logger.info("Log file created:", logFile);

    // let setup: SubTaskRecord;
    let workDir: string;

    if (taskRecord.type === "github") {
      this.logger.info("Setting up github");
      workDir = await this.setupProject(githubInfoRecord, projectRecord);
    } else {
      this.logger.info("Setting up local");
      workDir = path.join(this.projectsRootDir, projectRecord.projectName);
    }

    return {
      workDir,
      logFile,
    };
  }

  public async scheduleSubTask(subtask: SubTaskRecord) {
    this.logger.info("Scheduling task:", subtask.id);
    await db
      .update(tasks)
      .set({
        currentSubTaskId: subtask.id,
        status: "running",
      })
      .where(eq(tasks.id, subtask.taskId));

    this.logger.info("Adding complete callback for subtask:", subtask.id);

    this.llmScheduler.addCompleteCallback(
      subtask.id,
      this.onSubTaskComplete.bind(this)
    );

    this.llmScheduler.executeTask(subtask);

    return subtask;
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
    output: LLMResult | LLMHelpRequest | null
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

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, subtask.taskId),
    });

    if (!task) {
      this.logger.error("Task not found:", subtask.taskId);
      return;
    }
    let githubInfo: TaskGithubInfoRecord | null = null;

    try {
      if (task?.type === "github") {
        this.logger.info("On github task complete:", task);
        githubInfo = (await db.query.taskGithubInfo.findFirst({
          where: eq(taskGithubInfo.id, task.githubInfoId!),
        })) as TaskGithubInfoRecord;

        if (!githubInfo) {
          throw new Error("Github info not found. Malformed task.");
        }

        if (output?.type === "help_request") {
          this.logger.info("Help request received:", output.query);
          //write comment on linked issue
          if (githubInfo.linkedIssueNumber) {
            await this.github.createComment({
              owner: githubInfo.owner,
              repository: githubInfo.repo,
              issueNumber: githubInfo.linkedIssueNumber,
              body: output.query,
            });
            await db
              .update(tasks)
              .set({
                status: "awaiting_help",
              })
              .where(eq(tasks.id, task.id));
          } else {
            this.logger.error(
              "No linked issue number found for task. \
            Unable to create comment on issue. \
            Model's question will need to be manually resolved through API."
            );
          }

          this.logger.info("Creating branch:", githubInfo.targetBranch);
          await this.github.createBranch(
            subtask.workDir,
            githubInfo.targetBranch,
            {
              owner: githubInfo.owner,
              repo: githubInfo.repo,
            }
          );
          this.logger.info("Checking out branch:", githubInfo.targetBranch);
          await this.github.checkoutBranch(
            subtask.workDir,
            githubInfo.targetBranch
          );
          this.logger.info("Committing and pushing:", githubInfo.targetBranch);
          await this.github.commitAndPush(
            subtask.workDir,
            githubInfo.targetBranch,
            "feat: incomplete commit for task: " + task.id + " (help requested)"
          );
          return;
        }

        if (!githubInfo.pullRequest) {
          this.logger.info("Creating branch:", githubInfo.targetBranch);
          await this.github.createBranch(
            subtask.workDir,
            githubInfo.targetBranch,
            {
              owner: githubInfo.owner,
              repo: githubInfo.repo,
            }
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
            repository: githubInfo.repo,
            title: output?.commitMessage || "No commit message.",
            head: githubInfo.targetBranch,
            base: githubInfo.startBranch,
            body:
              (output?.commitDescription || "No commit description.") +
              (githubInfo.linkedIssueNumber
                ? "\n\nCloses #" + githubInfo.linkedIssueNumber
                : ""),
          });

          if (!pullRequest.data) {
            this.logger.error("Pull request not created:", pullRequest);
            return;
          }

          await db
            .update(taskGithubInfo)
            .set({
              pullRequest: pullRequest.data,
            })
            .where(eq(taskGithubInfo.id, githubInfo.id));

          await db
            .update(tasks)
            .set({
              status: "awaiting_approval",
            })
            .where(eq(tasks.id, subtask.taskId));

          if (env.github.trustMeBro) {
            this.logger.info("Trust me bro. Approving pull request.");
            await this.github.approvePullRequest({
              owner: githubInfo.owner,
              repository: githubInfo.repo,
              pullRequestNumber: pullRequest.data.number,
            });
            await this._onTaskApproved(task);
          }
        }
      } else {
        await this._onTaskApproved(task);
      }
    } catch (error) {
      this.logger.error("Error in onSubTaskComplete:", error);

      await db
        .update(tasks)
        .set({
          status: "error",
        })
        .where(eq(tasks.id, task.id));

      await db
        .update(subTasks)
        .set({
          error:
            error instanceof Error
              ? "Error while finalizing task: " + error.message
              : "Unknown error while finalizing task",
        })
        .where(eq(subTasks.id, subtask.id));
    }

    const callback = this.onSubtaskCompleteCallbacks.get(task.id);
    if (callback) {
      callback(task, subtask, githubInfo ?? undefined);
    }
  }

  private async _onTaskApproved(task: TaskRecord) {
    this.logger.info("Task has been approved. Finalizing task:", task.id);
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

  private onSubtaskCompleteCallbacks: Map<
    number,
    (
      task: TaskRecord,
      subtask: SubTaskRecord,
      githubInfo?: TaskGithubInfoRecord
    ) => Promise<void>
  > = new Map();

  public addOnSubtaskCompleteCallback(
    taskId: number,
    callback: (
      task: TaskRecord,
      subtask: SubTaskRecord,
      githubInfo?: TaskGithubInfoRecord
    ) => Promise<void>
  ) {
    if (this.onSubtaskCompleteCallbacks.has(taskId)) {
      this.logger.warn("Overwriting existing callback for task:", taskId);
      return;
    }
    this.onSubtaskCompleteCallbacks.set(taskId, callback);
  }

  public removeOnSubtaskCompleteCallback(taskId: number) {
    if (!this.onSubtaskCompleteCallbacks.has(taskId)) {
      this.logger.warn("No callback found for task:", taskId);
      return;
    }
    this.onSubtaskCompleteCallbacks.delete(taskId);
  }

  private async _onTaskClosed(task: TaskRecord) {
    await db
      .update(tasks)
      .set({
        status: "closed",
      })
      .where(eq(tasks.id, task.id));
  }

  private async _finalizeTask(task: TaskRecord) {
    if (task.type === "github") {
      const githubInfo = (await db.query.taskGithubInfo.findFirst({
        where: eq(taskGithubInfo.id, task.githubInfoId!),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        throw new Error("Github info not found. Malformed task.");
      }
    }
  }
}
