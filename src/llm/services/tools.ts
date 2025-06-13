import fs from "fs/promises";
import path from "path";
import { ToolCallParams, ToolResult, ToolName } from "@/types/llm-tools";
import { TerminalService } from "./terminal";
import { FunctionTool, Tool } from "openai/resources/responses/responses";
import {
  MAX_TERMINAL_INACTIVE_TIME,
  MAX_TERMINAL_BG_COMMAND_TIME,
  uriParam,
  paginationParam,
  replaceTool_description,
  cwdHelper,
  terminalDescHelper,
} from "../constants";
import { EditCodeService } from "./editcode";
import { URI } from "vscode-uri";
import {
  LintTypescriptDiagnostic,
  LintTypescriptResponse,
} from "@/lib/lint/ts";
import { lint } from "@/lib/lint";

export class ToolsService {
  private workspacePath: string;
  private terminalService: TerminalService;
  private originalWorkspacePath: string;
  private editCodeService: EditCodeService;
  private workspaceName: string;

  constructor(
    workspacePath: string,
    terminalService: TerminalService,
    editCodeService: EditCodeService
  ) {
    this.originalWorkspacePath = workspacePath;
    this.workspacePath = path.resolve(process.cwd(), workspacePath);
    const workspaceName = this.workspacePath
      .replace(/\/$/, "")
      .split("/")
      .pop();
    if (!workspaceName) {
      throw new Error("Workspace name not found");
    }
    this.workspaceName = workspaceName;
    this.terminalService = terminalService;
    this.editCodeService = editCodeService;
  }

  private async lint(
    filePath: string
  ): Promise<LintTypescriptDiagnostic[] | undefined> {
    const lintResponse = await lint(filePath);
    return lintResponse
      ? [
          ...lintResponse.syntaxDiag.diagnostics,
          ...lintResponse.semanticDiag.diagnostics,
        ]
      : undefined;
  }

  private resolvePath(filePath: string): string {
    if (filePath.startsWith(this.originalWorkspacePath)) {
      console.log("LLM used original workspace path");
      //help it out a bit
      filePath = filePath.replace(this.originalWorkspacePath, ".");
    } else if (filePath.startsWith("/")) {
      throw new Error(
        "Absolute paths are not allowed. Please use relative paths."
      );
    } else if (filePath.startsWith(this.workspaceName)) {
      filePath = filePath.replace(this.workspaceName, ".");
    }
    const resolvedPath = path.resolve(this.workspacePath, filePath);
    if (!resolvedPath.startsWith(this.workspacePath)) {
      throw new Error(`Access denied: Path ${filePath} is outside workspace`);
    }
    return resolvedPath;
  }

  async readFile(
    params: ToolCallParams["read_file"]
  ): Promise<ToolResult["read_file"]> {
    const filePath = this.resolvePath(params.uri);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    let startLine = params.start_line;
    if (!startLine) startLine = 1;
    else {
      if (startLine > lines.length) startLine = lines.length;
      else if (startLine < 1) startLine = 1;
    }
    let endLine = params.end_line;
    if (!endLine) endLine = lines.length;
    else {
      if (endLine > lines.length) endLine = lines.length;
      else if (endLine < startLine + 1) endLine = startLine + 1;
    }

    const selectedLines = lines.slice(startLine - 1, endLine);

    return {
      content: selectedLines.join("\n"),
      lineCount: lines.length,
    };
  }

  async lsDir(params: ToolCallParams["ls_dir"]): Promise<ToolResult["ls_dir"]> {
    const dirPath = this.resolvePath(params.uri);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    return {
      files: entries.filter((e) => e.isFile()).map((e) => e.name),
      directories: entries.filter((e) => e.isDirectory()).map((e) => e.name),
    };
  }

  async getDirTree(
    params: ToolCallParams["get_dir_tree"]
  ): Promise<ToolResult["get_dir_tree"]> {
    const dirPath = this.resolvePath(params.uri);

    async function buildTree(dir: string, prefix = ""): Promise<string> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      let tree = "";

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const marker = isLast ? "└── " : "├── ";
        const newPrefix = prefix + (isLast ? "    " : "│   ");

        tree += prefix + marker + entry.name + "\n";

        if (entry.isDirectory()) {
          tree += await buildTree(path.join(dir, entry.name), newPrefix);
        }
      }

