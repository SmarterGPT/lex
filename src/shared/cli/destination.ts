import { AXErrorException } from "../errors/ax-error.js";
import type { DestinationSnapshotV1 } from "../runtime-scope/destination.js";
import { createOutput } from "./output.js";

/** Payload-free preflight for remember: no frame history, health query, or mutation. */
export function destination(snapshot: DestinationSnapshotV1 | undefined, json = false): void {
  if (!snapshot) {
    throw new AXErrorException(
      "LEX_WORKSPACE_UNBOUND",
      "Destination inspection requires a configured trusted scope-bound host.",
      ["Configure trusted runtime scope and an authorized FrameStore binder."]
    );
  }
  const out = createOutput({ scope: "cli:destination", mode: json ? "jsonl" : "plain" });
  if (json) {
    out.json({
      level: "info",
      code: "DESTINATION_INSPECTED",
      message: "Authorized destination snapshot for remember (no frames read or written)",
      data: { destination: snapshot },
    });
  } else {
    out.info(`Workspace: ${snapshot.workspaceId}`);
    out.info(`Project root: ${snapshot.projectRoot}`);
    out.info(`Destination: ${snapshot.identity ?? "unverified backend"}`);
  }
}
