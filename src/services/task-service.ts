import { db } from "@/lib/db";
import { and, asc, eq, not, notExists, or, sql } from "drizzle-orm";
import { existsSync } from "fs";
import { GithubInstallationError, GitHubWrapper } from "@/lib/github/index";
import {
  projects,
  tasks,
  subTasks,
  taskGithubInfo,
  oaiResponses,
  taskDependencies,
} from "@/lib/db/schema";
import { StartTaskRequest, UpdateProjectRequest } from "@/types/api";
import {
  LLMResult,
  LLMHelpRequest,
  SubtaskInstance,
  TaskServiceResult,
  SubtaskSetup,
} from "@/types/llm-scheduler";

import fs from "fs/promises";
import path from "path";
import {
  ProjectRecord,
  SubTaskRecord,
  TaskGithubInfoRecord,
  TaskRecord,
  TaskStatus,
  taskFinalStatuses,
} from "@/types/db";
import archiver from "archiver";
import { LLMScheduler } from "./llm-scheduler";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";
import { env } from "@/lib/env";
import winston from "winston";
import { createTaskMemory, initializeTaskMemories } from "@/llm/memory";
import { ShellService } from "./shell-service";
import { PullRequestService } from "./pr-service";
import { AppError } from "@/lib/util";

type TaskDepGraph = Map<number, Set<number>>;

type TaskDepMap = Map<number, TaskRecord>;

export class TaskService {
  constructor(
    private projectsRootDir: string,
    private logsDir: string,
    private logger: winston.Logger,
    private llmScheduler: LLMScheduler,
    private github: GitHubWrapper,
    private terminalService: ShellService,
    private prService: PullRequestService,
  ) {
    this._init();
  }

  private async _init() {
    // Create logs directory
    this.logger.info("Initializing TaskService");

    this.logger.info("Creating logs directory:", { logsDir: this.logsDir });
    await fs.mkdir(this.logsDir, { recursive: true });
    this.logger.info("Creating projects root directory:", this.projectsRootDir);
    await fs.mkdir(this.projectsRootDir, { recursive: true });

    this.logger.info(
      "Registering webhook callback on Github for pull_request_review and pull_request.closed",
    );
    this.github.githubApp.webhooks.on(
      ["pull_request_review", "pull_request.closed"],
      this.onWebhookHandler,
    );

    const dbProjects = await db.select().from(projects);
    // .where(eq(projects.shouldHaveMemories, true));

    this.logger.info(
      "Initializing task memories for " + dbProjects.length + " projects",
    );

    for (const project of dbProjects) {
      await initializeTaskMemories(project);
    }

    await this._initAndRescheduleIncompleteTasks();
    this.runLoop();
  }

  private async runLoop() {
    while (true) {
      this.logger.debug("Processing pull request updates");
      const changes = await this.prService.processPullRequestUpdates();
      for (const change of changes) {
        switch (change.status) {
          case "approved":
            await this._onTaskApproved(change.task);
            break;
          case "closed":
            await this._onTaskClosed(change.task);
            break;
          case "changes_requested":
            await this.addContinuationSubTask(change.task, change.prompt);
            break;
        }
      }

      this.logger.debug("Running runnable tasks");
      await this.runRunnableTasks();
      await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
    }
  }

