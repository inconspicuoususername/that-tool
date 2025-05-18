// Helper function to remove whitespace except newlines
const removeWhitespaceExceptNewlines = (str: string): string => {
  return str.replace(/[^\S\n]+/g, "");
};

const numLinesOfStr = (str: string) => str.split("\n").length;

// finds block.orig in fileContents and return its range in file
// startingAtLine is 1-indexed and inclusive
// returns 1-indexed lines
const findTextInCode = (
  text: string,
  fileContents: string,
  canFallbackToRemoveWhitespace: boolean,
  opts: { startingAtLine?: number; returnType: "lines" }
) => {
  const returnAns = (fileContents: string, idx: number) => {
    const startLine = numLinesOfStr(fileContents.substring(0, idx + 1));
    const numLines = numLinesOfStr(text);
    const endLine = startLine + numLines - 1;

    return [startLine, endLine] as const;
  };

  const startingAtLineIdx = (fileContents: string) =>
    opts?.startingAtLine !== undefined
      ? fileContents.split("\n").slice(0, opts.startingAtLine).join("\n").length // num characters in all lines before startingAtLine
      : 0;

  // idx = starting index in fileContents
  let idx = fileContents.indexOf(text, startingAtLineIdx(fileContents));

  // if idx was found
  if (idx !== -1) {
    return returnAns(fileContents, idx);
  }

  if (!canFallbackToRemoveWhitespace) return "Not found" as const;

  // try to find it ignoring all whitespace this time
  text = removeWhitespaceExceptNewlines(text);
  fileContents = removeWhitespaceExceptNewlines(fileContents);
  idx = fileContents.indexOf(text, startingAtLineIdx(fileContents));

  if (idx === -1) return "Not found" as const;
  const lastIdx = fileContents.lastIndexOf(text);
  if (lastIdx !== idx) return "Not unique" as const;

  return returnAns(fileContents, idx);
};
