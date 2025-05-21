import { relations } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  varchar,
  pgSchema,
  serial,
  integer,
} from "drizzle-orm/pg-core";

const schema = pgSchema("ttl_agent");
const pgTable = schema.table;

// export interface Task {
//   id: string;
//   context: {
//     currentPrompt: string;
//     terminalService: TerminalService;
//     toolsService: ToolsService;
//     editCodeService: EditCodeService;
//   };
//   setup?: Setup;
//   promise: Promise<void>;
// }

// interface BaseSetup {
//   type: "local" | "github";
//   projectName: string;
//   workDir: string;
//   logFile: string;
//   modelName: string;
// }

// export interface GithubSetup extends BaseSetup {
//   type: "github";
//   github: GitHubWrapper;
//   owner: string;
//   repo: string;
//   privateAccessToken: string;
//   startBranch: string;
//   targetBranch: string;
//   pullRequest?: {
//     id: number;
//     number: number;
//     state: string;
//     title: string;
//     body: string | null;
//     url: string;
//   };
// }

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectName: text("project_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  initialPrompt: text("initial_prompt").notNull(),
  currentPrompt: text("current_prompt").notNull(),
  webhookURL: text("webhook_url"),
  // owner: string;
  // repo: string;
  // privateAccessToken: string;
  // startBranch: string;
  // targetBranch: string;
  // pullRequest?: {
  //   id: number;
  //   number: number;
  //   state: string;
  //   title: string;
  //   body: string | null;
  //   url: string;
  // };
  currentSubTaskId: integer("current_sub_task_id"),
  type: varchar("type", {
    enum: ["github", "local"],
  }).notNull(),
  status: varchar("status", {
    enum: ["pending", "running", "awaiting_approval", "complete", "error"],
  })
    .notNull()
    .default("pending"),
  githubInfoId: integer("github_info_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const taskGithubInfo = pgTable("task_github_info", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => tasks.id),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  privateAccessToken: text("private_access_token").notNull(),
  startBranch: text("start_branch").notNull(),
  targetBranch: text("target_branch").notNull(),
  pullRequest: jsonb("pull_request"),
});

export const subTasks = pgTable("sub_tasks", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .references(() => tasks.id)
    .notNull(),
  modelName: text("model_name").notNull(),
  prompt: text("prompt").notNull(),
  workDir: text("work_dir").notNull(),
  logFile: text("log_file").notNull(),
  currentOAIResponseId: text("current_oai_response_id"),
  status: varchar("status", {
    enum: ["pending", "running", "complete"],
  })
    .notNull()
    .default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const oaiResponses = pgTable("oai_responses", {
  id: text("id").primaryKey(),
  subTaskId: integer("sub_task_id").references(() => subTasks.id),
  response: jsonb("response").notNull(),
  oaiResponseId: text("oai_response_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const taskRelations = relations(tasks, ({ many, one }) => ({
  subTasks: many(subTasks),
  currentSubTask: one(subTasks, {
    fields: [tasks.currentSubTaskId],
    references: [subTasks.id],
  }),
  githubInfo: one(taskGithubInfo, {
    fields: [tasks.githubInfoId],
    references: [taskGithubInfo.id],
  }),
}));

export const taskGithubInfoRelations = relations(taskGithubInfo, ({ one }) => ({
  task: one(tasks, {
    fields: [taskGithubInfo.taskId],
    references: [tasks.id],
  }),
}));

export const subTaskRelations = relations(subTasks, ({ one }) => ({
  task: one(tasks, {
    fields: [subTasks.taskId],
    references: [tasks.id],
  }),
}));

export const oaiResponseRelations = relations(oaiResponses, ({ one }) => ({
  subTask: one(subTasks, {
    fields: [oaiResponses.subTaskId],
    references: [subTasks.id],
  }),
}));
