import { openai } from "@/llm/openai";
import { getToolJSON2 } from "@/llm/services/tools";
import { getSystemMessage } from "@/llm/system_prompt";
import { readLineAsync } from "@/util";

import OpenAI from "openai";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { oaiResponses, subTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  LLMHelpRequest,
  LLMResult,
  SubtaskInstance,
} from "@/types/llm-scheduler";
import { createDefaultWinstonLogger } from "@/lib/basic-logger";

export async function executeTask(
  task: SubtaskInstance
): Promise<LLMResult | LLMHelpRequest> {
  // // Initialize tools
  // const terminalService = new TerminalService(taskRecord.workDir);
  // const editCodeService = new EditCodeService();
  // const tools = new ToolsService(
  //   taskRecord.workDir,
  //   terminalService,
  //   editCodeService
  // );

  const terminalService = task.context.terminalService;
  const tools = task.context.toolsService;
  // const taskRecord = task.dbRecord;

  // Function to log messages
  // const logger = createLogger("Agent");
  const logger = createDefaultWinstonLogger("Agent", task.subtask.logFile);

  // Initialize conversation history
  let messages: OpenAI.Responses.ResponseInput = [];

  logger.info("Begin task execution.");
  logger.info(`Task: ${task.context.currentPrompt}`);
  logger.info(`Workspace path: ${task.subtask.workDir}`);

  let previousResponseId: string | undefined;
  let toolCalls: OpenAI.Responses.ResponseFunctionToolCall[] = [];

  if (task.subtask.previousSubTaskId) {
    logger.info(
      `Previous subtask id: ${task.subtask.previousSubTaskId}. Looking for previous response id.`
    );
    const previousTask = await db.query.subTasks.findFirst({
      where: eq(subTasks.id, task.subtask.previousSubTaskId),
    });
    if (previousTask) {
      previousResponseId = previousTask.currentOAIResponseId ?? undefined;
      logger.info(
        `Previous response id: ${previousResponseId}. Found in previous subtask.`
      );

      if (!previousResponseId) {
        throw new Error("No previous response id found");
      }

      //if we're using a previous response, we need to add the output for previous calls
      // this is either 'commit', or 'ask_for_help' depending on how the previous subtask ended
      const previousResponse = await openai.responses.retrieve(
        previousResponseId
      );

      //in case any previous tool calls were not evaluated, we need to add them to the messages
      toolCalls = previousResponse.output.filter(
        (x) =>
          x.type === "function_call" &&
          x.name !== "commit" &&
          x.name !== "ask_for_help"
      ) as OpenAI.Responses.ResponseFunctionToolCall[];

      const commitCall = previousResponse.output.find(
        (x) => x.type === "function_call" && x.name === "commit"
      ) as OpenAI.Responses.ResponseFunctionToolCall | undefined;
      const askForHelpCall = previousResponse.output.find(
        (x) => x.type === "function_call" && x.name === "ask_for_help"
      ) as OpenAI.Responses.ResponseFunctionToolCall | undefined;

      if (previousTask.output?.type === "tool_result") {
        if (!commitCall) {
          throw new Error("No commit call found");
        }

        messages.push({
          type: "function_call_output" as const,
          call_id: commitCall.call_id,
          output: JSON.stringify({
            success: true,
          }),
        });

        messages.push({
          role: "user",
          content: task.context.currentPrompt,
        });
      } else if (previousTask.output?.type === "help_request") {
        if (!askForHelpCall) {
          throw new Error("No ask for help call found");
        }

        messages.push({
          type: "function_call_output" as const,
          call_id: askForHelpCall.call_id,
          output: JSON.stringify({
            answer: task.subtask.prompt,
          }),
        });
      }
    } else {
      logger.warn(
        `Previous subtask not found. Continuing without previous response id.`
      );
    }
  } else {
    messages.push({
      role: "user",
      content: task.context.currentPrompt,
    });
  }

  await db
    .update(subTasks)
    .set({
      status: "running" as const,
    })
    .where(eq(subTasks.id, task.subtask.id));

  // Main loop
  while (true) {
    // // If no tool calls, check if task is complete
    const help = toolCalls.find((x) => x.name === "ask_for_help");
    if (help) {
      logger.info("Tool call 'ask_for_help' found. Model has requested help.");
      return {
        type: "help_request",
        query: JSON.parse(help.arguments).query,
      };
    }
    const commit = toolCalls.find((x) => x.name === "commit");
    if (commit) {
      logger.info(
        "Tool call 'commit' found. Model has completed the task successfully."
      );
      const commitMessage = JSON.parse(commit.arguments).message;
      const commitDescription = JSON.parse(commit.arguments).description;
      return {
        type: "tool_result",
        commitMessage: commitMessage as string,
        commitDescription: commitDescription as string,
      };
    }

    // Execute tool calls
    // const toolResults: ToolCallResult[] = [];

    for (const toolCall of toolCalls) {
      logger.info(`Executing tool: ${toolCall.name}`);
      try {
        const params = JSON.parse(toolCall.arguments);
        if (!tools.toolNameValid(toolCall.name)) {
          throw new Error(`Invalid tool name: ${toolCall.name}`);
        }
        logger.info(
          `Calling with tool parameters: ${JSON.stringify(params, null, 2)}`
        );
        if (env.shouldAskForTool) {
          //ask for approval from stdin
          console.log("Tool execution approved? (y/n)");
          const line = await readLineAsync();
          if (line.toLowerCase() !== "y") {
            logger.warn("Tool execution cancelled");
            continue;
          }
        }
        const result = await tools.executeTool(toolCall.name, params);
        logger.info(`Tool result: ${JSON.stringify(result, null, 2)}`);

        messages.push({
          type: "function_call_output" as const,
          // id: cr.id,
          call_id: toolCall.call_id,
          output: JSON.stringify(result),
        });
      } catch (error) {
        logger.error(`Tool error: ${error}`, { error: error as Error });
        messages.push({
          type: "function_call_output" as const,
          call_id: toolCall.call_id,
          output: JSON.stringify({ error: (error as Error).message }),
        });
      }
    }

    const instructions = await getSystemMessage({
      directoryPath: task.subtask.workDir,
      persistentTerminalIDs: terminalService.getTerminalIDs(),
    });

    // logger.info(`System prompt: ${instructions}`);
    // Get response from LLM
    logger.info(`Calling OpenAI API with model ${task.subtask.modelName}`);
    const apiResponse = await openai.responses.create({
      model: task.subtask.modelName,
      input: messages,
      instructions,
      tools: getToolJSON2(),
      tool_choice: "auto",
      previous_response_id: previousResponseId,
    });

    logger.info(`OpenAI API response recieved.`);

    await db.insert(oaiResponses).values({
      id: apiResponse.id,
      subTaskId: task.subtask.id,
      response: JSON.stringify(apiResponse.output),
      oaiResponseId: apiResponse.id,
    });

    await db
      .update(subTasks)
      .set({
        currentOAIResponseId: apiResponse.id,
      })
      .where(eq(subTasks.id, task.subtask.id));

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
          logger.info(`Model reasoning: ${item.text}`);
        }
      }
    }

    const txtMsg = response.filter((x) => x.type === "message");

    for (const msg of txtMsg) {
      for (const content of msg.content) {
        if (content.type === "output_text") {
          logger.info(`Model message: ${content.text}`);
        } else {
          logger.warn("Model refused to respond!");
          logger.warn(`Model refusal: ${content.refusal}`);
          process.exit(1);
        }
      }
    }

    toolCalls = response.filter((x) => x.type === "function_call");

    if (toolCalls.length === 0) {
      throw new Error("No tool calls found.");
    }
  }
}
