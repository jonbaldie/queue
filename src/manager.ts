import Queue from "./queue.ts"

export default class Manager<T> {
    private queues: Map<string, Queue<T>>;

    constructor() {
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

        return this;
    }

    public dequeue(name: string): string | undefined {
        let queue = this.find(name) || new Queue([]);

        if (this.registered(name) === false) {
            this.register(name, queue);
        }

        return queue.dequeue();
    }
}
