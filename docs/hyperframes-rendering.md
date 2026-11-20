# HyperFrames rendering

The renderer adapter invokes exactly HyperFrames `0.9.70`; it rejects a different reported CLI
version before preflight or production. The CLI may be installed separately or supplied through a
command such as `pnpm dlx hyperframes@0.9.70`. HyperFrames is intentionally not a base-package
dependency.

Each operation copies a trusted template into an attempt-scoped directory in stable lexical order.
Declared template files and fonts must be regular local files. Supplied artifacts are copied only
after their SHA-256 digest is verified, and their destinations cannot escape the staging directory.
Symlinks are rejected. HyperFrames `check --json` is the only diagnostic interface parsed by the
adapter; human console output is not interpreted.

Rendering is bounded by the operation deadline, diagnostic byte limit, and configured output byte
limit. A render first targets a partial file. FFprobe must then confirm a non-empty video stream,
duration, dimensions, codec, and rational frame rate. Only after that probe succeeds is the file
linked to its final name without replacing an existing artifact; the manifest is constructed last.

## Real CLI smoke record

On 2026-11-20, the repository fixture at `tests/fixtures/hyperframes` passed the following commands
on macOS arm64 with Node.js 22.14.0:

```sh
pnpm dlx hyperframes@0.9.70 check tests/fixtures/hyperframes --json
pnpm dlx hyperframes@0.9.70 render tests/fixtures/hyperframes \
  --output /private/tmp/tutorialx-hyperframes-smoke.mp4 --fps 30 --quality draft
/opt/homebrew/bin/ffprobe -v error -show_streams -show_format -of json \
  /private/tmp/tutorialx-hyperframes-smoke.mp4
```

The check reported `ok: true` with no lint, runtime, layout, or contrast errors. The render completed
in about four seconds. FFprobe measured a one-second, 30-frame, 640×360 H.264/yuv420p MP4 with a
30/1 frame rate and identified `hyperframes_version=0.9.70`. The small generated MP4 and HyperFrames
cache are smoke artifacts and are not committed.
