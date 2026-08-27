export interface QueueEvent<T> {
    queue: string;
    payload: T;
    enqueue: boolean;
    dequeue: boolean;
}

function isQueueEvent<T>(value: unknown): value is QueueEvent<T> {
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
    loadState(): Array<QueueEvent<T>>;
    clear(): void;
    dir(dir: string): void;
}

export class FileStore<T = string> implements QueueStore<T> {
    private directory: string = '';

    private get path(): string {
        return this.directory + "persist.dat";
    }

    private ensureDirectory(): void {
        if (this.directory === "") {
            return;
        }
        Deno.mkdirSync(this.directory, { recursive: true });
    }

    public saveEvent(queueName: string, payload: T, isEnqueue: boolean): void {
        this.ensureDirectory();
        const line = JSON.stringify({
            queue: queueName,
            payload: payload,
            enqueue: isEnqueue,
            dequeue: !isEnqueue
        });
        const file = Deno.openSync(this.path, { write: true, create: true, append: true });
        file.lockSync(true);
        try {
            file.writeSync(new TextEncoder().encode(line + "\n"));
        } finally {
            file.unlockSync();
            file.close();
        }
    }

    public clear(): void {
        this.ensureDirectory();
        const file = Deno.openSync(this.path, { write: true, create: true });
        file.lockSync(true);
        try {
            file.truncateSync(0);
        } finally {
            file.unlockSync();
            file.close();
        }
    }

    public loadState(): Array<QueueEvent<T>> {
        try {
            const file = Deno.openSync(this.path, { read: true });
            file.lockSync(false);
            try {
                const chunks: Uint8Array[] = [];
                const chunk = new Uint8Array(4096);
                let totalRead = 0;
                while (true) {
                    const read = file.readSync(chunk);
                    if (read === null || read <= 0) {
                        break;
                    }
                    chunks.push(chunk.slice(0, read));
                    totalRead += read;
                }
                const buf = new Uint8Array(totalRead);
                let offset = 0;
                for (const c of chunks) {
                    buf.set(c, offset);
                    offset += c.length;
                }
                const content = new TextDecoder().decode(buf);
                return content.split("\n")
                    .filter((line: string) => line.length > 0)
                    .flatMap((line: string) => {
                        try {
                            const event = JSON.parse(line);
                            return isQueueEvent<T>(event) ? [event] : [];
                        } catch {
                            return [];
                        }
                    });
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
        this.directory = dir.replace(/\/$/, '') + "/";
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

    public clear(): void {
        this.events = [];
    }

    public loadState(): Array<QueueEvent<T>> {
        return [...this.events];
    }

    public dir(): void {}
}
