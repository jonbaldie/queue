export default interface Persist {
    append(line: string): void;
    clear(): void;
    load(): string;
    dir(dir: string): void;
}

class Mutex {
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

export class File implements Persist {
    private directory: string = '';
    private mutex = new Mutex();

    public append(line: string): void {
        const path = this.directory + "persist.dat";
        try {
            Deno.writeFileSync(path, new TextEncoder().encode(line + "\n"), {append: true});
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to append to persist.dat: ${msg}`);
        }
    }

    public clear(): void {
        const path = this.directory + "persist.dat";
        try {
            Deno.writeFileSync(path, new Uint8Array());
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to clear persist.dat: ${msg}`);
        }
    }

    public load(): string {
        const path = this.directory + "persist.dat";
        try {
            return new TextDecoder().decode(Deno.readFileSync(path));
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                return "";
            }
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to load from persist.dat: ${msg}`);
        }
    }

    public dir(dir: string): void {
        this.directory = dir.replace(/\/$/, '') + "/";
    }
}

export class None implements Persist {
    public append(line: string): void {}

    public clear(): void {}

    public load(): string { return ""; }

    public dir(dir: string): void {}
}
