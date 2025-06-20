import winston from "winston";
import path from "path";
import { env } from "./env";

export const defaultWinstonFmt = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const formatMeta = (meta: any) => {
  // You can format the splat yourself
  const splat = meta[Symbol.for("splat")];
  if (splat && splat.length) {
    return splat.length === 1
      ? JSON.stringify(splat[0])
      : JSON.stringify(Array.isArray(splat) ? splat.join(" ") : splat);
  }
  return "";
};

const defaultWinstonConsoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    // winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
      return `[${timestamp}] [${service}] [${level}] ${message} ${formatMeta(
        meta
      )}`;
    }),
    winston.format.colorize({ all: true })
  ),
  forceConsole: true,
  level: "debug",
});

export function createDefaultWinstonLogger(service: string, logfile: string) {
  return winston.createLogger({
    level: "info",
    defaultMeta: {
      service: service,
    },
    format: defaultWinstonFmt,
    transports: [
      new winston.transports.File({
        filename: path.join(env.logDir, logfile),
        level: "info",
      }),
      defaultWinstonConsoleTransport,
    ],
  });
}
