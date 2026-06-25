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
import QueueManager from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";
const MAX_BODY_SIZE = stryMutAct_9fa48("0") ? 1024 / 1024 : (stryCov_9fa48("0"), 1024 * 1024); // 1 MB
const MAX_QUEUE_NAME_LENGTH = 128;
const enqueuePattern = new URLPattern(stryMutAct_9fa48("1") ? {} : (stryCov_9fa48("1"), {
  pathname: stryMutAct_9fa48("2") ? "" : (stryCov_9fa48("2"), "/enqueue/:queue")
}));
const dequeuePattern = new URLPattern(stryMutAct_9fa48("3") ? {} : (stryCov_9fa48("3"), {
  pathname: stryMutAct_9fa48("4") ? "" : (stryCov_9fa48("4"), "/dequeue/:queue")
}));
const peekPattern = new URLPattern(stryMutAct_9fa48("5") ? {} : (stryCov_9fa48("5"), {
  pathname: stryMutAct_9fa48("6") ? "" : (stryCov_9fa48("6"), "/peek/:queue")
}));
const lengthPattern = new URLPattern(stryMutAct_9fa48("7") ? {} : (stryCov_9fa48("7"), {
  pathname: stryMutAct_9fa48("8") ? "" : (stryCov_9fa48("8"), "/length/:queue")
}));
const healthPattern = new URLPattern(stryMutAct_9fa48("9") ? {} : (stryCov_9fa48("9"), {
  pathname: stryMutAct_9fa48("10") ? "" : (stryCov_9fa48("10"), "/health")
}));
const queuesPattern = new URLPattern(stryMutAct_9fa48("11") ? {} : (stryCov_9fa48("11"), {
  pathname: stryMutAct_9fa48("12") ? "" : (stryCov_9fa48("12"), "/queues")
}));
export function createHandler(mgr: QueueManager<string>, apiToken: string, rateLimitRequests?: number) {
  if (stryMutAct_9fa48("13")) {
    {}
  } else {
    stryCov_9fa48("13");
    const rateLimiter = new RateLimiter(stryMutAct_9fa48("14") ? rateLimitRequests && 100 : (stryCov_9fa48("14"), rateLimitRequests ?? 100));
    const innerHandler = async function (request: Request, remoteAddr?: string): Promise<Response> {
      if (stryMutAct_9fa48("15")) {
        {}
      } else {
        stryCov_9fa48("15");
        const url = request.url;
        if (stryMutAct_9fa48("17") ? false : stryMutAct_9fa48("16") ? true : (stryCov_9fa48("16", "17"), healthPattern.exec(url))) {
          if (stryMutAct_9fa48("18")) {
            {}
          } else {
            stryCov_9fa48("18");
            if (stryMutAct_9fa48("21") ? request.method === "GET" : stryMutAct_9fa48("20") ? false : stryMutAct_9fa48("19") ? true : (stryCov_9fa48("19", "20", "21"), request.method !== (stryMutAct_9fa48("22") ? "" : (stryCov_9fa48("22"), "GET")))) {
              if (stryMutAct_9fa48("23")) {
                {}
              } else {
                stryCov_9fa48("23");
                return new Response(stryMutAct_9fa48("24") ? "" : (stryCov_9fa48("24"), "Method not allowed"), stryMutAct_9fa48("25") ? {} : (stryCov_9fa48("25"), {
                  status: 405
                }));
              }
            }
            return new Response(JSON.stringify(stryMutAct_9fa48("26") ? {} : (stryCov_9fa48("26"), {
              status: stryMutAct_9fa48("27") ? "" : (stryCov_9fa48("27"), "ok")
            })), stryMutAct_9fa48("28") ? {} : (stryCov_9fa48("28"), {
              status: 200,
              headers: stryMutAct_9fa48("29") ? {} : (stryCov_9fa48("29"), {
                "Content-Type": stryMutAct_9fa48("30") ? "" : (stryCov_9fa48("30"), "application/json")
              })
            }));
          }
        }

        // Check rate limit after health check (health is exempt)
        if (stryMutAct_9fa48("33") ? false : stryMutAct_9fa48("32") ? true : stryMutAct_9fa48("31") ? rateLimiter.isAllowed(request, remoteAddr) : (stryCov_9fa48("31", "32", "33"), !rateLimiter.isAllowed(request, remoteAddr))) {
          if (stryMutAct_9fa48("34")) {
            {}
          } else {
            stryCov_9fa48("34");
            return new Response(stryMutAct_9fa48("35") ? "" : (stryCov_9fa48("35"), "Too many requests"), stryMutAct_9fa48("36") ? {} : (stryCov_9fa48("36"), {
              status: 429
            }));
          }
        }
        const authHeader = request.headers.get(stryMutAct_9fa48("37") ? "" : (stryCov_9fa48("37"), "Authorization"));
        if (stryMutAct_9fa48("40") ? !authHeader && authHeader !== `Bearer ${apiToken}` : stryMutAct_9fa48("39") ? false : stryMutAct_9fa48("38") ? true : (stryCov_9fa48("38", "39", "40"), (stryMutAct_9fa48("41") ? authHeader : (stryCov_9fa48("41"), !authHeader)) || (stryMutAct_9fa48("43") ? authHeader === `Bearer ${apiToken}` : stryMutAct_9fa48("42") ? false : (stryCov_9fa48("42", "43"), authHeader !== (stryMutAct_9fa48("44") ? `` : (stryCov_9fa48("44"), `Bearer ${apiToken}`)))))) {
          if (stryMutAct_9fa48("45")) {
            {}
          } else {
            stryCov_9fa48("45");
            return new Response(stryMutAct_9fa48("46") ? "" : (stryCov_9fa48("46"), "Unauthorized"), stryMutAct_9fa48("47") ? {} : (stryCov_9fa48("47"), {
              status: 401
            }));
          }
        }
        const isEnqueue = enqueuePattern.exec(url);
        const isDequeue = dequeuePattern.exec(url);
        const isPeek = peekPattern.exec(url);
        const isLength = lengthPattern.exec(url);
        const isQueues = queuesPattern.exec(url);
        if (stryMutAct_9fa48("49") ? false : stryMutAct_9fa48("48") ? true : (stryCov_9fa48("48", "49"), isQueues)) {
          if (stryMutAct_9fa48("50")) {
            {}
          } else {
            stryCov_9fa48("50");
            if (stryMutAct_9fa48("53") ? request.method === "GET" : stryMutAct_9fa48("52") ? false : stryMutAct_9fa48("51") ? true : (stryCov_9fa48("51", "52", "53"), request.method !== (stryMutAct_9fa48("54") ? "" : (stryCov_9fa48("54"), "GET")))) {
              if (stryMutAct_9fa48("55")) {
                {}
              } else {
                stryCov_9fa48("55");
                return new Response(stryMutAct_9fa48("56") ? "" : (stryCov_9fa48("56"), "Method not allowed"), stryMutAct_9fa48("57") ? {} : (stryCov_9fa48("57"), {
                  status: 405
                }));
              }
            }
            const queueNames = mgr.listQueues();
            return new Response(JSON.stringify(queueNames), stryMutAct_9fa48("58") ? {} : (stryCov_9fa48("58"), {
              status: 200,
              headers: stryMutAct_9fa48("59") ? {} : (stryCov_9fa48("59"), {
                "Content-Type": stryMutAct_9fa48("60") ? "" : (stryCov_9fa48("60"), "application/json")
              })
            }));
          }
        }
        if (stryMutAct_9fa48("62") ? false : stryMutAct_9fa48("61") ? true : (stryCov_9fa48("61", "62"), isEnqueue)) {
          if (stryMutAct_9fa48("63")) {
            {}
          } else {
            stryCov_9fa48("63");
            if (stryMutAct_9fa48("66") ? request.method === "POST" : stryMutAct_9fa48("65") ? false : stryMutAct_9fa48("64") ? true : (stryCov_9fa48("64", "65", "66"), request.method !== (stryMutAct_9fa48("67") ? "" : (stryCov_9fa48("67"), "POST")))) {
              if (stryMutAct_9fa48("68")) {
                {}
              } else {
                stryCov_9fa48("68");
                return new Response(stryMutAct_9fa48("69") ? "" : (stryCov_9fa48("69"), "Method not allowed"), stryMutAct_9fa48("70") ? {} : (stryCov_9fa48("70"), {
                  status: 405
                }));
              }
            }
            const queueName = isEnqueue.pathname.groups.queue as string;
            if (stryMutAct_9fa48("74") ? queueName.length <= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("73") ? queueName.length >= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("72") ? false : stryMutAct_9fa48("71") ? true : (stryCov_9fa48("71", "72", "73", "74"), queueName.length > MAX_QUEUE_NAME_LENGTH)) {
              if (stryMutAct_9fa48("75")) {
                {}
              } else {
                stryCov_9fa48("75");
                return new Response(stryMutAct_9fa48("76") ? "" : (stryCov_9fa48("76"), "Queue name too long"), stryMutAct_9fa48("77") ? {} : (stryCov_9fa48("77"), {
                  status: 400
                }));
              }
            }
            if (stryMutAct_9fa48("80") ? false : stryMutAct_9fa48("79") ? true : stryMutAct_9fa48("78") ? mgr.canEnqueue(queueName) : (stryCov_9fa48("78", "79", "80"), !mgr.canEnqueue(queueName))) {
              if (stryMutAct_9fa48("81")) {
                {}
              } else {
                stryCov_9fa48("81");
                return new Response(stryMutAct_9fa48("82") ? "" : (stryCov_9fa48("82"), "Queue full or too many queues"), stryMutAct_9fa48("83") ? {} : (stryCov_9fa48("83"), {
                  status: 507
                }));
              }
            }
            const contentLength = request.headers.get(stryMutAct_9fa48("84") ? "" : (stryCov_9fa48("84"), "content-length"));
            if (stryMutAct_9fa48("87") ? contentLength || parseInt(contentLength) > MAX_BODY_SIZE : stryMutAct_9fa48("86") ? false : stryMutAct_9fa48("85") ? true : (stryCov_9fa48("85", "86", "87"), contentLength && (stryMutAct_9fa48("90") ? parseInt(contentLength) <= MAX_BODY_SIZE : stryMutAct_9fa48("89") ? parseInt(contentLength) >= MAX_BODY_SIZE : stryMutAct_9fa48("88") ? true : (stryCov_9fa48("88", "89", "90"), parseInt(contentLength) > MAX_BODY_SIZE)))) {
              if (stryMutAct_9fa48("91")) {
                {}
              } else {
                stryCov_9fa48("91");
                return new Response(stryMutAct_9fa48("92") ? "" : (stryCov_9fa48("92"), "Payload too large"), stryMutAct_9fa48("93") ? {} : (stryCov_9fa48("93"), {
                  status: 413
                }));
              }
            }
            let body: string;
            try {
              if (stryMutAct_9fa48("94")) {
                {}
              } else {
                stryCov_9fa48("94");
                body = await request.text();
              }
            } catch {
              if (stryMutAct_9fa48("95")) {
                {}
              } else {
                stryCov_9fa48("95");
                return new Response(stryMutAct_9fa48("96") ? "" : (stryCov_9fa48("96"), "Payload too large"), stryMutAct_9fa48("97") ? {} : (stryCov_9fa48("97"), {
                  status: 413
                }));
              }
            }
            if (stryMutAct_9fa48("101") ? body.length <= MAX_BODY_SIZE : stryMutAct_9fa48("100") ? body.length >= MAX_BODY_SIZE : stryMutAct_9fa48("99") ? false : stryMutAct_9fa48("98") ? true : (stryCov_9fa48("98", "99", "100", "101"), body.length > MAX_BODY_SIZE)) {
              if (stryMutAct_9fa48("102")) {
                {}
              } else {
                stryCov_9fa48("102");
                return new Response(stryMutAct_9fa48("103") ? "" : (stryCov_9fa48("103"), "Payload too large"), stryMutAct_9fa48("104") ? {} : (stryCov_9fa48("104"), {
                  status: 413
                }));
              }
            }
            try {
              if (stryMutAct_9fa48("105")) {
                {}
              } else {
                stryCov_9fa48("105");
                const json = JSON.parse(body);
                if (stryMutAct_9fa48("108") ? false : stryMutAct_9fa48("107") ? true : stryMutAct_9fa48("106") ? "payload" in json : (stryCov_9fa48("106", "107", "108"), !((stryMutAct_9fa48("109") ? "" : (stryCov_9fa48("109"), "payload")) in json))) {
                  if (stryMutAct_9fa48("110")) {
                    {}
                  } else {
                    stryCov_9fa48("110");
                    return new Response(stryMutAct_9fa48("111") ? "" : (stryCov_9fa48("111"), "Missing payload key"), stryMutAct_9fa48("112") ? {} : (stryCov_9fa48("112"), {
                      status: 400
                    }));
                  }
                }
                if (stryMutAct_9fa48("115") ? json.payload !== null : stryMutAct_9fa48("114") ? false : stryMutAct_9fa48("113") ? true : (stryCov_9fa48("113", "114", "115"), json.payload === null)) {
                  if (stryMutAct_9fa48("116")) {
                    {}
                  } else {
                    stryCov_9fa48("116");
                    return new Response(stryMutAct_9fa48("117") ? "" : (stryCov_9fa48("117"), "Null payload not allowed"), stryMutAct_9fa48("118") ? {} : (stryCov_9fa48("118"), {
                      status: 400
                    }));
                  }
                }
                mgr.enqueue(queueName, json.payload);
                return new Response(stryMutAct_9fa48("119") ? `` : (stryCov_9fa48("119"), `Payload successfully queued onto ${queueName}.`));
              }
            } catch (e) {
              if (stryMutAct_9fa48("120")) {
                {}
              } else {
                stryCov_9fa48("120");
                if (stryMutAct_9fa48("122") ? false : stryMutAct_9fa48("121") ? true : (stryCov_9fa48("121", "122"), e instanceof SyntaxError)) {
                  if (stryMutAct_9fa48("123")) {
                    {}
                  } else {
                    stryCov_9fa48("123");
                    return new Response(stryMutAct_9fa48("124") ? "" : (stryCov_9fa48("124"), "Invalid JSON"), stryMutAct_9fa48("125") ? {} : (stryCov_9fa48("125"), {
                      status: 400
                    }));
                  }
                }
                throw e;
              }
            }
          }
        }
        if (stryMutAct_9fa48("127") ? false : stryMutAct_9fa48("126") ? true : (stryCov_9fa48("126", "127"), isDequeue)) {
          if (stryMutAct_9fa48("128")) {
            {}
          } else {
            stryCov_9fa48("128");
            if (stryMutAct_9fa48("131") ? request.method === "GET" : stryMutAct_9fa48("130") ? false : stryMutAct_9fa48("129") ? true : (stryCov_9fa48("129", "130", "131"), request.method !== (stryMutAct_9fa48("132") ? "" : (stryCov_9fa48("132"), "GET")))) {
              if (stryMutAct_9fa48("133")) {
                {}
              } else {
                stryCov_9fa48("133");
                return new Response(stryMutAct_9fa48("134") ? "" : (stryCov_9fa48("134"), "Method not allowed"), stryMutAct_9fa48("135") ? {} : (stryCov_9fa48("135"), {
                  status: 405
                }));
              }
            }
            const queueName = isDequeue.pathname.groups.queue as string;
            if (stryMutAct_9fa48("139") ? queueName.length <= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("138") ? queueName.length >= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("137") ? false : stryMutAct_9fa48("136") ? true : (stryCov_9fa48("136", "137", "138", "139"), queueName.length > MAX_QUEUE_NAME_LENGTH)) {
              if (stryMutAct_9fa48("140")) {
                {}
              } else {
                stryCov_9fa48("140");
                return new Response(stryMutAct_9fa48("141") ? "" : (stryCov_9fa48("141"), "Queue name too long"), stryMutAct_9fa48("142") ? {} : (stryCov_9fa48("142"), {
                  status: 400
                }));
              }
            }
            const item = mgr.dequeue(queueName);
            if (stryMutAct_9fa48("145") ? item !== undefined : stryMutAct_9fa48("144") ? false : stryMutAct_9fa48("143") ? true : (stryCov_9fa48("143", "144", "145"), item === undefined)) {
              if (stryMutAct_9fa48("146")) {
                {}
              } else {
                stryCov_9fa48("146");
                return new Response(null, stryMutAct_9fa48("147") ? {} : (stryCov_9fa48("147"), {
                  status: 204
                }));
              }
            }
            if (stryMutAct_9fa48("150") ? typeof item === "object" || item !== null : stryMutAct_9fa48("149") ? false : stryMutAct_9fa48("148") ? true : (stryCov_9fa48("148", "149", "150"), (stryMutAct_9fa48("152") ? typeof item !== "object" : stryMutAct_9fa48("151") ? true : (stryCov_9fa48("151", "152"), typeof item === (stryMutAct_9fa48("153") ? "" : (stryCov_9fa48("153"), "object")))) && (stryMutAct_9fa48("155") ? item === null : stryMutAct_9fa48("154") ? true : (stryCov_9fa48("154", "155"), item !== null)))) {
              if (stryMutAct_9fa48("156")) {
                {}
              } else {
                stryCov_9fa48("156");
                return new Response(JSON.stringify(item), stryMutAct_9fa48("157") ? {} : (stryCov_9fa48("157"), {
                  headers: stryMutAct_9fa48("158") ? {} : (stryCov_9fa48("158"), {
                    "Content-Type": stryMutAct_9fa48("159") ? "" : (stryCov_9fa48("159"), "application/json")
                  })
                }));
              }
            }
            return new Response(item);
          }
        }
        if (stryMutAct_9fa48("161") ? false : stryMutAct_9fa48("160") ? true : (stryCov_9fa48("160", "161"), isPeek)) {
          if (stryMutAct_9fa48("162")) {
            {}
          } else {
            stryCov_9fa48("162");
            if (stryMutAct_9fa48("165") ? request.method === "GET" : stryMutAct_9fa48("164") ? false : stryMutAct_9fa48("163") ? true : (stryCov_9fa48("163", "164", "165"), request.method !== (stryMutAct_9fa48("166") ? "" : (stryCov_9fa48("166"), "GET")))) {
              if (stryMutAct_9fa48("167")) {
                {}
              } else {
                stryCov_9fa48("167");
                return new Response(stryMutAct_9fa48("168") ? "" : (stryCov_9fa48("168"), "Method not allowed"), stryMutAct_9fa48("169") ? {} : (stryCov_9fa48("169"), {
                  status: 405
                }));
              }
            }
            const queueName = isPeek.pathname.groups.queue as string;
            if (stryMutAct_9fa48("173") ? queueName.length <= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("172") ? queueName.length >= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("171") ? false : stryMutAct_9fa48("170") ? true : (stryCov_9fa48("170", "171", "172", "173"), queueName.length > MAX_QUEUE_NAME_LENGTH)) {
              if (stryMutAct_9fa48("174")) {
                {}
              } else {
                stryCov_9fa48("174");
                return new Response(stryMutAct_9fa48("175") ? "" : (stryCov_9fa48("175"), "Queue name too long"), stryMutAct_9fa48("176") ? {} : (stryCov_9fa48("176"), {
                  status: 400
                }));
              }
            }
            const item = mgr.peek(queueName);
            if (stryMutAct_9fa48("179") ? item !== undefined : stryMutAct_9fa48("178") ? false : stryMutAct_9fa48("177") ? true : (stryCov_9fa48("177", "178", "179"), item === undefined)) {
              if (stryMutAct_9fa48("180")) {
                {}
              } else {
                stryCov_9fa48("180");
                return new Response(null, stryMutAct_9fa48("181") ? {} : (stryCov_9fa48("181"), {
                  status: 204
                }));
              }
            }
            if (stryMutAct_9fa48("184") ? typeof item === "object" || item !== null : stryMutAct_9fa48("183") ? false : stryMutAct_9fa48("182") ? true : (stryCov_9fa48("182", "183", "184"), (stryMutAct_9fa48("186") ? typeof item !== "object" : stryMutAct_9fa48("185") ? true : (stryCov_9fa48("185", "186"), typeof item === (stryMutAct_9fa48("187") ? "" : (stryCov_9fa48("187"), "object")))) && (stryMutAct_9fa48("189") ? item === null : stryMutAct_9fa48("188") ? true : (stryCov_9fa48("188", "189"), item !== null)))) {
              if (stryMutAct_9fa48("190")) {
                {}
              } else {
                stryCov_9fa48("190");
                return new Response(JSON.stringify(item), stryMutAct_9fa48("191") ? {} : (stryCov_9fa48("191"), {
                  headers: stryMutAct_9fa48("192") ? {} : (stryCov_9fa48("192"), {
                    "Content-Type": stryMutAct_9fa48("193") ? "" : (stryCov_9fa48("193"), "application/json")
                  })
                }));
              }
            }
            return new Response(item);
          }
        }
        if (stryMutAct_9fa48("195") ? false : stryMutAct_9fa48("194") ? true : (stryCov_9fa48("194", "195"), isLength)) {
          if (stryMutAct_9fa48("196")) {
            {}
          } else {
            stryCov_9fa48("196");
            if (stryMutAct_9fa48("199") ? request.method === "GET" : stryMutAct_9fa48("198") ? false : stryMutAct_9fa48("197") ? true : (stryCov_9fa48("197", "198", "199"), request.method !== (stryMutAct_9fa48("200") ? "" : (stryCov_9fa48("200"), "GET")))) {
              if (stryMutAct_9fa48("201")) {
                {}
              } else {
                stryCov_9fa48("201");
                return new Response(stryMutAct_9fa48("202") ? "" : (stryCov_9fa48("202"), "Method not allowed"), stryMutAct_9fa48("203") ? {} : (stryCov_9fa48("203"), {
                  status: 405
                }));
              }
            }
            const queueName = isLength.pathname.groups.queue as string;
            if (stryMutAct_9fa48("207") ? queueName.length <= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("206") ? queueName.length >= MAX_QUEUE_NAME_LENGTH : stryMutAct_9fa48("205") ? false : stryMutAct_9fa48("204") ? true : (stryCov_9fa48("204", "205", "206", "207"), queueName.length > MAX_QUEUE_NAME_LENGTH)) {
              if (stryMutAct_9fa48("208")) {
                {}
              } else {
                stryCov_9fa48("208");
                return new Response(stryMutAct_9fa48("209") ? "" : (stryCov_9fa48("209"), "Queue name too long"), stryMutAct_9fa48("210") ? {} : (stryCov_9fa48("210"), {
                  status: 400
                }));
              }
            }
            const len = mgr.length(queueName);
            return new Response(stryMutAct_9fa48("211") ? `` : (stryCov_9fa48("211"), `${len}`));
          }
        }
        return new Response(stryMutAct_9fa48("212") ? "" : (stryCov_9fa48("212"), "Not found."), stryMutAct_9fa48("213") ? {} : (stryCov_9fa48("213"), {
          status: 404
        }));
      }
    };
    return async function handler(request: Request, info?: Deno.ServeHandlerInfo): Promise<Response> {
      if (stryMutAct_9fa48("214")) {
        {}
      } else {
        stryCov_9fa48("214");
        const start = performance.now();
        try {
          if (stryMutAct_9fa48("215")) {
            {}
          } else {
            stryCov_9fa48("215");
            const remoteAddr = (stryMutAct_9fa48("218") ? info?.remoteAddr || info.remoteAddr.transport === "tcp" : stryMutAct_9fa48("217") ? false : stryMutAct_9fa48("216") ? true : (stryCov_9fa48("216", "217", "218"), (stryMutAct_9fa48("219") ? info.remoteAddr : (stryCov_9fa48("219"), info?.remoteAddr)) && (stryMutAct_9fa48("221") ? info.remoteAddr.transport !== "tcp" : stryMutAct_9fa48("220") ? true : (stryCov_9fa48("220", "221"), info.remoteAddr.transport === (stryMutAct_9fa48("222") ? "" : (stryCov_9fa48("222"), "tcp")))))) ? info.remoteAddr.hostname : undefined;
            const response = await innerHandler(request, remoteAddr);
            const duration = stryMutAct_9fa48("223") ? performance.now() + start : (stryCov_9fa48("223"), performance.now() - start);
            console.log(stryMutAct_9fa48("224") ? `` : (stryCov_9fa48("224"), `${request.method} ${request.url} ${response.status} ${duration.toFixed(2)}ms`));
            return response;
          }
        } catch (error) {
          if (stryMutAct_9fa48("225")) {
            {}
          } else {
            stryCov_9fa48("225");
            const duration = stryMutAct_9fa48("226") ? performance.now() + start : (stryCov_9fa48("226"), performance.now() - start);
            console.error(stryMutAct_9fa48("227") ? `` : (stryCov_9fa48("227"), `${request.method} ${request.url} 500 ${duration.toFixed(2)}ms`));
            throw error;
          }
        }
      }
    };
  }
}