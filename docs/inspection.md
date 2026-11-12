# Public progress and artifact inspection

`events`, `artifact.list`, and `artifact.read` share the action envelope and
authenticated job scope used by job actions. Discover their complete inputs with
`tutorialx schema events --json` or the corresponding action name. Lists default
to twenty items and accept at most one hundred.

`events` accepts a numeric `afterCursor`. Persist the returned `nextCursor`; a
reconnect returns only later records. An empty page retains the cursor.
`mayHaveMore` means the page reached its limit, not that a new event is guaranteed.
Events retain request, trace, job, and attempt identities. Submission bodies are
references through `submissionId` and `job.submission`; they are not copied into
the progress stream. Large diagnostic data becomes a bounded key summary.

`artifact.list` returns accepted manifests, provenance, and a cursor. It omits raw
storage locations. `artifact.read` requires an artifact accepted by the requested
job and verifies its recorded size and checksum before returning up to 64 KiB
from an original byte offset. Text is UTF-8; binary ranges use base64. `nextOffset`
addresses original bytes, even when redaction changes displayed text length.
Missing/corrupt artifacts fail explicitly. Object-storage reads require a selected
reader and are not silently treated as laptop files. Local reads reject redirected
paths and enforce a verification deadline.

The composition root can inject `knownSecrets` into `createActionService`; those
resolved values are never persisted by the redactor. Public response data and
diagnostics redact those values, sensitive field names, bearer credentials, and
common secret-bearing URLs. Artifact range reads mask known byte sequences with
asterisks before text/base64 encoding, including sequences spanning a requested
range boundary. Resolve credentials only in the provider process that needs them;
redaction is additional output protection, not permission to put secrets in input
documents or accepted media. Final footage masking remains a production quality
responsibility.

The inspection tests use real accepted files and SQLite metadata. They verify
pagination/reconnection, correlations, redaction, ranged reads, checksum failure,
and cross-job denial. They do not claim visual masking of recorded footage.
