export default interface Persist {
    append(line: string): void;
    clear(): void;
    load(): string;
    dir(dir: string): void;
}

export class File implements Persist {
    private directory: string = '';

    public append(line: string): void {
        Deno.writeFileSync(this.directory + "persist.dat", new TextEncoder().encode(line + "\n"), {append: true});
    }

    public clear(): void {
        Deno.truncateSync(this.directory + "persist.dat");
    }

    public load(): string {
        return new TextDecoder().decode(Deno.readFileSync(this.directory + "persist.dat"));
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
