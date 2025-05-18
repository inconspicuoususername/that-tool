import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_ITEMS_PER_DIR,
  MAX_DIRSTR_CHARS_TOTAL_BEGINNING,
  START_MAX_DEPTH,
  START_MAX_ITEMS_PER_DIR,
} from "../lib/constants";
import { MAX_FILES_TOTAL } from "../lib/constants";
import { Resolve, resolve } from "./filesystem";

const shouldExcludeDirectory = (name: string) => {
  if (
    name === ".git" ||
    name === "node_modules" ||
    name.startsWith(".") ||
    name === "dist" ||
    name === "build" ||
    name === "out" ||
    name === "bin" ||
    name === "coverage" ||
    name === "__pycache__" ||
    name === "env" ||
    name === "venv" ||
    name === "tmp" ||
    name === "temp" ||
    name === "artifacts" ||
    name === "target" ||
    name === "obj" ||
    name === "vendor" ||
    name === "logs" ||
    name === "cache" ||
    name === "resource" ||
    name === "resources"
  ) {
    return true;
  }

  if (name.match(/\bout\b/)) return true;
  if (name.match(/\bbuild\b/)) return true;

  return false;
};

const resolveChildren = async (
  children: Resolve[] | null
): Promise<Resolve[] | null> => {
  if (!children) return null;
  const res = await Promise.all(
    children.map(async (child) => await resolve(child.path))
  );
  //   const stats = res.map((s) => (s.success ? s.stat : null)).filter((s) => !!s);
  //   return stats;
  return res.filter((s) => !!s);
};

// Remove the old computeDirectoryTree function and replace with a combined version that handles both computation and rendering
export const computeAndStringifyDirectoryTree = async (
  eItem: Resolve,
  MAX_CHARS: number,
  fileCount: { count: number } = { count: 0 },
  options: {
    maxDepth?: number;
    currentDepth?: number;
    maxItemsPerDir?: number;
  } = {}
): Promise<{ content: string; wasCutOff: boolean }> => {
  // Set default values for options
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const currentDepth = options.currentDepth ?? 0;
  const maxItemsPerDir = options.maxItemsPerDir ?? DEFAULT_MAX_ITEMS_PER_DIR;

  // Check if we've reached the max depth
  if (currentDepth > maxDepth) {
    return { content: "", wasCutOff: true };
  }

  // Check if we've reached the file limit
  if (fileCount.count >= MAX_FILES_TOTAL) {
    return { content: "", wasCutOff: true };
  }

  // If we're already exceeding the max characters, return immediately
  if (MAX_CHARS <= 0) {
    return { content: "", wasCutOff: true };
  }

  // Increment file count
  fileCount.count++;

  // Add the root node first (without tree characters)
  const nodeLine = `${eItem.name}${eItem.stat.isDirectory() ? "/" : ""}${
    eItem.stat.isSymbolicLink() ? " (symbolic link)" : ""
  }\n`;

  if (nodeLine.length > MAX_CHARS) {
    return { content: "", wasCutOff: true };
  }

  let content = nodeLine;
  let wasCutOff = false;
  let remainingChars = MAX_CHARS - nodeLine.length;

  // Check if it's a directory we should skip
  const isGitIgnoredDirectory =
    eItem.stat.isDirectory() && shouldExcludeDirectory(eItem.name);

  // Fetch and process children if not a filtered directory
  if (eItem.stat.isDirectory() && !isGitIgnoredDirectory) {
    // Fetch children with Modified sort order to show recently modified first
    const eChildren = await resolveChildren(eItem.children);

    // Then recursively add all children with proper tree formatting
    if (eChildren && eChildren.length > 0) {
      const { childrenContent, childrenCutOff } = await renderChildrenCombined(
        eChildren,
        remainingChars,
        "",
        fileCount,
        { maxDepth, currentDepth, maxItemsPerDir } // Pass maxItemsPerDir to the render function
      );
      content += childrenContent;
      wasCutOff = childrenCutOff;
    }
  }

  return { content, wasCutOff };
};

