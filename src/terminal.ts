import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import path from "path";

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

  private createTerminal(cwd?: string): ChildProcess {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
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

    return terminal;
  }

  async runCommand(
    command: string,
    cwd?: string
  ): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve) => {
      const terminal = this.createTerminal(cwd);
      const terminalId = this.getTerminalId();
      const eventEmitter = new EventEmitter();
      this.terminalEvents.set(terminalId, eventEmitter);

      let output = "";
      eventEmitter.on("data", (data) => {
        output += data;
      });

      terminal.on("close", (code) => {
        this.terminalEvents.delete(terminalId);
        this.terminalOutputs.delete(terminalId);
        resolve({ output, exitCode: code || 0 });
      });

      if (terminal.stdin) {
        terminal.stdin.write(command + "\n");
        terminal.stdin.end();
      }
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
