import { OpenAI } from "openai";

export const browserOpenAITools: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "new_page",
    description: "Open a new page in the puppeteer browser instance.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "close_page",
    description: "Close the current page in the puppeteer browser instance.",
    parameters: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to close.",
        },
      },
      required: ["page_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_page_content",
    description: "Get the content of a page.",
    parameters: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to get the content of.",
        },
      },
      required: ["page_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  // {
  //   type: "function",
  //   name: "find_selector",
  //   description: "Find a selector in the current page.",
  //   parameters: {
  //     type: "object",
  //     properties: {
  //       selector: {
  //         type: "string",
  //         description:
  //           "selector to query the page for. CSS selectors can be passed as-is and a Puppeteer-specific selector syntax allows querying by text, a11y role and name, and xpath and combining these queries across shadow roots. Alternatively, you can specify the selector type using a prefix, like `text/My Text`.",
  //       },
  //       page_id: {
  //         type: "string",
  //         description: "The ID of the page to find the selector in.",
  //       },
  //     },
  //     required: ["selector", "page_id"],
  //     additionalProperties: false,
  //   },
  //   strict: true,
  // },
  {
    type: "function",
    name: "click_selector",
    description: "Click a selector in the current page.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "selector to query the page for. CSS selectors can be passed as-is and a Puppeteer-specific selector syntax allows querying by text, a11y role and name, and xpath and combining these queries across shadow roots. Alternatively, you can specify the selector type using a prefix, like `text/My Text`.",
        },
        page_id: {
          type: "string",
          description: "The ID of the page to click the selector in.",
        },
      },
      required: ["selector", "page_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "goto",
    description: "Navigate to a URL on an existing page.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to navigate to.",
        },
        page_id: {
          type: "string",
          description: "The ID of the page to navigate to.",
        },
        // wait_for_selector: {
        //   type: "string",
        //   description:
        //     "NOTE: Optional. Pass an empty string to not wait for any selector.\n\n\
        //     Selector to wait for. CSS selectors can be passed as-is and a Puppeteer-specific selector syntax allows querying by text, a11y role and name, and xpath and combining these queries across shadow roots. Alternatively, you can specify the selector type using a prefix, like `text/My Text`.",
        // },
        wait_for_navigation: {
          type: "boolean",
          description:
            "Optional. Whether to wait for navigation to complete. Defaults to false.",
        },
      },
      required: ["url", "page_id", "wait_for_navigation"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "input_into_selector",
    description: "Input text into a selector in a page.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "selector to query the page for. CSS selectors can be passed as-is and a Puppeteer-specific selector syntax allows querying by text, a11y role and name, and xpath and combining these queries across shadow roots. Alternatively, you can specify the selector type using a prefix, like `text/My Text`.",
        },
        page_id: {
          type: "string",
          description: "The ID of the page to input text into.",
        },
        text: {
          type: "string",
          description: "The text to input into the selector.",
        },
      },
      required: ["selector", "page_id", "text"],
      additionalProperties: false,
    },
    strict: true,
  },
];
