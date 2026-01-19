import { openai } from "@/llm/openai";
import { db } from "../lib/db";
import {
  memories,
  projects,
  subTasks,
  taskGithubInfo,
  tasks,
  taskDependencies,
} from "../lib/db/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { ProjectRecord, SubTaskRecord, TaskRecord } from "@/types/db";
import { populatePreviousResponse } from "@/llm/prompt";
import { createDefaultWinstonLogger } from "../lib/basic-logger";
import winston from "winston";
import { toFile } from "openai";

async function llmCreateMemory({
  project,
  logger,
  subtask,
}: {
  project: ProjectRecord;
  logger: winston.Logger;
  subtask: SubTaskRecord;
}) {
  const instructions = `
You are summarizing the knowledge you gained during a programming task.
This summary and the notes you derive from it will serve as the basis for your memory of this task, and will help you remember how to potentially solve future tasks.
When writing the summary, imagine that you are talking to yourself.
Focus on the most relevant project-specific information, and format it in markdown for storage.
Ensure that the summary includes key insights from actions taken, such as tool calls, questions asked, discoveries, and solutions.

# Steps

1. **Identify Key Actions**: Review your actions to determine which are most relevant for gaining project-specific knowledge.
2. **Extract Insights**: From these actions, extract meaningful insights, details, solutions, and any new knowledge.
3. **Summarize**: Consolidate the extracted information into a clear, concise summary.
4. **Format in Markdown**: Structure the summary using markdown syntax to facilitate easy storage and reference.

# Output Format

The output should be formatted in markdown, focusing on clarity and conciseness. Use headers, bullet points, or numbered lists as needed to organize information effectively. Only include the most relevant and significant knowledge.

# Examples of relevant information

### Questions Asked
- **Question**: Description of the question.
- **Insight Gained**: The answer and its relevance to the project.

### Discoveries and insights
- **Discovery Description**: Details of the discovery and its impact on the project.

### Solutions
- **Problem**: Brief description of the problem.
- **Solution**: Summary of how it was resolved.
`;

  const { messages, previousResponseId } = await populatePreviousResponse({
    previousSubtask: subtask,
    logger,
  });

  const apiResponse = await openai.responses.create({
    model: "o4-mini",
    tools: [
      {
        type: "file_search",
        vector_store_ids: [project.memoryVectorStoreId!],
      },
    ],
    input: messages,
    instructions,
    tool_choice: "auto",
    previous_response_id: previousResponseId,
  });

  const content = apiResponse.output
    .filter((x) => x.type === "message")
    .flatMap((x) => x.content);

  if (content.find((x) => x.type === "refusal")) {
    throw new Error("Refusal to create memory");
  }

  return content
    .filter((x) => x.type === "output_text")
    .map((x) => x.text)
    .join("\n");
}

const validStatuses = ["complete", "closed", "awaiting_approval"] as const;

export async function initializeTaskMemories(project: ProjectRecord) {
  const logger = createDefaultWinstonLogger(
    "initializeTaskMemories:project-" + project.projectName,
    "memories-" + project.id + ".log"
  );

  if (!project.shouldHaveMemories) {
    logger.debug("Project does not have memories enabled", {
      projectId: project.id,
    });

    //temporary: wipe memories if the project has memories and have memories is disabled
    if (project.memoryVectorStoreId) {
      logger.info("Deleting memories for project", {
        projectId: project.id,
      });

      const projectTasks = await db
        .select({
          taskId: tasks.id,
        })
        .from(tasks)
        .where(eq(tasks.projectId, project.id));

      const deletedMemories = await db
        .delete(memories)
        .where(
          inArray(
            memories.taskId,
            projectTasks.map((x) => x.taskId)
          )
        )
        .returning();

      for (const memory of deletedMemories) {
        await tryDeleteVectorStoreFile(
          logger,
          project.memoryVectorStoreId,
          memory.fileId
        );
      }

      await openai.vectorStores.del(project.memoryVectorStoreId);
      await db
        .update(projects)
        .set({
          memoryVectorStoreId: null,
        })
        .where(eq(projects.id, project.id));

      logger.info("Deleted memories for project", {
        projectId: project.id,
        deletedMemories: deletedMemories.length,
      });
    }
    return;
  }

  logger.info("Initializing task memories for project", {
    projectId: project.id,
  });

  if (!project.memoryVectorStoreId) {
    logger.info("Creating memory vector store for project", {
      projectId: project.id,
    });

    const vs = await openai.vectorStores.create({
      name: "memories-" + project.projectName,
    });

    const updatedProject = (
      await db
        .update(projects)
        .set({
          memoryVectorStoreId: vs.id,
        })
        .where(eq(projects.id, project.id))
        .returning()
    )[0];

    project = updatedProject;
  }

  //take only the tasks that are complete in some way
  //but not errored out, without any memory
  const tasksDbWhereConds = [
    eq(tasks.projectId, project.id),
    or(...validStatuses.map((x) => eq(tasks.status, x))),
  ];

  if (!project.shouldOverwriteMemories) {
    tasksDbWhereConds.push(isNull(memories.id));
  }

  const tasksDbReturn = await db
    .select()
    .from(tasks)
    .leftJoin(memories, eq(tasks.id, memories.taskId))
    .where(and(...tasksDbWhereConds));

  const tasksDb = tasksDbReturn.reduce((acc, x) => {
    acc[x.tasks.id] = x.tasks;
    return acc;
  }, {} as Record<number, TaskRecord>);

  const promises = [];
  for (const task of Object.values(tasksDb)) {
    promises.push(createTaskMemory(logger, task, project));
  }

  await Promise.all(promises);

  logger.info("Task memories initialized for project", {
    projectId: project.id,
  });
}

