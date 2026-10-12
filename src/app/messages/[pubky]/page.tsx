import { stripPubkyPrefix } from '@/libs/utils/utils';
import { ChatConversation } from '@/templates/Chat/ChatConversation';

interface ChatConversationPageProps {
  params: Promise<{ pubky: string }>;
}

export default async function ChatConversationPage({ params }: ChatConversationPageProps) {
  const { pubky } = await params;
  const peerPubky = stripPubkyPrefix(decodeURIComponent(pubky));
  return <ChatConversation peerPubky={peerPubky} />;
}
