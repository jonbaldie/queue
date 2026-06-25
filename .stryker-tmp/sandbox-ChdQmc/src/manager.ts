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
import Persist from "./persist.ts";
import Queue from "./queue.ts";
interface LoadLine<T> {
  queue: string;
  payload: T;
  enqueue: boolean;
  dequeue: boolean;
}
export default class Manager<T = string> {
  private queues: Map<string, Queue<T>>;
  private persist: Persist;
  private queueDepthLimit: number;
  private queueCountLimit: number;
  constructor(persist: Persist, queueDepthLimit?: number, queueCountLimit?: number) {
    if (stryMutAct_9fa48("228")) {
      {}
    } else {
      stryCov_9fa48("228");
      this.persist = persist;
      this.queues = new Map();
      this.queueDepthLimit = stryMutAct_9fa48("229") ? queueDepthLimit && 10000 : (stryCov_9fa48("229"), queueDepthLimit ?? 10000);
      this.queueCountLimit = stryMutAct_9fa48("230") ? queueCountLimit && 1000 : (stryCov_9fa48("230"), queueCountLimit ?? 1000);
    }
  }
  private register(name: string, queue: Queue<T>): Manager<T> {
    if (stryMutAct_9fa48("231")) {
      {}
    } else {
      stryCov_9fa48("231");
      this.queues.set(name, queue);
      return this;
    }
  }
  private registered(name: string): boolean {
    if (stryMutAct_9fa48("232")) {
      {}
    } else {
      stryCov_9fa48("232");
      return this.queues.has(name);
    }
  }
  public canCreateQueue(): boolean {
    if (stryMutAct_9fa48("233")) {
      {}
    } else {
      stryCov_9fa48("233");
      return stryMutAct_9fa48("237") ? this.queues.size >= this.queueCountLimit : stryMutAct_9fa48("236") ? this.queues.size <= this.queueCountLimit : stryMutAct_9fa48("235") ? false : stryMutAct_9fa48("234") ? true : (stryCov_9fa48("234", "235", "236", "237"), this.queues.size < this.queueCountLimit);
    }
  }
  public canEnqueue(name: string): boolean {
    if (stryMutAct_9fa48("238")) {
      {}
    } else {
      stryCov_9fa48("238");
      const queue = this.find(name);
      if (stryMutAct_9fa48("241") ? false : stryMutAct_9fa48("240") ? true : stryMutAct_9fa48("239") ? queue : (stryCov_9fa48("239", "240", "241"), !queue)) {
        if (stryMutAct_9fa48("242")) {
          {}
        } else {
          stryCov_9fa48("242");
          // Creating a new queue - check if we have room
          return this.canCreateQueue();
        }
      }
      // Existing queue - check if it has room
      return stryMutAct_9fa48("246") ? queue.length() >= this.queueDepthLimit : stryMutAct_9fa48("245") ? queue.length() <= this.queueDepthLimit : stryMutAct_9fa48("244") ? false : stryMutAct_9fa48("243") ? true : (stryCov_9fa48("243", "244", "245", "246"), queue.length() < this.queueDepthLimit);
    }
  }
  private find(name: string): Queue<T> | undefined {
    if (stryMutAct_9fa48("247")) {
      {}
    } else {
      stryCov_9fa48("247");
      return this.queues.get(name);
    }
  }
  public enqueue(name: string, payload: T): Manager<T> {
    if (stryMutAct_9fa48("248")) {
      {}
    } else {
      stryCov_9fa48("248");
      const queue = stryMutAct_9fa48("251") ? this.find(name) && new Queue([]) : stryMutAct_9fa48("250") ? false : stryMutAct_9fa48("249") ? true : (stryCov_9fa48("249", "250", "251"), this.find(name) || new Queue(stryMutAct_9fa48("252") ? ["Stryker was here"] : (stryCov_9fa48("252"), [])));
      if (stryMutAct_9fa48("255") ? this.registered(name) !== false : stryMutAct_9fa48("254") ? false : stryMutAct_9fa48("253") ? true : (stryCov_9fa48("253", "254", "255"), this.registered(name) === (stryMutAct_9fa48("256") ? true : (stryCov_9fa48("256"), false)))) {
        if (stryMutAct_9fa48("257")) {
          {}
        } else {
          stryCov_9fa48("257");
          this.register(name, queue);
        }
      }
      queue.enqueue(payload);
      this.persist.append(JSON.stringify(stryMutAct_9fa48("258") ? {} : (stryCov_9fa48("258"), {
        queue: name,
        payload: payload,
        enqueue: stryMutAct_9fa48("259") ? false : (stryCov_9fa48("259"), true),
        dequeue: stryMutAct_9fa48("260") ? true : (stryCov_9fa48("260"), false)
      })));
      return this;
    }
  }
  public dequeue(name: string): T | undefined {
    if (stryMutAct_9fa48("261")) {
      {}
    } else {
      stryCov_9fa48("261");
      const queue = stryMutAct_9fa48("264") ? this.find(name) && new Queue([]) : stryMutAct_9fa48("263") ? false : stryMutAct_9fa48("262") ? true : (stryCov_9fa48("262", "263", "264"), this.find(name) || new Queue(stryMutAct_9fa48("265") ? ["Stryker was here"] : (stryCov_9fa48("265"), [])));
      const wasRegistered = this.registered(name);
      if (stryMutAct_9fa48("268") ? wasRegistered !== false : stryMutAct_9fa48("267") ? false : stryMutAct_9fa48("266") ? true : (stryCov_9fa48("266", "267", "268"), wasRegistered === (stryMutAct_9fa48("269") ? true : (stryCov_9fa48("269"), false)))) {
        if (stryMutAct_9fa48("270")) {
          {}
        } else {
          stryCov_9fa48("270");
          this.register(name, queue);
        }
      }
      const wasNonEmpty = stryMutAct_9fa48("274") ? queue.length() <= 0 : stryMutAct_9fa48("273") ? queue.length() >= 0 : stryMutAct_9fa48("272") ? false : stryMutAct_9fa48("271") ? true : (stryCov_9fa48("271", "272", "273", "274"), queue.length() > 0);
      const payload = queue.dequeue();

      // Clean up empty queues to prevent memory leak (queue-18u)
      if (stryMutAct_9fa48("277") ? wasRegistered && wasNonEmpty || queue.length() === 0 : stryMutAct_9fa48("276") ? false : stryMutAct_9fa48("275") ? true : (stryCov_9fa48("275", "276", "277"), (stryMutAct_9fa48("279") ? wasRegistered || wasNonEmpty : stryMutAct_9fa48("278") ? true : (stryCov_9fa48("278", "279"), wasRegistered && wasNonEmpty)) && (stryMutAct_9fa48("281") ? queue.length() !== 0 : stryMutAct_9fa48("280") ? true : (stryCov_9fa48("280", "281"), queue.length() === 0)))) {
        if (stryMutAct_9fa48("282")) {
          {}
        } else {
          stryCov_9fa48("282");
          this.queues.delete(name);
        }
      }
      if (stryMutAct_9fa48("285") ? payload === undefined : stryMutAct_9fa48("284") ? false : stryMutAct_9fa48("283") ? true : (stryCov_9fa48("283", "284", "285"), payload !== undefined)) {
        if (stryMutAct_9fa48("286")) {
          {}
        } else {
          stryCov_9fa48("286");
          this.persist.append(JSON.stringify(stryMutAct_9fa48("287") ? {} : (stryCov_9fa48("287"), {
            queue: name,
            payload: payload,
            enqueue: stryMutAct_9fa48("288") ? true : (stryCov_9fa48("288"), false),
            dequeue: stryMutAct_9fa48("289") ? false : (stryCov_9fa48("289"), true)
          })));
        }
      }
      return payload;
    }
  }
  public peek(name: string): T | undefined {
    if (stryMutAct_9fa48("290")) {
      {}
    } else {
      stryCov_9fa48("290");
      const queue = this.find(name);
      if (stryMutAct_9fa48("293") ? queue !== undefined : stryMutAct_9fa48("292") ? false : stryMutAct_9fa48("291") ? true : (stryCov_9fa48("291", "292", "293"), queue === undefined)) {
        if (stryMutAct_9fa48("294")) {
          {}
        } else {
          stryCov_9fa48("294");
          return undefined;
        }
      }
      return queue.peek();
    }
  }
  public length(name: string): number {
    if (stryMutAct_9fa48("295")) {
      {}
    } else {
      stryCov_9fa48("295");
      const queue = stryMutAct_9fa48("298") ? this.find(name) && new Queue([]) : stryMutAct_9fa48("297") ? false : stryMutAct_9fa48("296") ? true : (stryCov_9fa48("296", "297", "298"), this.find(name) || new Queue(stryMutAct_9fa48("299") ? ["Stryker was here"] : (stryCov_9fa48("299"), [])));
      if (stryMutAct_9fa48("302") ? this.registered(name) !== false : stryMutAct_9fa48("301") ? false : stryMutAct_9fa48("300") ? true : (stryCov_9fa48("300", "301", "302"), this.registered(name) === (stryMutAct_9fa48("303") ? true : (stryCov_9fa48("303"), false)))) {
        if (stryMutAct_9fa48("304")) {
          {}
        } else {
          stryCov_9fa48("304");
          this.register(name, queue);
        }
      }
      return queue.length();
    }
  }
  public listQueues(): string[] {
    if (stryMutAct_9fa48("305")) {
      {}
    } else {
      stryCov_9fa48("305");
      return Array.from(this.queues.keys());
    }
  }
  public save(): void {
    if (stryMutAct_9fa48("306")) {
      {}
    } else {
      stryCov_9fa48("306");
      this.persist.clear();
      for (const [name, queue] of this.queues) {
        if (stryMutAct_9fa48("307")) {
          {}
        } else {
          stryCov_9fa48("307");
          for (const item of queue.all()) {
            if (stryMutAct_9fa48("308")) {
              {}
            } else {
              stryCov_9fa48("308");
              this.persist.append(JSON.stringify(stryMutAct_9fa48("309") ? {} : (stryCov_9fa48("309"), {
                queue: name,
                payload: item,
                enqueue: stryMutAct_9fa48("310") ? false : (stryCov_9fa48("310"), true),
                dequeue: stryMutAct_9fa48("311") ? true : (stryCov_9fa48("311"), false)
              })));
            }
          }
        }
      }
    }
  }
  public load(): void {
    if (stryMutAct_9fa48("312")) {
      {}
    } else {
      stryCov_9fa48("312");
      const all = stryMutAct_9fa48("313") ? this.persist.load().split("\n") : (stryCov_9fa48("313"), this.persist.load().split(stryMutAct_9fa48("314") ? "" : (stryCov_9fa48("314"), "\n")).filter(stryMutAct_9fa48("315") ? () => undefined : (stryCov_9fa48("315"), (line: string) => line.length)));
      all.forEach((line: string) => {
        if (stryMutAct_9fa48("316")) {
          {}
        } else {
          stryCov_9fa48("316");
          const decoded: LoadLine<T> = JSON.parse(line);
          const queue = stryMutAct_9fa48("319") ? this.find(decoded.queue) && new Queue([]) : stryMutAct_9fa48("318") ? false : stryMutAct_9fa48("317") ? true : (stryCov_9fa48("317", "318", "319"), this.find(decoded.queue) || new Queue(stryMutAct_9fa48("320") ? ["Stryker was here"] : (stryCov_9fa48("320"), [])));
          if (stryMutAct_9fa48("323") ? this.registered(decoded.queue) !== false : stryMutAct_9fa48("322") ? false : stryMutAct_9fa48("321") ? true : (stryCov_9fa48("321", "322", "323"), this.registered(decoded.queue) === (stryMutAct_9fa48("324") ? true : (stryCov_9fa48("324"), false)))) {
            if (stryMutAct_9fa48("325")) {
              {}
            } else {
              stryCov_9fa48("325");
              this.register(decoded.queue, queue);
            }
          }
          if (stryMutAct_9fa48("327") ? false : stryMutAct_9fa48("326") ? true : (stryCov_9fa48("326", "327"), decoded.enqueue)) {
            if (stryMutAct_9fa48("328")) {
              {}
            } else {
              stryCov_9fa48("328");
              queue.enqueue(decoded.payload);
            }
          } else if (stryMutAct_9fa48("330") ? false : stryMutAct_9fa48("329") ? true : (stryCov_9fa48("329", "330"), decoded.dequeue)) {
            if (stryMutAct_9fa48("331")) {
              {}
            } else {
              stryCov_9fa48("331");
              const wasNonEmpty = stryMutAct_9fa48("335") ? queue.length() <= 0 : stryMutAct_9fa48("334") ? queue.length() >= 0 : stryMutAct_9fa48("333") ? false : stryMutAct_9fa48("332") ? true : (stryCov_9fa48("332", "333", "334", "335"), queue.length() > 0);
              queue.dequeue();

              // Clean up empty queues to prevent memory leak (queue-18u)
              if (stryMutAct_9fa48("338") ? this.registered(decoded.queue) && wasNonEmpty || queue.length() === 0 : stryMutAct_9fa48("337") ? false : stryMutAct_9fa48("336") ? true : (stryCov_9fa48("336", "337", "338"), (stryMutAct_9fa48("340") ? this.registered(decoded.queue) || wasNonEmpty : stryMutAct_9fa48("339") ? true : (stryCov_9fa48("339", "340"), this.registered(decoded.queue) && wasNonEmpty)) && (stryMutAct_9fa48("342") ? queue.length() !== 0 : stryMutAct_9fa48("341") ? true : (stryCov_9fa48("341", "342"), queue.length() === 0)))) {
                if (stryMutAct_9fa48("343")) {
                  {}
                } else {
                  stryCov_9fa48("343");
                  this.queues.delete(decoded.queue);
                }
              }
            }
          }
        }
      });
      this.persist.clear();
    }
  }
}