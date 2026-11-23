import type { JsonValue } from "./payload.ts";

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
    replace(events: Array<QueueEvent<T>>): void;
    loadState(): Array<QueueEvent<T>>;
    dir(dir: string): void;
    close(): void;
}

export class PersistDirectoryInUseError extends Error {
    constructor(directory: string) {
        super(`PERSIST directory ${directory} is already in use by another queue process`);
        this.name = "PersistDirectoryInUseError";
    }
}

/** Persists payloads as JSON; T must be JSON-compatible. */
export class FileStore<T extends JsonValue = string> implements QueueStore<T> {
    private directory: string = '';
    private writeHandle: Deno.FsFile | null = null;
    private ownerHandle: Deno.FsFile | null = null;
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

    private serialize(event: QueueEvent<T>): Uint8Array {
        return this.encoder.encode(JSON.stringify({
            queue: event.queue,
            payload: event.payload,
            enqueue: event.enqueue,
            dequeue: event.dequeue,
        }) + "\n");
    }

    private syncDirectory(): void {
        const dirPath = this.directory === "" ? "." : this.directory;
        const dir = Deno.openSync(dirPath, { read: true });
        try {
            dir.syncSync();
        } finally {
            dir.close();
        }
    }

    private closeWriteHandle(): void {
        if (this.writeHandle !== null) {
            this.writeHandle.close();
            this.writeHandle = null;
        }
    }

    private releaseOwnership(): void {
        if (this.ownerHandle !== null) {
            this.ownerHandle.close();
            this.ownerHandle = null;
        }
    }

    // Two processes serving one directory each keep their own in-memory
    // queues, so both deliver the same item and each shutdown snapshot
    // erases the other's items. Hold an exclusive lock on a separate file
    // (persist.dat is replaced by rename, so its lock would not carry over)
    // for as long as this store owns the directory. The OS drops the lock
    // when the process exits, including on SIGKILL.
    public claimDirectory(): void {
        if (this.ownerHandle !== null) {
            return;
        }
        this.ensureDirectory();
        const handle = Deno.openSync(this.directory + "persist.lock", { write: true, create: true });
        if (!handle.tryLockSync(true)) {
            handle.close();
            throw new PersistDirectoryInUseError(this.directory);
        }
        this.ownerHandle = handle;
    }

    private removeTempFile(): void {
        try {
            Deno.removeSync(this.tempPath);
        } catch (cleanupError) {
            if (!(cleanupError instanceof Deno.errors.NotFound)) {
                throw cleanupError;
            }
        }
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
        this.append({
            queue: queueName,
            payload: payload,
            enqueue: isEnqueue,
            dequeue: !isEnqueue,
        });
    }

    // writeSync() may write fewer bytes than requested (e.g. on a full
    // volume) without throwing, so keep writing until every byte is down
    // or the OS reports the error.
    private writeAll(file: Deno.FsFile, bytes: Uint8Array): void {
        let offset = 0;
        while (offset < bytes.length) {
            const written = file.writeSync(bytes.subarray(offset));
            if (written === 0) {
                throw new Error("Failed to write to " + this.path + ": wrote 0 bytes");
            }
            offset += written;
        }
    }

    // A failed append is rolled back to the previous end of the log, so a
    // partial line can never be glued onto the next appended event.
    private append(event: QueueEvent<T>): void {
        this.ensureOpen();
        const handle = this.writeHandle!;
        handle.lockSync(true);
        try {
            const end = handle.statSync().size;
            try {
                this.writeAll(handle, this.serialize(event));
            } catch (error) {
                handle.truncateSync(end);
                handle.seekSync(end, Deno.SeekMode.Start);
                throw error;
            }
        } finally {
            handle.unlockSync();
        }
    }

