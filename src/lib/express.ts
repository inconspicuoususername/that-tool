import { serviceMesh } from "@/llm/mesh";
import { taskRouter } from "@/routes/task";
import { createNodeMiddleware } from "@octokit/webhooks";
import { env } from "./env";
import { createDefaultWinstonLogger } from "./basic-logger";
import express from "express";
import cors from "cors";

export const app = express();

export async function setupExpress() {
  const middlewareLogger = createDefaultWinstonLogger(
    "express.js",
    "express.log"
  );

  app.use(cors());
  app.use((req, res, next) => {
    const time = Date.now();
    middlewareLogger.info(`---> REQ ${req.method} ${req.url}`);
    next();
    middlewareLogger.info(
      `<--- RES ${req.method} ${req.url} - ${res.statusCode} - ${
        Date.now() - time
      }ms`
    );
  });
  const middleware = createNodeMiddleware(
    serviceMesh.github.githubApp.webhooks,
    {
      path: "/github/webhook",
      timeout: 300000,
    }
  );
  app.use(async (req, res, next) => {
    await middleware(req, res, next);
  });

  app.use("/task", express.json());

  app.use("/task", (req, res, next) => {
    const simpleAuthHeader = req.headers["authorization"];
    if (simpleAuthHeader !== "Bearer " + env.simpleAuthToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  app.use("/task", taskRouter);
  return new Promise((resolve) => {
    app.listen(5001, () => {
      middlewareLogger.info("Server is running on port 5001");
      resolve(true);
    });
  });
}
