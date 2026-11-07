export const title = "One client's sliding request window";

const sequence = (value) => Array.isArray(value)
  ? value
  : Object.keys(value ?? {}).sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);

export const state = (v) => {
  const admitted = sequence(v.admissions);
  const elapsed = sequence(v.admissionElapsed);
  const stored = sequence(v.stored);
  const active = elapsed.filter((time) => time > v.elapsed - 60000);
  return `wall clock ${v.now} ms; elapsed ${v.elapsed} ms; ${active.length} requests in the 60-second window; admitted at wall times [${admitted.join(", ")}]; stored [${stored.join(", ")}]; last request ${v.lastAllowed}`;
};

export const step = (action, _from, to) => {
  if (action.startsWith("Request")) {
    return `request at ${to.now} ms is ${to.lastAllowed}`;
  }
  return null;
};
