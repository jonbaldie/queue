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

export interface QueueStore<T = string> {
    saveEvent(queueName: string, payload: T, isEnqueue: boolean): void;
    saveBatch(events: Array<QueueEvent<T>>): void;
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

    public saveBatch(events: Array<QueueEvent<T>>): void {
        if (events.length === 0) return;
        this.ensureOpen();
        this.writeHandle!.lockSync(true);
        try {
            for (const event of events) {
                const line = JSON.stringify({
                    queue: event.queue,
                    payload: event.payload,
                    enqueue: event.enqueue,
                    dequeue: event.dequeue
                });
                this.writeHandle!.writeSync(this.encoder.encode(line + "\n"));
            }
        } finally {
            this.writeHandle!.unlockSync();
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
                    if (read === null || read <= 0) {
                        break;
                    }
                    leftover += decoder.decode(chunk.subarray(0, read), { stream: true });
                    let idx = leftover.indexOf("\n");
                    while (idx >= 0) {
                        const line = leftover.slice(0, idx);
                        leftover = leftover.slice(idx + 1);
                        if (line.length > 0) {
                            try {
                                const event = JSON.parse(line);
                                if (isQueueEvent<T>(event)) {
                                    events.push(event);
                                }
                            } catch {
                                // skip malformed lines
                            }
                        }
                        idx = leftover.indexOf("\n");
                    }
                }
                // Flush decoder and process any remaining line (no trailing newline)
                leftover += decoder.decode();
                if (leftover.length > 0) {
                    try {
                        const event = JSON.parse(leftover);
                        if (isQueueEvent<T>(event)) {
                            events.push(event);
                        }
                    } catch {
                        // skip malformed lines
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

    public clear(): void {
        this.events = [];
    }

    public loadState(): Array<QueueEvent<T>> {
        return [...this.events];
    }

    public dir(): void {}

    public close(): void {}
}