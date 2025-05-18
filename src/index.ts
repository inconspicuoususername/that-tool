import OpenAI from "openai";
import { ToolsService } from "./services/tools";
import fs from "fs/promises";
import path from "path";
import { readLineAsync } from "./util";
import { getSystemMessage } from "./system_prompt";
import { TerminalService } from "./terminal";
import { getToolJSON2, toolJSON2 } from "./tools-json";
async function main() {
  // Load environment variables
  require("dotenv").config();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Get workspace path from command line argument
  const workspacePath = process.argv[2];
  if (!workspacePath) {
    throw new Error(
      "Workspace path must be provided as a command line argument"
    );
  }

  // Initialize tools
  const terminalService = new TerminalService(workspacePath);
  const tools = new ToolsService(workspacePath, terminalService);

  // Get task from command line argument
  const task = process.argv[3];
  if (!task) {
    throw new Error("Task must be provided as a command line argument");
  }

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
    let instructions = await getSystemMessage({
      directoryPath: workspacePath,
      persistentTerminalIDs: terminalService.getTerminalIDs(),
    });
    // Get response from LLM
    await log("Calling OpenAI API with model gpt-4o-mini");
    const apiResponse = await openai.responses.create({
      model: "gpt-4o-mini",
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
          await log(content.text);
        } else {
          console.log("Model refused to respond!");
          await log(content.refusal);
          process.exit(1);
        }
      }
    }

    // // If no tool calls, check if task is complete
    const toolCalls = response.filter((x) => x.type === "function_call");
    if (toolCalls.some((x) => x.name === "commit")) {
      await log("Task completed successfully");
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

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

// getSystemMessage({
//   directoryPath: "./test_project",
//   persistentTerminalIDs: [],
// }).then((res) => {
//   console.log(res);
// });
