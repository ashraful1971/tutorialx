# Generated action reference

Generated from version 1 action schemas and public descriptors. Run `node scripts/skill-reference.mjs --write` after building to refresh. Retrieve complete schemas from the running engine; this table is a compact routing index.

| Action | Required params | Expected revision | Idempotency key | Capability |
| --- | --- | --- | --- | --- |
| `artifact.list` | `jobId` | No | No | Transport scope |
| `artifact.read` | `jobId`, `artifactId` | No | No | Transport scope |
| `capabilities` | None | No | No | Transport scope |
| `doctor` | `settings` | No | No | Transport scope |
| `events` | `jobId` | No | No | Transport scope |
| `job.cancel` | `jobId` | Yes | Yes | operator |
| `job.check` | `jobId` | Yes | Yes | operator |
| `job.context` | `jobId` | No | No | Transport scope |
| `job.create` | `title`, `topic`, `audience` | No | Yes | Transport scope |
| `job.export` | `jobId` | Yes | Yes | operator |
| `job.inspect` | `jobId` | No | No | Transport scope |
| `job.list` | None | No | No | Transport scope |
| `job.pause` | `jobId` | Yes | Yes | operator |
| `job.resume` | `jobId` | Yes | Yes | operator |
| `job.retry` | `jobId` | Yes | Yes | operator |
| `job.run` | `jobId` | Yes | Yes | operator |
| `job.submission` | `jobId`, `submissionId` | No | No | Transport scope |
| `job.submit` | Variant 1: `jobId`, `kind`, `report`, `evidence`<br>Variant 2: `jobId`, `kind`, `plan`<br>Variant 3: `jobId`, `kind`, `review`, `findings`<br>Variant 4: `jobId`, `kind`, `feedback` | Yes | Yes | Transport scope |
| `plan.approve` | `jobId`, `planRevision`, `decision` | Yes | Yes | operator |
| `plan.diff` | `jobId`, `beforeRevision`, `afterRevision` | No | No | Transport scope |
| `plan.revise` | `jobId`, `plan` | Yes | Yes | Transport scope |
| `plan.show` | `jobId` | No | No | Transport scope |
| `schema` | `name` | No | No | Transport scope |
| `skill.install` | `host` | No | No | operator |
| `skill.remove` | `host` | No | No | operator |
| `skill.update` | `host` | No | No | operator |
| `source.create` | `jobId`, `source` | Yes | Yes | Transport scope |
| `source.inspect` | `jobId`, `sourceId` | No | No | Transport scope |
| `source.list` | `jobId` | No | No | Transport scope |
| `workspace.init` | None | No | No | Transport scope |

Call `tutorialx schema job.submit --json` for an action input or `tutorialx schema PlanRevision --json` for a public record. Send the complete envelope with `tutorialx action --input request.json --json`:

```json
{
  "apiVersion": 1,
  "requestId": "request_context",
  "action": "job.context",
  "params": { "jobId": "job_example", "role": "researcher" },
  "expectedRevision": null,
  "idempotencyKey": null
}
```

For mutations, use the current positive job revision and a stable SHA256 hexadecimal idempotency key when marked above. Job creation requires an idempotency key but has no prior job revision. Read responses through the versioned ActionResponse envelope; an accepted asynchronous request is not completed production.
