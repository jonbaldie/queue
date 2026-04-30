export default class Queue<T = string> {
    private messages: Array<T>;

    constructor(messages: []);
    constructor(messages: Array<T>);
    constructor(messages: Array<T> | []) {
        this.messages = messages as Array<T>;
    }

    public length(): number {
        return this.messages.length;
    }

    public enqueue(payload: T): void {
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
