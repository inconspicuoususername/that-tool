import { EditCodeService } from "@/llm/services/editcode";
import { TerminalService } from "@/llm/services/terminal";
import { ToolsService } from "@/llm/services/tools";

import { openai } from "@/llm/openai";
import { getToolJSON2 } from "@/llm/tools-json";
import { getSystemMessage } from "@/llm/system_prompt";
import { readLineAsync } from "@/util";

import fs from "fs/promises";
import OpenAI from "openai";
import { TaskRecord } from "@/types/db";
import { SHOULD_ASK_FOR_TOOL } from "@/lib/env";
import { db } from "@/lib/db";
import { oaiResponses, tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function executeTask(taskRecord: TaskRecord) {
  // Initialize tools
  const terminalService = new TerminalService(taskRecord.workDir);
  const editCodeService = new EditCodeService();
  const tools = new ToolsService(
    taskRecord.workDir,
    terminalService,
    editCodeService
  );

  // Function to log messages
  async function log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage);
    await fs.appendFile(taskRecord.logFile, logMessage);
  }

  // Initialize conversation history
  let messages: OpenAI.Responses.ResponseInput = [
    //     {
    //       role: "system",
    //       content: `You are a software engineer. Your job is to accomplish the task you are given by a project manager.
    // Follow the instructions strictly.
    // You are restricted to working within the workspace directory: ${workspacePath}
    // You should think step by step about how to accomplish the task.
    // Continue until the task is complete.`,
    //     },
    {
      role: "user",
      content: taskRecord.prompt,
    },
  ];

  await log("Begin task execution.");
  await log(`Task: ${taskRecord.prompt}`);
  await log(`Workspace path: ${taskRecord.workDir}`);

  let previousResponseId: string | undefined;

  await db
    .update(tasks)
    .set({
      status: "running" as const,
    })
    .where(eq(tasks.id, taskRecord.id));

  // Main loop
  while (true) {
    const instructions = await getSystemMessage({
      directoryPath: taskRecord.workDir,
      persistentTerminalIDs: terminalService.getTerminalIDs(),
    });

    await log(`System prompt: ${instructions}`);
    // Get response from LLM
    await log(`Calling OpenAI API with model ${taskRecord.modelName}`);
    const apiResponse = await openai.responses.create({
      model: taskRecord.modelName,
      input: messages,
      instructions,
      tools: getToolJSON2(),
      tool_choice: "auto",
      previous_response_id: previousResponseId,
    });

    await log(`OpenAI API response recieved.`);

    await db.insert(oaiResponses).values({
      id: apiResponse.id,
      taskId: taskRecord.id,
      response: JSON.stringify(apiResponse.output),
      oaiResponseId: apiResponse.id,
    });

    await db
      .update(tasks)
      .set({
        currentOAIResponseId: apiResponse.id,
      })
      .where(eq(tasks.id, taskRecord.id));

    previousResponseId = apiResponse.id;
    messages = [];

    const response = apiResponse.output;
    if (!response) {
      throw new Error("No response from LLM");
    }

    const reasoning = response.filter((x) => x.type === "reasoning");
    if (reasoning.length > 0) {
      for (const res of reasoning) {
        for (const item of res.summary) {
          await log(`Model reasoning: ${item.text}`);
        }
      }
    }

    const txtMsg = response.filter((x) => x.type === "message");

    for (const msg of txtMsg) {
      for (const content of msg.content) {
        if (content.type === "output_text") {
          await log(`Model message: ${content.text}`);
        } else {
          await log("Model refused to respond!");
          await log(`Model refusal: ${content.refusal}`);
          process.exit(1);
        }
      }
    }

    // // If no tool calls, check if task is complete
    const toolCalls = response.filter((x) => x.type === "function_call");
    if (toolCalls.some((x) => x.name === "commit")) {
      await log(
        "Tool call 'commit' found. Model has completed the task successfully."
      );
      break;
    }

    // Execute tool calls
    // const toolResults: ToolCallResult[] = [];

    for (const toolCall of toolCalls) {
      await log(`Executing tool: ${toolCall.name}`);
      try {
        const params = JSON.parse(toolCall.arguments);
        if (!tools.toolNameValid(toolCall.name)) {
          throw new Error(`Invalid tool name: ${toolCall.name}`);
        }
        await log(
          `Calling with tool parameters: ${JSON.stringify(params, null, 2)}`
        );
        if (SHOULD_ASK_FOR_TOOL) {
          //ask for approval from stdin
          console.log("Tool execution approved? (y/n)");
          const line = await readLineAsync();
          if (line.toLowerCase() !== "y") {
            await log("Tool execution cancelled");
            continue;
          }
        }
        const result = await tools.executeTool(toolCall.name, params);
        await log(`Tool result: ${JSON.stringify(result, null, 2)}`);

        messages.push({
          type: "function_call_output" as const,
          // id: cr.id,
          call_id: toolCall.call_id,
          output: JSON.stringify(result),
        });
      } catch (error) {
        await log(`Tool error: ${error}`);
        messages.push({
          type: "function_call_output" as const,
          call_id: toolCall.call_id,
          output: JSON.stringify({ error: (error as Error).message }),
        });
      }
    }
  }
}
