import { OpenAI } from "openai";
import { openai } from "../openai";
// import ivm from "isolated-vm";
import puppeteer, { Browser, Page } from "puppeteer";
// import { writeFileSync } from "fs";
import { browserOpenAITools } from "./tools";
import { runCode } from "./run-isolated";
import { parse } from "node-html-parser";
import { openAIResponsesCall } from "../openai-api-call";
import { createDefaultWinstonLogger } from "@/lib/basic-logger";
import { sleep } from "@/lib/util";

interface BrowserContext {
  browser: Browser | null;
  pages: {
    [pageId: string]: Page;
  };
}

const browserContext: BrowserContext = {
  browser: null,
  pages: {},
};

const logger = createDefaultWinstonLogger("browser-agent", "browser-agent.log");

export async function runBrowserAgent({
  instructions,
  previousResponseId,
}: {
  instructions: string;
  previousResponseId?: string;
}) {
  //   const browser = await puppeteer.launch();
  //   const page = await browser.newPage();
  //   await page.evaluate(`
  //     console.log('Hello, world!');
  //   `);

  //   return;

  logger.info("Starting browser agent session.", {
    instructions,
    previousResponseId,
  });

  browserContext.browser = await puppeteer.launch({
    headless: false,
    browser: "firefox",
  });

  const browserVersion = await browserContext.browser?.version();
  const browserName = await browserContext.browser?.userAgent();

  logger.info("Browser launched.", {
    browserVersion,
    browserName,
  });

  const pages = await browserContext.browser?.pages();
  browserContext.pages = pages?.reduce((acc, curr) => {
    acc[crypto.randomUUID()] = curr;
    return acc;
  }, {} as Record<string, Page>);

  logger.info("Pages opened: ", {
    pages: Object.keys(browserContext.pages),
  });

  let prevRes = previousResponseId;
  let messages: OpenAI.Responses.ResponseInput = [
    {
      role: "user",
      content: instructions,
    },
  ];

  const output: string[] = [];

  while (true) {
    const openPagesInfo = await Promise.all(
      Object.entries(browserContext.pages).map(async ([id, page]) => {
        const url = page.url();
        const title = await page.title();
        return `Page ${id}:\n- URL: ${url}\n- Title: ${
          !title || !title.length ? "No title" : title
        }`;
      })
    );

    const systemPrompt =
      `You are a web browsing sub-agent for a programmer. Your job is to fulfil any queries the programmer may have. \
Don't ask questions to the user, or talk about your actions. Just give a best-effort answer based on the information you find on the web. \
Remember: your knowledge is outdated, so you will need to use the web browser to find up-to-date information. \
For searching, use https://search.brave.com/ instead of Google.\n\
Do not visit links directly. It's okay to go to well known domains, such as org.wikipedia.org, but not to specific pages within the domain. \
For that, use a search engine or a search function on a given website to find the page you want to visit, so you can get the up to date URL to the page you want to visit.\n\n\
## Browser information:\n- Version: ${browserVersion}\n- User Agent: ${browserName}\n\n\
## Open pages:\n` + openPagesInfo.join("\n");

    const { apiResponse, apiError } = await openAIResponsesCall({
      maxRetries: 3,
      retrySeconds: 10,
      modelName: "gpt-4.1-mini",
      input: messages,
      instructions: systemPrompt,
      toolsDefinition: browserOpenAITools,
      previousResponseId: prevRes,
      logger,
    });

    if (!apiResponse || apiError) {
      throw new Error(
        `Failed to get response from OpenAI API: ${apiError?.message}`
      );
    }

    messages = [];
    prevRes = apiResponse.id;

    const response = apiResponse.output;

    if (!response) {
      throw new Error("No response from LLM");
    }

    const mdlMessages = response.filter((x) => x.type === "message");
    if (mdlMessages.some((x) => x.content.some((y) => y.type === "refusal"))) {
      throw new Error("LLM refused to answer");
    }

    mdlMessages.forEach((x) => {
      output.push(
        x.content.reduce((acc, curr) => {
          if (curr.type != "output_text") return acc;
          return acc + curr.text;
        }, "")
      );
    });

    const toolCalls = response.filter((x) => x.type === "function_call");

    if (toolCalls.length === 0) {
      console.log("No tool calls found. Ending conversation.");
      // writeFileSync("messages.json", JSON.stringify(apiResponse, null, 2));
      break;
    }

    for (const toolCall of toolCalls) {
      logger.info("Executing tool call.", {
        toolCall,
      });
      const result = await executeToolCall(toolCall, browserContext);
      if (!result.success) {
        console.error(result.error);
      }

      logger.info("Tool call executed.", {
        result,
      });
      messages.push({
        type: "function_call_output" as const,
        // id: cr.id,
        call_id: toolCall.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  await browserContext.browser?.close();

  return output.join("\n");
}

function getPage(ctx: BrowserContext, pageId: string): Page {
  if (!ctx.pages[pageId]) {
    throw new Error(
      `Page ${pageId} not found. Make sure you have created a page, and have specified a 'page_id' in your tool call.`
    );
  }

  return ctx.pages[pageId];
}

async function getPageContent(page: Page): Promise<string> {
  const pageContent = await page.content();

  const dom = parse(pageContent, {
    lowerCaseTagName: true,
  });

  dom.querySelectorAll("script,style,link,svg").forEach((script) => {
    script.remove();
  });

  return dom.toString();
}

async function executeToolCall(
  toolCall: OpenAI.Responses.ResponseFunctionToolCall,
  browserContext: BrowserContext
): Promise<{
  success: boolean;
  error?: string;
  result?: object;
}> {
  try {
    const args = JSON.parse(toolCall.arguments);
    console.log("calling tool", toolCall.name, args);

    switch (toolCall.name) {
      case "puppeteer_eval":
        const result = await runCode(JSON.parse(toolCall.arguments).js_code);
        console.log(result);
        return {
          success: true,
          result: {
            output: result,
          },
        };
        break;
      case "open_browser":
        browserContext.browser = await puppeteer.launch({
          headless: false,
        });
        return {
          success: true,
        };
        break;
      case "close_browser":
        await browserContext.browser?.close();
        return {
          success: true,
        };
        break;
      case "new_page":
        const page = await browserContext.browser?.newPage();
        if (!page) {
          throw new Error("Failed to create new page");
        }
        const pageId = crypto.randomUUID();
        browserContext.pages[pageId] = page;
        return {
          success: true,
          result: {
            page_id: pageId,
          },
        };
        break;
      case "goto":
        const gotoPage = getPage(browserContext, args.page_id);
        await gotoPage.goto(args.url, {
          waitUntil: args.wait_for_navigation ? "networkidle0" : "load",
        });

        let error: Error | null = null;

        if (args.wait_for_selector) {
          try {
            await gotoPage.waitForSelector(args.wait_for_selector);
          } catch (e) {
            error = e as Error;
          }
        }

        await sleep(5000); // let the page render fully

        return {
          success: true,
          error: error?.message,
          result: {
            page_id: args.page_id,
            page_url: gotoPage.url(),
            // content: await getPageContent(gotoPage),
          },
        };
        break;
      case "close_page":
        await getPage(browserContext, args.page_id).close();
        delete browserContext.pages[args.page_id];
        return {
          success: true,
        };
        break;
      case "get_page_content":
        const contentPage = getPage(browserContext, args.page_id);
        if (!contentPage) {
          throw new Error("Page not found");
        }
        const pageContent = await getPageContent(contentPage);

        return {
          success: true,
          result: {
            page_id: args.page_id,
            page_content: pageContent,
          },
        };
        break;
      case "find_selector":
        const selector = await getPage(
          browserContext,
          args.page_id
        ).waitForSelector(args.selector);
        return {
          success: true,
          result: {
            selector_found: selector !== null,
            content: selector?.evaluate((el) => el.textContent),
          },
        };
        break;
      case "click_selector":
        await getPage(browserContext, args.page_id).click(args.selector);
        return {
          success: true,
          result: {
            selector_clicked: true,
          },
        };
      case "input_into_selector":
        await getPage(browserContext, args.page_id).type(
          args.selector,
          args.text
        );
        return {
          success: true,
          result: {
            selector_input: true,
          },
        };
      default:
        return {
          success: false,
          error: `Unknown tool call: ${toolCall.name}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
