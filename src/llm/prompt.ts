import { EditCodeService } from "@/services/editcode";
import { TerminalService } from "@/services/terminal";
import { ToolsService } from "@/services/tools";

import { openai } from "@/llm/openai";
import { getToolJSON2 } from "@/llm/tools-json";
import { getSystemMessage } from "@/llm/system_prompt";
import { readLineAsync } from "@/util";

import path from "path";
import fs from "fs/promises";
import OpenAI from "openai";

export async function executeTask(
  openaiModel: string,
  workspacePath: string,
  task: string
) {
  // Initialize tools
  const terminalService = new TerminalService(workspacePath);
  const editCodeService = new EditCodeService();
  const tools = new ToolsService(
    workspacePath,
    terminalService,
    editCodeService
  );

  // Create logs directory
  const logsDir = path.join(process.cwd(), ".logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Create log file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(logsDir, `task-${timestamp}.log`);

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
      content: task,
    },
  ];

  await log("Begin task execution.");
  await log(`Task: ${task}`);
  await log(`Workspace path: ${workspacePath}`);

  // Function to log messages
  async function log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage);
    await fs.appendFile(logFile, logMessage);
  }

  let previousResponseId: string | undefined;

  // Main loop
  while (true) {
    const instructions = await getSystemMessage({
      directoryPath: workspacePath,
      persistentTerminalIDs: terminalService.getTerminalIDs(),
    });

    await log(`System prompt: ${instructions}`);
    // Get response from LLM
    await log(`Calling OpenAI API with model ${openaiModel}`);
    const apiResponse = await openai.responses.create({
      model: openaiModel,
      input: messages,
      instructions,
      tools: getToolJSON2(),
      tool_choice: "auto",
      previous_response_id: previousResponseId,
    });

    await log(`OpenAI API response recieved.`);

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
        //ask for approval from stdin
        console.log("Tool execution approved? (y/n)");
        const line = await readLineAsync();
        if (line.toLowerCase() !== "y") {
          await log("Tool execution cancelled");
          continue;
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
