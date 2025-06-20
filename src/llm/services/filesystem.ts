import { existsSync, Stats } from "fs";
import fs from "fs/promises";
import nodepath from "path";

export interface Resolve {
  stat: Stats;
  path: string;
  name: string;
  children: Resolve[] | null;
}

export const resolve = async (path: string): Promise<Resolve | null> => {
  if (!existsSync(path)) {
    return null;
  }
  const stat = await fs.stat(path);
  //recursively resolve children
  let childrenArr: Resolve[] = [];
  if (stat.isDirectory()) {
    const children = await fs.readdir(path, { withFileTypes: true });
    const childrenRes = await Promise.all(
      children.map(async (child) => {
        try {
          return await resolve(path + "/" + child.name);
        } catch (e) {
          console.error(e);
          return null;
        }
      })
    );
    childrenArr = childrenRes.filter((child) => child !== null);
  }

  const rpath = nodepath.resolve(path);

  return {
    stat,
    path: rpath,
    // name: path.split("/").pop()!,
    name: nodepath.basename(rpath),
    children: childrenArr.length > 0 ? childrenArr : null,
  };
};
