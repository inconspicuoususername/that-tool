// used for calling language server protocol to lint typescript code

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import path from "path";
import {
  ActiveRequest,
  LSPInput,
  LSPResponse,
  LSPEvent,
  LSPEventReqComplete,
} from "@/types/lint";
import { logger } from ".";

let server: ChildProcessWithoutNullStreams | null = null;

const activeRequests: Map<number, ActiveRequest> = new Map();

let seq = 1;

function sendRequest(
  inputRequest: LSPInput,
  callback: (response: LSPResponse, events: LSPEvent[]) => void
) {
  const currentSeq = seq++;
  const request = {
    seq: currentSeq,
    type: "request",
    command: inputRequest.command,
    arguments: inputRequest.arguments,
  };

  activeRequests.set(currentSeq, {
    request,
    callback,
    eventHandler: inputRequest.eventFilter
      ? {
          events: [],
          filter: inputRequest.eventFilter,
        }
      : undefined,
  });

  const requestString = JSON.stringify(request);
  logger.info("sending request to tsserver", { requestString });

  server!.stdin.write(requestString + "\r\n", (e) => {
    if (e) {
      logger.error("Error sending request to tsserver", { error: e });
    }
  });
}

async function handleResponse(response: LSPResponse | LSPEventReqComplete) {
  const requestSeq =
    "request_seq" in response
      ? response.request_seq
      : response.body.request_seq;
  const request = activeRequests.get(requestSeq);
  if (!request) {
    logger.error("Request not found", { response });
    return;
  }
  const events = request.eventHandler?.events ?? [];
  request.callback(
    {
      seq: response.seq,
      type: "response",
      command: "event" in response ? request.request.command : response.command,
      request_seq: requestSeq,
      success: "success" in response ? response.success : true,
      body: response.body,
    },
    events
  );
  activeRequests.delete(response.seq);
}

async function sendRequestAsync(request: LSPInput): Promise<{
  response: LSPResponse;
  events: LSPEvent[];
}> {
  return new Promise((resolve) => {
    sendRequest(request, (response, events) => {
      resolve({ response, events });
    });
  });
}

async function startTypescriptServer(): Promise<ChildProcessWithoutNullStreams> {
  if (server) {
    return Promise.resolve(server);
  }

  server = spawn(
    "/bin/sh",
    ["-c", "tsserver --logVerbosity verbose --logFile ./tsserver.log"],
    {
      stdio: "pipe",
    }
  );

  server.stdin.on("data", (data) => {
    logger.info("Data", { data: data.toString() });
  });

  // server.stdin.write(
  //   // JSON.stringify({
  //   //   seq: 1,
  //   //   type: "request",
  //   //   command: "open",
  //   //   arguments: {
  //   //     file: "./test.ts",
  //   //   },
  //   // })
  //   `{"seq":1,"type":"request","command":"open","arguments":{"file":"./test.ts"}}`
  // );

  server.stdout.on("data", (data) => {
    logger.info("recieved stdout on tsserver", { data: data.toString() });
    const dataChunks = data.toString().split("\r\n");
    const res = JSON.parse(dataChunks[dataChunks.length - 1]);
    if (res.type !== "response") {
      if (res.type === "event") {
        if (res.event === "requestCompleted") {
          handleResponse(res);
          return;
        } else {
          for (const request of activeRequests.values()) {
            if (request.eventHandler?.filter(res)) {
              request.eventHandler.events.push(res);
            }
          }
        }
      }
      return;
    }
    handleResponse(res);
  });

  server.stdout.on("end", () => {
    logger.info("End");
  });
  server.stdout.on("close", () => {
    logger.info("Close");
  });
  server.stdout.on("error", () => {
    logger.error("Error");
  });
  server.stdout.on("pause", () => {
    logger.info("Pause");
  });
  server.stdout.on("resume", () => {
    logger.info("Resume");
  });
  // server.stdout.on("readable", () => {
  //   console.log("Readable");

  //   const read = server.stdout.read();
  //   // console.log("Read", read?.toString());
  //   // if (data) {
  //   //   console.log("Data", data.toString());
  //   //   resolve(data.toString());
  //   // }
  // });

  server.stderr.on("data", (data) => {
    logger.info("Stderr data", { data: data.toString() });
  });
  // server.stderr.on("end", () => {
  //   console.log("Stderr end");
  // });
  // server.stderr.on("close", () => {
  //   console.log("Stderr close");
  // });
  // server.stderr.on("error", () => {
  //   console.log("Stderr error");
  // });
  // server.stderr.on("pause", () => {
  //   console.log("Stderr pause");
  // });
  // server.stderr.on("resume", () => {
  //   console.log("Stderr resume");
  // });
  // server.stderr.on("readable", () => {
  //   console.log("Stderr readable");

  //   const data = server.stderr.read();
  //   console.log("Stderr read", data?.toString());
  //   // if (data) {
  //   //   console.log("Stderr data", data.toString());
  //   //   resolve(data.toString());
  //   // }
  // });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await sendRequestAsync({
    command: "configure",
    arguments: {
      hostInfo: "thattool-llm",
      preferences: {
        providePrefixAndSuffixTextForRename: true,
        allowRenameOfImportPath: true,
        includePackageJsonAutoImports: "on",
        excludeLibrarySymbolsInNavTo: true,
      },
    },
  });

  await sendRequestAsync({
    command: "compilerOptionsForInferredProjects",
    arguments: {
      options: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        jsx: "react-jsx",
        allowImportingTsExtensions: true,
        strictNullChecks: true,
        strictFunctionTypes: true,
        sourceMap: true,
        allowJs: true,
        allowSyntheticDefaultImports: true,
        allowNonTsExtensions: true,
        resolveJsonModule: true,
      },
    },
  });

  return server;
}

