# thattool-llm

Autonomous coding agent, deployed as a Docker container, that turns GitHub issues into pull requests.

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

Required (see `src/lib/env.ts`):
- `SERVER_URL` (e.g. `http://localhost:5001`)
- `OPENAI_API_KEY`
- `DATABASE_URL` (Postgres connection string)
- Auth/session:
  - `JWT_SECRET`
  - `ALLOWED_EMAIL` (GitHub account email allowed to log in)
  - `SESSION_SECRET`
- GitHub App:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PK_FILE` (path to GitHub App PEM private key)
  - `GITHUB_WEBHOOK_SECRET`
  - `GITHUB_APP_CLIENT_ID`
  - `GITHUB_APP_CLIENT_SECRET`
- Issue label filter:
  - `GITHUB_ISSUES_ACCEPT_LABELS` (comma-separated; default: empty)
  - `GITHUB_ISSUES_IGNORE_LABELS` (comma-separated; default: empty)

Common optional settings:
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

All endpoints under `/task` and `/manual` require a valid JWT (see `src/routes/middleware.ts` + `/auth/*`).

- `GET /task/:id/status` view current subtask status
- `GET /task/:id/logs/stream` stream logs (SSE)
- `GET /task/:id/files` download workspace as a zip
- `POST /task/begin-epic` run a chain of issues sequentially
- `POST /task/stop` stop a running task
- `POST /task/restart` restart a task
- `POST /task/delete` delete a task record
- `POST /task/update-project` update project metadata
- `GET /task/projects` list projects
- `GET /task/projects/:projectId/tasks` list tasks in a project
- `GET /task/projects/:projectId/subtasks` list subtasks in a project
- `GET /task/events/stream?projectId=...` stream task/subtask events (SSE)
- `POST /manual/subtask` create a manual subtask

Example: create an auth token (for API calls)

1) Navigate to `http://localhost:5001/login` and complete GitHub OAuth.
2) You’ll be redirected with `?token=...`; use that value as `Authorization: Bearer ...`.

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
