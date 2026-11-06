// Undo/redo over whole-tree snapshots. Pure functions on two arrays, so
// history.test.js can drive them; the store passes its $state arrays in, which
// is what keeps the toolbar's disabled bindings reactive.
//
// ponytail: whole-tree snapshots, fine at this size; diffs if trees get huge.

export const LIMIT = 100;

/** Remember `state` as the one to go back to. Every mutation path must call this. */
export function record(past, future, state) {
  past.push(state);
  if (past.length > LIMIT) past.shift();
  future.length = 0;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Move one step from `from` to `to`, returning the state to show, or null when
 * there is nothing to step to. commit() fires on every field focus, so tabbing
 * through inputs without typing stacks up identical states; rather than detect
 * "did this focus lead to a change", skip entries that match `current` —
 * otherwise the first press of undo visibly does nothing.
 */
export function step(from, to, current) {
  while (from.length) {
    const state = from.pop();
    if (same(state, current)) continue;
    to.push(current);
    return state;
  }
  return null;
}
