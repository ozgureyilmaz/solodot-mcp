#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { DeviceAuthWorker } from "./runtime/authWorker";
import { RuntimeJobProcessor } from "./runtime/processor";
import { createRuntimeRepositoryFromEnv, type RuntimeJob } from "./runtime/repository";
import { EncryptedTokenStore } from "./runtime/tokenStore";

const version = process.env.npm_package_version || "0.1.0";
const runtimeId = process.env.SOLODOT_RUNTIME_ID || `runtime-${randomUUID()}`;
const capacity = boundedInteger(process.env.SOLODOT_RUNTIME_CONCURRENCY, 8, 1, 64);
const maxWorkers = boundedInteger(process.env.SOLODOT_MAX_WORKERS, 8, 1, 64);
const leaseSeconds = boundedInteger(process.env.SOLODOT_JOB_LEASE_SECONDS, 120, 30, 1800);
const pollMilliseconds = boundedInteger(process.env.SOLODOT_JOB_POLL_MS, 2000, 500, 60_000);
const tokenDirectory = process.env.SOLODOT_RUNTIME_TOKEN_DIR || "/var/lib/solodot/tokens";
const encryptionKey = process.env.SOLODOT_RUNTIME_ENCRYPTION_KEY;
if (!encryptionKey) throw new Error("SOLODOT_RUNTIME_ENCRYPTION_KEY is required.");

const repository = createRuntimeRepositoryFromEnv();
const tokenStore = new EncryptedTokenStore({ directory: tokenDirectory, encryptionKey });
const authWorker = new DeviceAuthWorker(repository, tokenStore);
const processor = new RuntimeJobProcessor(repository, tokenStore, maxWorkers);
const active = new Map<string, Promise<unknown>>();
let draining = false;
let lastHeartbeat = 0;

process.once("SIGINT", beginDrain);
process.once("SIGTERM", beginDrain);

await repository.heartbeat({
  runtimeId,
  version,
  status: "starting",
  activeJobCount: 0,
  capacity,
});

process.stderr.write(
  `Solodot Runtime ${runtimeId} started with capacity ${capacity} and max worker wave ${maxWorkers}.\n`,
);

while (!draining) {
  try {
    if (Date.now() - lastHeartbeat >= 15_000) {
      await repository.heartbeat({
        runtimeId,
        version,
        status: "healthy",
        activeJobCount: active.size,
        capacity,
      });
      lastHeartbeat = Date.now();
    }
    await authWorker.tick();
    const available = capacity - active.size;
    if (available > 0) {
      const jobs = await repository.claimJobs(runtimeId, available, leaseSeconds);
      for (const job of jobs) startJob(job);
    }
  } catch (error) {
    process.stderr.write(
      `Runtime poll failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  await delay(pollMilliseconds);
}

await repository.heartbeat({
  runtimeId,
  version,
  status: "draining",
  activeJobCount: active.size,
  capacity,
});
await Promise.allSettled(active.values());
await repository.heartbeat({
  runtimeId,
  version,
  status: "stopped",
  activeJobCount: 0,
  capacity,
});

function startJob(job: RuntimeJob) {
  const renewal = setInterval(() => {
    void repository
      .renewLease(job.id, runtimeId, leaseSeconds)
      .then((renewed) => {
        if (!renewed) {
          process.stderr.write(`Lease renewal was rejected for job ${job.id}.\n`);
        }
      })
      .catch((error) => {
        process.stderr.write(
          `Lease renewal failed for job ${job.id}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      });
  }, Math.max(10_000, Math.floor((leaseSeconds * 1000) / 3)));
  renewal.unref();
  const work = processor
    .process(job)
    .catch((error) => {
      process.stderr.write(
        `Runtime job ${job.id} escaped its processor: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    })
    .finally(() => {
      clearInterval(renewal);
      active.delete(job.id);
    });
  active.set(job.id, work);
}

function beginDrain() {
  draining = true;
}
function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}
