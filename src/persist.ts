export default interface Persist {
    append(line: string): void;
    clear(): void;
    load(): string;
    dir(dir: string): void;
}

export class File implements Persist {
    private directory: string = '';

    private get path(): string {
        return this.directory + "persist.dat";
    }

    public append(line: string): void {
        const file = Deno.openSync(this.path, { write: true, create: true, append: true });
        file.lockSync(true);
        try {
            file.writeSync(new TextEncoder().encode(line + "\n"));
        } finally {
            file.unlockSync();
            file.close();
        }
    }

    public clear(): void {
        const file = Deno.openSync(this.path, { write: true, create: true });
        file.lockSync(true);
        try {
            file.truncateSync(0);
        } finally {
            file.unlockSync();
            file.close();
        }
    }

    public load(): string {
        try {
            const file = Deno.openSync(this.path, { read: true });
            file.lockSync(false);
            try {
                const stat = file.statSync();
                const buf = new Uint8Array(stat.size);
                let totalRead = 0;
                while (totalRead < stat.size) {
                    const read = file.readSync(buf.subarray(totalRead));
                    if (read === null || read === 0) break;
                    totalRead += read;
                }
                return new TextDecoder().decode(buf);
            } finally {
                file.unlockSync();
                file.close();
            }
        } catch (_e) {
            if (_e instanceof Deno.errors.NotFound) {
                return "";
            }
            throw _e;
        }
    }

    public dir(dir: string): void {
        this.directory = dir.replace(/\/$/, '') + "/";
    }
}

export class None implements Persist {
    public append(_line: string): void {}

    public clear(): void {}

    public load(): string { return ""; }

    public dir(_dir: string): void {}
}