// Helper function to render children with proper tree formatting
const renderChildrenCombined = async (
  children: Resolve[],
  maxChars: number,
  parentPrefix: string,
  fileCount: { count: number },
  options: { maxDepth: number; currentDepth: number; maxItemsPerDir?: number }
): Promise<{ childrenContent: string; childrenCutOff: boolean }> => {
  const { maxDepth, currentDepth } = options; // Remove maxItemsPerDir from destructuring
  // Get maxItemsPerDir separately and make sure we use it
  // For first level (currentDepth = 0), always use Infinity regardless of what was passed
  const maxItemsPerDir =
    currentDepth === 0
      ? Infinity
      : options.maxItemsPerDir ?? DEFAULT_MAX_ITEMS_PER_DIR;
  const nextDepth = currentDepth + 1;

  let childrenContent = "";
  let childrenCutOff = false;
  let remainingChars = maxChars;

  // Check if we've reached max depth
  if (nextDepth > maxDepth) {
    return { childrenContent: "", childrenCutOff: true };
  }

  // Apply maxItemsPerDir limit - only process the specified number of items
  const itemsToProcess =
    maxItemsPerDir === Infinity ? children : children.slice(0, maxItemsPerDir);
  const hasMoreItems = children.length > itemsToProcess.length;

  for (let i = 0; i < itemsToProcess.length; i++) {
    // Check if we've reached the file limit
    if (fileCount.count >= MAX_FILES_TOTAL) {
      childrenCutOff = true;
      break;
    }

    const child = itemsToProcess[i];
    const isLast = i === itemsToProcess.length - 1 && !hasMoreItems;

    // Create the tree branch symbols
    const branchSymbol = isLast ? "└── " : "├── ";
    const childLine = `${parentPrefix}${branchSymbol}${child.name}${
      child.stat.isDirectory() ? "/" : ""
    }${child.stat.isSymbolicLink() ? " (symbolic link)" : ""}\n`;

    // Check if adding this line would exceed the limit
    if (childLine.length > remainingChars) {
      childrenCutOff = true;
      break;
    }

    childrenContent += childLine;
    remainingChars -= childLine.length;
    fileCount.count++;

    const nextLevelPrefix = parentPrefix + (isLast ? "    " : "│   ");

    // Skip processing children for git ignored directories
    const isGitIgnoredDirectory =
      child.stat.isDirectory() && shouldExcludeDirectory(child.name);

    // Create the prefix for the next level (continuation line or space)
    if (child.stat.isDirectory() && !isGitIgnoredDirectory) {
      // Fetch children with Modified sort order to show recently modified first
      const eChildren = await resolveChildren(child.children);

      if (eChildren && eChildren.length > 0) {
        const {
          childrenContent: grandChildrenContent,
          childrenCutOff: grandChildrenCutOff,
        } = await renderChildrenCombined(
          eChildren,
          remainingChars,
          nextLevelPrefix,
          fileCount,
          { maxDepth, currentDepth: nextDepth, maxItemsPerDir }
        );

        if (grandChildrenContent.length > 0) {
          childrenContent += grandChildrenContent;
          remainingChars -= grandChildrenContent.length;
        }

        if (grandChildrenCutOff) {
          childrenCutOff = true;
        }
      }
    }
  }

  // Add a message if we truncated the items due to maxItemsPerDir
  if (hasMoreItems) {
    const remainingCount = children.length - itemsToProcess.length;
    const truncatedLine = `${parentPrefix}└── (${remainingCount} more items not shown...)\n`;

    if (truncatedLine.length <= remainingChars) {
      childrenContent += truncatedLine;
      remainingChars -= truncatedLine.length;
    }
    childrenCutOff = true;
  }

  return { childrenContent, childrenCutOff };
};

export const getAllDirectoriesStr = async ({
  cutOffMessage,
  folder,
}: {
  cutOffMessage: string;
  folder: string;
}) => {
  let str: string = "";
  let cutOff = false;

  // Use START_MAX_ITEMS_PER_DIR if not specified
  const startMaxItemsPerDir = START_MAX_ITEMS_PER_DIR;

  // this prioritizes filling 1st workspace before any other, etc
  str += `Directory of ${folder}:\n`;
  const rootURI = folder;

  const eRoot = await resolve(rootURI);
  if (!eRoot) return "";

  // First try with START_MAX_DEPTH and startMaxItemsPerDir
  const { content: initialContent, wasCutOff: initialCutOff } =
    await computeAndStringifyDirectoryTree(
      eRoot,
      MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length,
      { count: 0 },
      {
        maxDepth: START_MAX_DEPTH,
        currentDepth: 0,
        maxItemsPerDir: startMaxItemsPerDir,
      }
    );

  // If cut off, try again with DEFAULT_MAX_DEPTH and DEFAULT_MAX_ITEMS_PER_DIR
  let content, wasCutOff;
  if (initialCutOff) {
    const result = await computeAndStringifyDirectoryTree(
      eRoot,
      MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length,
      { count: 0 },
      {
        maxDepth: DEFAULT_MAX_DEPTH,
        currentDepth: 0,
        maxItemsPerDir: DEFAULT_MAX_ITEMS_PER_DIR,
      }
    );
    content = result.content;
    wasCutOff = result.wasCutOff;
  } else {
    content = initialContent;
    wasCutOff = initialCutOff;
  }

  str += content;
  if (wasCutOff) {
    cutOff = true;
  }

  const ans = cutOff ? `${str.trimEnd()}\n${cutOffMessage}` : str;
  return ans;
};
