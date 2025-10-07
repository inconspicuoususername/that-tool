<div align="center">

# ThatTool LLM – Autonomous GitHub Agent

_A headless AI software engineer: watches issues, writes code, opens PRs, adapts to review feedback, and chains multi-issue epics._

</div>

## Table of Contents
- Overview  
- Core Features  
- Architecture  
- Agent Execution Loop  
- GitHub App Integration  
- Project & Task Lifecycle  
- Epics (Chained Issue Execution)  
- API Reference  
- Data Model (Conceptual)  
- Configuration (Environment Variables)  
- Running Locally  
- Running with Docker  
- Database Migrations  
- Safety & Operational Notes  
- Ideas

---

## Overview

ThatTool LLM is a backend service that autonomously converts GitHub issues into pull requests.

It:
- Monitors repositories (via GitHub App + webhooks) for labeled issues
- Spins up a task workspace (clones repo & checks branches)
- Iteratively reasons using the OpenAI Responses API & function tools
- Edits code, runs terminal commands, and commits to a feature branch
- Opens a PR and reacts to reviewer feedback (continuation subtasks)
- Asks clarifying questions (issue comments) when blocked
- Chains multi-issue “epics” so each sub-issue builds on the last branch
- Supports a local (non-GitHub) task mode for experimentation

---

## Core Features
- Autonomous Issue → Branch → Commit → PR pipeline
- Dependency‑aware scheduler (prevents running multiple tasks for same project concurrently when unsafe)
- Review feedback integration (adds continuation subtasks)
- Help loop: model can pause and request info; resumes when answered
- Epic chaining: sequential branch stacking across related issues
- OpenAI Responses API + function tool orchestration
- Structured logging per service (Winston)
- Drizzle ORM + Postgres persistence
- Optional vector/memory integration (file_search tool if enabled)
- Simple bearer auth for internal task API

---

## Architecture

| Component | Responsibility |
|-----------|----------------|
| `Express` (`src/lib/express.ts`) | REST API + webhook mounting |
| `GitHubWrapper` | Cloning, auth, branches, commits, PRs, comments |
| `IssueService` | Crawls issues + reacts to issue / comment events |
| `TaskService` | Task lifecycle, dependency graph, PR state transitions |
| `LLMScheduler` | Executes subtasks (looping LLM tool calls) |
| `PullRequestService` | Processes PR review updates & merges |
| `ShellService` | Controlled shell command execution |
| `Memory` (`llm/memory.ts`) | (Optional) store context for retrieval |

Flow (GitHub task): Issue → Task + Subtask → LLM tool loop → Commit → PR → Review cycle → Approval → Complete.

---

## Agent Execution Loop
Defined in `src/llm/prompt.ts` (`executeTask`). Each iteration:
1. Builds a system prompt (OS info, directory tree, prior context)
2. Loads prior subtask response (commit vs help continuation)
3. Executes pending tool function calls (terminal, file ops, commit, ask_for_help, etc.)
4. Records tool outputs as function_call_output messages
5. Requests next OpenAI response with updated conversation + tools definition
6. Terminates when `commit` or `ask_for_help` tool call appears.

Resilience: On restart, `TaskService._initAndRescheduleIncompleteTasks()` attempts to re-hydrate in‑flight tasks.

---

## GitHub App Integration
You must register a GitHub App and install it on target repositories.

Required permissions (minimum practical set):
- Issues: Read & write
- Pull requests: Read & write
- Contents: Read & write
- Metadata: Read

Webhook URL: `https://<host>/github/webhook`

Events used:
- `issues`
- `issue_comment`
- `pull_request_review`
- `pull_request` (close/merge handling)

The app’s private key path is supplied via `GITHUB_APP_PK_FILE`.

---

## Project & Task Lifecycle
1. Project auto-created when first issue encountered (slug: `owner/repo`).
2. Task created with initial subtask (prompt includes issue body or user-provided prompt).
3. Subtask executes until commit or help request.
4. On commit: branch ensured, changes committed & pushed, PR created (if none).
5. On review:
	 - Approved → task status `complete`.
	 - Changes requested → continuation subtask seeded with review body.
	 - Help answered (issue comment) → IssueService resumes with new subtask.
6. Finalization triggers optional webhook callback (if `notifyURL` was supplied at task start).

Statuses (selected): `pending`, `running`, `awaiting_help`, `awaiting_approval`, `complete`, `error`, `killed`, `closed`.

---

## Epics (Chained Issue Execution)
`POST /task/begin-epic` processes an epic issue and its sub-issues sequentially. Each sub-issue’s branch derives from the previous successful branch, forming a linear chain of dependent work.

---

## API Reference
All endpoints are prefixed with `/task` and require:
```
Authorization: Bearer <SIMPLE_AUTH_TOKEN>
Content-Type: application/json
```

