import { FunctionTool } from "openai/resources/responses/responses.mjs";
import {
  MAX_TERMINAL_INACTIVE_TIME,
  MAX_TERMINAL_BG_COMMAND_TIME,
  uriParam,
  paginationParam,
  replaceTool_description,
  cwdHelper,
  terminalDescHelper,
} from "./constants";

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
  }, {});
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
