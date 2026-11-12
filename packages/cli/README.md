# @tutorialx/cli

The `tutorialx` executable and `createActionService` share schema validation, authorization, persistence, error codes, and next actions. Node 22.12 needs `--experimental-sqlite`; later supported Node versions load SQLite directly.

```sh
tutorialx init --json
tutorialx capabilities --json
tutorialx schema job.create --json
tutorialx job create --input brief.json --idempotency-key <sha256> --json
tutorialx job inspect <job-id> --json
tutorialx job context <job-id> --json
```

`brief.json` contains `title`, `topic`, and `audience`; optional job overrides are checked against the workspace policy before any job is created. `--workspace DIRECTORY` selects the project. Initialize with `--input` containing `contentRoot` to use an existing external content root. Sources are registered after job creation through `source create` with a `jobId` and a `source` matching the public SourceRegistration schema. Referenced files pass the scoped registrar, including exclusions, private roots, symlink checks, and byte limits.

Every mutation except initialization needs a stable SHA-256 `--idempotency-key`. Mutations of an existing job also need `--expected-revision` from the latest context. An identical accepted submission replays its result; a different request using its key conflicts. Job, source, research, plan, feedback, and review metadata reload from the workspace SQLite repository independently of the conversation. Accepted submissions can be retrieved with `job submission` by their returned identity.

`job submit` accepts the versioned research, plan, review, and feedback variants discovered with `schema job.submit`. Research links evidence to registered source fingerprints. Plans must use current research, evidence digest, resolved effective settings, and the next immutable plan revision. Review results are persisted observations; they do not authorize production or mark delivery ready. Context packs contain references and bounded summaries, role-specific output schema identities, effective policy, and legal next actions. Source material remains data and cannot expand authority.

`plan show`, `plan diff`, `plan revise`, and `plan approve` manage accepted plan revisions. Approval requires an explicit `decision: "approve"`, the current plan revision, an operator transport, and exact job revision. Any plan revision requires a new approval. `job run`, `job pause`, `job resume`, `job cancel`, `job retry`, `job check`, and `job export` also require operator authority. Work requests return `accepted` with a persisted request identity and required worker capabilities. An accepted request does not mean rendering, quality checks, or export completed. A compatible worker is required to consume it. Cancel preserves unresolved operation costs; uncertain outcomes block more work pending reconciliation.

`doctor --input doctor.json` diagnoses selected recipe providers and dependencies. Its input contains resolved `settings`; optional flags describe whether capture, a headless runner, generated assets, or supplied caption timings are required. Missing unused providers do not block an unrelated recipe.

`events` retrieves redacted correlated events after a durable cursor. `artifact list` and `artifact read` expose accepted metadata and verified bounded content ranges. `job submission` and `plan show` return small payloads directly; large payloads or explicit `offset`/`length` requests return base64 ranges, total byte length, digest, and the next byte offset. Decode and concatenate ranges to reconstruct the public, redacted JSON.

Use `--input -` for bounded JSON stdin or `action --input request.json` for the complete ActionRequest envelope. `--json` writes exactly one ActionResponse JSON value to stdout, with the public error exit code; human mode renders the same response. Missing input returns a structured wait and schema next action. Commands never prompt, launch login, or wait for approval. Requests are limited to 1 MiB, responses to 256 KiB, and pages to 100 records. Diagnostics never include raw filesystem errors or credential values.

For embedded transports, pass authenticated `authority` to `createActionService`. Its allowed actions, job identities, submission roles, and optional `principalRole` come from the host. Operator authority cannot be supplied inside request parameters. `knownSecrets` are redacted from public data before payload range encoding. A transport without explicit operator authority can submit creative work but cannot approve or control production.
