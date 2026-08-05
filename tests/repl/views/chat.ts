import * as ec from "../../../src/index.js";

export function printChatMessages(messages: readonly ec.ChatMessage[]): void {
   if (messages.length === 0) {
      console.log("No new chat messages.");
      return;
   }

   for (const message of messages) {
      console.log(`[${message.senderId}] ${message.text}`);
   }
}
