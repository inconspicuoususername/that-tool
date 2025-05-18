This project implements a headless AI programmer agent, similar to projects like Cursor or Windsurf.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Create a `.env` file in the project root with your OpenAI API key:
```
OPENAI_API_KEY=your-api-key-here
```

## Usage

Run the program with a workspace path and task:

```bash
pnpm dev <workspace-path> "<task>"
```

For example:
```bash
pnpm dev ./my-project "Create a simple React component that displays a counter"
```

The program will:
1. Execute the task using GPT-4
2. Use available tools to interact with the workspace
3. Log all activities to both console and a log file in `.logs` directory
4. Exit when the task is complete

## Available Tools

The AI agent has access to the following tools:
- `list_directory`: List files and directories in a given path
- `read_file`: Read content from a file
- `write_file`: Write content to a file
- `delete_file`: Delete a file
- `create_directory`: Create a new directory
- `search_files`: Search for files by name
- `search_in_file`: Search for content within a file

All operations are restricted to the provided workspace directory for security.