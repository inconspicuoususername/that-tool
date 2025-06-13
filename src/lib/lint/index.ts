import path from "path";
import { lintTypescript } from "./ts";
import winston from "winston";
import { env } from "../env";
import { defaultWinstonFmt } from "../basic-logger";

export function lint(filePath: string) {
  const extension = path.extname(filePath);
  switch (extension) {
    case ".ts":
      return lintTypescript(filePath);
    default:
      return undefined;
  }
}

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