export interface LintTypescriptDiagnostic {
  start: {
    line: number;
    offset: number;
  };
  end: {
    line: number;
    offset: number;
  };
  text: string;
  code: number;
  category: "error";
}

export interface LintTypescriptResponse {
  original: {
    response: LSPResponse;
    events: LSPEvent[];
  };
  syntaxDiag: {
    file: string;
    diagnostics: LintTypescriptDiagnostic[];
  };
  semanticDiag: {
    file: string;
    diagnostics: LintTypescriptDiagnostic[];
  };
}

const openFiles = new Set<string>();

async function lintTypescript(
  filePath: string
): Promise<LintTypescriptResponse> {
  if (!filePath.startsWith("/")) {
    filePath = path.join(process.cwd(), filePath);
  }
  // {"seq": 0, "type": "request", "command": "open", "arguments": { "files": ["./test.ts"] }}

  // server.stdin.write(
  //   JSON.stringify({
  //     seq: 0,
  //     type: "request",
  //     command: "open",
  //     arguments: { file: file },
  //   }) + "\r\n",
  //   (e) => {
  //     console.log("Error", e);
  //   }
  // );

  // server.stdin.end();

  // console.log("Result", result);
  // const fileContent = fs.readFileSync(filePath, "utf8");

  // await sendRequestAsync({
  //   command: "updateOpen",
  //   arguments: {
  //     openFiles: [
  //       {
  //         file: filePath,
  //         fileContent: fileContent,
  //         scriptKindName: "TS",
  //       },
  //     ],
  //     closedFiles:
  //       openFiles.size > 0
  //         ? Array.from(openFiles).filter((file) => file !== filePath)
  //         : [],
  //     changedFiles: [],
  //   },
  // });

  openFiles.add(filePath);

  await sendRequestAsync({
    command: "open",
    arguments: {
      file: filePath,
    },
  });

  const { response, events } = await sendRequestAsync({
    command: "geterr",
    arguments: {
      delay: 0,
      files: [
        filePath,
        // {
        //   file: filePath,
        //   ranges: [
        //     {
        //       startLine: 1,
        //       endLine: fileContent.split("\n").length,
        //       startOffset: 0,
        //       endOffset: fileContent.length,
        //     },
        //   ],
        // },
      ],
    },
    eventFilter: (event) => {
      const filters = ["semanticDiag", "syntaxDiag"];
      return filters.includes(event.event) && event.body.file === filePath;
    },
  });

  const syntaxDiag = events.filter((event) => event.event === "syntaxDiag");
  const semanticDiag = events.filter((event) => event.event === "semanticDiag");

  await sendRequestAsync({
    command: "close",
    arguments: {
      file: filePath,
    },
  });

  return {
    original: {
      response,
      events,
    },
    syntaxDiag: {
      file: filePath,
      diagnostics: syntaxDiag.flatMap((event) => event.body.diagnostics),
    },
    semanticDiag: {
      file: filePath,
      diagnostics: semanticDiag.flatMap((event) => event.body.diagnostics),
    },
  };
}

export { lintTypescript, startTypescriptServer };
