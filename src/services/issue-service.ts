import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { db } from "../lib/db";
import { projects, subTasks, taskGithubInfo, tasks } from "../lib/db/schema";
import { and, eq, or, not } from "drizzle-orm";
import { BeginEpicRequest, GithubStartTaskRequest } from "@/types/api";
import { env } from "../lib/env";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";
import winston from "winston";
import { createDefaultWinstonLogger } from "../lib/basic-logger";
import { GitHubWrapper } from "../lib/github";
import { TaskService } from "./task-service";
import { ProjectRecord, TaskGithubInfoRecord, TaskRecord } from "@/types/db";
import { taskActiveStatuses, taskSuccessStatuses } from "@/types/db";
import { TaskServiceResult } from "@/types/llm-scheduler";

type GitHubIssue =
  RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"][number];

export class IssueService {
  private logger: winston.Logger;
  private labelType: "accept" | "ignore";
  private labels: string[];

  constructor(private github: GitHubWrapper, private taskService: TaskService) {
    this.logger = createDefaultWinstonLogger(
      "IssueService",
      "issue-service.log"
    );

    const ACCEPT_LABELS = env.github.issueAcceptLabels;
    const IGNORE_LABELS = env.github.issueIgnoreLabels;

    if (ACCEPT_LABELS && IGNORE_LABELS) {
      throw new Error(
        "Cannot use both accept and ignore labels for crawling issues."
      );
    }

    this.logger.info("Initializing issue crawler");
    this.logger.info(`ACCEPT_LABELS: ${ACCEPT_LABELS}`);
    this.logger.info(`IGNORE_LABELS: ${IGNORE_LABELS}`);

    if (ACCEPT_LABELS) {
      this.labelType = "accept";
      this.labels = ACCEPT_LABELS.split(",");
    } else if (IGNORE_LABELS) {
      this.labelType = "ignore";
      this.labels = IGNORE_LABELS.split(",");
    } else {
      throw new Error("No issue labels provided");
    }

    this.github.githubApp.webhooks.on(
      ["issues", "issue_comment"],
      this.createWebhook()
    );

    this.crawlIssues();
  }

  public async completeEpic({
    issueId,
    repo,
    owner,
    baseBranch: startingBaseBranch,
  }: BeginEpicRequest) {
    const octokit = await this.github.findRepoClient(owner, repo);
    const issues = await octokit.rest.issues.get({
      owner: owner,
      repo: repo,
      issue_number: issueId,
    });

    const epic = issues.data;

    if (!epic) {
      throw new Error("Epic not found");
    }

    const subIssues = await octokit.rest.issues.listSubIssues({
      owner: owner,
      repo: repo,
      issue_number: epic.number,
    });

    const projectDb = await db.query.projects.findFirst({
      where: and(eq(projects.owner, owner), eq(projects.repo, repo)),
    });
    if (!projectDb) {
      throw new Error(`Project ${owner}/${repo} not found.`);
    }

    let previousTask: number | null = null;
    let baseBranch: string = startingBaseBranch ?? projectDb.defaultBaseBranch;

    for (const subIssue of subIssues.data) {
      this.logger.info(
        `Processing subissue ${subIssue.number} for epic ${epic.number} in ${owner}/${repo}.`
      );

      const res = await this.processIssue(
        subIssue,
        previousTask ? [previousTask] : [],
        projectDb,
        baseBranch
      );
      if (!res) {
        this.logger.warn(
          `Failed to process subissue ${subIssue.number} for epic ${epic.number} in ${owner}/${repo}. Cannot continue.`
        );
        return;
      }

      this.logger.info(
        `Subissue ${subIssue.number} for epic ${epic.number} in ${owner}/${repo} processed.`
      );

      previousTask = res.task.id;
      baseBranch = res.githubInfo?.targetBranch ?? baseBranch;
    }
  }

