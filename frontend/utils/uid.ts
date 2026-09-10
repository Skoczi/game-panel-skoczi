// Monotonic, session-unique ids for client-side list entries (log lines, history
// rows, CLI messages). Used only as React keys, never for ordering or storage.
// A timestamp is not enough: entries arriving in the same millisecond collide.
let seq = 0;

export function nextId(): number {
  seq += 1;
  return seq;
}
