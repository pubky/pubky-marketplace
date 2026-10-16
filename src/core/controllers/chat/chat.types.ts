import type { ChatContext, ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';

export type ChatConversationView = ChatConversationModelSchema & { unreadCount: number };
export type ChatMessageView = ChatMessageModelSchema;
export type ChatSendParams = { peerPubky: string; body: string; context?: ChatContext };
