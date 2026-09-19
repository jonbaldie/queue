// Runs main.ts but kills the process abruptly on its first file write, the
// way SIGKILL, an OOM kill or a power loss would during a snapshot rewrite.
// CRASH_ON_FIRST_WRITE=startup crashes during the startup rewrite;
// CRASH_ON_FIRST_WRITE=shutdown crashes during the SIGTERM flush.
const mode = Deno.env.get("CRASH_ON_FIRST_WRITE");
let armed = mode === "startup";
if (mode === "shutdown") {
    Deno.addSignalListener("SIGTERM", () => { armed = true; });
}

const writeSync = Deno.FsFile.prototype.writeSync;
Deno.FsFile.prototype.writeSync = function (this: Deno.FsFile, data: Uint8Array): number {
    if (armed) {
        Deno.exit(137);
    }
    return writeSync.call(this, data);
};

await import("../../main.ts");