export async function createTaskMemory(
  logger: winston.Logger,
  task: TaskRecord,
  project: ProjectRecord
) {
  const tx = db;

  if (!project.shouldHaveMemories) {
    return;
  }
  
  if (!project.memoryVectorStoreId) {
    throw new Error("No memory vector store id found");
  }

  if (!validStatuses.includes(task.status as (typeof validStatuses)[number])) {
    return;
  }

  logger.info("Creating task memory for task", {
    taskId: task.id,
  });

  if (task.currentSubTaskId === null) {
    throw new Error("No current subtask found");
  }

  const githubInfo = await tx.query.taskGithubInfo.findFirst({
    where: eq(taskGithubInfo.taskId, task.id),
  });

  if (!githubInfo) {
    logger.error("Memory creation requires tasks to be hosted on GitHub.", {
      taskId: task.id,
    });
    throw new Error("Memory creation requires tasks to be hosted on GitHub.");
  }

  const currentSubTasks = await tx
    .select()
    .from(subTasks)
    .where(eq(subTasks.id, task.currentSubTaskId));

  if (!currentSubTasks || currentSubTasks.length === 0) {
    logger.error("No current subtask found", {
      taskId: task.id,
    });
    throw new Error("No current subtask found");
  }

  const currentSubTask = currentSubTasks[0];

  if (
    currentSubTask.status !== "complete" ||
    currentSubTask.currentOAIResponseId === null
  ) {
    throw new Error("Current subtask is not complete or has no response id");
  }

  logger.info("Deleting past memories for task", {
    taskId: task.id,
  });

  //for now - single memory per task
  const pastMemories = await tx
    .delete(memories)
    .where(eq(memories.taskId, task.id))
    .returning();

  for (const pastMemory of pastMemories) {
    await tryDeleteVectorStoreFile(
      logger,
      project.memoryVectorStoreId,
      pastMemory.fileId
    );
  }
  let memory = await llmCreateMemory({
    project,
    logger,
    subtask: currentSubTask,
  });

  memory += `\n\n#Task Status\n`;

  if (task.status === "awaiting_approval") {
    memory += `The task's work is currently awaiting approval on a pull request. The changes are currently on the branch ${githubInfo.startBranch}.`;
  } else if (task.status === "closed") {
    memory += `The task's pull request has been marked as closed, and its contents have not been merged.`;
  } else if (task.status === "complete") {
    memory += `The task has been completed. The task's work has been merged from ${githubInfo.startBranch} to branch ${githubInfo.targetBranch}.`;
  }

  const deps = await tx
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, task.id));

  if (deps.length > 0) {
    memory += `\n#Task Dependencies\n`;
    memory += deps.map((x) => `- Task ID: ${x.dependencyTaskId}`).join("\n");
  }

  const file = await openai.files.create({
    file: await toFile(Buffer.from(memory), "memory-task-" + task.id + ".md"),
    purpose: "user_data",
  });

  await openai.vectorStores.files.create(project.memoryVectorStoreId, {
    file_id: file.id,
  });

  logger.info("Created new memory for tasks", {
    taskId: task.id,
    memoryId: file.id,
    projectId: project.id,
  });

  await tx.insert(memories).values({
    taskId: task.id,
    fileId: file.id,
    content: memory,
  });
}

async function tryDeleteVectorStoreFile(
  logger: winston.Logger,
  vectorStoreId: string,
  fileId: string
) {
  try {
    await openai.vectorStores.files.del(vectorStoreId, fileId);
  } catch (e) {
    logger.debug("Error deleting past memory", {
      error: e,
      fileId: fileId,
    });
  }
  try {
    await openai.files.del(fileId);
  } catch (e) {
    logger.debug("Error deleting past memory", {
      error: e,
      fileId: fileId,
    });
  }
}
