// src/fragments/bd-memory.js
// bd message convention: "<Type>: <json>".
export function assertId(id) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`invalid bead id: ${id}`);
  return id;
}
export function bdShow(id) { const v = assertId(id); return `bd show ${v} --json`; }
export function bdReady(label) { return label ? `bd ready --label ${label}` : 'bd ready'; }
// bdWrite returns a shell snippet an AGENT runs (workflow scripts can't run bash):
// create the bead if absent, then append a typed evidence comment WITH the body on stdin.
export function bdWrite(id, type, payloadObj) {
  const v = assertId(id);
  const body = `${type}: ${JSON.stringify(payloadObj)}`;
  return `bd show ${v} >/dev/null 2>&1 || bd create --id ${v} -t task >/dev/null 2>&1\ncat <<'ZKEOF' | bd comment ${v} --stdin\n${body}\nZKEOF`;
}
