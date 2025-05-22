import { DIVIDER, FINAL } from "../constants";

import { ORIGINAL } from "../constants";

export type ExtractedSearchReplaceBlock = {
  state: "writingOriginal" | "writingFinal" | "done";
  orig: string;
  final: string;
};

// JS substring swaps indices, so "ab".substr(1,0) will NOT be '', it will be 'a'!
const voidSubstr = (str: string, start: number, end: number) =>
  end < start ? "" : str.substring(start, end);

export const endsWithAnyPrefixOf = (str: string, anyPrefix: string) => {
  // for each prefix
  for (let i = anyPrefix.length; i >= 1; i--) {
    // i >= 1 because must not be empty string
    const prefix = anyPrefix.slice(0, i);
    if (str.endsWith(prefix)) return prefix;
  }
  return null;
};

// guarantees if you keep adding text, array length will strictly grow and state will progress without going back
export const extractSearchReplaceBlocks = (str: string) => {
  const ORIGINAL_ = ORIGINAL + `\n`;
  const DIVIDER_ = "\n" + DIVIDER + `\n`;
  // logic for FINAL_ is slightly more complicated - should be '\n' + FINAL, but that ignores if the final output is empty

  const blocks: ExtractedSearchReplaceBlock[] = [];

  let i = 0; // search i and beyond (this is done by plain index, not by line number. much simpler this way)
  while (true) {
    let origStart = str.indexOf(ORIGINAL_, i);
    if (origStart === -1) {
      return blocks;
    }
    origStart += ORIGINAL_.length;
    i = origStart;
    // wrote <<<< ORIGINAL\n

    let dividerStart = str.indexOf(DIVIDER_, i);
    if (dividerStart === -1) {
      // if didnt find DIVIDER_, either writing originalStr or DIVIDER_ right now
      const writingDIVIDERlen = endsWithAnyPrefixOf(str, DIVIDER_)?.length ?? 0;
      blocks.push({
        orig: voidSubstr(str, origStart, str.length - writingDIVIDERlen),
        final: "",
        state: "writingOriginal",
      });
      return blocks;
    }
    const dividerCountInString = str.split(DIVIDER_).length - 1;
    if (dividerCountInString > 1) {
      throw new Error(
        "Multiple dividers found in a single Search/Replace block. Make sure you include only one divider in each Search/Replace blocks."
      );
    }
    const origStrDone = voidSubstr(str, origStart, dividerStart);
    dividerStart += DIVIDER_.length;
    i = dividerStart;
    // wrote \n=====\n

    const fullFINALStart = str.indexOf(FINAL, i);
    const fullFINALStart_ = str.indexOf("\n" + FINAL, i); // go with B if possible, else fallback to A, it's more permissive
    const matchedFullFINAL_ =
      fullFINALStart_ !== -1 && fullFINALStart === fullFINALStart_ + 1; // this logic is really important, otherwise we might look for FINAL_ at a much later part of the string

    let finalStart = matchedFullFINAL_ ? fullFINALStart_ : fullFINALStart;
    if (finalStart === -1) {
      // if didnt find FINAL_, either writing finalStr or FINAL or FINAL_ right now
      const writingFINALlen = endsWithAnyPrefixOf(str, FINAL)?.length ?? 0;
      const writingFINALlen_ =
        endsWithAnyPrefixOf(str, "\n" + FINAL)?.length ?? 0; // this gets priority
      const usingWritingFINALlen = Math.max(writingFINALlen, writingFINALlen_);
      blocks.push({
        orig: origStrDone,
        final: voidSubstr(str, dividerStart, str.length - usingWritingFINALlen),
        state: "writingFinal",
      });
      return blocks;
    }
    const usingFINAL = matchedFullFINAL_ ? "\n" + FINAL : FINAL;
    const finalStrDone = voidSubstr(str, dividerStart, finalStart);
    finalStart += usingFINAL.length;
    i = finalStart;
    // wrote >>>>> FINAL

    blocks.push({
      orig: origStrDone,
      final: finalStrDone,
      state: "done",
    });
  }
};
