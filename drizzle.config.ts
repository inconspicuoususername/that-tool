import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL!;

export default {
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/auth.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
  // dbCredentials: {
  //   host: url.hostname,
  //   port: parseInt(url.port ?? "5432"),
  //   user: url.username,
  //   password: url.password,
  //   database: url.pathname.slice(1),
  //   ssl: false,
  // },
} satisfies Config;
