import { EditCodeService } from "@/llm/services/editcode";
import { TerminalService } from "@/llm/services/terminal";
import { ToolsService } from "@/llm/services/tools";
import {
  ProjectRecord,
  SubTaskRecord,
  TaskGithubInfoRecord,
  TaskRecord,
} from "./db";

export interface SubtaskSetup {
  workDir: string;
  logFile: string;
  currentPrompt: string;
}

export interface SubtaskInstance {
  setup: SubtaskSetup;
  context: {
    terminalService: TerminalService;
    toolsService: ToolsService;
    editCodeService: EditCodeService;
  };
  project: ProjectRecord;
  subtask: SubTaskRecord;
  promise: Promise<void>;
  abortController: AbortController;
}

export interface TaskServiceResult {
  task: TaskRecord;
  githubInfo?: TaskGithubInfoRecord;
  subtask: SubTaskRecord;
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
  setup: SubtaskSetup,
  error: Error | null,
  result: LLMResult | LLMHelpRequest | null
) => void;
