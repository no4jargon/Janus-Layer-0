import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildClusterPrompt,
  MAX_CLUSTER_TEXT_CHARS,
  type CollatedMessage,
} from '../src/index.js';

// Fixed clock so the ISO timestamps in the prompt are deterministic.
// 2026-05-16T12:00:00.000Z (NOW_MS = 1778932800000)
const NOW_MS = 1778932800000;
const ONE_HOUR_S = 3600;

const fixtureMessages = (): CollatedMessage[] => [
  // 1h ago — in window for any lookback >= 1h
  {
    sourceType: 'whatsapp_chat',
    timestampSec: NOW_MS / 1000 - ONE_HOUR_S,
    sender: 'Alice',
    text: 'can you ship the deck by friday?',
  },
  // Out of order on purpose — buildClusterPrompt must sort ascending
  // 30m ago
  {
    sourceType: 'email_thread',
    timestampSec: NOW_MS / 1000 - ONE_HOUR_S / 2,
    sender: 'Bob <bob@example.com>',
    text: 'Re: Q3 plan — agreed on the milestones.',
  },
  // 2h ago
  {
    sourceType: 'whatsapp_chat',
    timestampSec: NOW_MS / 1000 - 2 * ONE_HOUR_S,
    sender: 'Alice',
    text: 'kickoff at 3pm tomorrow?',
  },
];

describe('buildClusterPrompt', () => {
  it('emits messages in chronological order with the expected line format', () => {
    const result = buildClusterPrompt({
      messages: fixtureMessages(),
      lookbackHours: 4,
      nowMs: NOW_MS,
    });
    assert.ok(result.ok, 'expected ok result');
    if (!result.ok) return;
    assert.equal(result.includedCount, 3);
    assert.equal(
      result.promptText,
      [
        '[2026-05-16T10:00:00.000Z] (whatsapp_chat) Alice: kickoff at 3pm tomorrow?',
        '[2026-05-16T11:00:00.000Z] (whatsapp_chat) Alice: can you ship the deck by friday?',
        '[2026-05-16T11:30:00.000Z] (email_thread) Bob <bob@example.com>: Re: Q3 plan — agreed on the milestones.',
      ].join('\n'),
    );
  });

  it('drops messages outside the lookback window', () => {
    const result = buildClusterPrompt({
      messages: fixtureMessages(),
      lookbackHours: 0.75,
      nowMs: NOW_MS,
    });
    assert.ok(result.ok, 'expected ok result');
    if (!result.ok) return;
    assert.equal(result.includedCount, 1);
    assert.match(result.promptText, /\(email_thread\) Bob/);
    assert.doesNotMatch(result.promptText, /kickoff at 3pm/);
  });

  it('returns empty_window when no messages survive the filter', () => {
    const result = buildClusterPrompt({
      messages: fixtureMessages(),
      lookbackHours: 0.1,
      nowMs: NOW_MS,
    });
    assert.deepEqual(result, { ok: false, reason: 'empty_window' });
  });

  it('returns empty_window for an empty input', () => {
    const result = buildClusterPrompt({
      messages: [],
      lookbackHours: 4,
      nowMs: NOW_MS,
    });
    assert.deepEqual(result, { ok: false, reason: 'empty_window' });
  });

  it('filters out messages with empty text or zero timestamp', () => {
    const result = buildClusterPrompt({
      messages: [
        ...fixtureMessages(),
        {
          sourceType: 'whatsapp_chat',
          timestampSec: NOW_MS / 1000 - ONE_HOUR_S / 4,
          sender: 'Alice',
          text: '',
        },
        {
          sourceType: 'whatsapp_chat',
          timestampSec: 0,
          sender: 'Alice',
          text: 'this has no timestamp',
        },
      ],
      lookbackHours: 4,
      nowMs: NOW_MS,
    });
    assert.ok(result.ok, 'expected ok result');
    if (!result.ok) return;
    assert.equal(result.includedCount, 3);
  });

  it('truncates at MAX_CLUSTER_TEXT_CHARS rather than overflowing', () => {
    // Construct enough oversized messages to blow the budget. Each line is
    // ~10k chars, so 5 of them overflow the 40k budget after one or two.
    const overlongBody = 'x'.repeat(10_000);
    const messages: CollatedMessage[] = Array.from({ length: 8 }, (_, i) => ({
      sourceType: 'whatsapp_chat' as const,
      timestampSec: NOW_MS / 1000 - (8 - i) * 60,
      sender: 'A',
      text: overlongBody,
    }));
    const result = buildClusterPrompt({
      messages,
      lookbackHours: 4,
      nowMs: NOW_MS,
    });
    assert.ok(result.ok, 'expected ok result');
    if (!result.ok) return;
    assert.ok(result.includedCount < messages.length, 'should truncate');
    assert.ok(
      result.promptText.length <= MAX_CLUSTER_TEXT_CHARS,
      `prompt length ${result.promptText.length} exceeds budget ${MAX_CLUSTER_TEXT_CHARS}`,
    );
  });
});
