import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

/**
 * Builds a synthetic EC_TAG_CHAT_MESSAGE tag, as ChatMessage.fromTag() reads it.
 */
function messageTag(id: number, direction: ec.ChatDirection, timestamp: number, text: string): ec.ECTag {
   return new ec.ECStringTag(ec.ECTagNames.EC_TAG_CHAT_MESSAGE, text, [
      new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CHAT_MSG_ID, id),
      new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CHAT_DIRECTION, direction),
      new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CHAT_TIMESTAMP, timestamp),
   ]);
}

/**
 * Builds a synthetic EC_TAG_CHAT_SESSION tag, as ChatSession.fromTag() reads it.
 */
function sessionTag(fields: {
   clientId: bigint;
   peerName?: string;
   clientEcid?: number;
   friendEcid?: number;
   messages?: ec.ECTag[];
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.peerName !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CHAT_PEER_NAME, fields.peerName));
   }
   if (fields.clientEcid !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT, fields.clientEcid));
   }
   if (fields.friendEcid !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND, fields.friendEcid));
   }
   children.push(...(fields.messages ?? []));
   return new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CHAT_SESSION, fields.clientId, children);
}

function withChatCapability(fake: ReturnType<typeof createFakeConnection>): void {
   fake.connection.remoteCapabilities.chatSessions = true;
}

describe("ChatMessage.fromTag", () => {
   it("reads id/direction/timestamp/text", () => {
      const message = ec.ChatMessage.fromTag(messageTag(5, ec.ChatDirection.OUT, 1_700_000_000, "hello"));
      expect(message.id).to.equal(5n);
      expect(message.direction).to.equal(ec.ChatDirection.OUT);
      expect(message.timestamp).to.equal(1_700_000_000n);
      expect(message.text).to.equal("hello");
   });
});

describe("ChatSession.fromTag", () => {
   it("reads clientId/peerName/clientEcid/friendEcid and decodes each message", () => {
      const session = ec.ChatSession.fromTag(
         sessionTag({
            clientId: 123456789n,
            peerName: "Alice",
            clientEcid: 7,
            friendEcid: 3,
            messages: [messageTag(1, ec.ChatDirection.IN, 100, "hi")],
         }),
      );
      expect(session.clientId).to.equal(123456789n);
      expect(session.peerName).to.equal("Alice");
      expect(session.clientEcid).to.equal(7n);
      expect(session.friendEcid).to.equal(3n);
      expect(session.messages).to.have.lengthOf(1);
      expect(session.messages[0]?.text).to.equal("hi");
   });

   it("leaves clientEcid/friendEcid undefined when absent, messages empty", () => {
      const session = ec.ChatSession.fromTag(sessionTag({ clientId: 1n }));
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(session.clientEcid).to.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(session.friendEcid).to.be.undefined;
      expect(session.messages).to.deep.equal([]);
   });
});

describe("Chat.fetch", () => {
   it("throws when the daemon never confirmed EC_TAG_CAN_CHAT_SESSIONS, without sending anything", async () => {
      const fake = createFakeConnection();
      const chat = new ec.Chat(fake.connection);

      await expectRejection(chat.fetch(), /EC_TAG_CAN_CHAT_SESSIONS/);
      expect(fake.sent).to.have.lengthOf(0);
   });

   it("sends no cursor tag on the first call, decodes each EC_TAG_CHAT_SESSION", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_SESSIONS);
      reply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CHAT_MSG_ID, 10));
      reply.add(sessionTag({ clientId: 1n, peerName: "Alice", messages: [messageTag(1, ec.ChatDirection.IN, 100, "hi")] }));
      fake.queueReply(reply);

      await chat.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_CHAT_SESSIONS);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(chat.sessions).to.have.lengthOf(1);
      expect(chat.sessions[0]?.peerName).to.equal("Alice");
      expect(chat.sessions[0]?.messages).to.have.lengthOf(1);
   });

   it("sends the resume cursor on a later call, and merges new messages onto a known session", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const first = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_SESSIONS);
      first.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CHAT_MSG_ID, 1));
      first.add(sessionTag({ clientId: 1n, peerName: "Alice", messages: [messageTag(1, ec.ChatDirection.IN, 100, "hi")] }));
      fake.queueReply(first);
      await chat.fetch();

      const second = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_SESSIONS);
      second.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CHAT_MSG_ID, 2));
      second.add(sessionTag({ clientId: 1n, peerName: "Alice", messages: [messageTag(2, ec.ChatDirection.OUT, 200, "hey")] }));
      fake.queueReply(second);
      await chat.fetch();

      expect(fake.sent[1]?.find(ec.ECTagNames.EC_TAG_CHAT_MSG_ID)?.intValue).to.equal(1n);
      expect(chat.sessions).to.have.lengthOf(1);
      expect(chat.sessions[0]?.messages.map((m) => m.text)).to.deep.equal(["hi", "hey"]);
   });

   it("drops a session missing from a later reply (closed elsewhere)", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const first = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_SESSIONS);
      first.add(sessionTag({ clientId: 1n, peerName: "Alice" }));
      fake.queueReply(first);
      await chat.fetch();

      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_SESSIONS));
      await chat.fetch();

      expect(chat.sessions).to.have.lengthOf(0);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(chat.fetch(), /EC_OP_CHAT_SESSIONS/);
   });
});

