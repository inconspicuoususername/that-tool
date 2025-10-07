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
import { Logger } from "winston";
import { SubTaskRecord } from "@/types/db";
import { openAIResponsesCall } from "./openai-api-call";

export async function populatePreviousResponse({
  previousSubtask,
  logger,
  prompt,
}: {
  previousSubtask?: SubTaskRecord;
  logger: Logger;
  prompt?: string;
}): Promise<{
  messages: OpenAI.Responses.ResponseInput;
  toolCalls: OpenAI.Responses.ResponseFunctionToolCall[];
  previousResponseId: string | undefined;
}> {
  let messages: OpenAI.Responses.ResponseInput = [];
  let toolCalls: OpenAI.Responses.ResponseFunctionToolCall[] = [];

  if (previousSubtask) {
    logger.info(
      `Previous subtask id: ${previousSubtask.id}. Looking for previous response id.`
    );

    const previousResponseId =
      previousSubtask.currentOAIResponseId ?? undefined;
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

    if (previousSubtask.output?.type === "tool_result") {
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

      if (prompt) {
        messages.push({
          role: "user",
          content: prompt,
        });
      }
    } else if (previousSubtask.output?.type === "help_request") {
      if (!askForHelpCall) {
        throw new Error("No ask for help call found");
      }

      if (!prompt) {
        throw new Error("No prompt provided");
      }

      messages.push({
        type: "function_call_output" as const,
        call_id: askForHelpCall.call_id,
        output: JSON.stringify({
          answer: prompt,
        }),
      });
    }
  } else {
    if (prompt) {
      messages.push({
        role: "user",
        content: prompt,
      });
    }
  }

  return {
    messages,
    toolCalls,
    previousResponseId: previousSubtask?.currentOAIResponseId ?? undefined,
  };
}

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
  const logger = createDefaultWinstonLogger("Agent", task.setup.logFile);

  // Initialize conversation history
  const prompt = task.setup.currentPrompt;
  const workDir = task.setup.workDir;
  const logFile = task.setup.logFile;

  const apiRetrySeconds = 30;

  const toolsDefinition: OpenAI.Responses.Tool[] = getToolJSON2();

  if (task.project.shouldHaveMemories) {
    toolsDefinition.push({
      type: "file_search" as const,
      vector_store_ids: [task.project.memoryVectorStoreId!],
    });
  }

  logger.info("Begin task execution.");
  logger.info(`Task: ${prompt}`);
  logger.info(`Workspace path: ${workDir}`);
  logger.info(`Log file: ${logFile}`);

  const previousSubtask = task.subtask.previousSubTaskId
    ? await db.query.subTasks.findFirst({
        where: eq(subTasks.id, task.subtask.previousSubTaskId),
      })
    : undefined;

  let { messages, toolCalls, previousResponseId } =
    await populatePreviousResponse({
      previousSubtask,
      logger,
      prompt,
    });

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
      directoryPath: workDir,
      persistentTerminalIDs: terminalService.getTerminalIDs(),
    });

    const { apiResponse, apiError } = await openAIResponsesCall({
      maxRetries: task.project.maxLLMRetries,
      retrySeconds: apiRetrySeconds,
      modelName: task.subtask.modelName,
      input: messages,
      instructions,
      toolsDefinition,
      previousResponseId,
      logger,
    });

    if (!apiResponse) {
      throw new Error(
        `Failed to get response from OpenAI API: ${apiError?.message}`
      );
    }

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
      logger.warn("No tool calls found. Adding user message to continue.");
      messages.push({
        role: "user",
        content:
          "If you're done with the task, you need to use the 'commit' tool to complete the task. \
          Otherwise, continue with the task by using the tools provided.",
      });
      continue;
    }
  }
}
