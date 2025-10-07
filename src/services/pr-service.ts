import {
  projects,
  pullRequestStates,
  taskGithubInfo,
  tasks,
} from "@/lib/db/schema";
import { ProjectRecord, TaskGithubInfoRecord, TaskRecord } from "@/types/db";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { Logger } from "winston";
import { db } from "@/lib/db";
import { GitHubWrapper } from "@/lib/github";
import { PullRequestState } from "@/types/github";
import { TaskServiceResult } from "@/types/llm-scheduler";
import { result } from "lodash";
import { string, number } from "zod";

interface TaskWithGithubInfo {
  tasks: TaskRecord;
  task_github_info: TaskGithubInfoRecord;
  projects: ProjectRecord;
}

type ChangeInfo =
  | {
      status: "approved" | "closed";
      task: TaskRecord;
    }
  | {
      status: "changes_requested";
      task: TaskRecord;
      prompt: string;
    };

export class PullRequestService {
  constructor(private logger: Logger, private github: GitHubWrapper) {}

  private currentSession: ChangeInfo[] | null = null;

  onTaskApproved(task: TaskRecord): void {
    this.logger.info("Task approved:", task.id);
    if (!this.currentSession) {
      throw new Error("No current session");
    }
    this.currentSession?.push({
      status: "approved",
      task: task,
    });
  }
  onTaskClosed(task: TaskRecord): void {
    this.logger.info("Task closed:", task.id);
    if (!this.currentSession) {
      throw new Error("No current session");
    }
    this.currentSession?.push({
      status: "closed",
      task,
    });
  }
  addContinuationSubTask(task: TaskRecord, prompt: string): void {
    this.logger.info("Adding continuation subtask:", task.id);
    if (!this.currentSession) {
      throw new Error("No current session");
    }
    this.currentSession?.push({
      status: "changes_requested",
      task,
      prompt,
    });
  }

  /**
   * Main cron job entry point - processes all tasks that need PR checking
   */
  public async processPullRequestUpdates(): Promise<ChangeInfo[]> {
    this.currentSession = [];
    this.logger.info("Starting pull request update processing");

    try {
      // Get all tasks that are waiting for PR feedback
      const tasksToCheck = await this.getTasksAwaitingPullRequestFeedback();

      if (tasksToCheck.length === 0) {
        this.logger.info("No tasks found awaiting pull request feedback");
        this.currentSession = null;
        return [];
      }

      this.logger.info(`Found ${tasksToCheck.length} tasks to check`);

      // Process each task
      for (const taskData of tasksToCheck) {
        await this.processTaskPullRequest(taskData);
      }
    } catch (error) {
      this.logger.error("Error processing pull request updates:", error);
      this.currentSession = null;
      throw error;
    }

    const result = this.currentSession;
    this.currentSession = null;

    return result;
  }

