import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECTag, ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:chat");

/**
 * One EC_TAG_CHAT entry from an EC_OP_CHAT_MESSAGES reply.
 *
 * Confirmed against ExternalConn.cpp's EC_OP_GET_CHAT_MESSAGES case
 * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3727-L3739)
 * and amule-remote-gui.cpp's CChatMsgHandlerRem::HandlePacket()
 * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L1120-L1140):
 * the tag's own data is the pre-formatted "name|message" string - the EC
 * layer doesn't split sender name out of it (the reference GUI doesn't
 * either, passing the raw string straight to CChatWnd::ProcessMessage(),
 * so this library doesn't invent a split the reference client itself
 * skips). senderId comes from the EC_TAG_CHAT_CLIENT_ID child - confirmed
 * **uint64** (`m_chatQueue`'s own type is
 * `std::list<std::pair<uint64, wxString>>`, ExternalConn.cpp:520), unlike
 * every other client/server/friend identifier in this library, which are
 * uint32 ECIDs.
 */
export class ChatMessage {
   public readonly senderId: bigint;
   public readonly text: string;

   private constructor(fields: { senderId: bigint; text: string }) {
      this.senderId = fields.senderId;
      this.text = fields.text;
   }

   public static fromTag(tag: ECTag): ChatMessage {
      return new ChatMessage({
         senderId: tag.childInt(ECTagNames.EC_TAG_CHAT_CLIENT_ID) ?? 0n,
         text: tag instanceof ECStringTag ? tag.value : "",
      });
   }
}

/**
 * A one-shot drain of the daemon's buffered *incoming* chat messages -
 * EC_OP_GET_CHAT_MESSAGES / EC_OP_CHAT_MESSAGES. There is no opcode to
 * send a chat message anywhere in the EC protocol: messages arrive at the
 * daemon over the raw ed2k client protocol from other peers, and this is
 * purely a poll of what's already buffered there - each fetch() clears
 * the daemon's queue, so a message only ever appears in one fetch()'s
 * `messages`, never again on a later call.
 */
export class Chat implements ECFetchable {
   public messages: readonly ChatMessage[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Confirmed against ExternalConn.cpp's EC_OP_GET_CHAT_MESSAGES case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3727-L3739):
    * no request tags. Reply carries zero or more EC_TAG_CHAT tags (empty
    * if nothing buffered) - see ChatMessage's class doc for their shape.
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_CHAT_MESSAGES);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_CHAT_MESSAGES) {
         throw new Error(`Expected EC_OP_CHAT_MESSAGES, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.messages = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_CHAT;
         })
         .map((tag) => ChatMessage.fromTag(tag));
      debug("fetch: %d message(s)", this.messages.length);
   }
}
