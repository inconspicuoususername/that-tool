import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { MAX_TERMINAL_BG_COMMAND_TIME } from "../constants";

export class TerminalService {
  private persistentTerminals: Map<string, ChildProcess> = new Map();
  private terminalOutputs: Map<string, string> = new Map();
  private terminalEvents: Map<string, EventEmitter> = new Map();
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  private getTerminalId(): string {
    const id = (this.persistentTerminals.size + 1).toString();
    return id;
  }

  getTerminalIDs(): string[] {
    return Array.from(this.persistentTerminals.keys());
  }

  private createTerminal(cwd?: string): ChildProcess {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    // console.log("shell info", shell, cwd || this.workspacePath);
    const terminal = spawn(shell, [], {
      cwd: cwd || this.workspacePath,
      env: process.env,
      shell: true,
    });

    terminal.stdout.on("data", (data) => {
      const output = data.toString();
      const terminalId = this.getTerminalId();
      const currentOutput = this.terminalOutputs.get(terminalId) || "";
      this.terminalOutputs.set(terminalId, currentOutput + output);
      this.terminalEvents.get(terminalId)?.emit("data", output);
    });

    terminal.stderr.on("data", (data) => {
      const output = data.toString();
      const terminalId = this.getTerminalId();
      const currentOutput = this.terminalOutputs.get(terminalId) || "";
      this.terminalOutputs.set(terminalId, currentOutput + output);
      this.terminalEvents.get(terminalId)?.emit("data", output);
    });

    terminal.on("exit", (code) => {
      console.log(
        "Recieved exit event for terminal",
        terminal.pid ?? "unknown",
        "with code",
        code
      );
    });

    terminal.on("error", (error) => {
      console.error(
        "Recieved error event for terminal",
        terminal.pid ?? "unknown",
        "with error",
        error
      );
    });

    terminal.on("close", (code) => {
      console.log(
        "Recieved close event for terminal",
        terminal.pid ?? "unknown",
        "with code",
        code
      );
    });
    return terminal;
  }

  async runCommand(
    command: string,
    cwd?: string
  ): Promise<{
    output: {
      output: string;
      exitReason: "success" | "timeout";
    };
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const timeout = MAX_TERMINAL_BG_COMMAND_TIME * 1000;
      const terminal = this.createTerminal(cwd);
      const terminalId = this.getTerminalId();
      const eventEmitter = new EventEmitter();
      this.terminalEvents.set(terminalId, eventEmitter);

      let output = "";
      let exitReason: "success" | "timeout" = "success";
      eventEmitter.on("data", (data) => {
        output += data;
      });

      const timeoutId = setTimeout(() => {
        exitReason = "timeout";
        terminal.kill();
      }, timeout);

      let hasExited = false;

      const exitHandler = (code: number) => {
        if (hasExited) {
          return;
        }
        this.terminalEvents.delete(terminalId);
        this.terminalOutputs.delete(terminalId);
        clearTimeout(timeoutId);
        resolve({
          output: {
            output,
            exitReason,
          },
          exitCode: code || 0,
        });
        hasExited = true;
      };
      terminal.on("close", exitHandler);
      terminal.on("exit", exitHandler);

      terminal.once("spawn", () => {
        if (terminal.stdin?.writable) {
          try {
            terminal.stdin.write(command + "\nexit\n");
          } catch (error) {
            console.error(
              "error writing command to terminal",
              JSON.stringify(error)
            );
          }
        } else {
          console.error("terminal stdin not writable");
        }
      });
    });
  }

  async openPersistentTerminal(cwd?: string): Promise<string> {
    const terminal = this.createTerminal(cwd);
    const terminalId = this.getTerminalId();
    this.persistentTerminals.set(terminalId, terminal);
    this.terminalOutputs.set(terminalId, "");
    this.terminalEvents.set(terminalId, new EventEmitter());
    return terminalId;
  }

  async runPersistentCommand(
    command: string,
    terminalId: string
  ): Promise<{ output: string; exitCode: number }> {
    const terminal = this.persistentTerminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} does not exist`);
    }

    return new Promise((resolve) => {
      const eventEmitter = this.terminalEvents.get(terminalId);
      if (!eventEmitter) {
        throw new Error(`Terminal ${terminalId} event emitter not found`);
      }

      let output = "";
      const dataHandler = (data: string) => {
        output += data;
      };

      eventEmitter.on("data", dataHandler);

      if (terminal.stdin) {
        terminal.stdin.write(command + "\n");
      }

      // Wait for command to complete (this is a simple implementation)
      setTimeout(() => {
        eventEmitter.removeListener("data", dataHandler);
        resolve({ output, exitCode: 0 });
      }, 1000);
    });
  }

  async killPersistentTerminal(terminalId: string): Promise<boolean> {
    const terminal = this.persistentTerminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} does not exist`);
    }

    terminal.kill();
    this.persistentTerminals.delete(terminalId);
    this.terminalOutputs.delete(terminalId);
    this.terminalEvents.delete(terminalId);
    return true;
  }

  getTerminalOutput(terminalId: string): string {
    return this.terminalOutputs.get(terminalId) || "";
  }

  listPersistentTerminals(): string[] {
    return Array.from(this.persistentTerminals.keys());
  }
}
