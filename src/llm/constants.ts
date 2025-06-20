// Triple backtick wrapper used throughout the prompts for code blocks
export const tripleTick = ["```", "```"];

// Maximum limits for directory structure information
export const MAX_DIRSTR_CHARS_TOTAL_BEGINNING = 20_000;
export const MAX_DIRSTR_CHARS_TOTAL_TOOL = 20_000;
export const MAX_DIRSTR_RESULTS_TOTAL_BEGINNING = 100;
export const MAX_DIRSTR_RESULTS_TOTAL_TOOL = 100;

// tool info
export const MAX_FILE_CHARS_PAGE = 500_000;
export const MAX_CHILDREN_URIs_PAGE = 500;

// filesystem
export const DEFAULT_MAX_DEPTH = 10;
export const DEFAULT_MAX_ITEMS_PER_DIR = 100;
export const MAX_FILES_TOTAL = 1000;
export const START_MAX_DEPTH = 10;
export const START_MAX_ITEMS_PER_DIR = 100;

// terminal tool info
export const MAX_TERMINAL_CHARS = 100_000;
export const MAX_TERMINAL_INACTIVE_TIME = 8; // seconds
export const MAX_TERMINAL_BG_COMMAND_TIME = 20; // seconds

// Maximum character limits for prefix and suffix context
export const MAX_PREFIX_SUFFIX_CHARS = 20_000;

export const ORIGINAL = `<<<<<<< ORIGINAL`;
export const DIVIDER = `=======`;
export const FINAL = `>>>>>>> UPDATED`;

export const searchReplaceBlockTemplate = `\
${ORIGINAL}
// ... original code goes here
${DIVIDER}
// ... final code goes here
${FINAL}

${ORIGINAL}
// ... original code goes here
${DIVIDER}
// ... final code goes here
${FINAL}`;

export const replaceTool_description = `\
A string of SEARCH/REPLACE block(s) which will be applied to the given file.
Your SEARCH/REPLACE blocks string must be formatted as follows:
${searchReplaceBlockTemplate}

## Guidelines:

1. You may output multiple search replace blocks if needed.

2. The ORIGINAL code in each SEARCH/REPLACE block must EXACTLY match lines in the original file. Do not add or remove any whitespace or comments from the original code.

3. Each ORIGINAL text must be large enough to uniquely identify the change. However, bias towards writing as little as possible.

4. Each ORIGINAL text must be DISJOINT from all other ORIGINAL text.

5. This field is a STRING (not an array).`;

export const uriParam = (object: string) => ({
  uri: { description: `The FULL path to the ${object}.` },
});

export const paginationParam = {
  page_number: {
    description: "Optional. The page number of the result. Default is 1.",
  },
} as const;

export const terminalDescHelper = `You can use this tool to run any command: sed, grep, etc. Do not edit any files with this tool; use edit_file instead. When working with git and other tools that open an editor (e.g. git diff), you should pipe to cat to get all results and not get stuck in vim.`;

export const cwdHelper =
  "Optional. The directory in which to run the command. Defaults to the root folder.";
