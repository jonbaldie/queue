export class RateLimiter {
    private requestTimestamps: Map<string, number[]> = new Map();
    private requestsPerMinute: number;

    constructor(requestsPerMinute: number = 100) {
        this.requestsPerMinute = requestsPerMinute;
    }

    private getClientIp(request: Request): string {
        // Check for x-forwarded-for header first (proxy/CDN)
        const forwardedFor = request.headers.get("x-forwarded-for");
        if (forwardedFor) {
            return forwardedFor.split(",")[0].trim();
        }
        // Fall back to trying to get from request (may not be available in all environments)
        return "unknown";
    }

    public isAllowed(request: Request): boolean {
        const ip = this.getClientIp(request);
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Get or create timestamp list for this IP
        let timestamps = this.requestTimestamps.get(ip) || [];

        // Remove timestamps older than 1 minute
        timestamps = timestamps.filter(ts => ts > oneMinuteAgo);

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
