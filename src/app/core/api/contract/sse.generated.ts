// Generated from sse.schema.json. Run npm run contract:generate.

/**
 * JSON in a data field of a text or status event. SSE heartbeat comments have no JSON payload.
 */
export type ArturiaV1SSEPayload = TextEvent | ActiveStatusEvent | TerminalStatusEvent;
export type TerminalStatusEvent = {
  type: 'status';
  turnId: string;
  status: 'completed' | 'incomplete' | 'failed' | 'cancelled' | 'blocked';
  /**
   * Final deliverable text sequence. Zero indicates no deliverable text.
   */
  lastSeq: number;
};

export interface TextEvent {
  type: 'text';
  turnId: string;
  /**
   * Monotonic text sequence within this turn.
   */
  seq: number;
  text: string;
}
export interface ActiveStatusEvent {
  type: 'status';
  turnId: string;
  status: 'queued' | 'running';
}
