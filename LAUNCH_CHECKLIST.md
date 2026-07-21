# Solodot Runtime Launch Checklist

This checklist complements the web/auth checklist in the Solodot repository. Keep this pull request in draft until the runtime staging gates are complete. Never commit Supabase service-role credentials, OpenAI secrets, OAuth tokens, or the runtime encryption key.

## Engineering / Codex verification

### Completed locally

- [x] OpenAI-only MCP and runtime contracts.
- [x] Advisor/Orchestrator routing and configurable worker bounds.
- [x] Official Codex app-server device authorization and structured-turn parsing.
- [x] Official local browser authorization with an isolated child environment and `solodot` originator.
- [x] Customer companion uses a hash-only short-lived pairing token and receives no Supabase key.
- [x] X25519/HKDF/AES-GCM transfer encryption, attempt binding, tamper rejection, and ciphertext cleanup.
- [x] Usage-limit and rejected-credential classification.
- [x] Explicit founder approval before API-key fallback.
- [x] Encrypted token round-trip, redaction, deletion, and deletion-tombstone behavior.
- [x] Job claim and lease-renewal repository contracts.
- [x] TypeScript check, 62 runtime/MCP tests, production bundle, companion CLI, and Compose config.
- [x] Real app-server protocol handshake and strict security-config validation.
- [x] Outbound-only Compose service with no published application port.

### Required staging tests

- [ ] Start the container with production-like secrets and confirm a healthy Supabase heartbeat.
- [ ] Queue and complete one API-key execution job end to end.
- [ ] Claim jobs concurrently and prove no duplicate execution.
- [ ] Restart during active work and prove stale-lease recovery plus idempotent output.
- [ ] Verify retry exhaustion and terminal failure state.
- [ ] Verify persistent encrypted token recovery after container restart.
- [ ] Verify disconnect/account deletion removes the encrypted token file.
- [ ] Run IPv6 OpenAI and Supabase egress smoke tests on the selected host.
- [ ] Run a 24-hour stability test and record CPU, memory, egress, retries, and heartbeat gaps.
- [ ] Test subscription start/poll/refresh/revocation/limit behavior in preview.
- [ ] Import a companion credential through hosted Supabase and prove only the runtime can decrypt it.
- [ ] Keep an existing Codex Desktop task active during Solodot browser login and prove neither session is displaced.

## Project owner responsibilities

- [ ] Provide the hosted Supabase URL and service-role key through the runtime secret manager.
- [ ] Generate and securely back up `SOLODOT_RUNTIME_ENCRYPTION_KEY`.
- [ ] Generate and securely store `SOLODOT_RUNTIME_TRANSFER_PRIVATE_KEY`; publish only its matching public key to the web deployment.
- [ ] Choose and provision the runtime host without exposing an application port.
- [ ] Configure billing alerts and explicitly approve any paid resource.
- [ ] Keep production subscription mode disabled until preview evidence is complete.
- [ ] Approve production promotion after the staging evidence is attached to the PR.
