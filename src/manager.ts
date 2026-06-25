import { QueueStore } from "./persist.ts"
import Queue from "./queue.ts"

export default class Manager<T = string> {
    private queues: Map<string, Queue<T>>;
    private store: QueueStore<T>;
    private queueDepthLimit: number;
    private queueCountLimit: number;

    constructor(store: QueueStore<T>, queueDepthLimit?: number, queueCountLimit?: number) {
        this.store = store;
        this.queues = new Map;
        this.queueDepthLimit = queueDepthLimit ?? 10000;
        this.queueCountLimit = queueCountLimit ?? 1000;
    }

    private register(name: string, queue: Queue<T>): Manager<T> {
        this.queues.set(name, queue);

        return this;
    }

    private registered(name: string): boolean {
        return this.queues.has(name);
    }

    public canCreateQueue(): boolean {
        return this.queues.size < this.queueCountLimit;
    }

    public canEnqueue(name: string): boolean {
        const queue = this.find(name);
        if (!queue) {
            // Creating a new queue - check if we have room
            return this.canCreateQueue();
        }
        // Existing queue - check if it has room
        return queue.hasCapacity();
    }

    private find(name: string): Queue<T> | undefined {
        return this.queues.get(name);
    }

    public enqueue(name: string, payload: T): Manager<T> {
        const queue = this.find(name) || new Queue([], this.queueDepthLimit);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        queue.enqueue(payload);

        this.store.saveEvent(name, payload, true);

        return this;
    }

    public dequeue(name: string): T | undefined {
        const queue = this.find(name) || new Queue([], this.queueDepthLimit);

        const wasRegistered = this.registered(name);

        if (wasRegistered === false) {
            this.register(name, queue);
        }

        const wasNonEmpty = queue.length() > 0;
        const payload = queue.dequeue();

        // Clean up empty queues to prevent memory leak (queue-18u)
        if (wasRegistered && wasNonEmpty && queue.length() === 0) {
            this.queues.delete(name);
        }

        if (payload !== undefined) {
            this.store.saveEvent(name, payload, false);
        }

        return payload;
    }

    public peek(name: string): T | undefined {
        const queue = this.find(name);

        if (queue === undefined) {
            return undefined;
        }

        return queue.peek();
    }

    public length(name: string): number {
        const queue = this.find(name) || new Queue([], this.queueDepthLimit);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        return queue.length();
    }

    public listQueues(): string[] {
        return Array.from(this.queues.keys());
    }

    public save(): void {
        this.store.clear();
        for (const [name, queue] of this.queues) {
            for (const item of queue.all()) {
                this.store.saveEvent(name, item, true);
            }
        }
    }

    public load(): void {
        const events = this.store.loadState();

        events.forEach((event) => {
            const queue = this.find(event.queue) || new Queue([], this.queueDepthLimit);

            if (this.registered(event.queue) === false) {
                this.register(event.queue, queue);
            }

            if (event.enqueue) {
                queue.enqueue(event.payload);
            } else if (event.dequeue) {
                const wasNonEmpty = queue.length() > 0;
                queue.dequeue();

                // Clean up empty queues to prevent memory leak (queue-18u)
                if (this.registered(event.queue) && wasNonEmpty && queue.length() === 0) {
                    this.queues.delete(event.queue);
                }
            }
        });

        this.store.clear();
    }
}