    public replace(events: Array<QueueEvent<T>>): void {
        this.ensureDirectory();
        let renamed = false;
        let temp: Deno.FsFile | null = null;
        try {
            temp = Deno.openSync(this.tempPath, { write: true, create: true, truncate: true });
            temp.lockSync(true);
            try {
                for (const event of events) {
                    this.writeAll(temp, this.serialize(event));
                }
                temp.syncSync();
            } finally {
                temp.unlockSync();
                temp.close();
                temp = null;
            }
            Deno.renameSync(this.tempPath, this.path);
            renamed = true;
            this.closeWriteHandle();
            this.syncDirectory();
        } catch (error) {
            if (temp !== null) {
                try {
                    temp.close();
                } catch (closeError) {
                    void closeError;
                }
            }
            if (!renamed) {
                this.removeTempFile();
            }
            throw error;
        }
    }

    public loadState(): Array<QueueEvent<T>> {
        try {
            const file = Deno.openSync(this.path, { read: true });
            file.lockSync(false);
            try {
                // Stream-parse line by line to avoid 3x peak memory from split/filter/map.
                // Frame records in the byte domain: 0x0A can never occur inside a
                // multi-byte UTF-8 sequence, so a record can be decoded once its
                // terminating newline has been seen, which also reassembles
                // characters split across reads. Only the current record is
                // buffered, never the whole file.
                const events: QueueEvent<T>[] = [];
                // ignoreBOM: a byte-order mark is stripped only at the start
                // of the file (below), matching the previous streaming
                // decoder; decoding each record separately would otherwise
                // also strip a BOM at the start of any later record.
                const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
                const chunk = new Uint8Array(4096);
                // Fragments of the record being assembled, copied out of
                // the read chunk (which is reused for the next read).
                // Only the current record is buffered, never the whole
                // file; concatenating it once it is complete is linear,
                // unlike re-copying the growing prefix on every read.
                let parts: Uint8Array[] = [];
                let lineLength = 0;
                let lineCount = 0;
                const append = (bytes: Uint8Array): void => {
                    if (bytes.length === 0) {
                        return;
                    }
                    parts.push(bytes.slice());
                    lineLength += bytes.length;
                };
                const emit = (bytes: Uint8Array): void => {
                    const isFirstRecord = lineCount === 0;
                    lineCount++;
                    if (bytes.length === 0) {
                        return;
                    }
                    let text = decoder.decode(bytes);
                    if (isFirstRecord && text.startsWith("\uFEFF")) {
                        text = text.slice(1);
                    }
                    const event = parseLine<T>(text);
                    if (event) {
                        events.push(event);
                    }
                };
                const emitBuffered = (): void => {
                    if (parts.length === 1) {
                        emit(parts[0]);
                    } else {
                        const all = new Uint8Array(lineLength);
                        let offset = 0;
                        for (const part of parts) {
                            all.set(part, offset);
                            offset += part.length;
                        }
                        emit(all);
                    }
                    parts = [];
                    lineLength = 0;
                };
                while (true) {
                    const read = file.readSync(chunk);
                    if (!read) {
                        break;
                    }
                    const view = chunk.subarray(0, read);
                    let start = 0;
                    let newline = view.indexOf(0x0a, start);
                    while (newline >= 0) {
                        if (lineLength === 0) {
                            // Whole record inside this chunk: decode in place.
                            emit(view.subarray(start, newline));
                        } else {
                            append(view.subarray(start, newline));
                            emitBuffered();
                        }
                        start = newline + 1;
                        newline = view.indexOf(0x0a, start);
                    }
                    if (start < view.length) {
                        append(view.subarray(start));
                    }
                }
                // Process any remaining record (no trailing newline)
                if (lineLength > 0) {
                    emitBuffered();
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
        this.closeWriteHandle();
        this.releaseOwnership();
        this.directory = dir === "" ? "" : dir.replace(/\/$/, '') + "/";
    }

    public close(): void {
        this.closeWriteHandle();
        this.releaseOwnership();
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

    public replace(events: Array<QueueEvent<T>>): void {
        this.events = [...events];
    }

    public loadState(): Array<QueueEvent<T>> {
        return [...this.events];
    }

    public dir(): void {}

    public close(): void {}
}