  private async runRunnableTasks() {
    const projectMutex = new Set<string>();
    const projectsWithoutRunningCTE = db.$with("projects_without_running").as(
      db
        .select()
        .from(projects)
        .where(
          notExists(
            db
              .select()
              .from(tasks)
              .where(
                and(
                  eq(tasks.projectId, projects.id),
                  eq(projects.enabled, true),
                  or(eq(tasks.status, "running")),
                ),
              ),
          ),
        ),
    );

    const projectTasks = await db
      .with(projectsWithoutRunningCTE)
      .select()
      .from(tasks)
      .innerJoin(
        projectsWithoutRunningCTE,
        eq(tasks.projectId, projectsWithoutRunningCTE.id),
      )
      .leftJoin(subTasks, eq(tasks.currentSubTaskId, subTasks.id))
      .leftJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
      .orderBy(asc(tasks.createdAt));

    // console.log(runnableTasksRetQuery.toSQL());

    const deps = await db
      .select({
        id: taskDependencies.id,
        taskId: taskDependencies.taskId,
        dependencyTaskId: taskDependencies.dependencyTaskId,
        dependencyTaskStatus: tasks.status,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id));

    // const runnableTasksRet = await db
    //   .selectDistinctOn([projects.id])
    //   .from(tasks)
    //   .innerJoin(projects, eq(tasks.projectId, projects.id))
    //   .leftJoin(subTasks, eq(tasks.currentSubTaskId, subTasks.id))
    //   .leftJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
    //   .leftJoinLateral(
    //     db
    //       .select({
    //         id: taskDependencies.id,
    //         dependencyTaskId: taskDependencies.dependencyTaskId,
    //         dependencyTaskStatus: dependentTasksAlias.status,
    //       })
    //       .from(taskDependencies)
    //       .innerJoin(
    //         dependentTasksAlias,
    //         eq(taskDependencies.dependencyTaskId, dependentTasksAlias.id)
    //       )
    //       .where(eq(taskDependencies.taskId, tasks.id))
    //       .as("task_dependencies"),
    //     sql`true`
    //   )
    //   .where(
    //     and(
    //       notExists(
    //         db
    //           .select()
    //           .from(tasks)
    //           .where(
    //             and(
    //               eq(tasks.projectId, projects.id),
    //               or(eq(tasks.status, "running"))
    //             )
    //           )
    //       ),
    //       or(eq(tasks.status, "pending"))
    //     )
    //   )
    //   .orderBy(projects.id, asc(tasks.createdAt));

    const runnableTasks = projectTasks
      .filter((x) => x.tasks.status === "pending")
      .reduce(
        (acc, curr) => {
          acc[curr.tasks.id] = {
            ...curr.tasks,
            githubInfo: curr.task_github_info,
            project: curr.projects_without_running,
            currentSubTask: curr.sub_tasks,
          };
          return acc;
        },
        {} as Record<
          number,
          TaskRecord & {
            githubInfo: TaskGithubInfoRecord | null;
            project: ProjectRecord;
            currentSubTask: SubTaskRecord | null;
          }
        >,
      );

    const depGraph: TaskDepGraph = new Map();
    const taskMap: TaskDepMap = new Map();

    for (const { taskId, dependencyTaskId, dependencyTaskStatus } of deps) {
      if (!depGraph.has(taskId)) {
        depGraph.set(taskId, new Set());
      }

      depGraph.get(taskId)!.add(dependencyTaskId);

      // Ensure all tasks exist in graph even if they have no outgoing edges
      if (!depGraph.has(dependencyTaskId)) {
        depGraph.set(dependencyTaskId, new Set());
      }
    }

    const runnableTasksArray = Object.values(runnableTasks);

    for (const task of projectTasks) {
      taskMap.set(task.tasks.id, task.tasks);
    }

    for (const task of runnableTasksArray) {
      const slug = task.project.id;
      if (projectMutex.has(slug)) {
        continue;
      }

      projectMutex.add(slug);
      if (!(await this.canExecuteTask(task.project, task, depGraph, taskMap))) {
        this.logger.debug("Task dependencies not met. Skipping task:", task.id);
        projectMutex.delete(slug);
        continue;
      }

      await this.__processTask(
        task,
        task.project,
        task.currentSubTask ?? undefined,
        task.githubInfo ?? undefined,
      );
    }
  }

