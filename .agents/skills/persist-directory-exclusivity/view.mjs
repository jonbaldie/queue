export const title = "Queue servers sharing one PERSIST directory";

const sequenceLength = (sequence) =>
  Array.isArray(sequence) ? sequence.length : Object.keys(sequence ?? {}).length;

export const state = (v) => {
  const active = Object.entries(v.processState)
    .filter(([, status]) => status === "serving").length;
  const refused = Object.entries(v.processState)
    .filter(([, status]) => status === "refused").length;
  const owner = v.lockOwner === "no-owner"
    ? "directory free"
    : "persist.lock held";
  const job = v.diskPending ? "job remains on disk" : "disk queue is empty";
  const deliveredCount = sequenceLength(v.deliveries);
  const activeLabel = active === 1 ? "one server serving" : `${active} servers serving`;
  const refusedLabel = refused === 1 ? "one refused start" : `${refused} refused starts`;
  const deliveredLabel = deliveredCount === 1 ? "one delivery" : `${deliveredCount} deliveries`;
  return `${activeLabel}; ${owner}; ${refusedLabel}; ${job}; ${deliveredLabel}`;
};

export const step = (action, from, to) => {
  const changedServer = Object.keys(from.processState).find((server) =>
    from.processState[server] !== to.processState[server]
  );
  const deliveredBy = Object.keys(from.localPending).find((server) =>
    from.localPending[server] && !to.localPending[server]
  );
  const actor = action.startsWith("Dequeue")
    ? deliveredBy ?? "a server"
    : changedServer ?? "a server";
  switch (action.split("(")[0]) {
    case "StartServer":
      return `${actor} claims persist.lock and loads the queue`;
    case "RefuseStart":
      return `${actor} cannot claim persist.lock and exits`;
    case "RestartAfterRefusal":
      return `${actor} is restarted after the lock is released`;
    case "Dequeue":
      return `${actor} delivers and removes the pending job`;
    case "StopServer":
      return `${actor} exits and the operating system releases persist.lock`;
    case "Done":
      return null;
    default:
      return from.lockOwner === "no-owner" ? "the queue remains idle" : null;
  }
};
