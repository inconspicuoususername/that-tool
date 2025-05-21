export type Logger = {
  log: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
};

export function createLogger(name: string): Logger {
  return {
    log: (message: string) =>
      console.log(`[${new Date().toISOString()}] [${name}] ${message}`),
    error: (message: string, ...args: any[]) =>
      console.error(
        `[${new Date().toISOString()}] [${name}] ${message}`,
        ...args
      ),
    warn: (message: string, ...args: any[]) =>
      console.warn(
        `[${new Date().toISOString()}] [${name}] ${message}`,
        ...args
      ),
    info: (message: string, ...args: any[]) =>
      console.info(
        `[${new Date().toISOString()}] [${name}] ${message}`,
        ...args
      ),
  };
}
