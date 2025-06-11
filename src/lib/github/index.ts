import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import simpleGit, { SimpleGit } from "simple-git";
import { HandlerFunction } from "@octokit/webhooks/dist-types/types";
import { Logger } from "@/lib/basic-logger";
import { sleep } from "openai/core";

export class GithubInstallationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubInstallationError";
  }
}

export class GitHubWrapper {
  private git: SimpleGit;
  public githubApp: App;

  constructor(
    private logger: Logger,
    private privateKey: string,
    private appId: string,
    private webhookSecret: string
  ) {
    this.git = simpleGit();

    this.logger.info("Setting up GitHub app");
    this.githubApp = new App({
      appId: this.appId,
      privateKey: this.privateKey,
      webhooks: {
        secret: this.webhookSecret,
      },
      Octokit: Octokit.defaults({}),
    });

    this.test();
  }

  public registerWebhookCallback(
    webhookCallback: HandlerFunction<
      "pull_request_review" | "pull_request.closed" | "issue_comment"
    >
  ) {
    this.logger.info(
      "Registering new webhook callback for pull_request_review"
    );
    this.githubApp.webhooks.on(
      ["pull_request_review", "pull_request.closed", "issue_comment"],
      webhookCallback
    );
  }

  getURL(token: string, repo: string, owner: string) {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  async test() {
    const repo = "test-repo";
    const owner = "inconspicuoususername";
    const client = await this.findRepoClient(owner, repo);
    const pullRequests = await client.pulls.list({
      owner,
      repo,
    });
    console.log(pullRequests);
  }

  private async getInstallationID(owner: string, repo: string) {
    const installation = await this.githubApp.octokit.request(
      "GET /repos/{owner}/{repo}/installation",
      {
        owner,
        repo,
      }
    );
    const id = installation.data.id;

    return id;
  }

  private async getInstallationToken(owner: string, repo: string) {
    const installationID = await this.getInstallationID(owner, repo);
    this.logger.info(
      "Getting installation token for installation ID:",
      installationID
    );
    const client = await this.findRepoClient(owner, repo);
    const token = await client.rest.apps.createInstallationAccessToken({
      installation_id: installationID,
    });
    return token.data.token;
  }

  async cloneRepo(
    repo: string,
    owner: string,
    targetDir: string
  ): Promise<void> {
    this.logger.info("Getting installation token");
    const token = await this.getInstallationToken(owner, repo);
    this.logger.info("Cloning repo:", owner, repo);
    await this.git.clone(this.getURL(token, repo, owner), targetDir);
  }

  async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    this.logger.info("Checking out branch:", branchName, "in repo:", repoPath);
    const repo = simpleGit(repoPath);
    await repo.checkout(branchName);
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    original: {
      owner: string;
      repo: string;
    }
  ): Promise<void> {
    const client = await this.findRepoClient(original.owner, original.repo);
    try {
      const branch = await client.rest.repos.getBranch({
        owner: original.owner,
        repo: original.repo,
        branch: branchName,
      });
      this.logger.info("Branch already exists:", branchName);
      this.logger.info("Deleting branch:", branchName);
      await client.rest.git.deleteRef({
        owner: original.owner,
        repo: original.repo,
        ref: `heads/${branchName}`,
      });
    } catch (e) {
      const err = e as Error;
      if (err.message.includes("Branch not found")) {
        this.logger.info("Branch not found. Creating branch:", branchName);
      } else {
        throw e;
      }
    }

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
    repo.addConfig("user.name", "that-tool-agent");
    repo.addConfig("user.email", "dev@productsyndicate.io");
    await repo.add(".");
    await repo.commit(commitMessage);
    await repo.push("origin", branchName);
  }

  public async findRepoClient(owner: string, repository: string) {
    let client = null;
    for await (const repo of this.githubApp.eachRepository.iterator()) {
      if (
        repo.repository.owner.login === owner &&
        repo.repository.name === repository
      ) {
        client = repo.octokit as Octokit;
        break;
      }
    }

    if (!client) {
      this.logger.error("Client not found for repo:", owner, repository);
      throw new GithubInstallationError(
        "Cannot access repository. Please install the GitHub App in the referenced repository using the following link: \n" +
          // process.env.GITHUB_APP_INSTALL_URL
          (await this.githubApp.getInstallationUrl())
      );
    }
    return client;
  }

  async checkAuth(owner: string, repository: string) {
    await this.findRepoClient(owner, repository);
  }

  async createPullRequest({
    owner,
    repository,
    title,
    head,
    base,
    body,
  }: {
    owner: string;
    repository: string;
    title: string;
    head: string;
    base: string;
    body?: string;
  }) {
    this.logger.info("Creating pull request:", owner, repository, title);

    const client = await this.findRepoClient(owner, repository);
    return await client.pulls.create({
      owner,
      repo: repository,
      title,
      head,
      base: base,
      body,
    });
  }

  async approvePullRequest({
    owner,
    repository,
    pullRequestNumber,
  }: {
    owner: string;
    repository: string;
    pullRequestNumber: number;
  }) {
    const client = await this.findRepoClient(owner, repository);
    const attempt = async () => {
      const pr = await client.pulls.get({
        owner,
        repo: repository,
        pull_number: pullRequestNumber,
      });
      if (pr && pr.data.mergeable) {
        await client.pulls.merge({
          owner,
          repo: repository,
          pull_number: pullRequestNumber,
          merge_method: "squash",
          commit_title: pr.data.title,
          commit_message:
            (pr.data.body ?? "") +
            "\n\nMerged by the GitHub App. Please review the changes and merge manually if necessary.",
        });
      } else {
        this.logger.error(
          "Pull request is not mergeable. Please merge manually."
        );
        this.logger.error("Pull request body:", pr.data);
      }
    };
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
      try {
        await sleep(15000);
        await attempt();
        break;
      } catch (e) {
        this.logger.error("Error approving pull request:", e);
        if (i === attempts - 1) {
          throw e;
        }
      }
    }
  }

  async createComment({
    owner,
    repository,
    issueNumber,
    body,
  }: {
    owner: string;
    repository: string;
    issueNumber: number;
    body: string;
  }) {
    const client = await this.findRepoClient(owner, repository);
    await client.issues.createComment({
      owner,
      repo: repository,
      issue_number: issueNumber,
      body,
    });
  }
}
