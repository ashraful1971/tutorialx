# Browser capture setup and operating policy

TutorialX browser capture records an approved browser scene through the public `CaptureProvider` port. Call `preflight` before `capture`; production orchestration must still bind the request to the current approved plan and authorized attempt. The adapter never treats a visually plausible page as success: every plan step needs a bounded expected-state assertion and produces a timestamped screenshot checkpoint.

## Product demo setup

Install the exact Playwright package/browser revision declared by `@tutorialx/adapters` and make FFprobe available. Configure only the required origins, explicit mutation URL prefixes, viewport, and recording size. A mutable shared product fixture also needs a stable `setupRecipeId`, an atomic `ResourceCoordinator`, and a trusted reconciliation hook that resets or verifies the fixture before actions begin. Capture fails immediately when another attempt owns that fixture.

The licensed fixtures under `tests/fixtures/` are deterministic examples, not production applications. The demo app and WordPress plugin expose loopback-only settings pages, state inspection, and token-protected reset actions. Tests allocate private state/output locations per attempt. A real integration should provide an equivalent documented setup/reset recipe and should use dedicated demo data rather than a live customer account.

## Authentication and renewal

Browser authentication is referenced by an opaque `sessionRef`; cookies and tokens live only in the configured private session directory. A session envelope has a schema version, expiry timestamp, and Playwright storage state. Keep that directory outside shareable job content and version control. Do not put passwords, cookies, bearer tokens, or storage state in a plan, artifact manifest, log, screenshot name, or distributable bundle.

If preflight reports `CAPTURE_AUTH_EXPIRED`, `CAPTURE_SESSION_MISSING`, or `CAPTURE_AUTH_REQUIRED`, renew access interactively in the trusted environment, write a new private envelope, and rerun preflight. Never record a login form as substitute tutorial footage and never automate MFA or secret entry as a capture step.

## Permitted actions and sensitive regions

The adapter executes only the ordered steps supplied by the approved scene: navigation, click, fill, scroll, and observation. Every origin is allowlisted. Click and fill are additionally limited to configured mutation path prefixes. Navigation and expected URLs cannot escape the allowed origins. Robust role, label, test-id, or scoped CSS locators are required; arbitrary page scripts and shell automation are not plan actions.

Use normalized `maskRegions` for known sensitive rectangles. Masks are installed before each document renders, stay above the page without intercepting input, and appear in recording/checkpoint evidence. Mask configuration does not by itself prove every exported frame is safe: the later final-media quality review must verify required masking and block delivery on unresolved exposure.

## Capture outputs and limitations

A successful capture closes the isolated browser context, waits for the recording to finalize, and probes the saved video with FFprobe. The result contains the measured video manifest, per-step screenshot manifests, verified time ranges, focus regions, and presentation metadata for cursor/click/checkpoint alignment. Failed assertions retain a failure screenshot but do not return a successful capture result.

Capture supports browser surfaces only. It does not provide a desktop-app adapter, bypass access controls, discover mutation authorization, guarantee third-party UI stability, or make an irreversible/uncertain mutation safe to replay. Long recordings need renewable fixture leases in the worker layer; this adapter's capture must finish within the authorized attempt deadline. Final cropping, zoom, cursor rendering, and mask verification belong to composition and quality stages rather than being inferred from raw browser footage.
