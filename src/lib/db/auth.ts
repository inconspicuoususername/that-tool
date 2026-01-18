import { serial, text } from "drizzle-orm/pg-core";
import { pgTable } from "./schema";

export const authTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  username: text("username").notNull(),
  github_id: text("github_id").notNull().unique(),
});
