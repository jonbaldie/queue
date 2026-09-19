export interface QueueEvent<T> {
    queue: string;
    payload: T;
    enqueue: boolean;
    dequeue: boolean;
}

export function isQueueEvent<T>(value: unknown): value is QueueEvent<T> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const event = value as Record<string, unknown>;
    return typeof event.queue === "string" &&
        "payload" in event &&
        typeof event.enqueue === "boolean" &&
        typeof event.dequeue === "boolean" &&
        event.enqueue !== event.dequeue;
}

function parseLine<T>(line: string): QueueEvent<T> | undefined {
    try {
        const event = JSON.parse(line);
        if (isQueueEvent<T>(event)) {
            return event;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

export interface QueueStore<T = string> {
    saveEvent(queueName: string, payload: T, isEnqueue: boolean): void;
    saveBatch(events: Array<QueueEvent<T>>): void;
    // Swap the whole log for `events` so that a crash at any point leaves
    // either the old log or the new one, never a partial mix.
    replace(events: Array<QueueEvent<T>>): void;
    loadState(): Array<QueueEvent<T>>;
    clear(): void;
    dir(dir: string): void;
    close(): void;
}

export class FileStore<T = string> implements QueueStore<T> {
    private directory: string = '';
    private writeHandle: Deno.FsFile | null = null;
    private encoder = new TextEncoder();

    private get path(): string {
        return this.directory + "persist.dat";
    }

    private get tempPath(): string {
        return this.path + ".tmp";
    }

    private ensureDirectory(): void {
        if (this.directory === "") {
            return;
        }
        Deno.mkdirSync(this.directory, { recursive: true });
    }

    // Lazily open the write handle so that dir() with an invalid path
    // doesn't throw until an actual I/O operation is attempted.
    private ensureOpen(): void {
        if (this.writeHandle === null) {
            this.ensureDirectory();
            this.writeHandle = Deno.openSync(this.path, { write: true, create: true, append: true });
        }
    }

    public saveEvent(queueName: string, payload: T, isEnqueue: boolean): void {
        this.ensureOpen();
        const line = JSON.stringify({
            queue: queueName,
            payload: payload,
            enqueue: isEnqueue,
            dequeue: !isEnqueue
        });
        this.writeHandle!.lockSync(true);
        try {
            this.writeHandle!.writeSync(this.encoder.encode(line + "\n"));
        } finally {
            this.writeHandle!.unlockSync();
        }
    }

    private writeEvents(file: Deno.FsFile, events: Array<QueueEvent<T>>): void {
        for (const event of events) {
            const line = JSON.stringify({
                queue: event.queue,
                payload: event.payload,
                enqueue: event.enqueue,
                dequeue: event.dequeue
            });
            const bytes = this.encoder.encode(line + "\n");
            let written = 0;
            while (written < bytes.length) {
                written += file.writeSync(bytes.subarray(written));
            }
        }
    }

    public saveBatch(events: Array<QueueEvent<T>>): void {
        if (events.length === 0) return;
        this.ensureOpen();
        this.writeHandle!.lockSync(true);
        try {
            this.writeEvents(this.writeHandle!, events);
        } finally {
            this.writeHandle!.unlockSync();
        }
    }

    // Write the snapshot to a temp file, fsync it, then rename it over the
    // log. rename() is atomic, so the old log stays complete until the new
    // one is fully on disk.
    public replace(events: Array<QueueEvent<T>>): void {
        this.ensureOpen();
        const oldHandle = this.writeHandle!;
        oldHandle.lockSync(true);
        try {
            this.writeTempSnapshot(events);
            Deno.renameSync(this.tempPath, this.path);
        } finally {
            oldHandle.unlockSync();
        }
        // The old handle still points at the replaced file; drop it before
        // anything else can fail so later appends go to the new log.
        oldHandle.close();
        this.writeHandle = null;
        this.syncDirectory();
    }

    private writeTempSnapshot(events: Array<QueueEvent<T>>): void {
        const temp = Deno.openSync(this.tempPath, { write: true, create: true, truncate: true });
        try {
            this.writeEvents(temp, events);
            temp.syncSync();
        } catch (error) {
            temp.close();
            try {
                Deno.removeSync(this.tempPath);
            } catch (cleanupError) {
                // Keep the original error; a stale temp file is overwritten next save.
                Deno.stderr.writeSync(this.encoder.encode(
                    `Could not remove ${this.tempPath}: ${cleanupError}\n`,
                ));
            }
            throw error;
        }
        temp.close();
    }

    // Persist the rename itself so it survives power loss, not just a kill.
    private syncDirectory(): void {
        const dir = Deno.openSync(this.directory === "" ? "." : this.directory, { read: true });
        try {
            dir.syncSync();
        } finally {
            dir.close();
        }
    }

    public clear(): void {
        this.ensureOpen();
        this.writeHandle!.lockSync(true);
        try {
            this.writeHandle!.truncateSync(0);
        } finally {
            this.writeHandle!.unlockSync();
        }
    }

    public loadState(): Array<QueueEvent<T>> {
        try {
            const file = Deno.openSync(this.path, { read: true });
            file.lockSync(false);
            try {
                // Stream-parse line by line to avoid 3x peak memory from split/filter/map
                const events: QueueEvent<T>[] = [];
                const decoder = new TextDecoder();
                const chunk = new Uint8Array(4096);
                let leftover = "";
                while (true) {
                    const read = file.readSync(chunk);
                    if (!read) {
                        break;
                    }
                    leftover += decoder.decode(chunk.subarray(0, read), { stream: true });
                    let idx = leftover.indexOf("\n");
                    while (idx >= 0) {
                        const line = leftover.slice(0, idx);
                        leftover = leftover.slice(idx + 1);
                        if (line.length > 0) {
                            const event = parseLine<T>(line);
                            if (event) {
                                events.push(event);
                            }
                        }
                        idx = leftover.indexOf("\n");
                    }
                }
                // Flush decoder and process any remaining line (no trailing newline)
                leftover += decoder.decode();
                if (leftover.length > 0) {
                    const event = parseLine<T>(leftover);
                    if (event) {
                        events.push(event);
                    }
                }
                return events;
            } finally {
                file.unlockSync();
                file.close();
            }
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                return [];
            }
            throw error;
        }
    }

    public dir(dir: string): void {
        if (this.writeHandle !== null) {
            this.writeHandle.close();
            this.writeHandle = null;
        }
        this.directory = dir.replace(/\/$/, '') + "/";
    }

    public close(): void {
        if (this.writeHandle !== null) {
            this.writeHandle.close();
            this.writeHandle = null;
        }
    }
}

export class MemoryStore<T = string> implements QueueStore<T> {
    private events: Array<QueueEvent<T>> = [];

    public saveEvent(queueName: string, payload: T, isEnqueue: boolean): void {
        this.events.push({
            queue: queueName,
            payload,
            enqueue: isEnqueue,
            dequeue: !isEnqueue
        });
    }

    public saveBatch(events: Array<QueueEvent<T>>): void {
        for (const event of events) {
            this.events.push(event);
        }
    }

    public replace(events: Array<QueueEvent<T>>): void {
        this.events = [...events];
    }

    public clear(): void {
        this.events = [];
    }

    public loadState(): Array<QueueEvent<T>> {
        return [...this.events];
    }

    public dir(): void {}

    public close(): void {}
}