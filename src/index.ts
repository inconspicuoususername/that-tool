import { OpenAI } from "openai";
import { Tools } from "./tools";
import { LLMMessage, ToolCall, ToolCallResult, LLMResponse } from "./types";
import fs from "fs/promises";
import path from "path";

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
  const tools = new Tools(workspacePath);

  // Get task from command line argument
  const task = process.argv[3];
  if (!task) {
    throw new Error("Task must be provided as a command line argument");
  }

  // Create logs directory
  const logsDir = path.join(workspacePath, ".logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Create log file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(logsDir, `task-${timestamp}.log`);

  // Initialize conversation history
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are an AI programmer agent with access to the following tools:
- read_file: Read content from a file
- ls_dir: List files and directories in a given path
- get_dir_tree: Get a tree representation of a directory
- search_pathnames_only: Search for files by name
- search_for_files: Search for files with regex support
- search_in_file: Search for content within a file
- read_lint_errors: Read linting errors for a file
- create_file_or_folder: Create a new file or directory
- delete_file_or_folder: Delete a file or directory
- rewrite_file: Replace entire file content
- edit_file: Make targeted edits to a file
- run_command: Run a command in a temporary terminal
- run_persistent_command: Run a command in a persistent terminal
- open_persistent_terminal: Open a new persistent terminal
- kill_persistent_terminal: Kill a persistent terminal

You are restricted to working within the workspace directory: ${workspacePath}
You should think step by step about how to accomplish the task.
For each step, explain your reasoning and then use the appropriate tool.
Continue until the task is complete.`,
    },
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

  // Main loop
  while (true) {
    // Get response from LLM
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
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
              required: ["uri"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "ls_dir",
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
              required: ["uri"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_dir_tree",
            description: "Get a tree representation of a directory",
            parameters: {
              type: "object",
              properties: {
                uri: { type: "string", description: "Path to the directory" },
              },
              required: ["uri"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_pathnames_only",
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
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_for_files",
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
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_in_file",
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
              required: ["uri", "query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "read_lint_errors",
            description: "Read linting errors for a file",
            parameters: {
              type: "object",
              properties: {
                uri: { type: "string", description: "Path to the file" },
              },
              required: ["uri"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "create_file_or_folder",
            description: "Create a new file or directory",
            parameters: {
              type: "object",
              properties: {
                uri: { type: "string", description: "Path to create" },
              },
              required: ["uri"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "delete_file_or_folder",
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
              required: ["uri"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "rewrite_file",
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
              required: ["uri", "new_content"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "edit_file",
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
              required: ["uri", "search_replace_blocks"],
            },
          },
        },
      ],
      tool_choice: "auto",
    });

    const response = completion.choices[0].message;
    if (!response) {
      throw new Error("No response from LLM");
    }

    // Log reasoning
    if (response.content) {
      await log(`Reasoning: ${response.content}`);
    }

    // Add assistant's response to conversation history
    messages.push({
      role: "assistant",
      content: response.content || "",
    });

    // If no tool calls, check if task is complete
    if (!response.tool_calls || response.tool_calls.length === 0) {
      if (response.content?.toLowerCase().includes("task complete")) {
        await log("Task completed successfully");
        break;
      }
      continue;
    }

    // Execute tool calls
    const toolResults: ToolCallResult[] = [];
    for (const toolCall of response.tool_calls) {
      await log(`Executing tool: ${toolCall.function.name}`);
      try {
        const params = JSON.parse(toolCall.function.arguments);
        const result = await tools.executeTool(
          toolCall.function.name as any,
          params
        );
        await log(`Tool result: ${JSON.stringify(result, null, 2)}`);

        toolResults.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result),
        });
      } catch (error) {
        await log(`Tool error: ${error}`);
        toolResults.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({ error: error.message }),
        });
      }
    }

    // Add tool results to conversation history
    messages.push({
      role: "user",
      content: JSON.stringify({
        tool_results: toolResults,
      }),
    });
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