  public async crawlIssues() {
    this.logger.info("Starting issue crawler");
    await this.github.githubApp.eachRepository(async (o) => {
      this.logger.info(
        `Enumerating issues for ${o.repository.owner.login}/${o.repository.name}.`,
      );
      const octokit = o.octokit as Octokit;
      const ret = await octokit.rest.issues.listForRepo({
        owner: o.repository.owner.login,
        repo: o.repository.name,
      });

      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.owner, o.repository.owner.login),
          eq(projects.repo, o.repository.name),
        ),
      });

      let projectDb = await db.query.projects.findFirst({
        where: and(
          eq(projects.owner, o.repository.owner.login),
          eq(projects.repo, o.repository.name),
        ),
      });

      if (!projectDb) {
        this.logger.info(
          `Project ${o.repository.owner.login}/${o.repository.name} not found. Creating.`,
        );
        projectDb = await this.taskService.createProject({
          projectName: `${o.repository.owner.login}/${o.repository.name}`,
          owner: o.repository.owner.login,
          repo: o.repository.name,
        });
        if (!projectDb) {
          this.logger.error(
            `Failed to create project ${o.repository.owner.login}/${o.repository.name}. Skipping.`,
          );
          return;
        }
      }

      if (!projectDb.enabled) {
        this.logger.info(
          `Project ${o.repository.owner.login}/${o.repository.name} is disabled. Skipping.`,
        );

        return;
      }

      const issues = ret.data.filter((i) => !i.pull_request);

      if (issues.length === 0) {
        this.logger.info(
          `No issues found for ${o.repository.owner.login}/${o.repository.name}. Skipping.`,
        );
        return;
      }

      const ignoredOrAlreadyActive = await db
        .select()
        .from(taskGithubInfo)
        .innerJoin(tasks, eq(taskGithubInfo.taskId, tasks.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(projects.owner, o.repository.owner.login),
            eq(projects.repo, o.repository.name),
            and(
              not(eq(tasks.status, "closed")),
              // not(eq(tasks.status, "complete")),
              not(eq(tasks.status, "error")),
              not(eq(tasks.status, "killed")),
            ),
          ),
        );

      // if (
      //   ignoredOrAlreadyActive.some(
      //     (t) => t.tasks.status === "running" || t.tasks.status === "pending"
      //   )
      // ) {
      //   this.logger.info(
      //     `Already running tasks for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
      //   );
      //   return;
      // }

      const relevantIssues = issues
        .filter(
          (i) =>
            !ignoredOrAlreadyActive.some(
              (t) =>
                t.task_github_info.linkedIssueNumber === i.number &&
                t.tasks.status === "awaiting_approval",
            ),
        )
        .filter((i) => {
          const labels = i.labels
            .map((l) => (typeof l === "string" ? l : l.name))
            .filter((x) => x);
          if (this.labelType === "ignore") {
            return !this.labels.some((l) => labels.includes(l));
          }
          if (this.labelType === "accept") {
            return this.labels.some((l) => labels.includes(l));
          }
        });

      // add issues that may not have the label but are awaiting help
      relevantIssues.push(
        ...issues.filter((x) => {
          return (
            ignoredOrAlreadyActive.find(
              (t) => t.task_github_info.linkedIssueNumber === x.number,
            )?.tasks.status === "awaiting_help" &&
            !relevantIssues.some((y) => y.number === x.number)
          );
        }),
      );

      this.logger.info(
        `Found ${issues.length} issues for ${o.repository.owner.login}/${o.repository.name}.`,
      );
      this.logger.info(
        `Found ${relevantIssues.length} relevant issues for ${o.repository.owner.login}/${o.repository.name}.`,
      );

      // const issue = relevantIssues.find((i) => i.body && i.body.length > 0);
      for (const issue of relevantIssues) {
        try {
          const newTask = await this.processIssue(issue, [], projectDb);

          if (!newTask) {
            continue;
          }

          this.taskService.addOnSubtaskCompleteCallback(
            newTask.task.id,
            async (task, subtask, setup, project, githubInfo) => {
              this.logger.info(
                `Subtask ${subtask.id} complete for ${project.owner}/${project.repo}. Crawling issues.`,
              );
              this.taskService.removeOnSubtaskCompleteCallback(task.id);
              if (!githubInfo) {
                this.logger.error(
                  `Failed to get github info for ${project.owner}/${project.repo}. Skipping.`,
                );
                return;
              }
              this.crawlIssues();
            },
          );
        } catch (e) {
          this.logger.error(
            `Failed to process issue ${issue.number} for ${o.repository.owner.login}/${o.repository.name}. Skipping.`,
          );
          continue;
        }
      }

      // return {
      //   owner: o.repository.owner.login,
      //   repo: o.repository.name,
      //   issues: relevantIssues,
      // };
    });
  }

  private currentlyProcessingIssues = new Set<number>();

  public async processIssue(
    issue: GitHubIssue,
    taskDependencies: number[],
    project: ProjectRecord,
    baseBranch?: string
  ): Promise<TaskServiceResult | null> {
    if (this.currentlyProcessingIssues.has(issue.number)) {
      this.logger.info(
        `Issue ${issue.number} is already being processed. Skipping.`
      );
      return null;
    }
    this.currentlyProcessingIssues.add(issue.number);
    const repo = project.repo;
    const owner = project.owner;

    const previousTaskAttempts = await db
      .select()
      .from(tasks)
      .leftJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
      .leftJoin(subTasks, eq(tasks.currentSubTaskId, subTasks.taskId))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(projects.owner, owner),
          eq(projects.repo, repo),
          eq(taskGithubInfo.linkedIssueNumber, issue.number)
        )
      );

    if (!issue) {
      throw new Error("Issue is null");
    }

    const awaitingHelpTask = previousTaskAttempts.find(
      (t) => t.tasks.status === "awaiting_help"
    );

    if (awaitingHelpTask) {
      return await this.crawlIssueComments(issue.number);
    }

    const previousRunningTask = previousTaskAttempts.find((x) =>
      taskActiveStatuses.includes(x.tasks.status)
    );

    if (previousRunningTask) {
      this.logger.info(
        `Running task found for issue ${issue.number} for ${owner}/${repo}. Skipping.`
      );
      return {
        task: previousRunningTask.tasks,
        subtask: previousRunningTask.sub_tasks!,
        githubInfo: previousRunningTask.task_github_info ?? undefined,
      };
    }

    const previousRunningTaskSuccess = previousTaskAttempts.find(
      (x) =>
        x.task_github_info?.pullRequest &&
        [...taskSuccessStatuses, ...taskActiveStatuses].includes(x.tasks.status)
    );

    if (previousRunningTaskSuccess) {
      this.logger.info(
        `PR already exists for issue ${issue.number} for ${owner}/${repo}. Skipping.`
      );
      return {
        task: previousRunningTaskSuccess.tasks,
        subtask: previousRunningTaskSuccess.sub_tasks!,
        githubInfo: previousRunningTaskSuccess.task_github_info ?? undefined,
      };
    }

    if (!issue?.body) {
      this.logger.warn(
        `Issue ${issue.number} on ${owner}/${repo} has no body. Skipping.`
      );
      return null;
    }

    try {
      const client = await this.github.findRepoClient(owner, repo);
      const issueComments = await client.rest.issues.listComments({
        owner: owner,
        repo: repo,
        issue_number: issue.number,
      });
      if (
        previousTaskAttempts.length > 0 ||
        issueComments.data.some(
          (c) => c.user?.login === this.github.githubUsername
        )
      ) {
        this.logger.info(`Previous task attempts found for ${owner}/${repo}.`);
      } else {
        const repoClient = await this.github.findRepoClient(owner, repo);
        await repoClient.rest.issues.createComment({
          owner: owner,
          repo: repo,
          issue_number: issue.number,
          body: `I'll get right on it!`,
        });
      }
    } catch (e) {
      this.logger.error(
        `Failed to comment on issue ${issue.number} for ${owner}/${repo}. Error: ${e}`
      );
    }

    const startBranch = baseBranch ?? project.defaultBaseBranch;
    const targetBranch = "feat/issue-" + issue.number;

    this.logger.info(
      `Found issue ${issue.number} for ${owner}/${repo}. Scheduling task from branch: ${startBranch} to branch: ${targetBranch}.`
    );

    const taskService = this.taskService;
    const newTask = await taskService.addTask({
      type: "github",
      owner: owner,
      taskDependencies: taskDependencies,
      repo: repo,
      startBranch: startBranch,
      targetBranch: targetBranch,
      linkedIssueNumber: issue.number,
      prompt: `
You have been tasked with solving the following issue:
--------
TITLE: ${issue.title}
LABELS: ${issue.labels
        .map((l) => (typeof l === "string" ? l : l.name))
        .join(", ")}
ISSUE NUMBER: ${issue.number}
URL: ${issue.html_url}
--------
BODY:
${issue.body}
--------
Your job is to solve the issue. 
If you have questions, use the 'ask_for_help' tool to ask questions.
    `,
    } satisfies GithubStartTaskRequest);

    if (!newTask.task) {
      this.logger.error(`Failed to add task for ${owner}/${repo}.`);
      return null;
    }

    this.currentlyProcessingIssues.delete(issue.number);

    return newTask;
  }

  public async crawlIssueComments(issueNumber: number) {
    const issueTasks = await db
      .select()
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
      .where(
        and(
          eq(taskGithubInfo.linkedIssueNumber, issueNumber),
          eq(tasks.status, "awaiting_help")
        )
      );

    if (issueTasks.length === 0) {
      this.logger.warn(
        "comments: Nothing relevant found for issue:",
        issueNumber
      );
      return null;
    }

    const issueTask = issueTasks[0];

    const octokit = await this.github.findRepoClient(
      issueTask.projects.owner,
      issueTask.projects.repo
    );

    const issueComments = await octokit.rest.issues.listComments({
      owner: issueTask.projects.owner,
      repo: issueTask.projects.repo,
      issue_number: issueNumber,
    });

    //find latest comment by agent
    const agentComment = issueComments.data
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .find((c) => c.user?.login === this.github.githubUsername);

    if (!agentComment) {
      this.logger.warn("No agent comment found for issue:", issueNumber);
      return null;
    }

    // find the index of the agent comment
    const agentCommentIndex = issueComments.data.indexOf(agentComment);

    //look for response comments only BEFORE the agent comment (sorted newest to oldest)
    const responseComments = issueComments.data
      .slice(0, agentCommentIndex)
      .filter((c) => c.body?.includes(this.github.appName));

    if (responseComments.length === 0) {
      this.logger.warn("No response comments found for issue:", issueNumber);
      return null;
    }

    const responseComment = responseComments[responseComments.length - 1];

    if (!responseComment.body) {
      this.logger.warn(
        "No response comment body found for issue:",
        issueNumber
      );
      return null;
    }

    const newPrompt =
      "In response to your question, the PM said:\n\n" +
      responseComment.body.replace(this.github.appName, "You");

    const newSubTask = await this.taskService.addContinuationSubTask(
      issueTask.tasks,
      newPrompt
    );

    this.logger.info(
      "Help answer received, scheduled subtask with id: " +
        newSubTask.subtask.id,
      {
        issueId: issueNumber,
        subtaskId: newSubTask.subtask.id,
        repo: issueTask.projects.repo,
        owner: issueTask.projects.owner,
        taskId: newSubTask.task.id,
      }
    );

    return newSubTask;
  }

  private createWebhook(): HandlerFunction<"issues" | "issue_comment"> {
    return async (event) => {
      this.logger.info(
        `Received issue event: ${event.payload.action} for ${event.payload.issue.number}`
      );
      if (event.name === "issues") {
        if (
          event.payload.action === "opened" ||
          event.payload.action === "reopened" ||
          event.payload.action === "labeled"
        ) {
          if (flag.has(event.payload.issue.number)) {
            this.logger.info(
              `Skipping issue ${event.payload.issue.number} because it has already been crawled.`
            );
            return;
          }
          flag.add(event.payload.issue.number);
          this.logger.info(`Crawling issues for ${event.payload.issue.number}`);
          await this.crawlIssues();
          flag.delete(event.payload.issue.number);
        } else if (
          event.payload.action === "locked" ||
          event.payload.action === "closed"
        ) {
          const logString = `${event.payload.repository.owner.login}/${event.payload.repository.name}#${event.payload.issue.number}`;
          if (event.payload.issue.state_reason === "completed") {
            this.logger.info(`Issue ${logString} completed. Skipping.`);
            return;
          }
          // attempt to end task and remove PR
          this.logger.info(
            `Attempting to end task and remove PR for ${logString}`
          );
          const tasksRecord = await db
            .select()
            .from(tasks)
            .innerJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
            .innerJoin(projects, eq(tasks.projectId, projects.id))
            .where(
              eq(taskGithubInfo.linkedIssueNumber, event.payload.issue.number)
            );

          const task = tasksRecord.find(
            (t) => t.tasks.status === "running" || t.tasks.status === "pending"
          );
          if (task) {
            await this.taskService.stopTask(task.tasks.id);
          }
        }
      } else if (event.name === "issue_comment") {
        this.logger.info("Issue comment event received");
        if (
          event.payload.action !== "created" &&
          event.payload.action !== "edited"
        ) {
          this.logger.info(
            "Issue comment event not created or edited. Skipping."
          );
          return;
        }

        this.crawlIssueComments(event.payload.issue.number);
      }
    };
  }
}

// function setupIssueCrawlerCronJob(issueState: IssueState) {
//   //every 10 minutes
//   const cron = new CronJob("*/10 * * * *", async () => {
//     await crawlIssues(issueState);
//   });
//   cron.start();
// }

const flag = new Set<number>();

// export function initIssueCrawler() {
//   const issueState = initIssueState();
//   //   setupIssueCrawlerCronJob(issueState);
//   this.github.githubApp.webhooks.on("issues", createWebhook(issueState));
//   //start
//   crawlIssues(issueState);
// }
