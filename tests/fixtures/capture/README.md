# Licensed capture fixtures

The demo app and WordPress test plugin in the adjacent fixture directories are original TutorialX test code distributed under Apache-2.0. They contain no third-party media, credentials, sessions, or personal data.

`demo-app/server.mjs` serves one deterministic settings form, a state inspection endpoint, and a token-protected reset endpoint on loopback. `wordpress-plugin/tutorialx-fixture.php` keeps its settings normalization/setup/reset logic callable from WordPress and from the small PHP harness. The harness supplies only the option/action functions needed for an independent feature-flow check; it is not represented as a complete WordPress runtime. `wordpress-plugin/router.php` is a loopback test server that renders the plugin's settings flow so the public capture port can produce real browser media and evidence without claiming that the harness is a full WordPress distribution.

Recording tests must create a new private state file, call setup/reset before capture, and never reuse credentials or mutable state across jobs.

See `docs/browser-capture.md` for product setup, private-session renewal, mutation policy, masking, and capture limitations.
