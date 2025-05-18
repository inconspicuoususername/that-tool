import fs from "fs/promises";
import path from "path";
import { ToolCallParams, ToolResult, ToolName } from "../types";
import { TerminalService } from "../terminal";
import { FunctionTool, Tool } from "openai/resources/responses/responses";
import { isValidTool } from "../tools-json";

export class ToolsService {
  private workspacePath: string;
  private terminalService: TerminalService;
  private originalWorkspacePath: string;

  constructor(workspacePath: string, terminalService: TerminalService) {
    this.originalWorkspacePath = workspacePath;
    this.workspacePath = path.resolve(process.cwd(), workspacePath);
    this.terminalService = terminalService;
  }

  private resolvePath(filePath: string): string {
    if (filePath.startsWith(this.originalWorkspacePath)) {
      console.log("LLM used original workspace path");
      //help it out a bit
      filePath = filePath.replace(this.originalWorkspacePath, ".");
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

    const startLine = params.start_line ?? 1;
    const endLine = params.end_line ?? lines.length;

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
    // This is a placeholder - in a real implementation, you would integrate with a linter
    return { errors: [] };
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
    return { success: true };
  }

  async editFile(
    params: ToolCallParams["edit_file"]
  ): Promise<ToolResult["edit_file"]> {
    const filePath = this.resolvePath(params.uri);
    const content = await fs.readFile(filePath, "utf-8");

    // Parse search-replace blocks
    const blocks = JSON.parse(params.search_replace_blocks) as Array<{
      search: string;
      replace: string;
      isRegex?: boolean;
    }>;

    let newContent = content;
    for (const block of blocks) {
      if (block.isRegex) {
        const regex = new RegExp(block.search, "g");
        newContent = newContent.replace(regex, block.replace);
      } else {
        newContent = newContent.replaceAll(block.search, block.replace);
      }
    }

    await fs.writeFile(filePath, newContent, "utf-8");
    return { success: true };
  }

  async runCommand(
    params: ToolCallParams["run_command"]
  ): Promise<ToolResult["run_command"]> {
    const result = await this.terminalService.runCommand(
      params.command,
      params.cwd
    );
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

//due to openai, all tool parameters have to be required.
export const toolJSON: FunctionTool[] = [
  {
    type: "function",
    name: "read_file",
    strict: true,
    description: "Read content from a file",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the file" },
        start_line: {
          type: "number",
          description: "Starting line number (1-based)",
        },
        end_line: {
          type: "number",
          description: "Ending line number (1-based)",
        },
        page_number: {
          type: "number",
          description: "Page number for pagination",
        },
      },
      additionalProperties: false,
      required: ["uri", "start_line", "end_line", "page_number"],
    },
  },
  {
    type: "function",
    name: "ls_dir",
    strict: true,
    description: "List files and directories in a given path",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the directory" },
        page_number: {
          type: "number",
          description: "Page number for pagination",
        },
      },
      additionalProperties: false,
      required: ["uri", "page_number"],
    },
  },
  {
    type: "function",
    name: "get_dir_tree",
    strict: true,
    description: "Get a tree representation of a directory",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the directory" },
      },
      additionalProperties: false,
      required: ["uri"],
    },
  },
  {
    type: "function",
    name: "search_pathnames_only",
    strict: true,
    description: "Search for files by name",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        include_pattern: {
          type: "string",
          description: "Pattern to include in search",
        },
        page_number: {
          type: "number",
          description: "Page number for pagination",
        },
      },
      additionalProperties: false,
      required: ["query", "include_pattern", "page_number"],
    },
  },
  {
    type: "function",
    name: "search_for_files",
    strict: true,
    description: "Search for files with regex support",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        search_in_folder: {
          type: "string",
          description: "Folder to search in",
        },
        is_regex: {
          type: "boolean",
          description: "Whether to use regex matching",
        },
        page_number: {
          type: "number",
          description: "Page number for pagination",
        },
      },
      additionalProperties: false,
      required: ["query", "search_in_folder", "is_regex", "page_number"],
    },
  },
  {
    type: "function",
    name: "search_in_file",
    strict: true,
    description: "Search for content within a file",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the file" },
        query: { type: "string", description: "Search query" },
        is_regex: {
          type: "boolean",
          description: "Whether to use regex matching",
        },
      },
      additionalProperties: false,
      required: ["uri", "query", "is_regex"],
    },
  },
  {
    type: "function",
    name: "read_lint_errors",
    strict: true,
    description: "Read linting errors for a file",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the file" },
      },
      additionalProperties: false,
      required: ["uri"],
    },
  },
  {
    type: "function",
    name: "create_file_or_folder",
    strict: true,
    description: "Create a new file or directory",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to create" },
      },
      additionalProperties: false,
      required: ["uri"],
    },
  },
  {
    type: "function",
    name: "delete_file_or_folder",
    strict: true,
    description: "Delete a file or directory",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to delete" },
        is_recursive: {
          type: "boolean",
          description: "Whether to delete recursively",
        },
      },
      additionalProperties: false,
      required: ["uri", "is_recursive"],
    },
  },
  {
    type: "function",
    name: "rewrite_file",
    strict: true,
    description: "Replace entire file content",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the file" },
        new_content: {
          type: "string",
          description: "New content for the file",
        },
      },
      additionalProperties: false,
      required: ["uri", "new_content"],
    },
  },
  {
    type: "function",
    name: "edit_file",
    strict: true,
    description: "Make targeted edits to a file",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Path to the file" },
        search_replace_blocks: {
          type: "string",
          description:
            "JSON string of search-replace blocks. Each block has search, replace, and optional isRegex fields.",
        },
      },
      additionalProperties: false,
      required: ["uri", "search_replace_blocks"],
    },
  },
  {
    type: "function",
    name: "commit",
    strict: true,
    description: "Call this tool when you're done with your task",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
      },
      additionalProperties: false,
      required: ["message"],
    },
  },
];
