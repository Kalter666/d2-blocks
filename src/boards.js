// d2 files can hold more than one board: `layers`, `scenarios` and `steps`, each
// a whole diagram of its own, nestable. The compiled root carries them all; the
// renderer only draws the root unless it is given a `target` path like
// `layers.api.steps.2`. Pure helpers, no worker, so a test can import them.

const KINDS = ['layers', 'scenarios', 'steps'];

/** Every board below the root as `{ path, label }`, depth-first, in source order. */
export function boardPaths(diagram, prefix = '', label = '') {
  const out = [];
  for (const kind of KINDS) {
    for (const board of diagram?.[kind] ?? []) {
      if (!board) continue;
      const path = `${prefix}${kind}.${board.name}`;
      const name = `${label}${board.name}`;
      out.push({ path, label: name, kind });
      out.push(...boardPaths(board, `${path}.`, `${name} › `));
    }
  }
  return out;
}

/** The board at `path`, or null when it no longer exists (the source changed under it). */
export function boardAt(diagram, path) {
  if (!path) return diagram;
  const parts = path.split('.');
  let d = diagram;
  for (let i = 0; i < parts.length && d; i += 2) {
    d = d[parts[i]]?.find((b) => b?.name === parts[i + 1]) ?? null;
  }
  return d;
}
