import path from "path";
import { lintTypescript } from "./ts";
import winston from "winston";
import { env } from "../env";
import { defaultWinstonFmt } from "../basic-logger";

export const logger = winston.createLogger({
  level: "info",
  format: defaultWinstonFmt,
  defaultMeta: {
    service: "lint",
  },
  transports: [
    new winston.transports.File({
      filename: path.join(env.logDir, "lint.log"),
      level: "info",
    }),
  ],
});

export class LanguageService {
  constructor() {}

  public lint(filePath: string) {
    const extension = path.extname(filePath);
    switch (extension) {
      case ".js":
      case ".mjs":
      case ".cjs":
      case ".jsx":

      case ".ts":
      case ".mts":
      case ".cts":
      case ".tsx":
        return lintTypescript(filePath);
      default:
        return undefined;
    }
  }

  public getPackageManagerInstallCommand(filePath: string) {
    const extension = path.extname(filePath);
    switch (extension) {
      case ".ts":
        return "pnpm install";
    }
  }
}

export const languageService = new LanguageService();
