import * as ec from "../../../src/index.js";
import { printChatMessages } from "../views/chat.js";

export class ChatController {
   public constructor(private readonly chat: ec.Chat) {}

   public async show(): Promise<void> {
      await this.chat.fetch();
      printChatMessages(this.chat.messages);
   }
}
