import { QueueEvent, QueueStore } from "./persist.ts"
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
        const queue = this.find(name);
        if (!queue) {
            return undefined;
        }

        const wasNonEmpty = queue.length > 0;
        const payload = queue.shift();

        if (wasNonEmpty && queue.length === 0) {
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
        const queue = this.find(name);
        return queue ? queue.length : 0;
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
        for (const event of this.store.loadState()) {
            this.applyLoadedEvent(event);
        }
        this.store.clear();
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
        const queue = existing || [];
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
