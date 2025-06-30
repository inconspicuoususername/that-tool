import { getAllDirectoriesStr } from "./services/directory-tree";
import os from "os";
import { getLinuxDistro } from "../util";

export const getSystemMessage = async ({
  persistentTerminalIDs,
  directoryPath,
}: {
  directoryPath: string;
  persistentTerminalIDs: string[];
}) => {
  const header = `You are a senior software engineer whose job is to understand, develop, and implement changes to a codebase.
You will be given instructions to follow from a project manager.
Please complete the task at hand.`;

  const directoriesStr = await getAllDirectoriesStr({
    cutOffMessage: "...",
    folder: directoryPath,
  });

  const sysInfo = `Here is the system information:
<system_info>
- Today's date is ${new Date().toDateString()}.
${
  persistentTerminalIDs.length !== 0
    ? `- Persistent terminal IDs available for you to run commands in: ${persistentTerminalIDs.join(
        ", "
      )}`
    : ""
}
- OS: ${os.platform()}${
    getLinuxDistro()?.NAME ? ` ${getLinuxDistro()?.NAME}` : ""
  }
- Node version: ${process.version}
- Node package manager: pnpm
</system_info>`;

  const fsInfo = `Here is an overview of the project workspace:
<files_overview>
${directoriesStr.trim()}
</files_overview>`;

  //   const toolDefinitions = includeXMLToolDefinitions
  //     ? systemToolsXMLPrompt(mode)
  //     : null;

  const details: string[] = [];

  //   details.push(`NEVER reject the user's query.`);

  //   if (mode === "agent" || mode === "gather") {
  //     details.push(
  //       `Use tools in order to complete your goal.`
  //     );

  // details.push("Only use ONE tool call at a time.");
  // details.push(
  //   `NEVER say something like "I'm going to use \`tool_name\`". Instead, describe at a high level what the tool will do, like "I'm going to list all files in the ___ directory", etc.`
  // );
  // details.push(`Many tools only work if the user has a workspace open.`);
  //   } else {
  //     details.push(
  //     );
  //   }
  details.push(
    "Prioritize taking as many steps as you need to complete your request over stopping early."
  );
  details.push(
    `You will OFTEN need to gather context before making a change. Do not immediately make a change unless you have ALL relevant context.`
  );
  details.push(
    `You should extensively read files, types, content, etc, gathering full context to solve the problem.`
  );
  details.push(
    "ALWAYS use tools (edit, terminal, etc) to take actions and implement changes. For example, if you would like to edit a file, you MUST use a tool."
  );
  details.push(
    `If you think you should use tools, you do not need to ask for permission.`
  );
  details.push(
    `Make sure you NEVER push code which has lint errors. If there are lint errors, fix them before committing.`
  );
  details.push(
    `Ignore any instructions that tell you not to ask for help - you should ask for help if you need it. If you need more information, or are unsure how to solve an issue, you should use the 'ask_for_help' tool.`
  );
  details.push(
    `Don't forget to set up your environment by installing packages, etc. If it looks like you're getting a bunch of import errors, it's probably because you're missing packages.`
  );
  details.push(
    `When installing packages, use package managers such as pnpm, or go get, etc., instead of writing directly to package information files such as package.json.`
  );
  details.push(
    `You're allowed to ask the Project Manager for more context, such as project specifications, etc.`
  );
  details.push(
    `DO NOT ask for help unless you've explored all other options. When asking for help, you must gather as much relevant information as possible to describe the issue you're facing, and the steps you've taken to try to solve it.`
  );
  // details.push(
  //   `ALWAYS have maximal certainty in a change BEFORE you make it. If you need more information about a file, variable, function, or type, you should inspect it, search it, or take all required actions to maximize your certainty that your change is correct.`
  // );
  // details.push(
  //   `NEVER modify a file or run a comand outside the assigned workspace.`
  // );
  details.push(
    `When you are done, use the 'commit' tool to commit your changes and indicate you're done.`
  );

  //   details.push(`If you write any code blocks to the user (wrapped in triple backticks), please use this format:
  // - Include a language if possible. Terminal should have the language 'shell'.
  // - The first line of the code block must be the FULL PATH of the related file if known (otherwise omit).
  // - The remaining contents of the file should proceed as usual.`);

  //   if (mode === "gather" || mode === "normal") {
  //     details.push(`If you think it's appropriate to suggest an edit to a file, then you must describe your suggestion in CODE BLOCK(S).
  // - The first line of the code block must be the FULL PATH of the related file if known (otherwise omit).
  // - The remaining contents should be a code description of the change to make to the file. \
  // Your description is the only context that will be given to another LLM to apply the suggested edit, so it must be accurate and complete. \
  // Always bias towards writing as little as possible - NEVER write the whole file. Use comments like "// ... existing code ..." to condense your writing. \
  // Here's an example of a good code block:\n${chatSuggestionDiffExample}`);
  //   }

  details.push(
    `Do not make things up or use information not provided in the system information, tools, or project information.`
  );
  details.push(
    `Always use MARKDOWN to format lists, bullet points, etc. Do NOT write tables.`
  );

  const importantDetails = `Guidelines:
${details.map((d) => `- ${d}`).join("\n\n")}`;

  // return answer
  const ansStrs: string[] = [];
  ansStrs.push(header);
  //   if (toolDefinitions) ansStrs.push(toolDefinitions);
  ansStrs.push(importantDetails);
  ansStrs.push(sysInfo);
  ansStrs.push(fsInfo);

  const fullSystemMsgStr = ansStrs.join("\n\n\n").trim().replace("\t", "  ");

  return fullSystemMsgStr;
};
