import "@/lib/env";
import express from "express";
import cors from "cors";
import { taskRouter } from "@/routes/task";
import { serviceMesh } from "./llm/mesh";
import { createNodeMiddleware } from "@octokit/webhooks";
import { createLogger } from "./lib/basic-logger";
import { env } from "./lib/env";
import { initIssueCrawler } from "./lib/issue-crawler";

// // Get task from command line argument
const app = express();
const middlewareLogger = createLogger("express.js");

app.use(cors());
app.use((req, res, next) => {
  const time = new Date();
  middlewareLogger.info(`REQ ${req.method} ${req.url}`);
  next();
  middlewareLogger.info(
    `RES ${req.method} ${req.url} - ${res.statusCode} - ${
      new Date().getTime() - time.getTime()
    }ms`
  );
});
const middleware = createNodeMiddleware(serviceMesh.github.githubApp.webhooks, {
  path: "/github/webhook",
  timeout: 300000,
});
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

// setupIssueCrawlerCronJob();
initIssueCrawler();

app.listen(5001, () => {
  console.log("Server is running on port 5001");
});
