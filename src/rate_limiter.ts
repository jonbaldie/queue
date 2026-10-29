export class RateLimiter {
    private requestTimestamps: Map<string, number[]> = new Map();
    private requestsPerMinute: number;
    private windowMs: number;
    private cleanupInterval: number;
    private maxTrackedKeys: number;
    private requestCount: number = 0;

    constructor(requestsPerMinute: number = 100, windowMs: number = 60000, cleanupInterval: number = 100, maxTrackedKeys: number = 10000) {
        this.requestsPerMinute = requestsPerMinute;
        this.windowMs = windowMs;
        this.cleanupInterval = cleanupInterval;
        this.maxTrackedKeys = maxTrackedKeys;
    }

    // Stored keys may include stale entries until a sweep occurs.
    public get trackedKeysCount(): number {
        return this.requestTimestamps.size;
    }

    private cleanupStaleEntries(now: number): void {
        const cutoff = now - this.windowMs;
        for (const [key, timestamps] of this.requestTimestamps) {
            // Fast path: timestamps are sorted ascending, so if the oldest
            // (first) is still fresh, all are fresh — skip without scanning.
            if (timestamps.length === 0 || timestamps[0] > cutoff) {
                continue;
            }
            // Binary search for the first fresh timestamp (array is sorted ascending)
            let lo = 0, hi = timestamps.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (timestamps[mid] > cutoff) {
                    hi = mid;
                } else {
                    lo = mid + 1;
                }
            }
            // lo is the index of the first fresh timestamp
            if (lo === timestamps.length) {
                // All stale
                this.requestTimestamps.delete(key);
            } else if (lo > 0) {
                // Some stale, some fresh — keep only the fresh ones
                this.requestTimestamps.set(key, timestamps.slice(lo));
            }
        }

        if (this.requestTimestamps.size > this.maxTrackedKeys) {
            // Evict keys with the oldest last-activity (max timestamp).
            // Timestamps are sorted ascending, so the last element is the max —
            // O(1) per comparison instead of O(T) via Math.max(...arr).
            const entries = Array.from(this.requestTimestamps.entries());
            entries.sort((a, b) => {
                const aMax = a[1][a[1].length - 1];
                const bMax = b[1][b[1].length - 1];
                return aMax - bMax;
            });
            const toEvict = this.requestTimestamps.size - this.maxTrackedKeys;
            for (let i = 0; i < toEvict; i++) {
                this.requestTimestamps.delete(entries[i][0]);
            }
        }
    }

    // Index of the first timestamp still inside the window (ts > cutoff).
    // Timestamps are sorted ascending, so stale entries always form a prefix.
    private firstFreshIndex(timestamps: number[], cutoff: number): number {
        let lo = 0, hi = timestamps.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (timestamps[mid] > cutoff) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        return lo;
    }

    // Injected times must be nondecreasing to keep timestamps ordered.
    public isAllowed(key: string, now: number = Date.now()): boolean {
        const cutoff = now - this.windowMs;

        // Periodic cleanup of stale entries across all keys
        this.requestCount++;
        if (this.requestCount >= this.cleanupInterval) {
            this.requestCount = 0;
            this.cleanupStaleEntries(now);
        }

        // Get or create timestamp list for this key
        let timestamps = this.requestTimestamps.get(key) || [];

        // Fast path: the newest timestamp is fresh → nothing stale, O(1).
        // Otherwise binary search the first fresh timestamp — O(log n) — and
        // count the window without filtering or copying it.
        const firstFresh = timestamps.length > 0 && timestamps[0] <= cutoff
            ? this.firstFreshIndex(timestamps, cutoff)
            : 0;
        const freshCount = timestamps.length - firstFresh;

        if (freshCount === 0) {
            // All timestamps are stale — remove this key entry
            this.requestTimestamps.delete(key);
            timestamps = [];
        } else if (firstFresh > 0 && firstFresh * 2 >= timestamps.length) {
            // Drop the stale prefix only once it dominates the array, so the
            // copy stays amortized O(1) per recorded request
            timestamps = timestamps.slice(firstFresh);
        }

        // Check if we've exceeded the limit
        if (freshCount >= this.requestsPerMinute) {
            return false;
        }

        // Add current timestamp and save
        timestamps.push(now);
        this.requestTimestamps.set(key, timestamps);

        return true;
    }
}