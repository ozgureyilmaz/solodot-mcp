# solodot-mcp

connect the dots that scale your solo business.

mcp server for solodot. route the active founder painpoint, generate one execution asset, and keep the founder in control through approve, revise, or reject.

## features

- six execution packs: bottleneck, customers, founder functions, learning, trust, and agent workflows.
- five tools: route, generate, review, inspect, and export.
- local stdio for codex and claude desktop.
- authenticated streamable http for remote agents.
- anthropic and vertex model providers.
- in-memory local runs or durable supabase runs.
- docker and apple container support.
- no silent email, slack, crm, publishing, invoice, or external actions.

## requirements

- node.js 20+
- an anthropic or vertex api key
- supabase for remote http mode
- codex, claude, or another mcp client

apple container requires apple silicon and macos 26. install it from the [official releases](https://github.com/apple/container/releases), then start the service with `container system start`.

## install

```bash
cd /Users/0x79de/dev/solodot-mcp
npm install
cp .env.example .env
npm run build
```

set at least one provider in `.env`:

```text
SOLODOT_DEFAULT_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

use `SOLODOT_DEFAULT_PROVIDER=vertex` with `VERTEX_API_KEY` for vertex.

## setup

### codex

add a local stdio server to `~/.codex/config.toml`:

```toml
[mcp_servers.solodot]
command = "node"
args = ["/Users/0x79de/dev/solodot-mcp/dist/stdio.js"]
env = { SOLODOT_DEFAULT_PROVIDER = "anthropic", ANTHROPIC_API_KEY = "your-key" }
```

### claude desktop

add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "solodot": {
      "command": "node",
      "args": ["/Users/0x79de/dev/solodot-mcp/dist/stdio.js"],
      "env": {
        "SOLODOT_DEFAULT_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "your-key"
      }
    }
  }
}
```

restart the client after changing its config. ready-to-copy examples live in [`examples/`](examples/).

## usage

after setup, ask your agent:

- "route the biggest painpoint in my solo business."
- "turn this route into the execution asset i should use this week."
- "revise the asset for a narrower b2b saas buyer."
- "approve it and export the run as markdown."

the normal flow is:

```text
route_painpoint
  -> generate_execution_asset
  -> review_execution_asset
  -> export_solodot_run
```

approval records founder intent. it never executes the asset outside solodot.

## remote http

remote mode serves `POST /mcp` and `GET /health` on port `8787`.

configure:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=...
SOLODOT_MCP_API_KEYS=long-random-founder-token
ANTHROPIC_API_KEY=...
```

run:

```bash
npm run build
npm run start:http
```

remote codex config:

```toml
[mcp_servers.solodot]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "SOLODOT_MCP_TOKEN"
```

use the same public https endpoint and bearer token for a claude custom connector or another remote mcp host.

## apple container

solodot uses the same oci image for apple container and docker.

```bash
container system start
npm run container:build
npm run container:run
```

`container:run` reads `.env`, starts `solodot-mcp` with an init process, and publishes only `127.0.0.1:8787`.

```bash
npm run container:health
npm run container:logs
npm run container:stop
```

override defaults when needed:

```bash
SOLODOT_MCP_ENV_FILE=/absolute/path/to/solodot.env \
SOLODOT_MCP_PORT=9000 \
npm run container:run
```

apple container runs linux containers as lightweight virtual machines on apple silicon. the image remains portable to any oci-compatible runtime.

## docker

build from the standalone mcp repository:

```bash
cd /Users/0x79de/dev/solodot-mcp
docker build -t solodot-mcp:local .
docker run --init --rm --env-file .env -p 127.0.0.1:8787:8787 solodot-mcp:local
```

## tools

- `route_painpoint`: choose exactly one execution pack.
- `generate_execution_asset`: create the full asset for that fixed route.
- `review_execution_asset`: approve, revise, or reject.
- `get_solodot_run`: inspect diagnosis, assets, and approvals.
- `export_solodot_run`: return an approved asset as markdown or json.

resources are available at `solodot://execution-packs`, `solodot://approval-boundaries`, and `solodot://product-context`.

## slack

an mcp-capable agent can call solodot while its conversation lives in slack.

this is not a native slack bot. it does not read channels, receive slash commands, or post messages.

## development

```bash
npm run typecheck
npm test
npm run build
```

inspect the local server:

```bash
npx @modelcontextprotocol/inspector node dist/stdio.js
```

## links

- [model context protocol](https://modelcontextprotocol.io/)
- [apple container](https://github.com/apple/container)
- [codex mcp docs](https://developers.openai.com/codex/mcp)
- [claude remote mcp docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
