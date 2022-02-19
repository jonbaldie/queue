import Persist from "./persist.ts"
import Queue from "./queue.ts"

interface LoadLine {
    queue: string;
    payload: string;
    enqueue: boolean;
    dequeue: boolean;
}

export default class Manager<T> {
    private queues: Map<string, Queue<T>>;
    private persist: Persist;

    constructor(persist: Persist) {
        this.persist = persist;
        this.queues = new Map;
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

    public enqueue(name: string, payload: string): Manager<T> {
        let queue = this.find(name) || new Queue([]);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        queue.enqueue(payload);

        this.persist.append(`{ "queue": "{$name}", "payload": "{$payload}", "enqueue": true, "dequeue": false}`);

        return this;
    }

    public dequeue(name: string): string | undefined {
        let queue = this.find(name) || new Queue([]);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        const payload = queue.dequeue();

        this.persist.append(`{ "queue": "{$name}", "payload": "{$payload}", "enqueue": false, "dequeue": true}`);

        return payload;
    }

    public length(name: string): number {
        let queue = this.find(name) || new Queue([]);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        return queue.length();
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
