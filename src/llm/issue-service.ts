import { Octokit } from "@octokit/rest";
import { db } from "../lib/db";
import { taskGithubInfo, tasks } from "../lib/db/schema";
import { and, eq, or, not } from "drizzle-orm";
import { GithubStartTaskRequest } from "@/types/api";
import { env } from "../lib/env";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";
import winston from "winston";
import { createDefaultWinstonLogger } from "../lib/basic-logger";
import { GitHubWrapper } from "../lib/github";
import { TaskService } from "./task-service";

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

    this.github.githubApp.webhooks.on("issues", this.createWebhook());

    this.crawlIssues();
  }

  public async crawlIssues() {
    this.logger.info("Starting issue crawler");
    await this.github.githubApp.eachRepository(async (o) => {
      this.logger.info(
        `Enumerating issues for ${o.repository.owner.login}/${o.repository.name}.`
      );
      const octokit = o.octokit as Octokit;
      const ret = await octokit.rest.issues.listForRepo({
        owner: o.repository.owner.login,
        repo: o.repository.name,
      });

      const issues = ret.data.filter((i) => !i.pull_request);

      if (issues.length === 0) {
        this.logger.info(
          `No issues found for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
        );
        return;
      }

      const ignoredOrAlreadyActive = await db
        .select()
        .from(taskGithubInfo)
        .innerJoin(tasks, eq(taskGithubInfo.id, tasks.githubInfoId))
        .where(
          and(
            eq(taskGithubInfo.owner, o.repository.owner.login),
            eq(taskGithubInfo.repo, o.repository.name),
            and(
              not(eq(tasks.status, "closed")),
              // not(eq(tasks.status, "complete")),
              not(eq(tasks.status, "error")),
              not(eq(tasks.status, "killed"))
            )
          )
        );

      if (
        ignoredOrAlreadyActive.some(
          (t) => t.tasks.status === "running" || t.tasks.status === "pending"
        )
      ) {
        this.logger.info(
          `Already running tasks for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
        );
        return;
      }

      const relevantIssues = issues
        .filter(
          (i) =>
            !ignoredOrAlreadyActive.some(
              (t) =>
                t.task_github_info.linkedIssueNumber === i.number &&
                t.tasks.status === "awaiting_approval"
            )
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

      this.logger.info(
        `Found ${issues.length} issues for ${o.repository.owner.login}/${o.repository.name}.`
      );
      this.logger.info(
        `Found ${relevantIssues.length} relevant issues for ${o.repository.owner.login}/${o.repository.name}.`
      );

      // const issue = relevantIssues.find((i) => i.body && i.body.length > 0);
      for (const issue of relevantIssues) {
        const issueTasks = ignoredOrAlreadyActive.filter(
          (t) => t.task_github_info.linkedIssueNumber === issue.number
        );

        const awaitingHelpTask = issueTasks.find(
          (t) => t.tasks.status === "awaiting_help"
        );

        if (awaitingHelpTask) {
          this.crawlIssueComments(issue.number);
          continue;
        }

        if (!issue?.body) {
          this.logger.warn(
            `Issue ${issue.number} on ${o.repository.owner.login}/${o.repository.name} has no body. Skipping.`
          );
          continue;
        }

        try {
          const previousTaskAttempts = await db
            .select()
            .from(tasks)
            .leftJoin(taskGithubInfo, eq(tasks.githubInfoId, taskGithubInfo.id))
            .where(
              and(
                eq(taskGithubInfo.owner, o.repository.owner.login),
                eq(taskGithubInfo.repo, o.repository.name),
                eq(taskGithubInfo.linkedIssueNumber, issue.number)
              )
            );
          if (previousTaskAttempts.length > 0) {
            this.logger.info(
              `Previous task attempts found for ${o.repository.owner.login}/${o.repository.name}.`
            );

            if (
              previousTaskAttempts.some((x) => x.task_github_info?.pullRequest)
            ) {
              this.logger.info(
                `PR already exists for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
              );
              continue;
            }
          } else {
            const repoClient = await this.github.findRepoClient(
              o.repository.owner.login,
              o.repository.name
            );
            await repoClient.rest.issues.createComment({
              owner: o.repository.owner.login,
              repo: o.repository.name,
              issue_number: issue.number,
              body: `I'll get right on it!\n\nIssue ${issue.number} has been scheduled for a task.`,
            });
          }
        } catch (e) {
          this.logger.error(
            `Failed to comment on issue ${issue.number} for ${o.repository.owner.login}/${o.repository.name}. Error: ${e}`
          );
          continue;
        }

        const startBranch = "main";
        const targetBranch = "feat/issue-" + issue.number;

        this.logger.info(
          `Found issue ${issue.number} for ${o.repository.owner.login}/${o.repository.name}. Scheduling task from branch: ${startBranch} to branch: ${targetBranch}.`
        );

        const taskService = this.taskService;
        const task = await taskService.addTask({
          type: "github",
          owner: o.repository.owner.login,
          repo: o.repository.name,
          startBranch: startBranch,
          targetBranch: targetBranch,
          linkedIssueNumber: issue.number,
          prompt: `On a project you are working on, you have been assigned to an issue.
        The issue is as follows:
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
          openaiModel: env.github.defaultOpenaiModel,
        } satisfies GithubStartTaskRequest);

        if (!task.taskId) {
          this.logger.error(
            `Failed to add task for ${o.repository.owner.login}/${o.repository.name}. Error: ${task.error}`
          );
          return;
        }

        taskService.addOnSubtaskCompleteCallback(
          task.taskId,
          async (task, subtask, githubInfo) => {
            this.logger.info(
              `Subtask ${subtask.id} complete for ${o.repository.owner.login}/${o.repository.name}. Crawling issues.`
            );
            taskService.removeOnSubtaskCompleteCallback(task.id);
            if (!githubInfo) {
              this.logger.error(
                `Failed to get github info for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
              );
              return;
            }
            this.crawlIssues();
          }
        );
      }

      // return {
      //   owner: o.repository.owner.login,
      //   repo: o.repository.name,
      //   issues: relevantIssues,
      // };
    });
  }

  public async crawlIssueComments(issueNumber: number) {
    const issueTasks = await db
      .select()
      .from(tasks)
      .innerJoin(taskGithubInfo, eq(tasks.githubInfoId, taskGithubInfo.id))
      .where(
        and(
          eq(taskGithubInfo.linkedIssueNumber, issueNumber),
          eq(tasks.status, "awaiting_help")
        )
      );

    if (issueTasks.length === 0) {
      this.logger.warn("No relevanttask found for issue:", issueNumber);
      return;
    }

    const issueTask = issueTasks[0];

    const octokit = await this.github.findRepoClient(
      issueTask.task_github_info.owner,
      issueTask.task_github_info.repo
    );

    const issueComments = await octokit.rest.issues.listComments({
      owner: issueTask.task_github_info.owner,
      repo: issueTask.task_github_info.repo,
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
      return;
    }

    // find the index of the agent comment
    const agentCommentIndex = issueComments.data.indexOf(agentComment);

    //look for response comments only BEFORE the agent comment (sorted newest to oldest)
    const responseComments = issueComments.data
      .slice(0, agentCommentIndex)
      .filter((c) => c.body?.includes(this.github.appName));

    if (responseComments.length === 0) {
      this.logger.warn("No response comments found for issue:", issueNumber);
      return;
    }

    const responseComment = responseComments[responseComments.length - 1];

    if (!responseComment.body) {
      this.logger.warn(
        "No response comment body found for issue:",
        issueNumber
      );
      return;
    }

    const newPrompt =
      "In response to your question, the PM said:\n\n" +
      responseComment.body.replace(this.github.appName, "You");

    const newSubTask =
      await this.taskService.setupAndScheduleContinuationSubTask(
        issueTask.tasks,
        issueTask.task_github_info,
        newPrompt
      );

    this.logger.info(
      "Help answer received, scheduled subtask with id: " + newSubTask.id,
      {
        issueId: issueNumber,
        subtaskId: newSubTask.id,
        repo: issueTask.task_github_info.repo,
        owner: issueTask.task_github_info.owner,
      }
    );
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
            .innerJoin(
              taskGithubInfo,
              eq(tasks.githubInfoId, taskGithubInfo.id)
            )
            .where(
              eq(taskGithubInfo.linkedIssueNumber, event.payload.issue.number)
            );

          const task = tasksRecord.find(
            (t) => t.tasks.status === "running" || t.tasks.status === "pending"
          );
          if (task) {
            await this.taskService.killAndRemoveTask(task.tasks);
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
