"use client";

import type { ConversationView } from "@nexo/shared";
import { createContext, type ReactNode, useContext, useState } from "react";

type ChatStatus = {
  conversation: ConversationView | null;
  setConversation: (conversation: ConversationView | null) => void;
};

const Context = createContext<ChatStatus | null>(null);

/**
 * Who answers her now, shared by the chat, which learns it, and the pill of the top bar, which shows it: they are drawn
 * apart, the pill in the top bar and the chat under it.
 */
export function ChatStatusProvider({ initial, children }: { initial: ConversationView | null; children: ReactNode }) {
  const [conversation, setConversation] = useState(initial);
  return <Context.Provider value={{ conversation, setConversation }}>{children}</Context.Provider>;
}

export function useChatStatus(): ChatStatus {
  const status = useContext(Context);
  if (!status) throw new Error("useChatStatus needs a ChatStatusProvider");
  return status;
}
