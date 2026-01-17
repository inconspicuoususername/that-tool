import "express-session";

declare module "express-session" {
  interface SessionData {
    oauth?: {
      [nonce: string]: {
        codeVerifier: string;
        expectedState: string;
        createdAt: number;
      };
    };
  }
}