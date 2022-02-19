export default interface Persist {
    append(line: string): void;
    clear(): void;
    load(): string;
}

export class File implements Persist {
    public append(line: string): void {
        Deno.writeFileSync("persist.dat", new TextEncoder().encode(line), {append: true});
    }

    public clear(): void {
        Deno.truncateSync("persist.dat");
    }

    public load(): string {
        return new TextDecoder().decode(Deno.readFileSync("persist.dat"));
    }
}

export class None implements Persist {
    public append(line: string): void {}

    public clear(): void {}

    public load(): string { return ""; }
}