| Method & Path | Description |
|---------------|-------------|
| `POST /task/start` | Start a task (GitHub or local) |
| `GET /task/:id/status` | Current subtask status |
| `GET /task/:id/logs` | Live subtask log output |
| `GET /task/:id/files` | ZIP of working directory |
| `GET /task/:id` | Raw task record |
| `POST /task/begin-epic` | Start epic (issue chaining) |
| `POST /task/update-project` | Update project metadata |

### Start Task (GitHub example)
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

### Start Task (Local example)
```json
{
	"type": "local",
	"projectName": "sandbox-project",
	"prompt": "Refactor the utils module for clarity"
}
```

---

## Data Model (Conceptual)
- `projects` – per-repo or local workspace configuration
- `tasks` – top-level unit (links to project, current subtask)
- `sub_tasks` – incremental execution steps; each produces output or help request
- `task_github_info` – branch, PR, linked issue number
- `task_dependencies` – adjacency list for dependency graph execution ordering
- `oai_responses` – raw OpenAI function-call outputs for auditability

Dependency execution rules ensure prerequisites are `complete` or in limited `awaiting_approval` queue respecting `maxChainedPRs`.

---

## Configuration (Environment Variables)
Required:
- `OPENAI_API_KEY`
- `SIMPLE_AUTH_TOKEN`
- `DATABASE_URL` (Postgres connection string)
- `GITHUB_APP_ID`
- `GITHUB_APP_PK_FILE` (path to PEM)
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_ISSUES_ACCEPT_LABELS` **or** `GITHUB_ISSUES_IGNORE_LABELS` (comma-separated; exactly one strategy)

Optional / Defaults (see `src/lib/env.ts`):
- `GITHUB_DEFAULT_OPENAI_MODEL` (default: `o4-mini`)
- `PROJECTS_ROOT_DIR` (default: `./projects`)
- `LOG_DIR` (default: `./.logs`)
- `MEMORY_DIR` (default: `./.memory`)
- `SHOULD_ASK_FOR_TOOL` (`false`) – interactive approval for tool execution
- `GITHUB_TRUST_ME_BRO` (`false`) – auto-approves PRs programmatically
- `GITHUB_DELETE_BRANCH_IF_OVERLAPPING` (`false`)

---

## Running Locally
Prerequisites:
- Node 22+ (Dockerfile uses Node 23)
- pnpm (Corepack enabled)
- Postgres instance
- GitHub App installed on test repo(s)

Install deps:
```bash
pnpm install
```

Run migrations:
```bash
pnpm dlx drizzle-kit push
```

Start dev:
```bash
pnpm run dev
```
Server listens on `:5001`.

Expose webhook during development (example):
```bash
ngrok http 5001
```
Set the GitHub App webhook URL to the forwarded domain + `/github/webhook`.

---

## Running with Docker
Build image:
```bash
docker build -t thattool-llm .
```

Run container (example):
```bash
docker run --rm \
	-p 5001:5001 \
	-e OPENAI_API_KEY=sk-... \
	-e SIMPLE_AUTH_TOKEN=devtoken123 \
	-e DATABASE_URL=postgres://user:pass@host:5432/db \
	-e GITHUB_APP_ID=123456 \
	-e GITHUB_APP_PK_FILE=/app/crypt/app-pk.pem \
	-e GITHUB_WEBHOOK_SECRET=shhh \
	-e GITHUB_ISSUES_ACCEPT_LABELS=ready \
	-v $(pwd)/crypt/app-pk.pem:/app/crypt/app-pk.pem:ro \
	thattool-llm
```

Mount volumes for `projects` and `.logs` if you want persistence across restarts.

---

## Example Workflow (Issue → PR)
1. Maintainer labels issue with an accepted label (e.g. `ready`).
2. Webhook fires → `IssueService` filters → schedules task.
3. `TaskService` initializes workspace, creates subtask.
4. `LLMScheduler` runs tool loop (edits files, runs commands, commits).
5. Branch pushed; PR opened.
6. Reviewer requests changes → continuation subtask with critique context.
7. Reviewer approves → task finalized (`complete`).
8. Help path: model asked question → waits for maintainer reply comment → resumed.

---

## Safety & Operational Notes
- Shell commands are scoped to cloned repo directory—still audit untrusted code paths.
- Set `SHOULD_ASK_FOR_TOOL=true` to manually gate tool execution while debugging.
- Avoid placing secrets in repository files accessible to the agent.
- Use a dedicated GitHub bot installation account for isolation.
- Logs stored under `.logs` (consider rotating in production).

---

## Ideas
This project is essentially on pause, since this was a product I was going to sell but there wasn't enough traction compared to agents such as Claude Code, Codex, etc.
If you want to, feel free to fork and implement some of the other ideas here.
- Enhanced memory embedding & retrieval RAG integration
- Test discovery & gating (run test suite tool)
- CI integration & status checks
- Rebase / conflict auto-resolution strategies
- Multi-model fallback / cost optimization
- Web dashboard (real-time logs, task graph visualization)
- Sandbox isolation (container per subtask)
- Secrets & policy manager for tool access

---