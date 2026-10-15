import { QueueEvent, QueueStore } from "./persist.ts"
import { InvalidPayloadError, isNonNullPayload } from "./payload.ts";
export const MAX_QUEUE_NAME_LENGTH = 128;

export class QueueNameTooLongError extends Error {
    constructor() {
        super("Queue name too long");
        this.name = "QueueNameTooLongError";
    }
}

/**
 * FIFO queue with O(1) amortized enqueue and dequeue.
 * Uses a head index instead of Array.shift() to avoid O(n) reindexing.
 */
class FIFOQueue<T> {
    private items: T[] = [];
    private head = 0;

    push(item: T): void {
        this.items.push(item);
    }

    shift(): T | undefined {
        if (this.head >= this.items.length) return undefined;
        const item = this.items[this.head];
        this.items[this.head] = undefined as T; // help GC
        this.head++;
        // Compact when the consumed prefix exceeds the remaining items
        if (this.head > 16 && this.head >= (this.items.length >> 1)) {
            this.items = this.items.slice(this.head);
            this.head = 0;
        }
        return item;
    }

    retain(predicate: (item: T) => boolean): void {
        this.items = Array.from(this).filter(predicate);
        this.head = 0;
    }

    peek(): T | undefined {
        return this.head < this.items.length ? this.items[this.head] : undefined;
    }

    get length(): number {
        return this.items.length - this.head;
    }

    [Symbol.iterator](): Iterator<T> {
        let index = this.head;
        const items = this.items;
        const end = items.length;
        return {
            next(): IteratorResult<T> {
                if (index < end) {
                    return { value: items[index++], done: false };
                }
                return { value: undefined as unknown as T, done: true };
            },
        };
    }
}

export default class Manager<T = string> {
    private queues: Map<string, FIFOQueue<T>>;
    private store: QueueStore<T>;
    private queueDepthLimit: number;
    private queueCountLimit: number;
    private persistEnabled: boolean;

    constructor(store: QueueStore<T>, queueDepthLimit?: number, queueCountLimit?: number, persistEnabled?: boolean) {
        this.store = store;
        this.queues = new Map();
        this.queueDepthLimit = queueDepthLimit ?? 10000;
        this.queueCountLimit = queueCountLimit ?? 1000;
        this.persistEnabled = persistEnabled ?? true;
    }

    private register(name: string, queue: FIFOQueue<T>): Manager<T> {
        this.queues.set(name, queue);

        return this;
    }

    private validateName(name: string): void {
        if (Array.from(name).length > MAX_QUEUE_NAME_LENGTH) {
            throw new QueueNameTooLongError();
        }
    }

    public canCreateQueue(): boolean {
        return this.queues.size < this.queueCountLimit;
    }

    public canEnqueue(name: string): boolean {
        this.validateName(name);
        const queue = this.find(name);
        if (!queue) {
            return this.canCreateQueue() && 0 < this.queueDepthLimit;
        }
        return queue.length < this.queueDepthLimit;
    }

    private find(name: string): FIFOQueue<T> | undefined {
        return this.queues.get(name);
    }

    public enqueue(name: string, payload: T): Manager<T> {
        return this.applyEnqueue(name, payload, "live");
    }

    private applyEnqueue(name: string, payload: T, mode: "live" | "replay"): Manager<T> {
        this.validateName(name);
        const existing = this.find(name);
        const queue = existing || new FIFOQueue<T>();
        if (mode === "live") {
            this.validateLiveEnqueue(payload, existing);
            // Log before mutating, so persistence failures cannot leave
            // an item held only in memory. Replay never appends events.
            if (this.persistEnabled) {
                this.store.saveEvent(name, payload, true);
            }
        }

        if (!existing) {
            this.register(name, queue);
        }
        queue.push(payload);

        return this;
    }

    private validateLiveEnqueue(payload: T, existing: FIFOQueue<T> | undefined): void {
        if (!isNonNullPayload(payload)) {
            throw new InvalidPayloadError("Null payload not allowed");
        }
        if (!existing && !this.canCreateQueue()) {
            throw new Error("Queue count limit reached");
        }
        if ((existing?.length ?? 0) >= this.queueDepthLimit) {
            throw new Error("Queue depth limit reached");
        }
    }

    public dequeue(name: string): T | undefined {
        return this.applyDequeue(name, "live");
    }

    private applyDequeue(name: string, mode: "live" | "replay"): T | undefined {
        this.validateName(name);
        const queue = this.find(name);
        if (!queue) {
            return undefined;
        }

        const payload = queue.peek();
        if (payload === undefined) {
            return undefined;
        }

        if (mode === "live" && this.persistEnabled) {
            this.store.saveEvent(name, payload, false);
        }

        queue.shift();
        this.deleteIfEmpty(name, queue);

        return payload;
    }

    private deleteIfEmpty(name: string, queue: FIFOQueue<T>): void {
        if (queue.length === 0) {
            this.queues.delete(name);
        }
    }

    public peek(name: string): T | undefined {
        this.validateName(name);
        const queue = this.find(name);

        if (queue === undefined) {
            return undefined;
        }

        return queue.peek();
    }

    public length(name: string): number {
        this.validateName(name);
        const queue = this.find(name);
        return queue ? queue.length : 0;
    }

    public listQueues(): string[] {
        return Array.from(this.queues.keys());
    }

    public save(): void {
        const events: QueueEvent<T>[] = [];
        for (const [name, queue] of this.queues) {
            for (const item of queue) {
                events.push({ queue: name, payload: item, enqueue: true, dequeue: false });
            }
        }
        this.store.replace(events);
    }

    public load(): void {
        for (const event of this.store.loadState()) {
            this.applyLoadedEvent(event);
        }
        // Rejected payloads occupy FIFO slots until all dequeue events have
        // consumed their original positions. Only then discard survivors.
        // Filtering during enqueue would incorrectly consume valid items.
        for (const [name, queue] of this.queues) {
            queue.retain(isNonNullPayload);
            this.deleteIfEmpty(name, queue);
        }
        this.save();
    }

    private applyLoadedEvent(event: QueueEvent<T>): void {
        try {
            if (event.enqueue) {
                this.applyEnqueue(event.queue, event.payload, "replay");
            } else if (event.dequeue) {
                this.applyDequeue(event.queue, "replay");
            }
        } catch (error) {
            // Match the persist log's silent-skip policy for invalid lines.
            if (!(error instanceof QueueNameTooLongError)) {
                throw error;
            }
        }
    }
}
