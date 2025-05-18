// import postgres from "postgres";
// import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
// console.log("process.env.DATABASE_URL", process.env.DATABASE_URL);
// export const db = drizzle(sql, { schema });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
// import { config } from "dotenv";

const sql = neon<true, true>(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
