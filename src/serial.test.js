import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serial } from './serial.js';

const defer = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

test('jobs run one at a time, never overlapping', async () => {
  const gate = serial();
  const log = [];
  let active = 0;
  const job = (id, ms) => async () => {
    assert.equal(active, 0, `job ${id} started while another was running`);
    active++;
    log.push(`start ${id}`);
    await defer(ms);
    log.push(`end ${id}`);
    active--;
    return id;
  };
  // The first job is the slow one: if they overlapped, 2 would start before 1 ends.
  const p1 = gate(job(1, 30));
  const p2 = gate(job(2, 5));
  assert.deepEqual(await Promise.all([p1, p2]), [1, 2]);
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2']);
});

test('a rejected job does not poison the queue', async () => {
  const gate = serial();
  await assert.rejects(gate(() => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await gate(() => Promise.resolve('ok')), 'ok');
});
