/**
 * A one-at-a-time gate. Jobs handed to the returned function run in call order,
 * each awaited to completion before the next begins — even when a job rejects.
 *
 * Why: d2 runs in a single wasm worker (see d2.js). Concurrent compile/render
 * calls interleave on that one Go instance and hand back a corrupted SVG — a
 * fast edit during the cold ~6 MB first compile, or a modal preview firing while
 * the canvas re-renders, is enough to trigger it. Serial access is the fix.
 *
 * Its own module so it can be tested without importing d2.js, which spawns the
 * worker on import.
 */
const noop = () => {};

export function serial() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job);
    tail = run.then(noop, noop); // a rejected job settles the queue, never poisons it
    return run;
  };
}
