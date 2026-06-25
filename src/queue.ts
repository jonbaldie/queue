export default class Queue<T = string> {
    private messages: Array<T>;
    private depthLimit?: number;

    constructor(messages: [], depthLimit?: number);
    constructor(messages: Array<T>, depthLimit?: number);
    constructor(messages: Array<T> | [], depthLimit?: number) {
        this.messages = messages as Array<T>;
        this.depthLimit = depthLimit;
    }

    public length(): number {
        return this.messages.length;
    }

    public hasCapacity(): boolean {
        if (this.depthLimit === undefined) {
            return true;
        }
        return this.messages.length < this.depthLimit;
    }

    public enqueue(payload: T): void {
        if (this.depthLimit !== undefined && this.messages.length >= this.depthLimit) {
            throw new Error("Queue depth limit reached");
        }
        this.messages.push(payload);
    }

    public dequeue(): T | undefined {
        return this.messages.shift();
    }

    public is_empty(): boolean {
        return this.length() === 0;
    }

    public peek(): T | undefined {
        return this.messages[0];
    }

    public all(): Array<T> {
        return [...this.messages];
    }
}
