# Supplying research inputs

TutorialX accepts a topic in the job brief and registers every supporting material through the public `source create` action. Registration records provenance and scope; it does not treat source content as instructions, authorize spending, or begin production.

Start with a workspace and a topic-only brief:

```sh
tutorialx init --workspace /path/to/project --json
tutorialx job create --workspace /path/to/project --input brief.json \
  --idempotency-key <64-hex-key> --json
```

```json
{
  "title": "Explain the settings workflow",
  "topic": "Show how a beginner changes and verifies the setting",
  "audience": "Beginners"
}
```

For each material, pass the returned `jobId`, latest `--expected-revision`, and a new stable idempotency key. `origin`, `license`, `requiredText`, and `usage` are explicit even when some values are unknown.

```json
{
  "jobId": "job_example",
  "source": {
    "input": { "kind": "url", "url": "https://docs.example.com/feature" },
    "attribution": {
      "origin": "Product documentation",
      "license": null,
      "requiredText": null,
      "usage": "permitted"
    }
  }
}
```

Change only `source.input` for the other supported forms:

```json
{ "kind": "text", "text": "Operator-authored reference notes." }
{ "kind": "file", "path": "docs/feature.md", "copy": false }
{ "kind": "media", "path": "references/narration.wav", "copy": true }
{ "kind": "directory", "path": "references/feature", "copy": false }
{ "kind": "codebase", "path": ".", "copy": false }
```

- `copy: false` registers an immutable-by-policy reference and fingerprint. TutorialX does not move, rewrite, or delete the original.
- `copy: true` creates a private bounded snapshot under the job input directory and still leaves the original untouched.
- Files, folders, codebases, and media must remain within configured `sourceRoots` after realpath resolution. Workspace exclusions and built-in credential/private-state exclusions always apply.
- URL registration performs no network request. The selected reader later reports inaccessible or restricted links honestly and never invents a content hash.
- Broad folders and codebases are retrieved through query, file-count, byte, entry, deadline, and exclusion limits. Extracts identify their relative source path and disclose truncation.

Reusable product profiles belong in the private content root at `shared/products/<name>.json`; brand profiles, presets, and reusable references use their corresponding `shared/` directories. A composition root with a profile loader can select a versioned profile reference in `job create`. Until that loader is configured, register the profile JSON as a normal file source so research can cite it without silently applying settings. Register files under `shared/references/` the same way when a job needs them. Profile changes never mutate an already approved job; adopting a newer profile requires a new resolved plan revision and approval.

The following command uses the same action for every input shape:

```sh
tutorialx source create --workspace /path/to/project --input source.json \
  --expected-revision 1 --idempotency-key <64-hex-key> --json
```

Use the returned revision for the next registration. Inspect registered status, fingerprints, attribution, and limitations with `source list` and `source inspect`. A `pending`, `missing`, `inaccessible`, or `unsupported` source is not available evidence; supply access or another source rather than fabricating the missing material.

Executable coverage in `tests/cli/actions.test.ts` registers topic notes, a URL, a file, a folder, a codebase, and a product-profile reference through `source.create`, then verifies every original remains byte-for-byte unchanged.
