import dotenv from "dotenv";
dotenv.config();

import path from "path";

function getOrDefault(key: string, defaultValue?: string) {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is not set.`);
    }
    return defaultValue;
  }
  return value;
}

function getOrDefaultBoolean(key: string, defaultValue?: boolean) {
  const value = getOrDefault(key, defaultValue?.toString());
  return value === "true";
}

export const env = {
  simpleAuthToken: getOrDefault("SIMPLE_AUTH_TOKEN"),
  openai: {
    apiKey: getOrDefault("OPENAI_API_KEY"),
    defaultModel: getOrDefault("GITHUB_DEFAULT_OPENAI_MODEL", "o4-mini"),
  },
  shouldAskForTool: getOrDefaultBoolean("SHOULD_ASK_FOR_TOOL", false),
  projectsRootDir: getOrDefault(
    "PROJECTS_ROOT_DIR",
    path.join(process.cwd(), "projects")
  ),
  logDir: getOrDefault("LOG_DIR", path.join(process.cwd(), ".logs")),
  memoryDir: getOrDefault("MEMORY_DIR", path.join(process.cwd(), ".memory")),
  github: {
    appId: getOrDefault("GITHUB_APP_ID"),
    privateKeyFile: getOrDefault("GITHUB_APP_PK_FILE"),
    webhookSecret: getOrDefault("GITHUB_WEBHOOK_SECRET"),
    issueAcceptLabels: getOrDefault("GITHUB_ISSUES_ACCEPT_LABELS", ""),
    issueIgnoreLabels: getOrDefault("GITHUB_ISSUES_IGNORE_LABELS", ""),
    trustMeBro: getOrDefaultBoolean("GITHUB_TRUST_ME_BRO", false),
    shouldDeleteBranchIfOverlapping: getOrDefaultBoolean(
      "GITHUB_DELETE_BRANCH_IF_OVERLAPPING",
      false
    ),
  },
};
