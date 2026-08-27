import { QueueEvent, QueueStore } from "./persist.ts"
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
        if (name.length > MAX_QUEUE_NAME_LENGTH) {
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
        this.validateName(name);
        const existing = this.find(name);
        if (!existing && !this.canCreateQueue()) {
            throw new Error("Queue count limit reached");
        }
        const queue = existing || new FIFOQueue<T>();
        if (queue.length >= this.queueDepthLimit) {
            throw new Error("Queue depth limit reached");
        }
        if (!existing) {
            this.register(name, queue);
        }
        queue.push(payload);

        if (this.persistEnabled) {
            this.store.saveEvent(name, payload, true);
        }

        return this;
    }

    public dequeue(name: string): T | undefined {
        this.validateName(name);
        const queue = this.find(name);
        if (!queue) {
            return undefined;
        }

        const wasNonEmpty = queue.length > 0;
        const payload = queue.shift();

        if (wasNonEmpty && queue.length === 0) {
            this.queues.delete(name);
        }

        if (payload !== undefined && this.persistEnabled) {
            this.store.saveEvent(name, payload, false);
        }

        return payload;
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
        this.store.clear();
        const events: QueueEvent<T>[] = [];
        for (const [name, queue] of this.queues) {
            for (const item of queue) {
                events.push({ queue: name, payload: item, enqueue: true, dequeue: false });
            }
        }
        this.store.saveBatch(events);
    }

    public load(): void {
        for (const event of this.store.loadState()) {
            this.applyLoadedEvent(event);
        }
        this.save();
    }

    private applyLoadedEvent(event: QueueEvent<T>): void {
        if (event.enqueue) {
            this.applyLoadedEnqueue(event);
            return;
        }
        if (event.dequeue) {
            this.applyLoadedDequeue(event);
        }
    }

    private applyLoadedEnqueue(event: QueueEvent<T>): void {
        const existing = this.find(event.queue);
        if (!existing && !this.canCreateQueue()) {
            return;
        }
        const queue = existing || new FIFOQueue<T>();
        if (queue.length >= this.queueDepthLimit) {
            return;
        }
        if (!existing) {
            this.register(event.queue, queue);
        }
        queue.push(event.payload);
    }

    private applyLoadedDequeue(event: QueueEvent<T>): void {
        const queue = this.find(event.queue);
        if (!queue) {
            return;
        }
        const wasNonEmpty = queue.length > 0;
        queue.shift();
        if (wasNonEmpty && queue.length === 0) {
            this.queues.delete(event.queue);
        }
    }
}