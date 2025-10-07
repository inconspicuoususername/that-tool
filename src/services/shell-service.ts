import { MAX_TERMINAL_BG_COMMAND_TIME } from "@/llm/constants";
import { ChildProcess, spawn } from "child_process";
import EventEmitter from "events";
import { Logger } from "winston";

export interface ShellInstance {
  id: string;
  proc: ChildProcess;
  persistent: boolean;
  output: string;
  eventEmitter: EventEmitter;
  startCwd: string;
}

export class ShellService {
  private terminals: Map<string, ShellInstance> = new Map();

  constructor(private logger: Logger) {
    this._init();
  }

  private async _init() {
    this.logger.info("Initializing ShellService");
  }

  getTerminalIDs(): string[] {
    return Array.from(this.terminals.keys());
  }

  getPersistentTerminalIDs(): string[] {
    return Array.from(this.terminals.values())
      .filter((terminal) => terminal.persistent)
      .map((terminal) => terminal.id);
  }

  private createTerminal(
    cwd: string,
    persistent: boolean,
    env?: Record<string, string>
  ): ShellInstance {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const terminal = spawn(shell, [], {
      cwd: cwd,
      env: env
        ? {
            ...env,
            NODE_ENV: process.env.NODE_ENV || "development",
          }
        : process.env,
      shell: true,
    });

    if (!terminal?.pid) {
      throw new Error("Failed to spawn terminal");
    }

    const instanceId = terminal.pid.toString();

    const terminalInstance: ShellInstance = {
      id: instanceId,
      proc: terminal,
      output: "",
      eventEmitter: new EventEmitter(),
      persistent: persistent,
      startCwd: cwd,
    };

    this.terminals.set(instanceId, terminalInstance);

    terminal.stdout.on("data", (data) => {
      const output = data.toString();
      //   const terminalInstance = this.terminals.get(instanceId);
      //   if (!terminalInstance) {
      //     this.logger.error(`Terminal ${instanceId} not found`);
      //     return;
      //   }
      const currentOutput = terminalInstance.output || "";
      terminalInstance.output = currentOutput + output;
      terminalInstance.eventEmitter.emit("data", output);
    });

    terminal.stderr.on("data", (data) => {
      const output = data.toString();
      //   const terminalInstance = this.terminals.get(instanceId);
      //   if (!terminalInstance) {
      //     this.logger.error(`Terminal ${instanceId} not found`);
      //     return;
      //   }
      const currentOutput = terminalInstance.output || "";
      terminalInstance.output = currentOutput + output;
      terminalInstance.eventEmitter.emit("data", output);
    });

    terminal.on("exit", (code) => {
      //   const terminalInstance = this.terminals.get(instanceId);
      //   if (!terminalInstance) {
      //     this.logger.error(`Terminal ${instanceId} not found`);
      //     return;
      //   }
      this.logger.info(`Terminal ${instanceId} exited with code ${code}`);
      terminalInstance.eventEmitter.emit("exit", code);
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
      //   const terminalInstance = this.terminals.get(instanceId);
      //   if (!terminalInstance) {
      //     this.logger.error(`Terminal ${instanceId} not found`);
      //     return;
      //   }
      this.logger.info(`Terminal ${instanceId} closed with code ${code}`);
      terminalInstance.eventEmitter.emit("close", code);

      terminalInstance.eventEmitter.removeAllListeners();
      terminalInstance.proc.removeAllListeners();
      terminalInstance.proc.stdin?.removeAllListeners();
      terminalInstance.proc.stdout?.removeAllListeners();
      terminalInstance.proc.stderr?.removeAllListeners();
      this.terminals.delete(instanceId);
    });

    return terminalInstance;
  }

  async runCommand(
    command: string,
    timeout: number,
    cwd: string,
    env?: Record<string, string>
  ): Promise<{
    output: {
      output: string;
      exitReason: "success" | "timeout";
    };
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const terminal = this.createTerminal(cwd, false, env);

      let exitReason: "success" | "timeout" = "success";

      const timeoutId = setTimeout(() => {
        exitReason = "timeout";
        terminal.proc.kill();
      }, timeout);

      let hasExited = false;

      const exitHandler = (code: number) => {
        if (hasExited) {
          return;
        }
        this.terminals.delete(terminal.id);
        clearTimeout(timeoutId);
        resolve({
          output: {
            output: terminal.output,
            exitReason,
          },
          exitCode: code || 0,
        });
        hasExited = true;
      };

      terminal.proc.on("close", exitHandler);
      terminal.proc.on("exit", exitHandler);

      terminal.proc.once("spawn", () => {
        if (terminal.proc.stdin?.writable) {
          try {
            terminal.proc.stdin.write(command + "\nexit\n");
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

  async openPersistentTerminal(cwd: string): Promise<string> {
    const terminal = this.createTerminal(cwd, true);
    this.terminals.set(terminal.id, terminal);
    return terminal.id;
  }

  async runPersistentCommand(
    command: string,
    terminalId: string
  ): Promise<{ output: string; exitCode: number }> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} does not exist`);
    }

    return new Promise((resolve) => {
      const eventEmitter = this.terminals.get(terminalId)?.eventEmitter;
      if (!eventEmitter) {
        throw new Error(`Terminal ${terminalId} event emitter not found`);
      }

      let output = "";
      const dataHandler = (data: string) => {
        output += data;
      };

      eventEmitter.on("data", dataHandler);

      if (terminal.proc.stdin) {
        terminal.proc.stdin.write(command + "\n");
      }

      // Wait for command to complete (this is a simple implementation)
      setTimeout(() => {
        eventEmitter.removeListener("data", dataHandler);
        resolve({ output, exitCode: 0 });
      }, 1000);
    });
  }

  async killPersistentTerminal(terminalId: string): Promise<boolean> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} does not exist`);
    }

    terminal.proc.kill();
    this.terminals.delete(terminalId);
    return true;
  }

  getTerminalOutput(terminalId: string): string {
    return this.terminals.get(terminalId)?.output || "";
  }
}
