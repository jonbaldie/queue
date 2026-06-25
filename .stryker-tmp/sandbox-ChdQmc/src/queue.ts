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
export default class Queue<T = string> {
  private messages: Array<T>;
  constructor(messages: []);
  constructor(messages: Array<T>);
  constructor(messages: Array<T> | []) {
    if (stryMutAct_9fa48("393")) {
      {}
    } else {
      stryCov_9fa48("393");
      this.messages = messages as Array<T>;
    }
  }
  public length(): number {
    if (stryMutAct_9fa48("394")) {
      {}
    } else {
      stryCov_9fa48("394");
      return this.messages.length;
    }
  }
  public enqueue(payload: T): void {
    if (stryMutAct_9fa48("395")) {
      {}
    } else {
      stryCov_9fa48("395");
      this.messages.push(payload);
    }
  }
  public dequeue(): T | undefined {
    if (stryMutAct_9fa48("396")) {
      {}
    } else {
      stryCov_9fa48("396");
      return this.messages.shift();
    }
  }
  public is_empty(): boolean {
    if (stryMutAct_9fa48("397")) {
      {}
    } else {
      stryCov_9fa48("397");
      return stryMutAct_9fa48("400") ? this.length() !== 0 : stryMutAct_9fa48("399") ? false : stryMutAct_9fa48("398") ? true : (stryCov_9fa48("398", "399", "400"), this.length() === 0);
    }
  }
  public peek(): T | undefined {
    if (stryMutAct_9fa48("401")) {
      {}
    } else {
      stryCov_9fa48("401");
      return this.messages[0];
    }
  }
  public all(): Array<T> {
    if (stryMutAct_9fa48("402")) {
      {}
    } else {
      stryCov_9fa48("402");
      return stryMutAct_9fa48("403") ? [] : (stryCov_9fa48("403"), [...this.messages]);
    }
  }
}