/** One observation of the reply's live region (wall-clock ms): whether the turn is active and how much text is shown. */
export interface Sample {
  readonly at: number;
  readonly busy: boolean;
  readonly length: number;
}

export interface TerminalRequest {
  /** Wall-clock ms when the browser requested the first snapshot that reported a terminal status. */
  readonly terminalRequestedAt: number | undefined;
  /** How far ahead of that request the first block must be displayed. */
  readonly minLeadMs: number;
}

export interface StreamingEvidence {
  readonly firstBlockAt: number;
  readonly terminalAt: number;
  readonly partialLength: number;
  readonly finalLength: number;
  readonly leadMs: number;
}

/**
 * Proves progressive delivery in the browser. The live region's aria-busy follows the status the client applies, which
 * comes from the terminal snapshot it fetches after the stream ends, so three conditions are required: text shown while
 * the turn is still active, shown a margin ahead of the request for the terminal snapshot (a buffered delivery that
 * renders in pieces right before it does not count), and more text arriving afterwards (the early text is a block,
 * not the final reply rendered ahead of a lagging status). A reply needs at least two spaced blocks to pass.
 */
export function blocksBeforeTerminal(samples: readonly Sample[], terminal: TerminalRequest): StreamingEvidence {
  const start = samples.findIndex((sample) => sample.busy);
  if (start === -1) throw new Error('No sample shows an active turn');
  const end = samples.findIndex((sample, index) => index > start && !sample.busy);
  if (end === -1) throw new Error('The turn never reached a terminal status');
  const first = samples.slice(start, end).find((sample) => sample.length > 0);
  if (!first) throw new Error('No response block was displayed before the terminal status');
  if (terminal.terminalRequestedAt === undefined) throw new Error('The terminal snapshot request was not observed');
  const leadMs = terminal.terminalRequestedAt - first.at;
  if (leadMs < terminal.minLeadMs) {
    throw new Error(`The first block was displayed ${leadMs} ms ahead of the terminal snapshot request; ` +
      `at least ${terminal.minLeadMs} ms are required`);
  }
  const final = samples.at(-1)!;
  if (final.length <= first.length) throw new Error('No more text arrived after the first displayed block');
  return {
    firstBlockAt: first.at,
    terminalAt: samples[end]!.at,
    partialLength: first.length,
    finalLength: final.length,
    leadMs,
  };
}
