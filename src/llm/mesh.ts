import { LLMScheduler } from "./llm-scheduler";
import { TaskService } from "./task-service";
import { createLogger } from "@/lib/basic-logger";
import { GitHubWrapper } from "@/lib/github";
export function newServiceMesh(projectsRootDir: string, logsDir: string) {
  const github = new GitHubWrapper(createLogger("GitHubWrapper"));
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
  };
}
