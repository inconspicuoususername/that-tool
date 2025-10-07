import { LLMScheduler } from "./llm-scheduler";
import { TaskService } from "./task-service";
import { IssueService } from "./issue-service";
import { createDefaultWinstonLogger } from "@/lib/basic-logger";
import { GitHubWrapper } from "@/lib/github";
import { env } from "@/lib/env";
import fs from "fs";
import { ShellService } from "./shell-service";
import { PullRequestService } from "./pr-service";

export function newServiceMesh(projectsRootDir: string, logsDir: string) {
  const pkFile = env.github.privateKeyFile;
  const pk = fs.readFileSync(pkFile, "utf8");
  const appId = env.github.appId;
  const webhookSecret = env.github.webhookSecret;
  // this.logger.info("Found PK file: ****");
  const github = new GitHubWrapper(
    createDefaultWinstonLogger("GitHubWrapper", "github.log"),
    pk,
    appId,
    webhookSecret
  );
  const llmScheduler = new LLMScheduler(
    createDefaultWinstonLogger("LLMScheduler", "llm-scheduler.log")
  );
  const terminalService = new ShellService(
    createDefaultWinstonLogger("ShellService", "shell-service.log")
  );

  const prService = new PullRequestService(
    createDefaultWinstonLogger("PullRequestService", "pr-service.log"),
    github
  );
  const taskService = new TaskService(
    projectsRootDir,
    logsDir,
    createDefaultWinstonLogger("TaskService", "task-service.log"),
    llmScheduler,
    github,
    terminalService,
    prService
  );
  const issueService = new IssueService(github, taskService);

  return {
    taskService,
    llmScheduler,
    github,
    issueService,
    prService,
  };
}

export const serviceMesh = newServiceMesh(env.projectsRootDir, env.logDir);
