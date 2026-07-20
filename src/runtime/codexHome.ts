import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EncryptedTokenStore } from "./tokenStore";

const CODEX_CONFIG = [
  'cli_auth_credentials_store = "file"',
  'forced_login_method = "chatgpt"',
  'approval_policy = "never"',
  'sandbox_mode = "read-only"',
  'web_search = "disabled"',
  "",
  "[history]",
  'persistence = "none"',
  "",
  "[feedback]",
  "enabled = false",
  "",
  "[features]",
  "apps = false",
  "browser_use = false",
  "browser_use_external = false",
  "browser_use_full_cdp_access = false",
  "computer_use = false",
  "hooks = false",
  "image_generation = false",
  "in_app_browser = false",
  "multi_agent = false",
  "plugins = false",
  "remote_plugin = false",
  "shell_snapshot = false",
  "shell_tool = false",
  "skill_mcp_dependency_install = false",
  "tool_call_mcp_elicitation = false",
  "tool_suggest = false",
  "unified_exec = false",
  "workspace_dependencies = false",
  "",
].join("\n");

export class CodexHomeManager {
  constructor(
    private readonly tokenStore: EncryptedTokenStore,
    private readonly temporaryRoot = "/tmp/solodot-codex",
  ) {}

  async open(connectionId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(connectionId)) {
      throw new Error("Invalid connection id.");
    }
    await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 });
    const sessionPath = await mkdtemp(join(this.temporaryRoot, `${connectionId}-`));
    const path = join(sessionPath, "home");
    const workspacePath = join(sessionPath, "workspace");
    await mkdir(path, { mode: 0o700 });
    await mkdir(workspacePath, { mode: 0o700 });
    await chmod(path, 0o700);
    await writeFile(join(path, "config.toml"), CODEX_CONFIG, { mode: 0o600 });
    const cached = await this.tokenStore.load(connectionId);
    if (cached) {
      await writeFile(join(path, "auth.json"), cached.authJson, { mode: 0o600 });
    }

    let discarded = false;
    const discard = async () => {
      if (discarded) return;
      discarded = true;
      await rm(sessionPath, { recursive: true, force: true });
    };
    return {
      path,
      workspacePath,
      discard,
      persistAndDiscard: async () => {
        try {
          const authJson = await readFile(join(path, "auth.json"), "utf8");
          JSON.parse(authJson);
          await this.tokenStore.save(connectionId, { authJson });
        } finally {
          await discard();
        }
      },
    };
  }
}
