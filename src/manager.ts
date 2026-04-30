import Persist from "./persist.ts"
import Queue from "./queue.ts"

interface LoadLine<T> {
    queue: string;
    payload: T;
    enqueue: boolean;
    dequeue: boolean;
}

export default class Manager<T = string> {
    private queues: Map<string, Queue<T>>;
    private persist: Persist;
    private queueDepthLimit: number;
    private queueCountLimit: number;

    constructor(persist: Persist, queueDepthLimit?: number, queueCountLimit?: number) {
        this.persist = persist;
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
        return queue.length() < this.queueDepthLimit;
    }

    private find(name: string): Queue<T> | undefined {
        return this.queues.get(name);
    }

    public enqueue(name: string, payload: T): Manager<T> {
        const queue = this.find(name) || new Queue([]);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        queue.enqueue(payload);

        this.persist.append(JSON.stringify({
            queue: name,
            payload: payload,
            enqueue: true,
            dequeue: false
        }));

        return this;
    }

    public dequeue(name: string): T | undefined {
        const queue = this.find(name) || new Queue([]);

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

        this.persist.append(JSON.stringify({
            queue: name,
            payload: payload,
            enqueue: false,
            dequeue: true
        }));

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
        const queue = this.find(name) || new Queue([]);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        return queue.length();
    }

    public listQueues(): string[] {
        return Array.from(this.queues.keys());
    }

    public load(): void {
        const all = this.persist.load().split("\n").filter((line: string) => line.length);

        all.forEach((line: string) => {
            const decoded: LoadLine<T> = JSON.parse(line);
            const queue = this.find(decoded.queue) || new Queue([]);

            if (this.registered(decoded.queue) === false) {
                this.register(decoded.queue, queue);
            }

            if (decoded.enqueue) {
                queue.enqueue(decoded.payload);
            } else if (decoded.dequeue) {
                const wasNonEmpty = queue.length() > 0;
                queue.dequeue();

                // Clean up empty queues to prevent memory leak (queue-18u)
                if (this.registered(decoded.queue) && wasNonEmpty && queue.length() === 0) {
                    this.queues.delete(decoded.queue);
                }
            }
        });

        this.persist.clear();
    }
}
