import "@/lib/env";
import { startTypescriptServer } from "./lib/lint/ts";
import { setupExpress } from "./routes";

const tsServer = startTypescriptServer();
const expressServer = setupExpress();

Promise.all([tsServer, expressServer]).then(() => {
  console.log("that-tool-llm: Init complete");
});

// const result = await runBrowserAgent({
//   instructions:
//     "Can you summarize the latest changes in the TypeScript compiler for me?",
// });

// console.log(result);

// import puppeteer from "puppeteer";

// const browser = await puppeteer.launch({
//   headless: false,
// });

// const page = await browser.newPage();
// await page.goto("https://www.google.com");

// await page.waitForSelector("text/Google");
