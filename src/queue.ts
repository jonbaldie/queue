export default class Queue<T> {
    private messages: Array<string>;

    constructor(messages: Array<string>) {
        this.messages = messages;
    }

    public length(): number {
        return this.messages.length;
    }

    public enqueue(payload: string): void {
        this.messages.push(payload);
    }

    public dequeue(): string | undefined {
        return this.messages.shift();
    }

    public is_empty(): boolean {
        return this.length() === 0;
    }

    public peek(): string | undefined {
        for (let x in this.messages) {
            return x;
        }
    }
}