describe("Chat.fetchHistory", () => {
   it("sends the client id as EC_TAG_CHAT_CLIENT_ID and merges the backfilled session", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_MESSAGES);
      reply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CHAT_MSG_ID, 5));
      reply.add(sessionTag({ clientId: 42n, peerName: "Bob", messages: [messageTag(5, ec.ChatDirection.IN, 500, "old")] }));
      fake.queueReply(reply);

      await chat.fetchHistory(42n);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_CHAT_MESSAGES);
      const idTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CHAT_CLIENT_ID);
      expect(idTag?.intValue).to.equal(42n);
      expect(chat.sessions).to.have.lengthOf(1);
      expect(chat.sessions[0]?.messages[0]?.text).to.equal("old");
   });

   it("sends the optional cursor as EC_TAG_CHAT_MSG_ID", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_MESSAGES));

      await chat.fetchHistory(42n, 3n);

      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CHAT_MSG_ID)?.intValue).to.equal(3n);
   });

   it("merges older backfilled messages ahead of newer ones already known, sorted by id", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const polled = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_SESSIONS);
      polled.add(sessionTag({ clientId: 1n, messages: [messageTag(10, ec.ChatDirection.IN, 1000, "newer")] }));
      fake.queueReply(polled);
      await chat.fetch();

      const backfill = new ec.ECPacket(ec.ECOpcode.EC_OP_CHAT_MESSAGES);
      backfill.add(sessionTag({ clientId: 1n, messages: [messageTag(1, ec.ChatDirection.IN, 100, "older")] }));
      fake.queueReply(backfill);
      await chat.fetchHistory(1n);

      expect(chat.sessions[0]?.messages.map((m) => m.text)).to.deep.equal(["older", "newer"]);
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "No such chat session"));
      fake.queueReply(failure);

      await expectRejection(chat.fetchHistory(42n), /No such chat session/);
   });
});

describe("Chat.sendToSession/sendToClient/sendToFriend", () => {
   it("sendToSession sends EC_TAG_CHAT + EC_TAG_CHAT_CLIENT_ID and returns the resolved id", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP);
      reply.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CHAT_CLIENT_ID, 99n));
      fake.queueReply(reply);

      const resolved = await chat.sendToSession(99n, "hi");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CHAT_SEND);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CHAT)?.stringValue).to.equal("hi");
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CHAT_CLIENT_ID)?.intValue).to.equal(99n);
      expect(resolved).to.equal(99n);
   });

   it("sendToClient sends EC_TAG_CLIENT as the target", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await chat.sendToClient(7n, "hi");

      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CLIENT)?.intValue).to.equal(7n);
   });

   it("sendToFriend sends EC_TAG_FRIEND as the target", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await chat.sendToFriend(3n, "hi");

      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND)?.intValue).to.equal(3n);
   });

   it("throws the daemon's reason on EC_OP_FAILED (empty text or unknown target)", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Unknown chat target"));
      fake.queueReply(failure);

      await expectRejection(chat.sendToClient(7n, "hi"), /Unknown chat target/);
   });
});

describe("Chat.closeSession", () => {
   it("sends EC_TAG_CHAT_CLIENT_ID and succeeds on EC_OP_NOOP, without touching sessions", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await chat.closeSession(42n);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CHAT_CLOSE_SESSION);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CHAT_CLIENT_ID)?.intValue).to.equal(42n);
      expect(chat.sessions).to.deep.equal([]);
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      withChatCapability(fake);
      const chat = new ec.Chat(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "No such chat session"));
      fake.queueReply(failure);

      await expectRejection(chat.closeSession(42n), /No such chat session/);
   });
});