  private async __processTask(
    task: TaskRecord,
    project: ProjectRecord,
    currentSubTask?: SubTaskRecord,
    githubInfo?: TaskGithubInfoRecord,
  ) {
    try {
      this.logger.info("Checking github auth for task:", task.id);
      await this.github.checkAuth(project.owner, project.repo);
      this.logger.info("Github auth checked for task:", task.id);
    } catch (error) {
      if (error instanceof GithubInstallationError) {
        // The github app is not installed on the repository anymore.
        //delete the task and move on.
        this.logger.warn(
          "Github installation error. Updating task and subtask to error state.",
          error.message,
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

        return;
      } else throw error;
    }

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

    if (taskFinalStatuses.includes(task.status)) {
      // this.logger.info("Task is in a final state. Skipping task:", task.id);
      return;
    }

    if (!task.currentSubTaskId || !currentSubTask) {
      //The task never started, but we lost starting info. kill the task. if its a github task,
      //the issue crawler will pick up the issue and create a new task anyways.
      this.logger.warn("Task has no current subtask. Killing task.", task.id);
      await this.killAndRemoveTask(task);
      return;
    }

    if (currentSubTask.status === "complete") {
      //we have entered a broken task state. this usually means that the worker process was killed as approval was
      //given from a PR. it is recoverable, but not through the current webhook system, as prs would have to
      //be crawled and checked for new responses
      this.logger.warn(
        "Task is running, but subtask is in complete state. This usually means that the worker process was killed as approval was given from a PR. It is recoverable, but not through the current webhook system, as PRs would have to be crawled and checked for new responses.",
      );
      await this.killAndRemoveTask(task);
      return;
    }

    // delete any existing PRs for this task if the creator is agent
    if (githubInfo) {
      const pr = await this.github.getPRByBranch(
        project.owner,
        project.repo,
        githubInfo?.targetBranch,
      );

      if (pr && pr.user?.login === this.github.githubUsername) {
        this.logger.info(
          "Deleting existing PR for task:",
          task.id,
          "PR Number:",
          pr.number,
        );
        await this.github.closePR(project.owner, project.repo, pr.number);
      }
    }

    const { workDir, logFile } = await this._setupSubTask(task, githubInfo);

    const subtask = await this.resetSubtask(currentSubTask);

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
      this.onSubTaskComplete.bind(this),
    );

    const instance = await this.llmScheduler.executeTask(
      project,
      subtask,
      workDir,
      logFile,
    );

    return {
      task,
      subtask,
      githubInfo,
      instance,
    };
  }

  private async canExecuteTask(
    project: ProjectRecord,
    task: TaskRecord,
    depGraph: TaskDepGraph,
    taskMap: TaskDepMap,
  ) {
    const visited = new Set<number>();

    const depsInfo = {
      totalNum: 0,
      awaitingNum: 0,
      completeNum: 0,
      allCompleteBefore: true,
    };

    const depsArray = depGraph.get(task.id);

    const stack = (depsArray ? [...depsArray] : []).map((x) => ({
      taskId: x,
      currentLength: 1,
    }));

    while (stack.length > 0) {
      const stackItem = stack.pop()!;
      visited.add(stackItem.taskId);
      const { taskId, currentLength } = stackItem;
      const deps = depGraph.get(taskId);
      if (!deps) continue;
      depsInfo.totalNum++;

      const taskInfo = taskMap.get(taskId);
      if (!taskInfo) continue;

      if (taskInfo?.status === "complete") {
        depsInfo.completeNum++;
      } else {
        depsInfo.allCompleteBefore = false;
      }

      if (taskInfo.status === "awaiting_approval") {
        depsInfo.awaitingNum++;
      }

      for (const depTaskId of deps) {
        if (visited.has(depTaskId)) {
          continue;
        }

        stack.push({ taskId: depTaskId, currentLength: currentLength + 1 });
      }
    }

    if (depsInfo.totalNum != depsInfo.completeNum + depsInfo.awaitingNum) {
      return false;
    }

    if (depsInfo.awaitingNum >= project.maxChainedPRs) {
      return false;
    }

    return true;
  }

