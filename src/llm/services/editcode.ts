import { URI } from "vscode-uri";
import { ExtractedSearchReplaceBlock } from "./extractcode";
import { searchReplaceBlockTemplate, tripleTick } from "../constants";
import { extractSearchReplaceBlocks } from "./extractcode";
import { readFileSync, writeFileSync } from "fs";
import { findTextInCode } from "./findtext";
export class EditCodeService {
  private _errContentOfInvalidStr = (
    str: "Not found" | "Not unique" | "Has overlap",
    blockOrig: string
  ): string => {
    const problematicCode = `${tripleTick[0]}\n${JSON.stringify(blockOrig)}\n${
      tripleTick[1]
    }`;

    // use a switch for better readability / exhaustiveness check
    let descStr: string;
    switch (str) {
      case "Not found":
        descStr = `The edit was not applied. The text in ORIGINAL must EXACTLY match lines of code in the file, but there was no match for:\n${problematicCode}. Ensure you have the latest version of the file, and ensure the ORIGINAL code matches a code excerpt exactly.`;
        break;
      case "Not unique":
        descStr = `The edit was not applied. The text in ORIGINAL must be unique in the file being edited, but the following ORIGINAL code appears multiple times in the file:\n${problematicCode}. Ensure you have the latest version of the file, and ensure the ORIGINAL code is unique.`;
        break;
      case "Has overlap":
        descStr = `The edit was not applied. The text in the ORIGINAL blocks must not overlap, but the following ORIGINAL code had overlap with another ORIGINAL string:\n${problematicCode}. Ensure you have the latest version of the file, and ensure the ORIGINAL code blocks do not overlap.`;
        break;
      default:
        descStr = "";
    }
    return (
      descStr +
      `
Make sure you are following the format for search/replace blocks EXACTLY!
EXAMPLE:
${searchReplaceBlockTemplate}`
    );
  };

  public applySRBlocks(uri: URI, blocksStr: string, modelStr: string) {
    if (blocksStr === undefined) {
      throw new Error(
        `No Search/Replace blocks were received! You must follow the format exactly as provided in the example.
EXAMPLE:
${searchReplaceBlockTemplate}`
      );
    }
    const blocks = extractSearchReplaceBlocks(blocksStr);
    if (blocks.length === 0)
      throw new Error(
        `No Search/Replace blocks were received! Make sure you're using the correct format for blocks. Example:
${searchReplaceBlockTemplate}`
      );
    if (modelStr == undefined)
      throw new Error(
        `Error applying Search/Replace blocks: File does not exist.`
      );

    if (modelStr.length === 0)
      throw new Error(`Error applying Search/Replace blocks: File is empty.`);

    // .split('\n').map(l => '\t' + l).join('\n') // for testing purposes only, remember to remove this
    const modelStrLines = modelStr.split("\n");

    const replacements: {
      origStart: number;
      origEnd: number;
      block: ExtractedSearchReplaceBlock;
    }[] = [];
    for (const b of blocks) {
      const res = findTextInCode(b.orig, modelStr, true, {
        returnType: "lines",
      });
      if (typeof res === "string")
        throw new Error(this._errContentOfInvalidStr(res, b.orig));
      let [startLine, endLine] = res;
      startLine -= 1; // 0-index
      endLine -= 1;

      // including newline before start
      const origStart = (
        startLine !== 0
          ? modelStrLines.slice(0, startLine).join("\n") + "\n"
          : ""
      ).length;

      // including endline at end
      const origEnd = modelStrLines.slice(0, endLine + 1).join("\n").length - 1;

      replacements.push({ origStart, origEnd, block: b });
    }
    // sort in increasing order
    replacements.sort((a, b) => a.origStart - b.origStart);

    // ensure no overlap
    for (let i = 1; i < replacements.length; i++) {
      if (replacements[i].origStart <= replacements[i - 1].origEnd) {
        throw new Error(
          this._errContentOfInvalidStr(
            "Has overlap",
            replacements[i]?.block?.orig
          )
        );
      }
    }

    // apply each replacement from right to left (so indexes don't shift)
    let newCode: string = modelStr;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { origStart, origEnd, block } = replacements[i];
      newCode =
        newCode.slice(0, origStart) +
        block.final +
        newCode.slice(origEnd + 1, Infinity);
    }

    this._writeURIText(uri, newCode, "wholeFileRange");
  }

  private _writeURIText(
    uri: URI,
    text: string,
    range: { startLine: number; endLine: number } | "wholeFileRange"
    // options: { shouldRealignDiffAreas: boolean }
  ): void {
    if (range === "wholeFileRange") {
      writeFileSync(uri.fsPath, text);
    } else {
      const lines = text.split("\n");
      const startLine = range.startLine;
      const endLine = range.endLine;
      //   const startIndex = lines[startLine].length;
      //   const endIndex = lines[endLine].length;
      const newText = lines.slice(startLine, endLine + 1).join("\n");
      writeFileSync(uri.fsPath, newText);
    }
  }
}
