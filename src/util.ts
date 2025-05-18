import readline from "node:readline";

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
