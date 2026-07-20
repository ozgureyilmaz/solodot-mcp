# solodot-mcp

OpenAI-only MCP tools and the persistent Solodot Runtime.

Solodot routes an active founder painpoint to one of six execution packs, produces one founder-reviewable asset, and keeps consequential action behind explicit approval.

## Surfaces

- Local MCP over stdio: route, generate, review, inspect, and export.
- Optional authenticated Streamable HTTP MCP endpoint.
- Outbound-only persistent runtime: leases Supabase jobs, runs the adaptive harness, records model decisions, and resumes retryable work after restart.

The default container command starts the runtime and opens no inbound application port.

## OpenAI connections

- API-key mode uses the official OpenAI Responses API.
- Codex subscription mode uses OpenAI's official `codex app-server` managed `chatgptDeviceCode` login and structured turn protocol.
- Both may coexist per workspace.
- Subscription exhaustion pauses the job. API-key continuation requires a separate founder approval and is never silent.

The app-server owns token refresh. Solodot materializes its credential cache only in a private temporary `CODEX_HOME`, encrypts that cache with AES-256-GCM before persistence, and disables shell, exec, browser, app, plugin, MCP-install, multi-agent, history, and web-search capabilities for product turns.

## Adaptive harness

Advisor mode is the efficiency-first default: one balanced executor and focused read-only review gates only when the risk justifies them.

Orchestrator mode is chosen when at least two workstreams can produce useful output independently. It uses one planner, isolated in-memory worker inputs, bounded concurrent waves, and one synthesizer. Worker capacity is configuration-driven and has no hard-coded two-worker ceiling.

The architecture adapts:

- `pi-orchestrator` at `a123a4ad925e2d49d4ac33c9e70a10fefa339d54`
- `pi-advisor` at `33a3e204882e8b8587b26bfbc31df092d8b2bc16`

## Install

```bash
npm install
cp .env.example .env
npm run build
```

For local API-key MCP:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
```

Codex configuration:

```toml
[mcp_servers.solodot]
command = "node"
args = ["/Users/0x79de/dev/solodot-mcp/dist/stdio.js"]
env = { OPENAI_API_KEY = "your-key", OPENAI_MODEL = "gpt-5-mini" }
```

## Persistent runtime

Apply the Supabase migration from `solodot-mvp`, then configure:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SOLODOT_RUNTIME_ENCRYPTION_KEY=... # 32 bytes, base64 or hex
SOLODOT_RUNTIME_TOKEN_DIR=/var/lib/solodot/tokens
SOLODOT_RUNTIME_CONCURRENCY=8
SOLODOT_MAX_WORKERS=8
CODEX_BINARY=/app/node_modules/.bin/codex
# Optional. Empty uses the subscription account's default Codex model.
CODEX_SUBSCRIPTION_MODEL=
```

Run directly:

```bash
npm run build
npm run start:runtime
```

Or as an outbound-only container:

```bash
docker build -t solodot-runtime:local .
docker run --init --rm --env-file .env -v solodot-runtime:/var/lib/solodot solodot-runtime:local
```

The runtime uses atomic job claims, renewable leases, three-attempt defaults, stale-lease recovery, heartbeats, encrypted subscription tokens, and graceful draining.

## MCP workflow

```text
route_painpoint
  -> generate_execution_asset
  -> review_execution_asset
  -> export_solodot_run
```

Approval records founder intent. Solodot does not send email, post messages, update a CRM, publish, invoice, make compliance claims, or perform another external action silently.

## Optional HTTP MCP

The HTTP entry is not used by the persistent runtime. If explicitly started, it serves `POST /mcp` and `GET /health`:

```text
SOLODOT_MCP_API_KEYS=long-random-token
SOLODOT_MCP_WORKSPACE_ID=...
SOLODOT_MCP_USER_ID=...
```

```bash
npm run start:http
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```
