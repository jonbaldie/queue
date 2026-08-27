import { QueueStore } from "./persist.ts"
export const MAX_QUEUE_NAME_LENGTH = 128;

export class QueueNameTooLongError extends Error {
    constructor() {
        super("Queue name too long");
        this.name = "QueueNameTooLongError";
    }
}

export default class Manager<T = string> {
    private queues: Map<string, Array<T>>;
    private store: QueueStore<T>;
    private queueDepthLimit: number;
    private queueCountLimit: number;

    constructor(store: QueueStore<T>, queueDepthLimit?: number, queueCountLimit?: number) {
        this.store = store;
        this.queues = new Map;
        this.queueDepthLimit = queueDepthLimit ?? 10000;
        this.queueCountLimit = queueCountLimit ?? 1000;
    }

    private register(name: string, queue: Array<T>): Manager<T> {
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

    private find(name: string): Array<T> | undefined {
        return this.queues.get(name);
    }

    public enqueue(name: string, payload: T): Manager<T> {
        this.validateName(name);
        const queue = this.find(name) || [];

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        if (queue.length >= this.queueDepthLimit) {
            throw new Error("Queue depth limit reached");
        }
        queue.push(payload);

        this.store.saveEvent(name, payload, true);

        return this;
    }

    public dequeue(name: string): T | undefined {
        this.validateName(name);
        const queue = this.find(name) || [];

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

        if (payload !== undefined) {
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

        return queue[0];
    }

    public length(name: string): number {
        this.validateName(name);
        const queue = this.find(name) || [];

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
        for (const [name, queue] of this.queues) {
            for (const item of queue) {
                this.store.saveEvent(name, item, true);
            }
        }
    }

    public load(): void {
        const events = this.store.loadState();

        events.forEach((event) => {
            const queue = this.find(event.queue) || [];

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
