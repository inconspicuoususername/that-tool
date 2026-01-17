import * as client from "openid-client";
import { env } from "@/lib/env";

let oauthClient: client.Configuration | null = null;

export function createOAuthClient() {
    if (oauthClient) {
        return oauthClient;
    }
    const serverMetadata: client.ServerMetadata = {
      issuer: "https://github.com",
      authorization_endpoint: "https://github.com/login/oauth/authorize", // GitHub OAuth authorize endpoint :contentReference[oaicite:4]{index=4}
      token_endpoint: "https://github.com/login/oauth/access_token",
    };
    
    oauthClient = new client.Configuration(
      serverMetadata,
      env.auth.githubClientId,
      { client_secret: env.auth.githubClientSecret },
      client.ClientSecretPost(), // send client_id/client_secret in the POST body
    );
    
    // Ensure token endpoint response is JSON if the provider varies.
    // (Harmless if already JSON; helps with providers that otherwise return urlencoded.)
    oauthClient[client.customFetch] = async (url, options) => {
      const headers = new Headers(options?.headers);
      headers.set("accept", "application/json");
      return fetch(url, { ...options, headers });
    };

    return oauthClient;
}