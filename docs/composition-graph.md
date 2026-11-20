# Renderer-neutral composition graph

The composition graph is declarative data shared by renderer adapters. It contains measured variant
dimensions, rational frame rate, duration, staged asset identities, one accepted caption-track
identity, and ordered visual/audio nodes. Common primitives cover title, text, image, video,
verified browser capture, focus/zoom, diagram, callout, transition, voice/music/effects, and
captions. The contract contains no HTML, React component, script, command, or executable plugin.

`compileTrustedTemplate` accepts a template selected from the maintained composition-root registry.
The template has an exact ID, version, digest, built-in relative source, supported primitive list,
font allowlist, and node ceiling. Compilation rejects unsupported primitives, unstaged assets,
unknown node references, nonaccepted caption tracks, untrusted fonts, and nodes outside measured
duration. The resulting graph records only template identity; renderer-specific source stays inside
the selected adapter and template package.

Custom renderer scenes are not translated into this common graph automatically. They retain their
declared provider/template dependency and require compatible selection or explicit adaptation plus
new plan approval.
