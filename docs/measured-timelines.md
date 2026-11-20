# Measured timelines

`reconcileMeasuredTimeline` turns accepted narration and visual artifacts into a contract-valid
timeline using their measured durations. Each declared narration/action binding identifies a
spoken anchor and an essential visual action. Reconciliation shifts an entire track forward to
reduce anchor drift; it never trims source media, changes `sourceStartUs`, or changes playback
speed. Multiple bindings must fit the configured tolerance, which defaults to 250 milliseconds.

Measured duration differences remain explicit. A delayed narration start or a visual tail becomes
an intentional silence. A visual gap requires either an approved still-frame hold or a supplied
cutaway long enough for that exact gap. Without either authorization, reconciliation fails instead
of silently speeding an essential action or truncating narration.

Scene ranges are accumulated in integer microseconds. Frame boundaries use the shared rational
`microsecondsToFrame` conversion, including rates such as 30000/1001, so renderer adapters receive
stable nearest-frame indices without accumulated floating-point drift. Holds and silences remain
timeline annotations for later quality checks; they are not automatically treated as defects.
