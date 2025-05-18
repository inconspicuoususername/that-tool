require("dotenv").config();

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

export const OPENAI_API_KEY = getOrDefault("OPENAI_API_KEY");
