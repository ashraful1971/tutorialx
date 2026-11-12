# Recovery and resuming

Resume by job ID using `job.inspect`, `job.context`, accepted submission IDs and event cursors. The engine's metadata is authoritative; readable brief/plan files are projections and editing them is not an approval action.

| Result | Response |
| --- | --- |
| Needs input or missing prerequisite | Retrieve the recommended schema and supply only the requested material. |
| Revision conflict | Refresh job/context/plan, reconcile changes, and submit a new logical request. Replaying unchanged accepted input keeps its original key. |
| Needs approval or policy denied | Hand the exact plan and current next action to the authorized operator; retain the waiting state. |
| Capability unavailable | Report the specific provider/worker/check blocker and retain accepted work. |
| Provider failure | Inspect redacted operation/event context and follow its recovery recommendation. |
| Uncertain paid/external outcome | Reconcile the retained receipt/provider request identity before any repeat request; never blindly repeat a possibly charged operation. |
| Paused or cancelled | Preserve accepted artifacts; resume only through the authorized operator control. |

Use bounded `events`, artifact ranges and pagination to reconnect without dumping all history. Never query or patch private database tables to force a stage, fabricate an artifact, or clear an approval wait. Skill removal changes only managed instructions and retains videos and workspace state.
