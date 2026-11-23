import type { FixturePreview } from '../home.page';
import chat from '../core/api/contract/fixtures/chat.json';
import type { ConversationSummary } from '../core/api/contract/openapi.generated';

const conversation = chat.createConversation.response satisfies ConversationSummary;

export const fixturePreview: FixturePreview = {
  heading: 'Modo de prueba',
  conversationTitle: conversation.title,
};
