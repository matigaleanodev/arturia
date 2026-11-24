import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blocksBeforeTerminal, type Sample } from './streaming.ts';

const busy = (at: number, length: number): Sample => ({ at, busy: true, length });
const done = (at: number, length: number): Sample => ({ at, busy: false, length });
const lead = { terminalRequestedAt: 2800, minLeadMs: 500 };

test('accepts blocks displayed while the turn is active, ahead of the terminal snapshot request', () => {
  const evidence = blocksBeforeTerminal([busy(0, 0), busy(900, 11), busy(1900, 23), done(2900, 35)], lead);
  assert.deepEqual(evidence, { firstBlockAt: 900, terminalAt: 2900, partialLength: 11, finalLength: 35, leadMs: 1900 });
});

test('fails when every block appears only together with the terminal status', () => {
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), done(2900, 35)], lead), /before the terminal status/);
});

test('fails when the text appears only after the terminal status', () => {
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), done(2900, 0), done(3000, 35)], lead), /before the terminal status/);
});

test('fails when a buffered delivery renders in pieces right before the terminal snapshot request', () => {
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), busy(2700, 11), busy(2750, 23), done(2900, 35)], lead),
    /ahead of the terminal snapshot/);
});

test('fails when the first block is displayed after the terminal snapshot was requested', () => {
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), busy(2850, 11), done(2900, 35)], lead), /ahead of the terminal snapshot/);
});

test('fails when the full text is shown early and nothing arrives afterwards', () => {
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), busy(900, 35), done(2900, 35)], lead), /more text/);
});

test('fails without a terminal status or without the terminal snapshot request', () => {
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), busy(900, 11)], lead), /terminal status/);
  assert.throws(() => blocksBeforeTerminal([busy(0, 0), busy(900, 11), busy(1900, 23), done(2900, 35)],
    { terminalRequestedAt: undefined, minLeadMs: 500 }), /terminal snapshot/);
});

test('fails without any active sample', () => {
  assert.throws(() => blocksBeforeTerminal([], lead), /active turn/);
  assert.throws(() => blocksBeforeTerminal([done(0, 35)], lead), /active turn/);
});
