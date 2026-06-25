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
export default interface Persist {
  append(line: string): void;
  clear(): void;
  load(): string;
  dir(dir: string): void;
}
export class File implements Persist {
  private directory: string = stryMutAct_9fa48("344") ? "Stryker was here!" : (stryCov_9fa48("344"), '');
  private get path(): string {
    if (stryMutAct_9fa48("345")) {
      {}
    } else {
      stryCov_9fa48("345");
      return this.directory + (stryMutAct_9fa48("346") ? "" : (stryCov_9fa48("346"), "persist.dat"));
    }
  }
  public append(line: string): void {
    if (stryMutAct_9fa48("347")) {
      {}
    } else {
      stryCov_9fa48("347");
      const file = Deno.openSync(this.path, stryMutAct_9fa48("348") ? {} : (stryCov_9fa48("348"), {
        write: stryMutAct_9fa48("349") ? false : (stryCov_9fa48("349"), true),
        create: stryMutAct_9fa48("350") ? false : (stryCov_9fa48("350"), true),
        append: stryMutAct_9fa48("351") ? false : (stryCov_9fa48("351"), true)
      }));
      file.lockSync(stryMutAct_9fa48("352") ? false : (stryCov_9fa48("352"), true));
      try {
        if (stryMutAct_9fa48("353")) {
          {}
        } else {
          stryCov_9fa48("353");
          file.writeSync(new TextEncoder().encode(line + (stryMutAct_9fa48("354") ? "" : (stryCov_9fa48("354"), "\n"))));
        }
      } finally {
        if (stryMutAct_9fa48("355")) {
          {}
        } else {
          stryCov_9fa48("355");
          file.unlockSync();
          file.close();
        }
      }
    }
  }
  public clear(): void {
    if (stryMutAct_9fa48("356")) {
      {}
    } else {
      stryCov_9fa48("356");
      const file = Deno.openSync(this.path, stryMutAct_9fa48("357") ? {} : (stryCov_9fa48("357"), {
        write: stryMutAct_9fa48("358") ? false : (stryCov_9fa48("358"), true),
        create: stryMutAct_9fa48("359") ? false : (stryCov_9fa48("359"), true)
      }));
      file.lockSync(stryMutAct_9fa48("360") ? false : (stryCov_9fa48("360"), true));
      try {
        if (stryMutAct_9fa48("361")) {
          {}
        } else {
          stryCov_9fa48("361");
          file.truncateSync(0);
        }
      } finally {
        if (stryMutAct_9fa48("362")) {
          {}
        } else {
          stryCov_9fa48("362");
          file.unlockSync();
          file.close();
        }
      }
    }
  }
  public load(): string {
    if (stryMutAct_9fa48("363")) {
      {}
    } else {
      stryCov_9fa48("363");
      try {
        if (stryMutAct_9fa48("364")) {
          {}
        } else {
          stryCov_9fa48("364");
          const file = Deno.openSync(this.path, stryMutAct_9fa48("365") ? {} : (stryCov_9fa48("365"), {
            read: stryMutAct_9fa48("366") ? false : (stryCov_9fa48("366"), true)
          }));
          file.lockSync(stryMutAct_9fa48("367") ? true : (stryCov_9fa48("367"), false));
          try {
            if (stryMutAct_9fa48("368")) {
              {}
            } else {
              stryCov_9fa48("368");
              const stat = file.statSync();
              const buf = new Uint8Array(stat.size);
              let totalRead = 0;
              while (stryMutAct_9fa48("371") ? totalRead >= stat.size : stryMutAct_9fa48("370") ? totalRead <= stat.size : stryMutAct_9fa48("369") ? false : (stryCov_9fa48("369", "370", "371"), totalRead < stat.size)) {
                if (stryMutAct_9fa48("372")) {
                  {}
                } else {
                  stryCov_9fa48("372");
                  const read = file.readSync(buf.subarray(totalRead));
                  if (stryMutAct_9fa48("375") ? read === null && read === 0 : stryMutAct_9fa48("374") ? false : stryMutAct_9fa48("373") ? true : (stryCov_9fa48("373", "374", "375"), (stryMutAct_9fa48("377") ? read !== null : stryMutAct_9fa48("376") ? false : (stryCov_9fa48("376", "377"), read === null)) || (stryMutAct_9fa48("379") ? read !== 0 : stryMutAct_9fa48("378") ? false : (stryCov_9fa48("378", "379"), read === 0)))) break;
                  stryMutAct_9fa48("380") ? totalRead -= read : (stryCov_9fa48("380"), totalRead += read);
                }
              }
              return new TextDecoder().decode(buf);
            }
          } finally {
            if (stryMutAct_9fa48("381")) {
              {}
            } else {
              stryCov_9fa48("381");
              file.unlockSync();
              file.close();
            }
          }
        }
      } catch (_e) {
        if (stryMutAct_9fa48("382")) {
          {}
        } else {
          stryCov_9fa48("382");
          if (stryMutAct_9fa48("384") ? false : stryMutAct_9fa48("383") ? true : (stryCov_9fa48("383", "384"), _e instanceof Deno.errors.NotFound)) {
            if (stryMutAct_9fa48("385")) {
              {}
            } else {
              stryCov_9fa48("385");
              return stryMutAct_9fa48("386") ? "Stryker was here!" : (stryCov_9fa48("386"), "");
            }
          }
          throw _e;
        }
      }
    }
  }
  public dir(dir: string): void {
    if (stryMutAct_9fa48("387")) {
      {}
    } else {
      stryCov_9fa48("387");
      this.directory = dir.replace(stryMutAct_9fa48("388") ? /\// : (stryCov_9fa48("388"), /\/$/), stryMutAct_9fa48("389") ? "Stryker was here!" : (stryCov_9fa48("389"), '')) + (stryMutAct_9fa48("390") ? "" : (stryCov_9fa48("390"), "/"));
    }
  }
}
export class None implements Persist {
  public append(_line: string): void {}
  public clear(): void {}
  public load(): string {
    if (stryMutAct_9fa48("391")) {
      {}
    } else {
      stryCov_9fa48("391");
      return stryMutAct_9fa48("392") ? "Stryker was here!" : (stryCov_9fa48("392"), "");
    }
  }
  public dir(_dir: string): void {}
}