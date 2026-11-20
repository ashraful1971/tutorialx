# Branded templates and output framing

TutorialX maintains three renderer-neutral branded template definitions: tutorial, explainer, and
reel. Each accepts the workspace brand name, six-digit primary color, and an optional staged logo;
all production nodes still pass through the trusted composition-graph compiler.

`resolveBrandedLayout` classifies each measured output as landscape, vertical, or square and derives
pixel regions for the title/brand, primary content, captions, and the platform-control exclusion.
The safe region is intentionally smaller for vertical output because social-player controls occupy
more of its lower edge. Required regions are validated both against the safe rectangle and against
the control exclusion; an invalid layout fails before rendering.

Focus regions are never treated as an implicit center crop. `mapFocusToCrop` expands the approved
normalized focus to the exact content-region aspect ratio, clamps it to the source, and returns a
bounded zoom/translation mapping. Caption height is derived from the selected font size and maximum
line count, then placed at the requested top, center, or bottom position inside the safe region.

The landscape (1920×1080), vertical (1080×1920), and square (1080×1080) fixtures exercise every
template family and verify that title text, content, captions, and focused controls remain visible.