  /**
   * Get all tasks that are awaiting PR approval or help
   */
  private async getTasksAwaitingPullRequestFeedback(): Promise<
    TaskWithGithubInfo[]
  > {
    return await db
      .select()
      .from(tasks)
      .innerJoin(taskGithubInfo, eq(tasks.id, taskGithubInfo.taskId))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          // Only get tasks that have a PR number
          isNotNull(sql`${taskGithubInfo.pullRequest}->>'number'`),
          // Only get tasks in relevant statuses
          or(eq(tasks.status, "awaiting_approval"))
        )
      );
  }

  /**
   * Process a single task's pull request
   */
  private async processTaskPullRequest(
    taskData: TaskWithGithubInfo
  ): Promise<void> {
    const task = taskData.tasks;
    const githubInfo = taskData.task_github_info as TaskGithubInfoRecord;
    const project = taskData.projects;

    if (!githubInfo.pullRequest?.number) {
      this.logger.warn("No pull request number found for task:", task.id);
      return;
    }

    try {
      // Get current PR state from GitHub API
      const currentPrState = await this.fetchPullRequestState(
        project.owner,
        project.repo,
        githubInfo.pullRequest.number
      );

      // Get the last known state from our database
      const lastKnownState = await this.getLastKnownPullRequestState(task.id);

      // Process any changes
      await this.handlePullRequestChanges(
        task,
        githubInfo,
        currentPrState,
        lastKnownState
      );

      // Update our stored state
      await this.updateStoredPullRequestState(task.id, currentPrState);
    } catch (error) {
      this.logger.error(
        `Error processing task ${task.id} pull request:`,
        error
      );
    }
  }

  /**
   * Fetch current PR state from GitHub API
   */
  private async fetchPullRequestState(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequestState> {
    const client = await this.github.findRepoClient(owner, repo);
    // Fetch PR details
    const prResponse = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Fetch PR reviews
    const reviewsResponse = await client.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      number: prNumber,
      state: prResponse.data.state as "open" | "closed",
      merged: prResponse.data.merged || false,
      reviews: reviewsResponse.data.map((review) => ({
        id: review.id,
        state: review.state as "approved" | "changes_requested" | "commented",
        body: review.body || "",
        submitted_at: review.submitted_at || "",
      })),
    };
  }

  /**
   * Get the last known PR state from database
   */
  private async getLastKnownPullRequestState(
    taskId: number
  ): Promise<PullRequestState | null> {
    const result = await db
      .select()
      .from(pullRequestStates) // You'll need to create this table
      .where(eq(pullRequestStates.taskId, taskId))
      .limit(1);

    return result.length > 0 ? result[0].state : null;
  }

  /**
   * Handle changes between current and last known state
   */
  private async handlePullRequestChanges(
    task: TaskRecord,
    githubInfo: TaskGithubInfoRecord,
    currentState: PullRequestState,
    lastKnownState: PullRequestState | null
  ): Promise<void> {
    // Handle PR closure/merge
    if (currentState.state === "closed") {
      if (currentState.merged) {
        this.logger.info(
          `Pull request ${currentState.number} merged for task ${task.id}`
        );
        await this.onTaskApproved(task);
      } else {
        this.logger.info(
          `Pull request ${currentState.number} closed for task ${task.id}`
        );
        await this.onTaskClosed(task);
      }
      return;
    }

    // Handle new reviews
    const newReviews = this.getNewReviews(
      currentState.reviews,
      lastKnownState?.reviews || []
    );

    for (const review of newReviews) {
      await this.handleReview(task, githubInfo, review);
    }
  }

  /**
   * Get reviews that weren't in the last known state
   */
  private getNewReviews(
    currentReviews: PullRequestState["reviews"],
    lastKnownReviews: PullRequestState["reviews"]
  ): PullRequestState["reviews"] {
    const lastKnownIds = new Set(lastKnownReviews.map((r) => r.id));
    return currentReviews.filter((review) => !lastKnownIds.has(review.id));
  }

  /**
   * Handle a single review
   */
  private async handleReview(
    task: TaskRecord,
    githubInfo: TaskGithubInfoRecord,
    review: PullRequestState["reviews"][0]
  ): Promise<void> {
    if (review.state === "approved") {
      this.logger.info(
        `Pull request ${githubInfo.pullRequest?.number} approved for task ${task.id}`
      );
      await this.onTaskApproved(task);
    } else if (review.state === "changes_requested") {
      this.logger.info(
        `Pull request ${githubInfo.pullRequest?.number} requires changes for task ${task.id}`
      );

      if (!review.body) {
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
        review.body +
        "\n```\n\n" +
        "Please fix the issues and commit your changes.";

      this.logger.info("Rescheduling task:", task.id);
      await this.addContinuationSubTask(task, newPrompt);
    }
  }

  /**
   * Update stored PR state in database
   */
  private async updateStoredPullRequestState(
    taskId: number,
    state: PullRequestState
  ): Promise<void> {
    await db
      .insert(pullRequestStates)
      .values({
        taskId,
        state,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pullRequestStates.taskId,
        set: {
          state,
          updatedAt: new Date(),
        },
      });
  }
}
