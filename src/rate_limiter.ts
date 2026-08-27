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
        if (remoteAddr) {
            return remoteAddr;
        }
        const forwardedFor = request.headers.get("x-forwarded-for");
        if (forwardedFor) {
            return forwardedFor.split(",")[0].trim();
        }
        return "unknown";
    }

    private cleanupStaleEntries(now: number): void {
        const cutoff = now - this.windowMs;
        for (const [ip, timestamps] of this.requestTimestamps) {
            const fresh = timestamps.filter(ts => ts > cutoff);
            if (fresh.length === 0) {
                this.requestTimestamps.delete(ip);
            } else if (fresh.length !== timestamps.length) {
                this.requestTimestamps.set(ip, fresh);
            }
        }

        if (this.requestTimestamps.size > this.maxTrackedIPs) {
            const entries = Array.from(this.requestTimestamps.entries());
            entries.sort((a, b) => {
                const aMax = Math.max(...a[1]);
                const bMax = Math.max(...b[1]);
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