  private async _initAndRescheduleIncompleteTasks() {
    const incompleteTasks = await db
      .select()
      .from(tasks)
      .where(or(eq(tasks.status, "running")));

    this.logger.info("Found " + incompleteTasks.length + " incomplete tasks");

    for (const task of incompleteTasks) {
      this.logger.info("Incomplete task:", task.id);
      if (task.type !== "github") {
        continue;
      }

      const project = (await db.query.projects.findFirst({
        where: eq(projects.id, task.projectId),
      })) as ProjectRecord;

      const githubInfo = (await db.query.taskGithubInfo.findFirst({
        where: eq(taskGithubInfo.taskId, task.id),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        continue;
      }

      const currentSubTask = task.currentSubTaskId
        ? await db.query.subTasks.findFirst({
            where: eq(subTasks.id, task.currentSubTaskId),
          })
        : undefined;

      await this.__processTask(task, project, currentSubTask, githubInfo);
    }
  }

  private async resetSubtask(subtask: SubTaskRecord) {
    const subtaskRecord = await db
      .update(subTasks)
      .set({
        status: "pending",
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
        .innerJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(projects.repo, event.payload.repository.name),
            eq(projects.owner, event.payload.repository.owner.login),
            eq(
              sql`${taskGithubInfo.pullRequest}->>'number'`,
              event.payload.pull_request.number,
            ),
            or(
              eq(tasks.status, "awaiting_approval"),
              eq(tasks.status, "awaiting_help"),
              // eq(tasks.status, "running"),
              // eq(tasks.status, "pending")
            ),
          ),
        );

      if (dbtasks.length === 0) {
        this.logger.warn(
          "No task found for pull request:",
          event.payload.pull_request.number,
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
            this.logger.info("Rescheduling task:", task.id);

            await this.addContinuationSubTask(task, newPrompt);
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

  public async addContinuationSubTask(
    task: TaskRecord,
    prompt: string,
  ): Promise<TaskServiceResult> {
    const projectRecord = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });

    if (!projectRecord) {
      throw new Error("Project not found");
    }

    const previousSubTask = await db.query.subTasks.findFirst({
      where: eq(subTasks.id, task.currentSubTaskId!),
    });

    if (!previousSubTask) {
      throw new Error("Previous subtask not found");
    }

    const newSubTask = await this.createSubTask({
      taskId: task.id,
      modelName: projectRecord.defaultModel,
      prompt,
      previousSubTaskId: previousSubTask.id,
    });

    await this.scheduleTask(task.id, newSubTask.id);

    const githubInfo = await db.query.taskGithubInfo.findFirst({
      where: eq(taskGithubInfo.taskId, task.id),
    });

    return {
      task,
      subtask: newSubTask,
      githubInfo: githubInfo ?? undefined,
    };
  }

  private async _setupWorkingDir(
    task: TaskRecord,
    project: ProjectRecord,
    githubInfo?: TaskGithubInfoRecord,
    overwrite = true,
  ) {
    const projectBaseDir = path.join(this.projectsRootDir, project.projectName);
    if (existsSync(projectBaseDir) && overwrite) {
      await fs.rm(projectBaseDir, { recursive: true, force: true });
    }

    if (task.type === "github") {
      const repo = project.repo;
      const owner = project.owner;

      if (!existsSync(projectBaseDir)) {
        this.logger.info("Cloning repo:", repo, owner);
        await this.github.cloneRepo(repo, owner, projectBaseDir);
      } else {
        this.logger.info("Pulling repo:", repo, owner);
        await this.github.pullRepo(repo, owner, projectBaseDir);
      }

      // first check if the target branch exists, and if the LLM commited something there before
      let branch = githubInfo?.targetBranch;
      if (branch) {
        const branchExists = await this.github.branchExists(
          project.owner,
          project.repo,
          branch,
        );
        if (!branchExists) {
          this.logger.debug(
            "Target branch does not exist. Using start branch:",
            githubInfo?.startBranch,
          );
          branch = githubInfo?.startBranch;
        } else {
          this.logger.debug(
            "Target branch exists. Using target branch:",
            branch,
          );
        }
      }

      branch ??= githubInfo?.startBranch;

      if (branch) {
        this.logger.info("Checking out branch:", branch);
        await this.github.checkoutBranch(projectBaseDir, branch);
      }
    }

    return projectBaseDir;
  }

  public async createProject({
    projectName,
    owner,
    repo,
    defaultModel,
  }: {
    projectName: string;
    owner: string;
    repo: string;
    defaultModel?: string;
  }) {
    const projectRecord = await db
      .insert(projects)
      .values({
        projectName,
        repo,
        owner,
        defaultModel: defaultModel ?? env.openai.defaultModel,
      })
      .returning();

    return projectRecord[0];
  }

  public async updateProject(project: UpdateProjectRequest) {
    await db
      .update(projects)
      .set({
        projectName: project.projectName,
        defaultBaseBranch: project.defaultBaseBranch,
        projectSpecification: project.projectSpecification,
        defaultModel: project.defaultModel,
      })
      .where(
        and(eq(projects.owner, project.owner), eq(projects.repo, project.repo)),
      );

    return {
      success: true,
    };
  }

  private async getProject(projectName: string) {
    this.logger.info("Getting project:", projectName);
    let projectRecord = await db.query.projects.findFirst({
      where: eq(projects.projectName, projectName),
    });

    return projectRecord;
  }

  private async createTask(
    projectRecord: ProjectRecord,
    task: StartTaskRequest,
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
    }

    return {
      taskRecord: taskRecord[0],
      githubInfoRecord,
    };
  }

  private async createSubTask({
    taskId,
    modelName,
    prompt,
    previousSubTaskId,
  }: {
    taskId: number;
    modelName: string;
    prompt: string;
    previousSubTaskId?: number;
  }) {
    const subTaskRecord = await db
      .insert(subTasks)
      .values({
        taskId,
        modelName,
        status: "pending",
        prompt: `${prompt}`,
        previousSubTaskId,
      })
      .returning();

    return subTaskRecord[0] as SubTaskRecord;
  }

  private async scheduleTask(taskId: number, subtaskId: number) {
    return db
      .update(tasks)
      .set({
        currentSubTaskId: subtaskId,
        status: "pending",
      })
      .where(eq(tasks.id, taskId))
      .returning();
  }

  public async addTask(
    startTask: StartTaskRequest,
  ): Promise<TaskServiceResult> {
    // this.newTaskQueue.push(task);
    // const workDir = path.join(this.projectsRootDir, task.projectName);
    // if (existsSync(workDir)) {
    //   await fs.rm(workDir, { recursive: true, force: true });
    // }

    // await fs.mkdir(workDir, { recursive: true });
    this.logger.info("New task added");
    if (startTask.type === "github") {
      await this.github.checkAuth(startTask.owner, startTask.repo);
    }

    const projectName =
      startTask.type === "github"
        ? `${startTask.owner}/${startTask.repo}`
        : startTask.projectName;

    const projectRecord = await this.getProject(projectName);

    if (!projectRecord) {
      throw new Error("Project not found");
    }

    const { taskRecord, githubInfoRecord } = await this.createTask(
      projectRecord,
      startTask,
    );

    for (const dependencyId of startTask.taskDependencies ?? []) {
      const dependencyTask = await db.query.tasks.findFirst({
        where: eq(tasks.id, dependencyId),
      });
      if (!dependencyTask) {
        throw new Error("Dependency task not found");
      }

      await db.insert(taskDependencies).values({
        taskId: taskRecord.id,
        dependencyTaskId: dependencyTask.id,
      });
    }

    this.logger.info("Task record created:", taskRecord.id);

    this.logger.info("Creating subtask", {
      taskId: taskRecord.id,
      modelName: projectRecord.defaultModel,
    });

    const subTask = await this.createSubTask({
      taskId: taskRecord.id,
      modelName: projectRecord.defaultModel,
      prompt: `You are working on a project called ${
        projectRecord.projectName
      }. The project is hosted on GitHub at ${
        projectRecord.repo
      } and is owned by ${projectRecord.owner}.
${
  projectRecord.projectSpecification
    ? `The project description is as follows:\n ${projectRecord.projectSpecification}`
    : ""
}
${startTask.prompt}`,
    });

    this.logger.info("Scheduling subtask", {
      subtaskId: subTask.id,
    });

    await this.scheduleTask(taskRecord.id, subTask.id);

    return {
      task: taskRecord,
      subtask: subTask,
      githubInfo: githubInfoRecord ?? undefined,
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
            eq(subTasks.status, "running"),
          ),
        );
    }
    this.llmScheduler.stopTaskIfExists(taskRecord.id);
  }

