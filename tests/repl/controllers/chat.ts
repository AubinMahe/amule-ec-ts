import * as ec from "../../../src/index.js";
import { printChatSessions } from "../views/chat.js";

/**
 * Chat session-store commands ("show chat"/"chat send|close|history") - all operate on ec.Chat
 * alone.
 */
export class ChatController {
   public constructor(private readonly chat: ec.Chat) {}

   public async show(): Promise<void> {
      await this.chat.fetch();
      printChatSessions(this.chat.sessions);
   }

   public async history(args: string[]): Promise<void> {
      const clientIdText = args[0];
      if (!clientIdText) {
         console.error("Usage: chat history <client-id> [cursor]");
         return;
      }
      const cursor = args[1] ? BigInt(args[1]) : undefined;
      await this.chat.fetchHistory(BigInt(clientIdText), cursor);
      printChatSessions(this.chat.sessions);
   }

   public async close(args: string[]): Promise<void> {
      const clientIdText = args[0];
      if (!clientIdText) {
         console.error("Usage: chat close <client-id>");
         return;
      }
      await this.chat.closeSession(BigInt(clientIdText));
      console.log(`Chat session closed: ${clientIdText}.`);
   }

   public async send(args: string[]): Promise<void> {
      const mode = args[0]?.toLowerCase();
      const idText = args[1];
      const text = args.slice(2).join(" ");
      if (!idText || !text || (mode !== "session" && mode !== "client" && mode !== "friend")) {
         console.error("Usage: chat send <session|client|friend> <id> <text>");
         return;
      }
      const id = BigInt(idText);
      let clientId: bigint;
      if (mode === "session") {
         clientId = await this.chat.sendToSession(id, text);
      } else if (mode === "client") {
         clientId = await this.chat.sendToClient(id, text);
      } else {
         clientId = await this.chat.sendToFriend(id, text);
      }
      console.log(`Message sent: client-id=${clientId}.`);
   }

   public async dispatch(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "send") {
         await this.send(args.slice(1));
         return;
      }
      if (sub === "close") {
         await this.close(args.slice(1));
         return;
      }
      if (sub === "history") {
         await this.history(args.slice(1));
         return;
      }
      console.error("Usage: chat <send <session|client|friend> <id> <text>|close <client-id>|history <client-id> [cursor]>");
   }
}
