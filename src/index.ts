import "@/lib/env";
import { startTypescriptServer } from "./lib/lint/ts";
import { setupExpress } from "./lib/express";

const tsServer = startTypescriptServer();
const expressServer = setupExpress();

Promise.all([tsServer, expressServer]).then(() => {
  console.log("that-tool-llm: Init complete");
});
