import { relations } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  varchar,
  pgSchema,
} from "drizzle-orm/pg-core";

const schema = pgSchema("ttl_agent");
const pgTable = schema.table;

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectName: text("project_name").notNull(),
  modelName: text("model_name").notNull(),
  prompt: text("prompt").notNull(),
  workDir: text("work_dir").notNull(),
  logFile: text("log_file").notNull(),
  currentOAIResponseId: text("current_oai_response_id"),
  webhookURL: text("webhook_url"),
  status: varchar("status", {
    enum: ["pending", "running", "complete", "error"],
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
  taskId: uuid("task_id").references(() => tasks.id),
  response: jsonb("response").notNull(),
  oaiResponseId: text("oai_response_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const taskRelations = relations(tasks, ({ one }) => ({
  currentOAIResponse: one(oaiResponses, {
    fields: [tasks.currentOAIResponseId],
    references: [oaiResponses.id],
  }),
}));

export const oaiResponseRelations = relations(oaiResponses, ({ one }) => ({
  task: one(tasks, {
    fields: [oaiResponses.taskId],
    references: [tasks.id],
  }),
}));
