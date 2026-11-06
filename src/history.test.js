import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT, record, step } from './history.js';

test('undo and redo walk the same path back and forth', () => {
  const past = [], future = [];
  record(past, future, ['a']);
  record(past, future, ['a', 'b']);
  let now = ['a', 'b', 'c'];
  now = step(past, future, now); assert.deepEqual(now, ['a', 'b']);
  now = step(past, future, now); assert.deepEqual(now, ['a']);
  assert.equal(step(past, future, now), null, 'nothing further back');
  now = step(future, past, now); assert.deepEqual(now, ['a', 'b']);
});

test('a new edit drops the redo branch', () => {
  const past = [], future = [];
  record(past, future, [1]);
  step(past, future, [2]);
  assert.equal(future.length, 1);
  record(past, future, [3]);
  assert.equal(future.length, 0);
});

test('focus-only commits are stepped over, not undone one by one', () => {
  const past = [], future = [];
  record(past, future, ['a']);
  for (let i = 0; i < 3; i++) record(past, future, ['a', 'b']); // tabbing through fields
  assert.deepEqual(step(past, future, ['a', 'b']), ['a'], 'first undo visibly does something');
});

test('history is capped', () => {
  const past = [], future = [];
  for (let i = 0; i < LIMIT + 20; i++) record(past, future, [i]);
  assert.equal(past.length, LIMIT);
  assert.deepEqual(past[0], [20], 'the oldest go first');
});
