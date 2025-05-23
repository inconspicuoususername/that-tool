import { serviceMesh } from "@/llm/mesh";
import { Octokit } from "@octokit/rest";
import { db } from "./db";
import { taskGithubInfo, tasks } from "./db/schema";
import { and, eq, or, not } from "drizzle-orm";
import { GithubStartTaskRequest } from "@/types/api";
import { CronJob } from "cron";
import { createLogger, Logger } from "./basic-logger";
import { env } from "./env";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";

interface IssueState {
  logger: Logger;
  labelType: "accept" | "ignore";
  labels: string[];
}

function initIssueState(): IssueState {
  const ACCEPT_LABELS = env.github.issueAcceptLabels;
  const IGNORE_LABELS = env.github.issueIgnoreLabels;

  if (ACCEPT_LABELS && IGNORE_LABELS) {
    throw new Error(
      "Cannot use both accept and ignore labels for crawling issues."
    );
  }

  const logger = createLogger("IssueCrawler");

  if (ACCEPT_LABELS) {
    return {
      logger,
      labelType: "accept",
      labels: ACCEPT_LABELS.split(","),
    };
  } else if (IGNORE_LABELS) {
    return {
      logger,
      labelType: "ignore",
      labels: IGNORE_LABELS.split(","),
    };
  } else {
    throw new Error("No issue labels provided");
  }
}

async function crawlIssues(issueState: IssueState) {
  issueState.logger.info("Starting issue crawler");
  await serviceMesh.github.githubApp.eachRepository(async (o) => {
    const octokit = o.octokit as Octokit;
    const ret = await octokit.rest.issues.listForRepo({
      owner: o.repository.owner.login,
      repo: o.repository.name,
    });

    const issues = ret.data.filter((i) => !i.pull_request);

    if (issues.length === 0) {
      issueState.logger.info(
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

    if (ignoredOrAlreadyActive.some((t) => t.tasks.status === "running")) {
      issueState.logger.info(
        `Already running tasks for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
      );
      return;
    }
    const relevantIssues = issues
      .filter(
        (i) =>
          !ignoredOrAlreadyActive.some(
            (t) => t.task_github_info.linkedIssueNumber === i.number
          )
      )
      .filter((i) => {
        const labels = i.labels
          .map((l) => (typeof l === "string" ? l : l.name))
          .filter((x) => x);
        if (issueState.labelType === "ignore") {
          return !issueState.labels.some((l) => labels.includes(l));
        }
        if (issueState.labelType === "accept") {
          return issueState.labels.some((l) => labels.includes(l));
        }
      });

    issueState.logger.info(
      `Found ${issues.length} issues for ${o.repository.owner.login}/${o.repository.name}.`
    );
    issueState.logger.info(
      `Found ${relevantIssues.length} relevant issues for ${o.repository.owner.login}/${o.repository.name}.`
    );

    const issue = relevantIssues.find((i) => i.body && i.body.length > 0);
    if (!issue?.body) {
      issueState.logger.warn(`No issue or no issue with body found. Skipping.`);
      return;
    }

    const startBranch = "main";
    const targetBranch = "feat/issue-" + issue.number;

    issueState.logger.info(
      `Found issue ${issue.number} for ${o.repository.owner.login}/${o.repository.name}. Scheduling task from branch: ${startBranch} to branch: ${targetBranch}.`
    );

    try {
      const repoClient = await serviceMesh.github.findRepoClient(o.repository.owner.login, o.repository.name);
      await repoClient.rest.issues.createComment({
        owner: o.repository.owner.login,
        repo: o.repository.name,
        issue_number: issue.number,
        body: `I'll get right on it!\n\nIssue ${issue.number} has been scheduled for a task.`,
      });
    } catch(e) {
      issueState.logger.error(`Failed to comment on issue ${issue.number} for ${o.repository.owner.login}/${o.repository.name}. Error: ${e}`);
      return;
    }

    const taskService = serviceMesh.taskService;
    const task = await taskService.addTask({
      type: "github",
      owner: o.repository.owner.login,
      repo: o.repository.name,
      startBranch,
      targetBranch,
      linkedIssueNumber: issue.number,
      prompt: `On a project you are working on, you have been tasked with fixing an issue.
      The issue is as follows:
      --------
      TITLE: ${issue.title}
      LABELS: ${issue.labels.map((l) => (typeof l === "string" ? l : l.name)).join(", ")}
      ISSUE NUMBER: ${issue.number}
      URL: ${issue.html_url}
      --------
      BODY:
      ${issue.body}
      --------
      Please fix the issue.
      `,
      openaiModel: env.github.defaultOpenaiModel,
    } satisfies GithubStartTaskRequest);

    if (!task.taskId) {
      issueState.logger.error(
        `Failed to add task for ${o.repository.owner.login}/${o.repository.name}. Error: ${task.error}`
      );
      return;
    }

    taskService.addOnSubtaskCompleteCallback(task.taskId, async (task, subtask, githubInfo) => {
      issueState.logger.info(
        `Subtask complete for ${o.repository.owner.login}/${o.repository.name}. Crawling issues.`
      );
      taskService.removeOnSubtaskCompleteCallback(task.id);
      if (!githubInfo) {
        issueState.logger.error(
          `Failed to get github info for ${o.repository.owner.login}/${o.repository.name}. Skipping.`
        );
        return;
      }
      crawlIssues(issueState);
    });
    // return {
    //   owner: o.repository.owner.login,
    //   repo: o.repository.name,
    //   issues: relevantIssues,
    // };
  });
}
function setupIssueCrawlerCronJob(issueState: IssueState) {
  //every 10 minutes
  const cron = new CronJob("*/10 * * * *", async () => {
    await crawlIssues(issueState);
  });
  cron.start();
}

export function createWebhook(
  issueState: IssueState
): HandlerFunction<"issues"> {
  return async (event) => {
    issueState.logger.info(
      `Received issue event: ${event.payload.action} for ${event.payload.issue.number}`
    );
    if (
      event.payload.action === "opened" ||
      event.payload.action === "reopened" ||
      event.payload.action === "labeled"
    ) {
      issueState.logger.info(
        `Crawling issues for ${event.payload.issue.number}`
      );
      await crawlIssues(issueState);
    } else if (
      event.payload.action === "locked" ||
      event.payload.action === "closed"
    ) {
      const logString = `${event.payload.repository.owner.login}/${event.payload.repository.name}#${event.payload.issue.number}`;
      if (event.payload.issue.state_reason === "completed") {
        issueState.logger.info(
          `Issue ${logString} completed. Skipping.`
        );
        return;
      }
      // attempt to end task and remove PR
      issueState.logger.info(
        `Attempting to end task and remove PR for ${logString}`
      );
      const tasksRecord = await db
        .select()
        .from(tasks)
        .innerJoin(taskGithubInfo, eq(tasks.githubInfoId, taskGithubInfo.id))
        .where(
          eq(taskGithubInfo.linkedIssueNumber, event.payload.issue.number)
        );

      const task = tasksRecord.find(
        (t) => t.tasks.status === "running" || t.tasks.status === "pending"
      );
      if (task) {
        await serviceMesh.taskService.killAndRemoveTask(task.tasks);
      }
    }
  };
}

export function initIssueCrawler() {
  const issueState = initIssueState();
  //   setupIssueCrawlerCronJob(issueState);
  serviceMesh.github.githubApp.webhooks.on("issues", createWebhook(issueState));
  //start
  crawlIssues(issueState);
}
