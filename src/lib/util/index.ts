import readline from "node:readline";
import fs from "fs";
import os from "os";

export const readLineAsync = () => {
  const rl = readline.createInterface({
    input: process.stdin,
  });

  return new Promise<string>((resolve) => {
    rl.prompt();
    rl.on("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
};

interface LinuxDistro {
  NAME?: string;
  ID?: string;
  VERSION?: string;
  VERSION_ID?: string;
}

export function getLinuxDistro(): LinuxDistro | undefined {
  if (os.platform() !== "linux") {
    return undefined;
  }

  try {
    const osReleaseContent = fs.readFileSync("/etc/os-release", "utf8");
    const lines = osReleaseContent.split("\n");
    const distroInfo: LinuxDistro = {};

    lines.forEach((line) => {
      const parts = line.split("=");
      if (parts.length === 2) {
        distroInfo[parts[0] as keyof LinuxDistro] = parts[1].replace(/"/g, ""); // Remove quotes
      }
    });

    return {
      NAME: distroInfo.NAME,
      ID: distroInfo.ID,
      VERSION: distroInfo.VERSION,
      VERSION_ID: distroInfo.VERSION_ID,
    };
  } catch (error) {
    return undefined;
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AppError extends Error {
  status: number;
  nonce: string;
  constructor(status: number, message: string, nonce: string) {
    super(message);
    this.status = status;
    this.nonce = nonce;
  }
}