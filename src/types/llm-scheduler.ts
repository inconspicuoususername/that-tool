import { EditCodeService } from "@/llm/services/editcode";
import { TerminalService } from "@/llm/services/terminal";
import { ToolsService } from "@/llm/services/tools";
import { SubTaskRecord } from "./db";

export interface SubtaskInstance {
  context: {
    currentPrompt: string;
    terminalService: TerminalService;
    toolsService: ToolsService;
    editCodeService: EditCodeService;
  };
  subtask: SubTaskRecord;
  promise: Promise<void>;
}

export interface LLMResult {
  type: "tool_result";
  commitMessage: string;
  commitDescription: string;
}

export interface LLMHelpRequest {
  type: "help_request";
  query: string;
}

export type SubtaskCompleteCallback = (
  subtask: SubTaskRecord,
  error: Error | null,
  result: LLMResult | LLMHelpRequest | null
) => void;
