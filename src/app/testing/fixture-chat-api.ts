import { ChatApi, ChatApiError, type ConversationRef, type TurnRef } from '../core/api/chat-api';
import type {
  ConversationDetail,
  ConversationInput,
  ConversationSummary,
  TurnInput,
  TurnSnapshot,
} from '../core/api/contract/openapi.generated';
import fixture from '../core/api/contract/fixtures/chat.json';

export const fixtureScopes = {
  personal: fixture.createConversation.response.scopeId,
  work: 'fixture-work',
};

const dataKey = 'arturia.fixture.chat';
const scenarioKey = 'arturia.fixture.scenario';
type Outcome = 'completed' | 'incomplete' | 'failed';

interface FixtureTurn {
  readonly ref: ConversationRef;
  readonly turnId: string;
  readonly input: TurnInput;
  readonly key: string;
  readonly acceptedAt: number;
  readonly outcome: Outcome;
  cancelled?: TurnSnapshot;
}

interface FixtureData {
  readonly conversations: ConversationSummary[];
  readonly turns: FixtureTurn[];
}

const seed = fixture.getConversation;
const seededTurn: TurnSnapshot = { ...fixture.turnSnapshots.completed, status: 'completed' };

function readData(): FixtureData {
  const stored = localStorage.getItem(dataKey);
  return stored ? JSON.parse(stored) as FixtureData : {
    conversations: fixture.listConversations.conversations,
    turns: [],
  };
}

function saveData(data: FixtureData): void {
  localStorage.setItem(dataKey, JSON.stringify(data));
}

function checkScope(scopeId: string, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (scopeId !== fixtureScopes.personal && scopeId !== fixtureScopes.work) {
    throw new ChatApiError(403);
  }
}

function findConversation(data: FixtureData, ref: ConversationRef): ConversationSummary {
  const summary = data.conversations.find(
    ({ scopeId, conversationId }) => scopeId === ref.scopeId && conversationId === ref.conversationId,
  );
  if (!summary) throw new ChatApiError(404);
  return summary;
}

function findTurn(data: FixtureData, ref: TurnRef): FixtureTurn {
  const found = data.turns.find(({ ref: entry, turnId }) =>
    entry.scopeId === ref.scopeId && turnId === ref.turnId,
  );
  if (!found) throw new ChatApiError(404);
  return found;
}

function snapshot(turn: FixtureTurn): TurnSnapshot {
  if (turn.cancelled) return turn.cancelled;
  const elapsed = Date.now() - turn.acceptedAt;
  const status = elapsed < 450 ? 'queued' : elapsed < 2400 ? 'running' : turn.outcome;
  const payload = status === 'running' && turn.outcome === 'failed'
    ? fixture.turnSnapshots.queued
    : fixture.turnSnapshots[status];
  return { ...payload, ...turn.ref, turnId: turn.turnId, status };
}

export class FixtureChatApi implements ChatApi {
  async listConversations(scopeId: string, signal: AbortSignal) {
    checkScope(scopeId, signal);
    return { conversations: readData().conversations.filter((item) => item.scopeId === scopeId) };
  }

  async createConversation(scopeId: string, input: ConversationInput, signal: AbortSignal) {
    checkScope(scopeId, signal);
    const data = readData();
    const created = {
      scopeId,
      conversationId: crypto.randomUUID(),
      title: input.title,
      createdAt: new Date().toISOString(),
    };
    data.conversations.unshift(created);
    saveData(data);
    return created;
  }

  async getConversation(ref: ConversationRef, signal: AbortSignal): Promise<ConversationDetail> {
    checkScope(ref.scopeId, signal);
    const data = readData();
    const summary = findConversation(data, ref);
    const turns = data.turns
      .filter(({ ref: stored }) => stored.scopeId === ref.scopeId && stored.conversationId === ref.conversationId)
      .map((turn) => ({ input: turn.input, snapshot: snapshot(turn) }));

    if (ref.scopeId === seed.scopeId && ref.conversationId === seed.conversationId) {
      turns.unshift({ input: fixture.acceptTurn.request, snapshot: seededTurn });
    }
    return { ...summary, turns };
  }

  async acceptTurn(ref: ConversationRef, input: TurnInput, key: string, signal: AbortSignal) {
    checkScope(ref.scopeId, signal);
    const data = readData();
    findConversation(data, ref);
    const existing = data.turns.find(({ key: stored, ref: entry }) =>
      stored === key && entry.scopeId === ref.scopeId && entry.conversationId === ref.conversationId,
    );
    if (existing) {
      if (existing.input.text !== input.text) throw new ChatApiError(409);
      return { turnId: existing.turnId, status: 'queued' as const };
    }

    const scenario = sessionStorage.getItem(scenarioKey);
    sessionStorage.removeItem(scenarioKey);
    const turnId = crypto.randomUUID();
    data.turns.push({
      ref,
      turnId,
      input,
      key,
      acceptedAt: Date.now(),
      outcome: scenario === 'incomplete' || scenario === 'failed' ? scenario : 'completed',
    });
    saveData(data);
    if (scenario === 'lost-response') throw new TypeError('Synthetic acknowledgement lost');
    return { turnId, status: 'queued' as const };
  }

  async getTurn(ref: TurnRef, signal: AbortSignal): Promise<TurnSnapshot> {
    checkScope(ref.scopeId, signal);
    if (ref.scopeId === seededTurn.scopeId && ref.turnId === seededTurn.turnId) return seededTurn;
    return snapshot(findTurn(readData(), ref));
  }

  async cancelTurn(ref: TurnRef, signal: AbortSignal): Promise<TurnSnapshot> {
    checkScope(ref.scopeId, signal);
    const data = readData();
    const turn = findTurn(data, ref);
    const current = snapshot(turn);
    if (current.status !== 'queued' && current.status !== 'running') return current;

    turn.cancelled = { ...fixture.cancelTurn, ...current, status: 'cancelled' };
    saveData(data);
    return turn.cancelled;
  }
}
