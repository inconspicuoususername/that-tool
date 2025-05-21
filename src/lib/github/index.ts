import { Octokit } from "@octokit/rest";
import { Webhooks } from "@octokit/webhooks";
import simpleGit, { SimpleGit } from "simple-git";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";
import { EventSource } from "eventsource";
import { Logger } from "@/lib/basic-logger";

export class GitHubWrapper {
  private git: SimpleGit;
  private webhookClient: Webhooks;
  private webhookSecret: string;

  private clientMap: Map<
    string,
    {
      token: string;
      client: Octokit;
      webhookId?: number;
      refcount: number;
    }
  > = new Map();

  constructor(private logger: Logger) {
    this.git = simpleGit();
    this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET!;
    this.webhookClient = new Webhooks({
      secret: this.webhookSecret,
    });
    this._init();
  }

  public registerWebhookCallback(
    webhookCallback: HandlerFunction<"pull_request_review">
  ) {
    this.logger.info(
      "Registering new webhook callback for pull_request_review"
    );
    this.webhookClient.on("pull_request_review", webhookCallback);
  }

  private _init() {
    const url = process.env.GITHUB_WEBHOOK_URL!;
    if (process.env.NODE_ENV === "development") {
      const source = new EventSource(url);
      source.onmessage = (event) => {
        const webhookEvent = JSON.parse(event.data);
        const id = webhookEvent["x-request-id"];
        const name = webhookEvent["x-github-event"];
        const signature = webhookEvent["x-hub-signature-256"];
        const payload = JSON.stringify(webhookEvent.body);

        console.log("Received webhook event:", id, name, signature);
        this.webhookClient
          .verifyAndReceive({
            id,
            name,
            signature,
            payload,
          })
          .catch(console.error);
      };
    }
  }

  getURL(token: string, repo: string, owner: string) {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  async cloneRepo(
    token: string,
    repo: string,
    owner: string,
    targetDir: string
  ): Promise<void> {
    this.logger.info("Cloning repo:", owner, repo);
    await this.git.clone(this.getURL(token, repo, owner), targetDir);
  }

  async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    this.logger.info("Checking out branch:", branchName, "in repo:", repoPath);
    const repo = simpleGit(repoPath);
    await repo.checkout(branchName);
  }

  async createBranch(repoPath: string, branchName: string): Promise<void> {
    this.logger.info("Creating branch:", branchName, "in repo:", repoPath);
    const repo = simpleGit(repoPath);
    await repo.checkoutLocalBranch(branchName);
  }

  async commitAndPush(
    repoPath: string,
    branchName: string,
    commitMessage: string
  ): Promise<void> {
    this.logger.info(
      "Committing and pushing:",
      branchName,
      "in repo:",
      repoPath
    );
    const repo = simpleGit(repoPath);
    await repo.add(".");
    await repo.commit(commitMessage);
    await repo.push("origin", branchName);
  }

  async setupClient(token: string, owner: string, repo: string) {
    const key = {
      owner,
      repo,
    };
    this.logger.info("Registering reference to client for:", owner, repo);
    if (this.clientMap.has(JSON.stringify(key))) {
      const client = this.clientMap.get(JSON.stringify(key))!;
      client.refcount++;
      this.clientMap.set(JSON.stringify(key), client);
      return client;
    }
    const client = new Octokit({ auth: token });
    this.clientMap.set(JSON.stringify(key), { client, refcount: 1, token });
    await this._deleteAllWebhooks(owner, repo);
    await this._setupWebhook(owner, repo);
    return client;
  }

  private async _getClient(owner: string, repo: string) {
    const key = {
      owner,
      repo,
    };
    const client = this.clientMap.get(JSON.stringify(key));

    if (!client) {
      throw new Error("Client not found");
    }

    return client;
  }

  async releaseClient(owner: string, repo: string) {
    const key = {
      owner,
      repo,
    };
    const client = this.clientMap.get(JSON.stringify(key))!;
    this.logger.info("Releasing client for:", owner, repo);
    client.refcount--;
    if (client.refcount === 0) {
      this._deleteAllWebhooks(owner, repo);
      this.clientMap.delete(JSON.stringify(key));
    }
  }

  async createPullRequest({
    owner,
    repo,
    title,
    head,
    base,
    body,
  }: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body?: string;
  }) {
    this.logger.info("Creating pull request:", owner, repo, title);
    const client = await this._getClient(owner, repo);
    return await client.client.pulls.create({
      owner,
      repo,
      title,
      head,
      base: base,
      body,
    });
  }

  private async _setupWebhook(owner: string, repo: string) {
    this.logger.info("Setting up webhook for:", owner, repo);
    const client = await this._getClient(owner, repo);
    const url = process.env.GITHUB_WEBHOOK_URL!;
    const res = await client.client.repos.createWebhook({
      owner,
      repo,
      name: "web",
      active: true,
      events: ["pull_request_review"],
      config: {
        url,
        content_type: "json",
        secret: this.webhookSecret,
      },
    });

    return {
      id: res.data.id,
      url,
    };
  }

  private async _deleteAllWebhooks(owner: string, repo: string) {
    this.logger.info("Deleting all webhooks for:", owner, repo);
    const client = await this._getClient(owner, repo);
    const webhooks = await client.client.repos.listWebhooks({
      owner,
      repo,
    });
    for (const webhook of webhooks.data) {
      await client.client.repos.deleteWebhook({
        owner,
        repo,
        hook_id: webhook.id,
      });
    }
  }
}
