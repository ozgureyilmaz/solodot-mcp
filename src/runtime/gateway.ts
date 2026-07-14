import type { JsonSchema } from "../harness/types";
import { callStructuredOpenAI } from "../harness/openai";
import { callCodexStructured } from "./codexResponses";
import { refreshCodexCredentials } from "./codexOAuth";
import { modelAliasForRole, resolveModelAlias, type AgentRole } from "./modelRouting";
import {
  RuntimeRepository,
  type RuntimeConnection,
  type RuntimeJob,
} from "./repository";
import { EncryptedTokenStore, type CodexCredentials } from "./tokenStore";

export class RuntimeOpenAIGateway {
  private apiKey: string | null = null;
  private credentials: CodexCredentials | null = null;

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly tokenStore: EncryptedTokenStore,
    private readonly job: RuntimeJob,
    readonly connection: RuntimeConnection,
    private readonly routingReason: string,
  ) {}

  async call({
    role,
    system,
    user,
    schema,
    outputName,
    outputDescription,
  }: {
    role: AgentRole;
    system: string;
    user: string;
    schema: JsonSchema;
    outputName: string;
    outputDescription: string;
  }) {
    const alias = modelAliasForRole(role);
    const model = resolveModelAlias(alias);
    const stepId = await this.repository.createStep({
      job: this.job,
      role,
      modelAlias: alias,
      resolvedModel: model,
      authMode: this.connection.auth_mode,
      routingReason: this.routingReason,
      input: { outputName, system, user },
    });
    try {
      const output =
        this.connection.auth_mode === "api_key"
          ? await callStructuredOpenAI(
              {
                apiKey: await this.getApiKey(),
                model,
                system,
                user,
                schema,
              },
              outputName,
              outputDescription,
            )
          : await callCodexStructured({
              credentials: await this.getCodexCredentials(),
              model,
              system,
              user,
              schema,
              outputName,
              outputDescription,
            });
      await this.repository.completeStep(stepId, output);
      return output;
    } catch (error) {
      await this.repository.failStep(
        stepId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async getApiKey() {
    this.apiKey ||= await this.repository.readApiKey(this.connection.id);
    return this.apiKey;
  }

  private async getCodexCredentials() {
    this.credentials ||= await this.tokenStore.load(this.connection.id);
    if (!this.credentials) throw new Error("Encrypted Codex credentials are unavailable.");
    if (this.credentials.expires <= Date.now() + 60_000) {
      this.credentials = await refreshCodexCredentials(this.credentials.refresh);
      await this.tokenStore.save(this.connection.id, this.credentials);
      await this.repository.updateConnection(this.connection.id, {
        status: "connected",
        expires_at: new Date(this.credentials.expires).toISOString(),
        last_checked_at: new Date().toISOString(),
      });
    }
    return this.credentials;
  }
}
