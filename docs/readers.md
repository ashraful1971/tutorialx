# Bounded source readers

`createLocalResearchReader` from `@tutorialx/adapters` implements the existing
`ResearchReader` port and additive `inspect` / `formats` methods. The original
version-one reader result remains unchanged. Rich inspection returns measured
metadata, processing limitations, the source fingerprint, and bounded extracts
with line/page provenance.

Configure trusted `projectDirectory`, `allowedRoots`, exclusions, private roots,
`localOnly`, and allowed origins when composing the reader. Individual requests
can further restrict those scopes and byte limits. Source/context identities
must match. Reading does not execute source code, approve claims, install a
provider, or alter policy.

| Format | Processing | Limits / dependencies |
| --- | --- | --- |
| Text, Markdown, code | UTF-8 extracts with line provenance | No code execution |
| HTML file or allowed URL | Static visible text | No scripts, styles, linked resources, or browser state |
| DOCX | Main WordprocessingML document paragraphs | Bounded ZIP/XML extraction; no linked parts/layout interpretation |
| PDF | Page text layer | Optional pinned `pdfjs-dist` 6.5.438 on Node 22.13+; scanned pages need separate OCR |
| PNG/JPEG/GIF/WebP | Header dimensions | Does not certify decoded pixels or visual content |
| PCM/float WAV | Stream duration/rate/channels | No speech recognition or alignment |
| Other supported audio/video | Container/stream metadata | Explicit FFprobe executable; no quality certification |

Default limits are 16 MiB input, 200,000 output bytes, 100 PDF pages, and a
30-second timeout. Supported ceilings are validated. Document extraction runs in
a terminated worker with explicit memory/stack bounds; archive expansion, XML
depth, output, and page counts are bounded. Optional FFprobe receives argument
arrays, sanitized environment, a private temporary file, file/pipe protocols,
format restrictions, and a timeout. No executable or model is downloaded by a
read action. Missing dependencies, malformed formats, unreadable/encrypted
documents, and unsupported sources return honest status and limitations.

URL reads require both trusted and request origin authorization. Local-only
configuration denies all network retrieval. Each redirect is checked, DNS
answers are inspected and pinned to the request, private destinations need
explicit trusted-origin permission, embedded credentials are rejected, and
HTTPS cannot downgrade. Bodies, redirects, headers, and deadlines are bounded.
Exclusions and allowed-root checks reuse the source-registration scope rules.
Repository retrieval/ranking and refresh policy are tracked separately in 6.2.

Tests generate authored text, DOCX, PDF, image headers, and WAV fixtures; an HTTP
fixture tests limits, redirects, and local-only restrictions. The optional media
case was exercised on macOS arm64 with temporary FFmpeg 4.1.5 and FFprobe 5.0.1
binaries: real generated H264/AAC MP4 and FLAC were probed. Those binaries and
generated media remain outside Git. To repeat that case, set
`TUTORIALX_TEST_FFMPEG` and `TUTORIALX_TEST_FFPROBE` to compatible executables before
running `pnpm test`; otherwise it is explicitly skipped. No hosted production
provider or final video-quality check is claimed by these reader tests.
