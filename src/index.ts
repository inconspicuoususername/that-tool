import "@/lib/env";
import express from "express";
import cors from "cors";
import { taskRouter } from "@/routes/task";

// Get workspace path from command line argument
// const workspacePath = process.argv[2];
// if (!workspacePath) {
//   throw new Error("Workspace path must be provided as a command line argument");
// }

// // Get task from command line argument
// const task = process.argv[3];
// if (!task) {
//   throw new Error("Task must be provided as a command line argument");
// }

const app = express();

app.use(express.json());
app.use(cors());

app.use("/task", taskRouter);

app.listen(3050, () => {
  console.log("Server is running on port 3050");
});
