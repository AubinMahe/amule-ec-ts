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
      let clientId: bigint;
      if (mode === "session" && args[1] && args.length > 2) {
         clientId = await this.chat.sendToSession(BigInt(args[1]), args.slice(2).join(" "));
      } else if (mode === "address" && args[1] && args[2] && args.length > 3) {
         clientId = await this.chat.sendToAddress(args[1], Number(args[2]), args.slice(3).join(" "));
      } else {
         console.error("Usage: chat send <session <client-id>|address <ip> <port>> <text>");
         return;
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
      console.error(
         "Usage: chat <send <session <client-id>|address <ip> <port>> <text>|close <client-id>|history <client-id> [cursor]>",
      );
   }
}
