import { QueueStore, QueueEvent } from "./persist.ts"
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

    private registered(name: string): boolean {
        return this.queues.has(name);
    }

    public canCreateQueue(): boolean {
        return this.queues.size < this.queueCountLimit;
    }

    public canEnqueue(name: string): boolean {
        this.validateName(name);
        const queue = this.find(name);
        if (!queue) {
            // Creating a new queue - check if we have room
            return this.canCreateQueue();
        }
        // Existing queue - check if it has room
        return queue.length < this.queueDepthLimit;
    }

    private find(name: string): FIFOQueue<T> | undefined {
        return this.queues.get(name);
    }

    public enqueue(name: string, payload: T): Manager<T> {
        this.validateName(name);
        const queue = this.find(name) || new FIFOQueue<T>();

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        if (queue.length >= this.queueDepthLimit) {
            throw new Error("Queue depth limit reached");
        }
        queue.push(payload);

        if (this.persistEnabled) {
            this.store.saveEvent(name, payload, true);
        }

        return this;
    }

    public dequeue(name: string): T | undefined {
        this.validateName(name);
        const queue = this.find(name) || new FIFOQueue<T>();

        const wasRegistered = this.registered(name);

        if (wasRegistered === false) {
            if (!this.canCreateQueue()) {
                return undefined;
            }
            this.register(name, queue);
        }

        const wasNonEmpty = queue.length > 0;
        const payload = queue.shift();

        // Clean up empty queues to prevent memory leak (queue-18u)
        if (wasRegistered && wasNonEmpty && queue.length === 0) {
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
        const queue = this.find(name) || new FIFOQueue<T>();

        if (this.registered(name) === false) {
            if (!this.canCreateQueue()) {
                return 0;
            }
            this.register(name, queue);
        }

        return queue.length;
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
        const events = this.store.loadState();

        events.forEach((event) => {
            const queue = this.find(event.queue) || new FIFOQueue<T>();

            if (this.registered(event.queue) === false) {
                this.register(event.queue, queue);
            }

            if (event.enqueue) {
                if (queue.length >= this.queueDepthLimit) {
                    throw new Error("Queue depth limit reached");
                }
                queue.push(event.payload);
            } else if (event.dequeue) {
                const wasNonEmpty = queue.length > 0;
                queue.shift();

                // Clean up empty queues to prevent memory leak (queue-18u)
                if (this.registered(event.queue) && wasNonEmpty && queue.length === 0) {
                    this.queues.delete(event.queue);
                }
            }
        });

        this.store.clear();
    }
}