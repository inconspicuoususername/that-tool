import "@/lib/env";
import { executeTask } from "@/llm/prompt";

// Get workspace path from command line argument
const workspacePath = process.argv[2];
if (!workspacePath) {
  throw new Error("Workspace path must be provided as a command line argument");
}

// Get task from command line argument
const task = process.argv[3];
if (!task) {
  throw new Error("Task must be provided as a command line argument");
}

executeTask("gpt-4o-mini", workspacePath, task).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

// getSystemMessage({
//   directoryPath: "./test_project",
//   persistentTerminalIDs: [],
// }).then((res) => {
//   console.log(res);
// });
