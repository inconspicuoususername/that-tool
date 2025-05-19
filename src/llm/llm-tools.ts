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
  | "kill_persistent_terminal";

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
}

export interface ToolResult {
  read_file: {
    content: string;
    lineCount: number;
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
    errors: {
      line: number;
      message: string;
      severity: "error" | "warning" | "info";
    }[];
  };
  create_file_or_folder: {
    success: boolean;
  };
  delete_file_or_folder: {
    success: boolean;
  };
  rewrite_file: {
    success: boolean;
  };
  edit_file: {
    success: boolean;
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
