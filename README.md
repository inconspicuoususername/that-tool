# thattool-llm

Autonomous backend service that turns GitHub issues into pull requests.

At a high level, it:
- Listens to GitHub webhooks (via a GitHub App)
- Creates a workspace (clone repo + branch)
- Runs an LLM tool loop (edit files, run commands)
- Commits + pushes a branch and opens/updates a PR
- Responds to review feedback by continuing the task

## Quickstart (local)

Prereqs:
- Node.js 22+
- pnpm (Corepack)
- Postgres
- A GitHub App installed on the repos you want to automate

```bash
pnpm install
pnpm dlx drizzle-kit push
pnpm run dev
```

Server listens on `http://localhost:5001`.

To receive GitHub webhooks locally, expose the port (e.g. `ngrok http 5001`) and set your GitHub App webhook URL to:

`https://<public-host>/github/webhook`

## Configuration

The service is configured via environment variables.

Required:
- `OPENAI_API_KEY`
- `SIMPLE_AUTH_TOKEN` (Bearer token for `/task/*` endpoints)
- `DATABASE_URL` (Postgres connection string)
- `GITHUB_APP_ID`
- `GITHUB_APP_PK_FILE` (path to GitHub App PEM private key)
- `GITHUB_WEBHOOK_SECRET`
- Exactly one of:
  - `GITHUB_ISSUES_ACCEPT_LABELS` (comma-separated)
  - `GITHUB_ISSUES_IGNORE_LABELS` (comma-separated)

Common optional settings (see `src/lib/env.ts`):
- `GITHUB_DEFAULT_OPENAI_MODEL` (default: `o4-mini`)
- `PROJECTS_ROOT_DIR` (default: `./projects`)
- `LOG_DIR` (default: `./.logs`)
- `MEMORY_DIR` (default: `./.memory`)
- `SHOULD_ASK_FOR_TOOL` (default: `false`) to gate tool execution

## How it works

- Issues are selected by label via `GITHUB_ISSUES_ACCEPT_LABELS` / `GITHUB_ISSUES_IGNORE_LABELS`.
- A task consists of one or more "subtasks". Each subtask runs until it either:
  - commits code (PR work), or
  - asks for help (posts a question and waits).
- PR review events can create continuation subtasks ("changes requested" → keep working).

## API (most-used endpoints)

All endpoints require:

```
Authorization: Bearer <SIMPLE_AUTH_TOKEN>
Content-Type: application/json
```

- `POST /task/start` start a GitHub or local task
- `GET /task/:id/status` view task status
- `GET /task/:id/logs` stream task logs
- `GET /task/:id/files` download workspace as a zip
- `POST /task/begin-epic` run a chain of issues sequentially

Example: start a GitHub task

```json
{
  "type": "github",
  "owner": "acme",
  "repo": "frontend",
  "startBranch": "main",
  "targetBranch": "feat/issue-123",
  "linkedIssueNumber": 123,
  "prompt": "Implement the feature described in issue #123"
}
```

## GitHub App permissions/events

Typical minimal permissions:
- Issues: Read & write
- Pull requests: Read & write
- Contents: Read & write
- Metadata: Read

Events used:
- `issues`
- `issue_comment`
- `pull_request_review`
- `pull_request`

## Docker

```bash
docker build -t thattool-llm .
```

See `compose.yaml` for an example runtime configuration.

## Notes

- This project executes shell commands against cloned repos; run it with appropriate isolation.
- Logs default to `./.logs`; workspaces default to `./projects`.
