// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
export class RateLimiter {
  private requestTimestamps: Map<string, number[]> = new Map();
  private requestsPerMinute: number;
  private windowMs: number;
  private cleanupInterval: number;
  private maxTrackedIPs: number;
  private requestCount: number = 0;
  constructor(requestsPerMinute: number = 100, windowMs: number = 60000, cleanupInterval: number = 100, maxTrackedIPs: number = 10000) {
    if (stryMutAct_9fa48("404")) {
      {}
    } else {
      stryCov_9fa48("404");
      this.requestsPerMinute = requestsPerMinute;
      this.windowMs = windowMs;
      this.cleanupInterval = cleanupInterval;
      this.maxTrackedIPs = maxTrackedIPs;
    }
  }
  private getClientIp(request: Request, remoteAddr?: string): string {
    if (stryMutAct_9fa48("405")) {
      {}
    } else {
      stryCov_9fa48("405");
      // Check for x-forwarded-for header first (proxy/CDN)
      const forwardedFor = request.headers.get(stryMutAct_9fa48("406") ? "" : (stryCov_9fa48("406"), "x-forwarded-for"));
      if (stryMutAct_9fa48("408") ? false : stryMutAct_9fa48("407") ? true : (stryCov_9fa48("407", "408"), forwardedFor)) {
        if (stryMutAct_9fa48("409")) {
          {}
        } else {
          stryCov_9fa48("409");
          return stryMutAct_9fa48("410") ? forwardedFor.split(",")[0] : (stryCov_9fa48("410"), forwardedFor.split(stryMutAct_9fa48("411") ? "" : (stryCov_9fa48("411"), ","))[0].trim());
        }
      }
      // Fall back to connection remote address
      if (stryMutAct_9fa48("413") ? false : stryMutAct_9fa48("412") ? true : (stryCov_9fa48("412", "413"), remoteAddr)) {
        if (stryMutAct_9fa48("414")) {
          {}
        } else {
          stryCov_9fa48("414");
          return remoteAddr;
        }
      }
      return stryMutAct_9fa48("415") ? "" : (stryCov_9fa48("415"), "unknown");
    }
  }
  private cleanupStaleEntries(now: number): void {
    if (stryMutAct_9fa48("416")) {
      {}
    } else {
      stryCov_9fa48("416");
      const cutoff = stryMutAct_9fa48("417") ? now + this.windowMs : (stryCov_9fa48("417"), now - this.windowMs);
      for (const [ip, timestamps] of this.requestTimestamps) {
        if (stryMutAct_9fa48("418")) {
          {}
        } else {
          stryCov_9fa48("418");
          const fresh = stryMutAct_9fa48("419") ? timestamps : (stryCov_9fa48("419"), timestamps.filter(stryMutAct_9fa48("420") ? () => undefined : (stryCov_9fa48("420"), ts => stryMutAct_9fa48("424") ? ts <= cutoff : stryMutAct_9fa48("423") ? ts >= cutoff : stryMutAct_9fa48("422") ? false : stryMutAct_9fa48("421") ? true : (stryCov_9fa48("421", "422", "423", "424"), ts > cutoff))));
          if (stryMutAct_9fa48("427") ? fresh.length !== 0 : stryMutAct_9fa48("426") ? false : stryMutAct_9fa48("425") ? true : (stryCov_9fa48("425", "426", "427"), fresh.length === 0)) {
            if (stryMutAct_9fa48("428")) {
              {}
            } else {
              stryCov_9fa48("428");
              this.requestTimestamps.delete(ip);
            }
          } else if (stryMutAct_9fa48("431") ? fresh.length === timestamps.length : stryMutAct_9fa48("430") ? false : stryMutAct_9fa48("429") ? true : (stryCov_9fa48("429", "430", "431"), fresh.length !== timestamps.length)) {
            if (stryMutAct_9fa48("432")) {
              {}
            } else {
              stryCov_9fa48("432");
              this.requestTimestamps.set(ip, fresh);
            }
          }
        }
      }
      if (stryMutAct_9fa48("436") ? this.requestTimestamps.size <= this.maxTrackedIPs : stryMutAct_9fa48("435") ? this.requestTimestamps.size >= this.maxTrackedIPs : stryMutAct_9fa48("434") ? false : stryMutAct_9fa48("433") ? true : (stryCov_9fa48("433", "434", "435", "436"), this.requestTimestamps.size > this.maxTrackedIPs)) {
        if (stryMutAct_9fa48("437")) {
          {}
        } else {
          stryCov_9fa48("437");
          const entries = Array.from(this.requestTimestamps.entries());
          stryMutAct_9fa48("438") ? entries : (stryCov_9fa48("438"), entries.sort((a, b) => {
            if (stryMutAct_9fa48("439")) {
              {}
            } else {
              stryCov_9fa48("439");
              const aMax = stryMutAct_9fa48("440") ? Math.min(...a[1]) : (stryCov_9fa48("440"), Math.max(...a[1]));
              const bMax = stryMutAct_9fa48("441") ? Math.min(...b[1]) : (stryCov_9fa48("441"), Math.max(...b[1]));
              return stryMutAct_9fa48("442") ? aMax + bMax : (stryCov_9fa48("442"), aMax - bMax);
            }
          }));
          const toEvict = stryMutAct_9fa48("443") ? this.requestTimestamps.size + this.maxTrackedIPs : (stryCov_9fa48("443"), this.requestTimestamps.size - this.maxTrackedIPs);
          for (let i = 0; stryMutAct_9fa48("446") ? i >= toEvict : stryMutAct_9fa48("445") ? i <= toEvict : stryMutAct_9fa48("444") ? false : (stryCov_9fa48("444", "445", "446"), i < toEvict); stryMutAct_9fa48("447") ? i-- : (stryCov_9fa48("447"), i++)) {
            if (stryMutAct_9fa48("448")) {
              {}
            } else {
              stryCov_9fa48("448");
              this.requestTimestamps.delete(entries[i][0]);
            }
          }
        }
      }
    }
  }
  public isAllowed(request: Request, remoteAddr?: string): boolean {
    if (stryMutAct_9fa48("449")) {
      {}
    } else {
      stryCov_9fa48("449");
      const ip = this.getClientIp(request, remoteAddr);
      const now = Date.now();
      const cutoff = stryMutAct_9fa48("450") ? now + this.windowMs : (stryCov_9fa48("450"), now - this.windowMs);

      // Periodic cleanup of stale entries across all IPs
      stryMutAct_9fa48("451") ? this.requestCount-- : (stryCov_9fa48("451"), this.requestCount++);
      if (stryMutAct_9fa48("455") ? this.requestCount < this.cleanupInterval : stryMutAct_9fa48("454") ? this.requestCount > this.cleanupInterval : stryMutAct_9fa48("453") ? false : stryMutAct_9fa48("452") ? true : (stryCov_9fa48("452", "453", "454", "455"), this.requestCount >= this.cleanupInterval)) {
        if (stryMutAct_9fa48("456")) {
          {}
        } else {
          stryCov_9fa48("456");
          this.requestCount = 0;
          this.cleanupStaleEntries(now);
        }
      }

      // Get or create timestamp list for this IP
      let timestamps = stryMutAct_9fa48("459") ? this.requestTimestamps.get(ip) && [] : stryMutAct_9fa48("458") ? false : stryMutAct_9fa48("457") ? true : (stryCov_9fa48("457", "458", "459"), this.requestTimestamps.get(ip) || (stryMutAct_9fa48("460") ? ["Stryker was here"] : (stryCov_9fa48("460"), [])));

      // Remove timestamps older than the window
      timestamps = stryMutAct_9fa48("461") ? timestamps : (stryCov_9fa48("461"), timestamps.filter(stryMutAct_9fa48("462") ? () => undefined : (stryCov_9fa48("462"), ts => stryMutAct_9fa48("466") ? ts <= cutoff : stryMutAct_9fa48("465") ? ts >= cutoff : stryMutAct_9fa48("464") ? false : stryMutAct_9fa48("463") ? true : (stryCov_9fa48("463", "464", "465", "466"), ts > cutoff))));

      // If all timestamps are stale, remove this IP entry
      if (stryMutAct_9fa48("469") ? timestamps.length !== 0 : stryMutAct_9fa48("468") ? false : stryMutAct_9fa48("467") ? true : (stryCov_9fa48("467", "468", "469"), timestamps.length === 0)) {
        if (stryMutAct_9fa48("470")) {
          {}
        } else {
          stryCov_9fa48("470");
          this.requestTimestamps.delete(ip);
        }
      }

      // Check if we've exceeded the limit
      if (stryMutAct_9fa48("474") ? timestamps.length < this.requestsPerMinute : stryMutAct_9fa48("473") ? timestamps.length > this.requestsPerMinute : stryMutAct_9fa48("472") ? false : stryMutAct_9fa48("471") ? true : (stryCov_9fa48("471", "472", "473", "474"), timestamps.length >= this.requestsPerMinute)) {
        if (stryMutAct_9fa48("475")) {
          {}
        } else {
          stryCov_9fa48("475");
          return stryMutAct_9fa48("476") ? true : (stryCov_9fa48("476"), false);
        }
      }

      // Add current timestamp and save
      timestamps.push(now);
      this.requestTimestamps.set(ip, timestamps);
      return stryMutAct_9fa48("477") ? false : (stryCov_9fa48("477"), true);
    }
  }
}