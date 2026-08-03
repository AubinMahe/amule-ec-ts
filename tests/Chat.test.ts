import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

/** Builds a synthetic EC_TAG_CHAT tag as Chat.fetch() sees it: own data is the "name|message" string, EC_TAG_CHAT_CLIENT_ID (uint64) is a child. */
function chatTag(senderId: bigint, text: string): ec.ECTag {
   return new ec.ECStringTag(ec.ECTagNames.EC_TAG_CHAT, text, [
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CHAT_CLIENT_ID, senderId),
   ]);
}

describe("ChatMessage.fromTag", () => {
   it("reads the raw text from own data and senderId from EC_TAG_CHAT_CLIENT_ID", () => {
      const message = ec.ChatMessage.fromTag(chatTag(123456789012n, "Alice|hello there"));
      expect(message.text).to.equal("Alice|hello there");
      expect(message.senderId).to.equal(123456789012n);
   });

   it("defaults senderId to 0n when the child is missing", () => {
      const message = ec.ChatMessage.fromTag(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CHAT, "x"));
      expect(message.senderId).to.equal(0n);
   });
});

describe("Chat.fetch", () => {
   it("sends no request tags and parses each EC_TAG_CHAT reply tag", async () => {
      const fake = createFakeConnection();
      const chat = new ec.Chat(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_MESSAGES);
      reply.add(chatTag(1n, "Alice|hi"));
      reply.add(chatTag(2n, "Bob|yo"));
      fake.queueReply(reply);

      await chat.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_CHAT_MESSAGES);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(chat.messages).to.have.lengthOf(2);
      expect(chat.messages.map((m) => m.text)).to.deep.equal(["Alice|hi", "Bob|yo"]);
   });

   it("results in an empty array when the daemon has nothing buffered", async () => {
      const fake = createFakeConnection();
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_MESSAGES));

      await chat.fetch();

      expect(chat.messages).to.have.lengthOf(0);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(chat.fetch(), /EC_OP_CHAT_MESSAGES/);
   });
});
