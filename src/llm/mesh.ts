import { LLMScheduler } from "./llm-scheduler";
import { TaskService } from "./task-service";
import { createLogger } from "@/lib/basic-logger";
import { GitHubWrapper } from "@/lib/github";
import { env } from "@/lib/env";
import fs from "fs";

export function newServiceMesh(projectsRootDir: string, logsDir: string) {
  const pkFile = env.github.privateKeyFile;
  const pk = fs.readFileSync(pkFile, "utf8");
  const appId = env.github.appId;
  const webhookSecret = env.github.webhookSecret;
  // this.logger.info("Found PK file: ****");
  const github = new GitHubWrapper(
    createLogger("GitHubWrapper"),
    pk,
    appId,
    webhookSecret
  );
  const llmScheduler = new LLMScheduler();
  const taskService = new TaskService(
    projectsRootDir,
    logsDir,
    llmScheduler,
    github,
    createLogger("TaskService")
  );

  return {
    taskService,
    llmScheduler,
    github,
  };
}

export const serviceMesh = newServiceMesh(env.projectsRootDir, env.logDir);
