import type { JsonSchema } from "../harness/types";
import { callStructuredOpenAI } from "../harness/openai";
import {
  CodexAppServerClient,
  CodexAuthenticationError,
  createStdioCodexTransport,
} from "./codexAppServer";
import { CodexHomeManager } from "./codexHome";
import { modelAliasForRole, resolveModelAlias, type AgentRole } from "./modelRouting";
import {
  RuntimeRepository,
  type RuntimeConnection,
  type RuntimeJob,
} from "./repository";

const managedCodexQueues = new Map<string, Promise<void>>();

type StructuredCodexClient = Pick<
  CodexAppServerClient,
  "initialize" | "readAccount" | "runStructured" | "close"
>;

export class RuntimeOpenAIGateway {
  private apiKey: string | null = null;

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly homeManager: CodexHomeManager,
    private readonly job: RuntimeJob,
    readonly connection: RuntimeConnection,
    private readonly routingReason: string,
    private readonly createCodexClient: (codexHome: string) => StructuredCodexClient =
      (codexHome) =>
        new CodexAppServerClient(createStdioCodexTransport({ codexHome })),
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
    const apiModel = resolveModelAlias(alias);
    const subscriptionModel = process.env.CODEX_SUBSCRIPTION_MODEL || undefined;
    const resolvedModel =
      this.connection.auth_mode === "codex_subscription"
        ? subscriptionModel || "codex-default"
        : apiModel;
    const stepId = await this.repository.createStep({
      job: this.job,
      role,
      modelAlias: alias,
      resolvedModel,
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
                model: apiModel,
                system,
                user,
                schema,
              },
              outputName,
              outputDescription,
            )
          : await serializeManagedCodex(this.connection.id, () =>
              this.callManagedCodex({
                model: subscriptionModel,
                system,
                user,
                schema,
              }),
            );
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

  private async callManagedCodex({
    model,
    system,
    user,
    schema,
  }: {
    model?: string;
    system: string;
    user: string;
    schema: JsonSchema;
  }) {
    const home = await this.homeManager.open(this.connection.id);
    const client = this.createCodexClient(home.path);
    let closed = false;
    let discarded = false;
    try {
      await client.initialize();
      const accountResult = await client.readAccount(true);
      const account = accountResult.account as Record<string, unknown> | undefined;
      if (!account || account.type !== "chatgpt") {
        throw new CodexAuthenticationError(
          "The encrypted Codex cache no longer contains a managed ChatGPT login.",
        );
      }
      const output = await client.runStructured({
        model,
        system,
        user,
        schema,
        cwd: home.workspacePath,
      });
      await client.close();
      closed = true;
      await home.persistAndDiscard();
      discarded = true;
      await this.repository.updateConnection(this.connection.id, {
        status: "connected",
        last_checked_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      });
      return output;
    } finally {
      if (!closed) await client.close().catch(() => undefined);
      if (!discarded) {
        await home.persistAndDiscard().catch(() => home.discard());
      }
    }
  }
}

async function serializeManagedCodex<T>(
  connectionId: string,
  operation: () => Promise<T>,
) {
  const previous = managedCodexQueues.get(connectionId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  managedCodexQueues.set(connectionId, settled);
  try {
    return await current;
  } finally {
    if (managedCodexQueues.get(connectionId) === settled) {
      managedCodexQueues.delete(connectionId);
    }
  }
}