      return tree;
    }

    const tree = await buildTree(dirPath);
    return { tree };
  }

  async searchPathnamesOnly(
    params: ToolCallParams["search_pathnames_only"]
  ): Promise<ToolResult["search_pathnames_only"]> {
    const searchDir = this.workspacePath;
    const matches: string[] = [];

    async function search(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(searchDir, fullPath);

        if (entry.isDirectory()) {
          await search(fullPath);
        }

        if (entry.name.includes(params.query)) {
          matches.push(relativePath);
        }
      }
    }

    await search(searchDir);
    return { matches };
  }

  async searchForFiles(
    params: ToolCallParams["search_for_files"]
  ): Promise<ToolResult["search_for_files"]> {
    const searchDir = params.search_in_folder
      ? this.resolvePath(params.search_in_folder)
      : this.workspacePath;
    const matches: string[] = [];

    async function search(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(searchDir, fullPath);

        if (entry.isDirectory()) {
          await search(fullPath);
        } else {
          const isMatch = params.is_regex
            ? new RegExp(params.query).test(entry.name)
            : entry.name.includes(params.query);

          if (isMatch) {
            matches.push(relativePath);
          }
        }
      }
    }

    await search(searchDir);
    return { matches };
  }

  async searchInFile(
    params: ToolCallParams["search_in_file"]
  ): Promise<ToolResult["search_in_file"]> {
    const filePath = this.resolvePath(params.uri);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    const matches = lines
      .map((line, index) => ({ line: index + 1, content: line }))
      .filter(({ content }) =>
        params.is_regex
          ? new RegExp(params.query).test(content)
          : content.includes(params.query)
      );

    return { matches };
  }

  async readLintErrors(
    params: ToolCallParams["read_lint_errors"]
  ): Promise<ToolResult["read_lint_errors"]> {
    const filePath = this.resolvePath(params.uri);
    const lintResponse = await this.lint(filePath);
    return {
      errors: lintResponse ?? [],
    };
  }

  async createFileOrFolder(
    params: ToolCallParams["create_file_or_folder"]
  ): Promise<ToolResult["create_file_or_folder"]> {
    const targetPath = this.resolvePath(params.uri);
    const isFolder = params.uri.endsWith("/") || params.uri.endsWith("\\");

    if (isFolder) {
      await fs.mkdir(targetPath, { recursive: true });
    } else {
      await fs.writeFile(targetPath, "", "utf-8");
    }

    return { success: true };
  }

  async deleteFileOrFolder(
    params: ToolCallParams["delete_file_or_folder"]
  ): Promise<ToolResult["delete_file_or_folder"]> {
    const targetPath = this.resolvePath(params.uri);
    const isFolder = targetPath.endsWith("/") || targetPath.endsWith("\\");

    if (isFolder) {
      if (params.is_recursive) {
        await fs.rm(targetPath, { recursive: true, force: true });
      } else {
        await fs.rmdir(targetPath);
      }
    } else {
      await fs.unlink(targetPath);
    }

    return { success: true };
  }

  async rewriteFile(
    params: ToolCallParams["rewrite_file"]
  ): Promise<ToolResult["rewrite_file"]> {
    const filePath = this.resolvePath(params.uri);
    await fs.writeFile(filePath, params.new_content, "utf-8");
    const lintResponse = await this.lint(filePath);
    return {
      success: true,
      lintErrors: lintResponse,
    };
  }

  private async getURI(path: string) {
    const resolved = this.resolvePath(path);
    return URI.file(resolved);
  }

  private async getModel(uri: URI) {
    const filePath = this.resolvePath(uri.fsPath);
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  }

  async editFile(
    params: ToolCallParams["edit_file"]
  ): Promise<ToolResult["edit_file"]> {
    const { uri, search_replace_blocks } = params;
    const uriObj = await this.getURI(uri);
    const model = await this.getModel(uriObj);
    await this.editCodeService.applySRBlocks(
      uriObj,
      search_replace_blocks,
      model
    );
    const lintResponse = await this.lint(uriObj.fsPath);
    return {
      success: true,
      lintErrors: lintResponse,
    };
  }

  async runCommand(
    params: ToolCallParams["run_command"]
  ): Promise<ToolResult["run_command"]> {
    const path = params.cwd ? this.resolvePath(params.cwd) : this.workspacePath;
    const result = await this.terminalService.runCommand(params.command, path);
    return {
      output: result.output,
      exitCode: result.exitCode,
    };
  }

  async runPersistentCommand(
    params: ToolCallParams["run_persistent_command"]
  ): Promise<ToolResult["run_persistent_command"]> {
    const result = await this.terminalService.runPersistentCommand(
      params.command,
      params.persistent_terminal_id
    );
    return {
      output: result.output,
      exitCode: result.exitCode,
    };
  }

  async openPersistentTerminal(
    params: ToolCallParams["open_persistent_terminal"]
  ): Promise<ToolResult["open_persistent_terminal"]> {
    const terminalId = await this.terminalService.openPersistentTerminal(
      params.cwd
    );
    return {
      terminal_id: terminalId,
    };
  }

  async killPersistentTerminal(
    params: ToolCallParams["kill_persistent_terminal"]
  ): Promise<ToolResult["kill_persistent_terminal"]> {
    const success = await this.terminalService.killPersistentTerminal(
      params.persistent_terminal_id
    );
    return {
      success,
    };
  }

  toolNameValid(name: string): name is ToolName {
    return isValidTool(name);
  }

  async executeTool<T extends ToolName>(
    name: T,
    params: ToolCallParams[T]
  ): Promise<ToolResult[T]> {
    switch (name) {
      case "read_file":
        return this.readFile(params as ToolCallParams["read_file"]) as Promise<
          ToolResult[T]
        >;
      case "ls_dir":
        return this.lsDir(params as ToolCallParams["ls_dir"]) as Promise<
          ToolResult[T]
        >;
      case "get_dir_tree":
        return this.getDirTree(
          params as ToolCallParams["get_dir_tree"]
        ) as Promise<ToolResult[T]>;
      case "search_pathnames_only":
        return this.searchPathnamesOnly(
          params as ToolCallParams["search_pathnames_only"]
        ) as Promise<ToolResult[T]>;
      case "search_for_files":
        return this.searchForFiles(
          params as ToolCallParams["search_for_files"]
        ) as Promise<ToolResult[T]>;
      case "search_in_file":
        return this.searchInFile(
          params as ToolCallParams["search_in_file"]
        ) as Promise<ToolResult[T]>;
      case "read_lint_errors":
        return this.readLintErrors(
          params as ToolCallParams["read_lint_errors"]
        ) as Promise<ToolResult[T]>;
      case "create_file_or_folder":
        return this.createFileOrFolder(
          params as ToolCallParams["create_file_or_folder"]
        ) as Promise<ToolResult[T]>;
      case "delete_file_or_folder":
        return this.deleteFileOrFolder(
          params as ToolCallParams["delete_file_or_folder"]
        ) as Promise<ToolResult[T]>;
      case "rewrite_file":
        return this.rewriteFile(
          params as ToolCallParams["rewrite_file"]
        ) as Promise<ToolResult[T]>;
      case "edit_file":
        return this.editFile(params as ToolCallParams["edit_file"]) as Promise<
          ToolResult[T]
        >;
      case "run_command":
        return this.runCommand(
          params as ToolCallParams["run_command"]
        ) as Promise<ToolResult[T]>;
      case "run_persistent_command":
        return this.runPersistentCommand(
          params as ToolCallParams["run_persistent_command"]
        ) as Promise<ToolResult[T]>;
      case "open_persistent_terminal":
        return this.openPersistentTerminal(
          params as ToolCallParams["open_persistent_terminal"]
        ) as Promise<ToolResult[T]>;
      case "kill_persistent_terminal":
        return this.killPersistentTerminal(
          params as ToolCallParams["kill_persistent_terminal"]
        ) as Promise<ToolResult[T]>;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

export const toolJSON2 = {
  read_file: {
    name: "read_file",
    description: `Returns full contents of a given file.`,
    params: {
      ...uriParam("file"),
      start_line: {
        description:
          "Optional. Do NOT fill this field in unless you were specifically given exact line numbers to search. Defaults to the beginning of the file.",
      },
      end_line: {
        description:
          "Optional. Do NOT fill this field in unless you were specifically given exact line numbers to search. Defaults to the end of the file.",
      },
      ...paginationParam,
    },
  },

  ls_dir: {
    name: "ls_dir",
    description: `Lists all files and folders in the given URI.`,
    params: {
      uri: {
        description: `Optional. The FULL path to the ${"folder"}. Leave this as empty or "" to search all folders.`,
      },
      ...paginationParam,
    },
  },

  get_dir_tree: {
    name: "get_dir_tree",
    description: `This is a very effective way to learn about your codebase. Returns a tree diagram of all the files and folders in the given folder. `,
    params: {
      ...uriParam("folder"),
    },
  },

  // pathname_search: {
  // 	name: 'pathname_search',
  // 	description: `Returns all pathnames that match a given \`find\`-style query over the entire workspace. ONLY searches file names. ONLY searches the current workspace. You should use this when looking for a file with a specific name or path. ${paginationHelper.desc}`,

  search_pathnames_only: {
    name: "search_pathnames_only",
    description: `Returns all pathnames that match a given query (searches ONLY file names). You should use this when looking for a file with a specific name or path.`,
    params: {
      query: { description: `Your query for the search.` },
      include_pattern: {
        description:
          "Optional. Only fill this in if you need to limit your search because there were too many results.",
      },
      ...paginationParam,
    },
  },

  search_for_files: {
    name: "search_for_files",
    description: `Returns a list of file names whose content matches the given query. The query can be any substring or regex.`,
    params: {
      query: { description: `Your query for the search.` },
      search_in_folder: {
        description:
          "Optional. Leave as blank by default. ONLY fill this in if your previous search with the same query was truncated. Searches descendants of this folder only.",
      },
      is_regex: {
        description:
          "Optional. Default is false. Whether the query is a regex.",
      },
      ...paginationParam,
    },
  },

  // add new search_in_file tool
  search_in_file: {
    name: "search_in_file",
    description: `Returns an array of all the start line numbers where the content appears in the file.`,
    params: {
      ...uriParam("file"),
      query: { description: "The string or regex to search for in the file." },
      is_regex: {
        description:
          "Optional. Default is false. Whether the query is a regex.",
      },
    },
  },

  read_lint_errors: {
    name: "read_lint_errors",
    description: `Use this tool to view all the lint errors on a file.`,
    params: {
      ...uriParam("file"),
    },
  },

  // --- editing (create/delete) ---

  create_file_or_folder: {
    name: "create_file_or_folder",
    description: `Create a file or folder at the given path. To create a folder, the path MUST end with a trailing slash.`,
    params: {
      ...uriParam("file or folder"),
    },
  },

  delete_file_or_folder: {
    name: "delete_file_or_folder",
    description: `Delete a file or folder at the given path.`,
    params: {
      ...uriParam("file or folder"),
      is_recursive: {
        description: "Optional. Return true to delete recursively.",
      },
    },
  },

  edit_file: {
    name: "edit_file",
    description: `Edit the contents of a file. You must provide the file's URI as well as a SINGLE string of SEARCH/REPLACE block(s) that will be used to apply the edit.`,
    params: {
      ...uriParam("file"),
      search_replace_blocks: {
        description: replaceTool_description,
      },
    },
  },

  rewrite_file: {
    name: "rewrite_file",
    description: `Edits a file, deleting all the old contents and replacing them with your new contents. Use this tool if you want to edit a file you just created.`,
    params: {
      ...uriParam("file"),
      new_content: {
        description: `The new contents of the file. Must be a string.`,
      },
    },
  },
  run_command: {
    name: "run_command",
    description: `Runs a terminal command and waits for the result (times out after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity). ${terminalDescHelper}`,
    params: {
      command: { description: "The terminal command to run." },
      cwd: { description: cwdHelper },
    },
  },

  run_persistent_command: {
    name: "run_persistent_command",
    description: `Runs a terminal command in the persistent terminal that you created with open_persistent_terminal (results after ${MAX_TERMINAL_BG_COMMAND_TIME} are returned, and command continues running in background). ${terminalDescHelper}`,
    params: {
      command: { description: "The terminal command to run." },
      persistent_terminal_id: {
        description:
          "The ID of the terminal created using open_persistent_terminal.",
      },
    },
  },

  open_persistent_terminal: {
    name: "open_persistent_terminal",
    description: `Use this tool when you want to run a terminal command indefinitely, like a dev server (eg \`npm run dev\`), a background listener, etc. Opens a new terminal in the your machine's environment which will not awaited for or killed.`,
    params: {
      cwd: { description: cwdHelper },
    },
  },

  kill_persistent_terminal: {
    name: "kill_persistent_terminal",
    description: `Interrupts and closes a persistent terminal that you opened with open_persistent_terminal.`,
    params: {
      persistent_terminal_id: {
        description: `The ID of the persistent terminal.`,
      },
    },
  },
  commit: {
    name: "commit",
    description: `Commit your changes. This should be your final function call.`,
    params: {
      message: {
        description: `The commit message. Max. 50 characters.`,
      },
      description: {
        description: `The commit description. Max. 1000 characters.`,
      },
    },
  },
  ask_for_help: {
    name: "ask_for_help",
    description: `Ask a project manager for help. Use this when you are stuck, or need to know more about the project, or your task.`,
    params: {
      query: { description: "The query to ask for help." },
    },
  },
} as {
  [key: string]: {
    name: string;
    description: string;
    params: Record<string, { description: string }>;
  };
};

function getProperties(params: Record<string, { description: string }>) {
  return Object.keys(params).reduce((acc, key) => {
    acc[key] = { type: "string", description: params[key].description };
    return acc;
  }, {} as Record<string, { type: string; description: string }>);
}

export function isValidTool(name: string) {
  return toolJSON2[name] !== undefined;
}

export function getToolJSON2(): FunctionTool[] {
  return Object.values(toolJSON2).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties: getProperties(tool.params),
      required: Object.keys(tool.params),
      additionalProperties: false,
    },
    strict: true,
  }));
}
