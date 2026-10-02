import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardPaths, boardAt } from './boards.js';

const root = {
  name: '',
  layers: [{ name: 'api', steps: [{ name: '1' }, { name: '2' }] }],
  scenarios: [{ name: 'outage' }],
};

test('boards are listed depth-first with d2 target paths', () => {
  assert.deepEqual(boardPaths(root).map((b) => b.path), [
    'layers.api', 'layers.api.steps.1', 'layers.api.steps.2', 'scenarios.outage',
  ]);
  assert.equal(boardPaths(root)[2].label, 'api › 2');
});

test('a path resolves to its board, and a stale one to null', () => {
  assert.equal(boardAt(root, ''), root);
  assert.equal(boardAt(root, 'layers.api.steps.2').name, '2');
  assert.equal(boardAt(root, 'layers.gone'), null);
});
