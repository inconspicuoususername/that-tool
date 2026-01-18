import { serviceMesh } from "@/services/mesh";
import { taskRouter } from "@/routes/task";
import { createNodeMiddleware } from "@octokit/webhooks";
import { env } from "../lib/env";
import { createDefaultWinstonLogger } from "../lib/basic-logger";
import express from "express";
import cors from "cors";
import session from "express-session";
import { authRouter } from "./auth";
import { errorHandler } from "./error-handler";
import path from "path";
import { fileURLToPath } from "url";
import { requireJWT } from "./middleware";
import { manualRouter } from "./manual";

export const app = express();

export async function setupExpress() {
  const middlewareLogger = createDefaultWinstonLogger(
    "express.js",
    "express.log",
  );

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const viewsDir = path.resolve(__dirname, "../views");

  app.set("view engine", "ejs");
  app.set("views", viewsDir);

  app.use(cors());
  app.use((req, res, next) => {
    const time = Date.now();
    middlewareLogger.info(`---> REQ ${req.method} ${req.url}`);
    next();
    middlewareLogger.info(
      `<--- RES ${req.method} ${req.url} - ${res.statusCode} - ${
        Date.now() - time
      }ms`,
    );
  });
  const middleware = createNodeMiddleware(
    serviceMesh.github.githubApp.webhooks,
    {
      path: "/github/webhook",
      timeout: 300000,
    },
  );
  app.use(async (req, res, next) => {
    await middleware(req, res, next);
  });

  // app.use(express.urlencoded({ extended: true }));

  app.set("trust proxy", 1);

  app.use(express.json());

  app.use(
    session({
      secret: env.auth.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.serverUrl.startsWith("https://"),
      },
    }),
  );

  app.get(["/", "/monitor"], requireJWT, async (_req, res) => {
    res.render("monitor", {});
  });
  app.get(["/login"], async (_req, res) => {
    res.render("login", {});
  });

  app.use("/task", requireJWT, taskRouter);
  app.use("/manual", requireJWT, manualRouter);
  app.use("/auth", authRouter);

  app.use(errorHandler);

  return new Promise((resolve) => {
    app.listen(5001, () => {
      middlewareLogger.info("Server is running on port 5001");
      resolve(true);
    });
  });
}
