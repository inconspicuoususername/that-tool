import { Request, Response, Router } from "express";
import * as client from "openid-client";
import jwt from "jsonwebtoken";
import { env } from "@/lib/env";
import { b64urlEncodeUtf8, b64urlDecodeUtf8 } from "@/lib/util/base64";
import { addHoursUnixSeconds } from "@/lib/util/time";
import { db } from "@/lib/db";
import { authTable } from "@/lib/db/auth";
import { createOAuthClient } from "@/lib/util/oauth";
import { getFullURL } from "@/lib/util/express";
import { AppError } from "@/lib/util";

type AuthState = { nonce: string };

type GitHubUser = {
  id: number;
  email: string | null;
  login: string;
};

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  // GitHub REST API requests should include a User-Agent header. :contentReference[oaicite:2]{index=2}
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "planner-backend",
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AppError(
      401,
      `GitHub API error (${res.status}): ${text}`,
      "10001",
    );
  }
  return (await res.json()) as T;
}

export const authRouter = Router();

authRouter.get("/github/login", async (req: Request, res: Response) => {
  // GitHub recommends (strongly) state + PKCE for the code flow.
  const nonce = client.randomState();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const stateObj: AuthState = { nonce };
  const encodedState = b64urlEncodeUtf8(JSON.stringify(stateObj));

  const sess = req.session;
  sess.oauth ??= {};
  sess.oauth[nonce] = {
    codeVerifier,
    expectedState: encodedState,
    createdAt: Date.now(),
  };

  const redirectUri = getFullURL(req, "/auth/callback");

  const authUrl = client.buildAuthorizationUrl(createOAuthClient(), {
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state: encodedState,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.redirect(302, authUrl.toString());
});

// GET /api/auth/callback?code=...&state=...
authRouter.get("/callback", async (req: Request, res: Response) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  if (!code || !state)
    throw new AppError(400, "Missing code or state", "10002");

  const decoded = b64urlDecodeUtf8(state);
  const authState = JSON.parse(decoded) as AuthState;

  const sess = req.session;
  const entry = sess.oauth?.[authState.nonce];
  if (!entry)
    throw new AppError(
      400,
      "OAuth session not found (expired or invalid)",
      "10003",
    );
  if (entry.expectedState !== state)
    throw new AppError(400, "State mismatch", "10004");

  // One-time use
  delete sess.oauth?.[authState.nonce];

  const currentURL = new URL(getFullURL(req));

  // Exchange code for tokens (PKCE + expectedState validation). :contentReference[oaicite:6]{index=6}
  const tokens = await client.authorizationCodeGrant(
    createOAuthClient(),
    currentURL,
    {
      pkceCodeVerifier: entry.codeVerifier,
      expectedState: entry.expectedState,
    },
  );

  const accessToken = tokens.access_token;
  if (!accessToken)
    throw new AppError(401, "No access_token received", "10005");

  // Fetch user info
  const ghUser = await githubApi<GitHubUser>("/user", accessToken);

  // If email missing, fetch from /user/emails (requires user:email scope). :contentReference[oaicite:7]{index=7}
  let email = ghUser.email;
  if (!email) {
    const emails = await githubApi<
      Array<{ email: string; primary: boolean; verified: boolean }>
    >("/user/emails", accessToken);
    const primaryVerified = emails.find((e) => e.primary && e.verified);
    if (!primaryVerified)
      throw new AppError(401, "No verified email found", "10006");
    email = primaryVerified.email;
  }

  if (email !== env.auth.allowedEmail) {
    throw new AppError(403, "Email not authorized", "10007");
  }

  const githubId = String(ghUser.id);

  // Upsert user in DB
  const result = await db
    .insert(authTable)
    .values({
      github_id: githubId,
      email,
      username: ghUser.login,
    })
    .onConflictDoUpdate({
      target: authTable.github_id,
      set: {
        email: authTable.email,
        username: authTable.username,
      },
    })
    .returning();

  const user = result[0];
  if (!user) throw new AppError(500, "Failed to upsert user", "10008");

  // Generate JWT (3 hours)
  const token = jwt.sign(
    { sub: String(user.id), email: user.email, exp: addHoursUnixSeconds(3) },
    env.auth.jwtSecret,
  );

  res.json({ token, user });
});
