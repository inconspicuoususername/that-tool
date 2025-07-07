import { LintTypescriptDiagnostic } from "@/lib/lint/ts";

export type ToolName =
  | "read_file"
  | "ls_dir"
  | "get_dir_tree"
  | "search_pathnames_only"
  | "search_for_files"
  | "search_in_file"
  | "read_lint_errors"
  | "create_file_or_folder"
  | "delete_file_or_folder"
  | "rewrite_file"
  | "edit_file"
  | "run_command"
  | "run_persistent_command"
  | "open_persistent_terminal"
  | "kill_persistent_terminal"
  | "ask_for_help"
  | "browser_agent"
  | "fetch";

export interface ToolCallParams {
  read_file: {
    uri: string;
    start_line?: number;
    end_line?: number;
    page_number?: number;
  };
  ls_dir: {
    uri: string;
    page_number?: number;
  };
  get_dir_tree: {
    uri: string;
  };
  search_pathnames_only: {
    query: string;
    include_pattern?: string;
    page_number?: number;
  };
  search_for_files: {
    query: string;
    search_in_folder?: string;
    is_regex?: boolean;
    page_number?: number;
  };
  search_in_file: {
    uri: string;
    query: string;
    is_regex?: boolean;
  };
  read_lint_errors: {
    uri: string;
  };
  create_file_or_folder: {
    uri: string;
  };
  delete_file_or_folder: {
    uri: string;
    is_recursive?: boolean;
  };
  rewrite_file: {
    uri: string;
    new_content: string;
  };
  edit_file: {
    uri: string;
    search_replace_blocks: string;
  };
  run_command: {
    command: string;
    cwd?: string;
  };
  run_persistent_command: {
    command: string;
    persistent_terminal_id: string;
  };
  open_persistent_terminal: {
    cwd?: string;
  };
  kill_persistent_terminal: {
    persistent_terminal_id: string;
  };
  ask_for_help: {
    query: string;
  };
  browser_agent: {
    instructions: string;
  };
  fetch: {
    url: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  };
}

export type BaseToolResult<T> =
  | {
      success: true;
      result: T;
    }
  | {
      success: false;
      error: string;
      result?: undefined;
    };

export interface ToolResult {
  read_file: {
    content: string;
    lineCount: number;
    lintErrors?: LintTypescriptDiagnostic[];
  };
  ls_dir: {
    files: string[];
    directories: string[];
  };
  get_dir_tree: {
    tree: string;
  };
  search_pathnames_only: {
    matches: string[];
  };
  search_for_files: {
    matches: string[];
  };
  search_in_file: {
    matches: {
      line: number;
      content: string;
    }[];
  };
  read_lint_errors: {
    errors: LintTypescriptDiagnostic[];
  };
  create_file_or_folder: {
    success: boolean;
  };
  delete_file_or_folder: {
    success: boolean;
  };
  rewrite_file: {
    success: boolean;
    lintErrors?: LintTypescriptDiagnostic[];
  };
  edit_file: {
    success: boolean;
    lintErrors?: LintTypescriptDiagnostic[];
  };
  run_command: {
    output: {
      output: string;
      exitReason: "success" | "timeout";
    };
    exitCode: number;
  };
  run_persistent_command: {
    output: string;
    exitCode: number;
  };
  open_persistent_terminal: {
    terminal_id: string;
  };
  kill_persistent_terminal: {
    success: boolean;
  };
  ask_for_help: {
    response: string;
  };
  browser_agent: BaseToolResult<string>;
  fetch: BaseToolResult<{
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: ToolName;
    arguments: string; // JSON string of ToolCallParams[ToolName]
  };
}

export interface ToolCallResult {
  tool_call_id: string;
  output: string; // JSON string of ToolResult[ToolName]
}

export interface LLMResponse {
  reasoning: string;
  toolCalls?: ToolCall[];
  isComplete: boolean;
}
