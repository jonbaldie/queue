import Persist from "./persist.ts"
import Queue from "./queue.ts"

interface LoadLine {
    queue: string;
    payload: string;
    enqueue: boolean;
    dequeue: boolean;
}

class AsyncMutex {
    private locked = false;
    private waiters: Array<(value?: unknown) => void> = [];

    async lock(): Promise<() => void> {
        while (this.locked) {
            await new Promise(resolve => this.waiters.push(resolve));
        }
        this.locked = true;
        return () => this.unlock();
    }

    private unlock(): void {
        this.locked = false;
        const next = this.waiters.shift();
        if (next) next();
    }
}

export default class Manager<T> {
    private queues: Map<string, Queue<T>>;
    private persist: Persist;
    private mutex: AsyncMutex;

    constructor(persist: Persist) {
        this.persist = persist;
        this.queues = new Map;
        this.mutex = new AsyncMutex();
    }

    private register(name: string, queue: Queue<T>): Manager<T> {
        this.queues.set(name, queue);

        return this;
    }

    private registered(name: string): boolean {
        return this.queues.has(name);
    }

    private find(name: string): Queue<T> | undefined {
        return this.queues.get(name);
    }

    public async enqueue(name: string, payload: string): Promise<void> {
        const unlock = await this.mutex.lock();
        try {
            let queue = this.find(name) || new Queue([]);

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
        } finally {
            unlock();
        }
    }

    public async dequeue(name: string): Promise<string | undefined> {
        const unlock = await this.mutex.lock();
        try {
            let queue = this.find(name) || new Queue([]);

            if (this.registered(name) === false) {
                this.register(name, queue);
            }

            const payload = queue.dequeue();

            this.persist.append(JSON.stringify({
                queue: name,
                payload: payload,
                enqueue: false,
                dequeue: true
            }));

            return payload;
        } finally {
            unlock();
        }
    }

    public async length(name: string): Promise<number> {
        const unlock = await this.mutex.lock();
        try {
            let queue = this.find(name) || new Queue([]);

            if (this.registered(name) === false) {
                this.register(name, queue);
            }

            return queue.length();
        } finally {
            unlock();
        }
    }

    public load(): void {
        const all = this.persist.load().split("\n").filter((line: string) => line.length);

        all.forEach((line: string) => {
            let decoded: LoadLine = JSON.parse(line);
            let queue = this.find(decoded.queue) || new Queue([]);

            if (this.registered(decoded.queue) === false) {
                this.register(decoded.queue, queue);
            }

            if (decoded.enqueue) {
                queue.enqueue(decoded.payload);
            } else if (decoded.dequeue) {
                queue.dequeue();
            }
        });

        this.persist.clear();
    }
}
