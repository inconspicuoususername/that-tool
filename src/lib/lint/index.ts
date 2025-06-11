import path from "path";
import { lintTypescript } from "./ts";

export function lint(filePath: string) {
  const extension = path.extname(filePath);
  switch (extension) {
    case ".ts":
      return lintTypescript(filePath);
    default:
      return undefined;
  }
}
