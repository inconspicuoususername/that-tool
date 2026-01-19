import { OpenAI } from "openai";
import { openai } from "./openai";
import { Logger } from "winston";

function isReasoningModel(modelname: string) {
  return modelname.includes("o4");
}

export async function openAIResponsesCall({
  maxRetries,
  retrySeconds,
  modelName,
  input,
  instructions,
  toolsDefinition,
  previousResponseId,
  logger,
  abortSignal,
}: {
  maxRetries: number;
  retrySeconds: number;
  modelName: OpenAI.ResponsesModel;
  instructions: string;
  input: OpenAI.Responses.ResponseInput;
  toolsDefinition: OpenAI.Responses.Tool[];
  previousResponseId: string | undefined;
  logger: Logger;
  abortSignal: AbortSignal;
}): Promise<{
  apiResponse: OpenAI.Responses.Response | null;
  apiError: Error | null;
}> {
  let apiResponse: OpenAI.Responses.Response | null = null;
  let apiError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      logger.info(`Calling OpenAI API with model ${modelName}`);
      apiResponse = await openai.responses.create(
        {
          model: modelName,
          input: input,
          instructions,
          tools: toolsDefinition,
          tool_choice: "auto",
          reasoning: isReasoningModel(modelName)
            ? {
                effort: "high",
              }
            : undefined,
          previous_response_id: previousResponseId,
        },
        {
          signal: abortSignal,
        },
      );
    } catch (e) {
      apiError = e as Error;
    }

    if (apiResponse) {
      break;
    } else {
      if (abortSignal.aborted) {
        logger.warn("OpenAI API call aborted.");
        break;
      }
      logger.warn(
        `Failed to get response from OpenAI API: ${apiError?.message}\nRetrying in ${retrySeconds} seconds...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    }
  }

  return {
    apiResponse,
    apiError,
  };
}