  private async _setupSubTask(
    taskRecord: TaskRecord,
    githubInfoRecord?: TaskGithubInfoRecord,
  ) {
    this.logger.info("Setting up subtask:", taskRecord.id);

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
      `task-${timestamp}-${projectRecord.projectName}.log`,
    );

    this.logger.info("Log file created:", logFile);

    // let setup: SubTaskRecord;

    const workDir = await this._setupWorkingDir(
      taskRecord,
      projectRecord,
      githubInfoRecord,
    );

    if (projectRecord.beforeStartShellScript) {
      this.logger.info("Running before start shell script.");
      this.logger.debug("Shell script:", projectRecord.beforeStartShellScript);
      const result = await this.terminalService.runCommand(
        projectRecord.beforeStartShellScript,
        30000,
        workDir,
      );

      if (result.exitCode !== 0) {
        this.logger.error("Failed to run before start shell script:", result);
      }
    }

    return {
      workDir,
      logFile,
    };
  }

  public async getCurrentSubTaskStatus(id: number) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });
    if (!task) {
      throw new AppError(400, "Task not found", "20001");
    }

    if (!task.currentSubTaskId) {
      throw new AppError(400, "No active subtask for task", "20003");
    }

    const subtask = await db.query.subTasks.findFirst({
      where: eq(subTasks.id, task.currentSubTaskId),
    });

    if (!subtask) {
      throw new AppError(400, "Subtask not found", "20002");
    }

    return {
      success: true,
      status: subtask.status,
      error: subtask.error,
    };
  }

  public async getSubTaskLogs(taskId: number, subtaskId?: number) {
    return this.tailTaskLogs(taskId, subtaskId);
  }

  public async getTask(id: number) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });

    if (!task) {
      throw new AppError(400, "Task not found", "20006");
    }

    return {
      success: true,
      task: task,
    };
  }

  public async getSubTaskFiles(id: number): Promise<{
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

    if (!task || !task.currentSubTaskId) {
      throw new AppError(400, "Task or subtask not found", "20007");
    }

    try {
      return await this.llmScheduler.getSubTaskFiles(
        task.currentSubTaskId.toString(),
      );
    } catch (error) {
      throw new AppError(
        500,
        error instanceof Error
          ? error.message
          : "Failed to retrieve subtask files",
        "20008",
      );
    }
  }

  public async listProjects(limit = 50, offset = 0) {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(asc(projects.projectName))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      projects: rows,
    };
  }

  public async listProjectTasks(projectId: string, limit = 50, offset = 0) {
    const rows = await db
      .select({
        task: tasks,
        githubInfo: taskGithubInfo,
      })
      .from(tasks)
      .leftJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.id))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      tasks: rows,
    };
  }

  public async listProjectSubtasks(projectId: string, limit = 50, offset = 0) {
    const rows = await db
      .select({
        subtask: subTasks,
        task: tasks,
      })
      .from(subTasks)
      .innerJoin(tasks, eq(subTasks.taskId, tasks.id))
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(subTasks.id))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      subtasks: rows,
    };
  }

  public async tailTaskLogs(taskId: number, subtaskId?: number) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      return {
        success: false,
        error: "Task not found",
      };
    }

    const activeSubtaskId = subtaskId ?? task.currentSubTaskId;

    if (!activeSubtaskId) {
      return {
        success: false,
        error: "No active subtask",
      };
    }

    try {
      const logs = await this.llmScheduler.getSubtaskLogs(activeSubtaskId);
      return {
        success: true,
        logs,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? `${error.message}. Logs are only available for running subtasks.`
            : "Failed to read logs",
      };
    }
  }

  public async onSubTaskComplete(
    subtask: SubTaskRecord,
    setup: SubtaskSetup,
    error: Error | null,
    output: LLMResult | LLMHelpRequest | null,
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
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });

    if (!project) {
      throw new Error("Project not found");
    }

    let githubInfo: TaskGithubInfoRecord | null = null;

    try {
      if (task?.type === "github") {
        this.logger.info("On github task complete:", task);
        githubInfo = (await db.query.taskGithubInfo.findFirst({
          where: eq(taskGithubInfo.taskId, task.id),
        })) as TaskGithubInfoRecord;

        if (!githubInfo) {
          throw new Error("Github info not found. Malformed task.");
        }

        let commitMessage = "";

        if (output?.type === "help_request") {
          this.logger.info("Help request received:", output.query);
          //write comment on linked issue
          if (githubInfo.linkedIssueNumber) {
            await this.github.createComment({
              owner: project.owner,
              repository: project.repo,
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
            Model's question will need to be manually resolved through API.",
            );
          }

          commitMessage =
            "feat: incomplete commit for task: " +
            task.id +
            " (help requested)";
        } else {
          commitMessage = output?.commitMessage || "No commit message.";
        }
        this.logger.info("Creating branch:", githubInfo.targetBranch);
        await this.github.createBranchIfNotExists(
          setup.workDir,
          githubInfo.targetBranch,
          {
            owner: project.owner,
            repo: project.repo,
          },
        );
        this.logger.info("Checking out branch:", githubInfo.targetBranch);
        await this.github.checkoutBranch(
          setup.workDir,
          githubInfo.targetBranch,
        );
        this.logger.info("Committing and pushing:", githubInfo.targetBranch);
        await this.github.commitAndPush(
          setup.workDir,
          githubInfo.targetBranch,
          commitMessage,
        );
        if (!githubInfo.pullRequest && output?.type === "tool_result") {
          this.logger.info("Creating pull request:", githubInfo.targetBranch);
          const pullRequest = await this.github.createPullRequest({
            owner: project.owner,
            repository: project.repo,
            title: commitMessage,
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
              owner: project.owner,
              repository: project.repo,
              pullRequestNumber: pullRequest.data.number,
            });
            await this._onTaskApproved(task);
          }
        }
      } else {
        await this._onTaskApproved(task);
      }

      await createTaskMemory(this.logger, task, project);
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
      callback(task, subtask, setup, project, githubInfo ?? undefined);
    }
  }

  public async _onTaskApproved(task: TaskRecord) {
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
      setup: SubtaskSetup,
      project: ProjectRecord,
      githubInfo?: TaskGithubInfoRecord,
    ) => Promise<void>
  > = new Map();

  public addOnSubtaskCompleteCallback(
    taskId: number,
    callback: (
      task: TaskRecord,
      subtask: SubTaskRecord,
      setup: SubtaskSetup,
      project: ProjectRecord,
      githubInfo?: TaskGithubInfoRecord,
    ) => Promise<void>,
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

  public async _onTaskClosed(task: TaskRecord) {
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
        where: eq(taskGithubInfo.taskId, task.id),
      })) as TaskGithubInfoRecord;

      if (!githubInfo) {
        throw new Error("Github info not found. Malformed task.");
      }
    }
  }
}
