export class RateLimiter {
    private requestTimestamps: Map<string, number[]> = new Map();
    private requestsPerMinute: number;
    private windowMs: number;
    private cleanupInterval: number;
    private maxTrackedIPs: number;
    private requestCount: number = 0;

    constructor(requestsPerMinute: number = 100, windowMs: number = 60000, cleanupInterval: number = 100, maxTrackedIPs: number = 10000) {
        this.requestsPerMinute = requestsPerMinute;
        this.windowMs = windowMs;
        this.cleanupInterval = cleanupInterval;
        this.maxTrackedIPs = maxTrackedIPs;
    }

    private getClientIp(request: Request, remoteAddr?: string): string {
        // Check for x-forwarded-for header first (proxy/CDN)
        const forwardedFor = request.headers.get("x-forwarded-for");
        if (forwardedFor) {
            return forwardedFor.split(",")[0].trim();
        }
        // Fall back to connection remote address
        if (remoteAddr) {
            return remoteAddr;
        }
        return "unknown";
    }

    private cleanupStaleEntries(now: number): void {
        const cutoff = now - this.windowMs;
        for (const [ip, timestamps] of this.requestTimestamps) {
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
                this.requestTimestamps.delete(ip);
            } else if (lo > 0) {
                // Some stale, some fresh — keep only the fresh ones
                this.requestTimestamps.set(ip, timestamps.slice(lo));
            }
        }

        if (this.requestTimestamps.size > this.maxTrackedIPs) {
            // Evict IPs with the oldest last-activity (max timestamp).
            // Timestamps are sorted ascending, so the last element is the max —
            // O(1) per comparison instead of O(T) via Math.max(...arr).
            const entries = Array.from(this.requestTimestamps.entries());
            entries.sort((a, b) => {
                const aMax = a[1][a[1].length - 1];
                const bMax = b[1][b[1].length - 1];
                return aMax - bMax;
            });
            const toEvict = this.requestTimestamps.size - this.maxTrackedIPs;
            for (let i = 0; i < toEvict; i++) {
                this.requestTimestamps.delete(entries[i][0]);
            }
        }
    }

    public isAllowed(request: Request, remoteAddr?: string): boolean {
        const ip = this.getClientIp(request, remoteAddr);
        const now = Date.now();
        const cutoff = now - this.windowMs;

        // Periodic cleanup of stale entries across all IPs
        this.requestCount++;
        if (this.requestCount >= this.cleanupInterval) {
            this.requestCount = 0;
            this.cleanupStaleEntries(now);
        }

        // Get or create timestamp list for this IP
        let timestamps = this.requestTimestamps.get(ip) || [];

        // Remove timestamps older than the window
        timestamps = timestamps.filter(ts => ts > cutoff);

        // If all timestamps are stale, remove this IP entry
        if (timestamps.length === 0) {
            this.requestTimestamps.delete(ip);
        }

        // Check if we've exceeded the limit
        if (timestamps.length >= this.requestsPerMinute) {
            return false;
        }

        // Add current timestamp and save
        timestamps.push(now);
        this.requestTimestamps.set(ip, timestamps);

        return true;
    }
}