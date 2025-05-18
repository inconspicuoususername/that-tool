require("dotenv").config();

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

export const OPENAI_API_KEY = getOrDefault("OPENAI_API_KEY");

export const SHOULD_ASK_FOR_TOOL = getOrDefaultBoolean(
  "SHOULD_ASK_FOR_TOOL",
  false
);

export const PROJECTS_ROOT_DIR = getOrDefault(
  "PROJECTS_ROOT_DIR",
  path.join(process.cwd(), "projects")
);

export const LOG_DIR = getOrDefault(
  "LOG_DIR",
  path.join(process.cwd(), ".logs")
);
