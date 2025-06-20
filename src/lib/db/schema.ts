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
import { LLMHelpRequest, LLMResult } from "@/types/llm-scheduler";

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
  projectName: text("project_name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  repo: text("repo").notNull(),
  owner: text("owner").notNull(),

  projectSpecification: text("project_specification"),
  defaultBaseBranch: text("default_base_branch").notNull().default("main"),
  defaultModel: text("default_model").notNull().default("gpt-4o-mini"),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
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
    enum: [
      "pending",
      "running",
      "awaiting_approval",
      "awaiting_help",
      "complete",
      "error",
      "closed",
      "killed",
    ],
  })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const taskDependencies = pgTable("task_dependencies", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .notNull(),
  dependencyTaskId: integer("dependency_task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .notNull(),
});

/*

pullRequest: z
    .object({
      id: z.number(),
      number: z.number(),
      state: z.string(),
      title: z.string(),
      body: z.string().nullable(),
      url: z.string(),
    })
    .nullable(),
    */
export const taskGithubInfo = pgTable("task_github_info", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .notNull(),
  startBranch: text("start_branch").notNull(),
  targetBranch: text("target_branch").notNull(),
  pullRequest: jsonb("pull_request").$type<{
    id: number;
    number: number;
    state: string;
    title: string;
    body: string | null;
    url: string;
  }>(),
  linkedIssueNumber: integer("linked_issue_number"),
});

/*
output: z.union([
    z.object({
      type: z.literal("help_request"),
      query: z.string(),
    }),
    z.object({
      type: z.literal("tool_result"),
      toolName: z.string(),
      result: z.any(),
    }),
  ]),
*/

export const subTasks = pgTable("sub_tasks", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .notNull(),
  modelName: text("model_name").notNull(),
  prompt: text("prompt").notNull(),
  currentOAIResponseId: text("current_oai_response_id"),
  status: varchar("status", {
    enum: ["pending", "running", "complete", "killed"],
  })
    .notNull()
    .default("pending"),
  previousSubTaskId: integer("previous_sub_task_id"),
  output: jsonb("output").$type<LLMResult | LLMHelpRequest>(),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const oaiResponses = pgTable("oai_responses", {
  id: text("id").primaryKey(),
  subTaskId: integer("sub_task_id").references(() => subTasks.id, {
    onDelete: "cascade",
  }),
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
  taskGithubInfo: one(taskGithubInfo, {
    fields: [tasks.id],
    references: [taskGithubInfo.taskId],
  }),
  dependencies: many(taskDependencies),
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
