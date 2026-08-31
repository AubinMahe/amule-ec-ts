import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECTag, ECUInt32Tag, ECUInt64Tag, ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:chat");

/**
 * A chat message's direction within its session - `EC_TAG_CHAT_DIRECTION`.
 */
export enum ChatDirection {
   IN = 0,
   OUT = 1,
}

/**
 * One message within a `ChatSession` - `EC_TAG_CHAT_MESSAGE`.
 *
 * Confirmed against the daemon's chat session store: own data is the message text; `id` is
 * monotonic across the *whole* store, not per session - never reused and never renumbered on
 * eviction, which is what makes `Chat.fetch()`'s single resume cursor safe (a per-session counter
 * could let a client miss a message that landed in a different session while it was polling).
 */
export class ChatMessage {
   public constructor(
      public readonly id: bigint,
      public readonly direction: ChatDirection,
      /**
       * Unix timestamp (seconds), stamped by the daemon.
       */
      public readonly timestamp: bigint,
      public readonly text: string,
   ) {}

   public static fromTag(tag: ECTag): ChatMessage {
      const direction: ChatDirection = Number(tag.childInt(ECTagNames.EC_TAG_CHAT_DIRECTION) ?? 0n);
      return new ChatMessage(
         tag.childInt(ECTagNames.EC_TAG_CHAT_MSG_ID) ?? 0n,
         direction,
         tag.childInt(ECTagNames.EC_TAG_CHAT_TIMESTAMP) ?? 0n,
         tag.stringValue ?? "",
      );
   }
}

/**
 * One chat conversation with a peer - `EC_TAG_CHAT_SESSION`, from an `EC_OP_CHAT_SESSIONS` reply
 * or an `EC_OP_CHAT_MESSAGES` backfill (see `Chat.fetchHistory()`).
 *
 * `clientId` (own data) is the same GUI_ID every send/close call below addresses a session by -
 * confirmed stable across the session's lifetime, unlike `clientEcid` which only resolves while
 * the peer is actually connected. `clientEcid`/`friendEcid` link the live peer and the friend-list
 * entry when either currently resolves, so a caller can join against its own `Uploads`/`Update` or
 * `Friends` view without a lookup of its own - both are `undefined`, not `0n`, when absent.
 */
export class ChatSession {
   public constructor(
      public readonly clientId: bigint,
      public readonly peerName: string,
      public readonly clientEcid: bigint | undefined,
      public readonly friendEcid: bigint | undefined,
      public readonly messages: readonly ChatMessage[],
   ) {}

   public static fromTag(tag: ECTag): ChatSession {
      return new ChatSession(
         tag.intValue ?? 0n,
         tag.childString(ECTagNames.EC_TAG_CHAT_PEER_NAME) ?? "",
         tag.childInt(ECTagNames.EC_TAG_CLIENT),
         tag.childInt(ECTagNames.EC_TAG_FRIEND),
         tag.children
            .filter((child) => {
               const name: ECTagNames = child.name;
               return name === ECTagNames.EC_TAG_CHAT_MESSAGE;
            })
            .map((child) => ChatMessage.fromTag(child)),
      );
   }
}

function compareMessageId(a: ChatMessage, b: ChatMessage): number {
   if (a.id < b.id) {
      return -1;
   }
   return a.id > b.id ? 1 : 0;
}

/**
 * Merges freshly-decoded messages into what a session already has, keyed by `ChatMessage.id` -
 * `incoming` may repeat an id `previous` already holds (e.g. `fetchHistory()`'s no-cursor form
 * returns a session's *entire* retained history, not just what's arrived since the last `fetch()`)
 * and may also carry ids *older* than anything in `previous` (backfilling a session that predates
 * this connection's own polling) - sorted by id afterward rather than assumed append-only, so
 * either case lands in the right place.
 */
function mergeMessages(previous: readonly ChatMessage[], incoming: readonly ChatMessage[]): readonly ChatMessage[] {
   if (incoming.length === 0) {
      return previous;
   }
   const byId = new Map(previous.map((message) => [message.id, message]));
   for (const message of incoming) {
      byId.set(message.id, message);
   }
   return [...byId.values()].sort(compareMessageId);
}

/**
 * The daemon's chat session store - `EC_OP_GET_CHAT_SESSIONS`/`EC_OP_CHAT_SESSIONS`,
 * `EC_OP_CHAT_SEND`, `EC_OP_CHAT_CLOSE_SESSION`, and the repurposed
 * `EC_OP_GET_CHAT_MESSAGES`/`EC_OP_CHAT_MESSAGES` (see `fetchHistory()`).
 *
 * Replaces this library's previous `Chat` entirely rather than adding to it: upstream re-specified
 * `EC_OP_GET_CHAT_MESSAGES` itself from a destructive, tag-less drain of a per-connection queue
 * into the non-destructive backfill of one named session below - the old queue is gone from the
 * daemon along with the shape this library used to decode, there is no compatible middle ground to
 * preserve. A message is now only ever seen through a session (there is no bare, session-less chat
 * event anymore), and closing is global: a session absent from a later `fetch()` reply was closed
 * on some other connection, not just this one.
 *
 * Poll-only, like the reference `amuleapi`'s own chat support: there is no push notification for
 * chat, `fetch()` must be called again to see anything new.
 *
 * Guarded on `connection.remoteCapabilities.chatSessions` - unlike `clientHistory`/
 * `sharedDirsConfig`/`searchList`, this is a genuine client opt-in rather than an unconditional
 * version probe (see `ECCapabilities.chatSessions`'s doc for why): pass
 * `ECEngineStartOptions.chatSessions` (or set `connection.localCapabilities.chatSessions` before
 * authenticating). A daemon that never saw the request tag never echoes it back, and sending any
 * of these opcodes regardless risks the same unknown-opcode assert `SharedFiles.getSharedDirs()`'s
 * doc describes.
 */
export class Chat implements ECFetchable {
   public sessions: readonly ChatSession[] = [];

   /**
    * This connection's own resume point into the store's globally-monotonic message ids - see
    * ChatMessage's doc. 0n (the store's own "nothing yet" sentinel) means "send me everything you
    * still have".
    */
   private cursor = 0n;

   public constructor(public readonly connection: ECConnection) {}

   private requireCapability(): void {
      if (!this.connection.remoteCapabilities.chatSessions) {
         throw new Error(
            "The daemon did not confirm EC_TAG_CAN_CHAT_SESSIONS during authentication - " +
               "set ECEngineStartOptions.chatSessions (or connection.localCapabilities.chatSessions) " +
               "before authenticating, and only use Chat once the daemon has echoed it back.",
         );
      }
   }

   /**
    * Polls `EC_OP_GET_CHAT_SESSIONS` with this connection's own resume cursor and merges the reply
    * into `sessions`: the reply's session list *replaces* the tracked set wholesale (a session this
    * connection was tracking that's missing from a reply was closed elsewhere), while each
    * session's messages are merged rather than replaced (see `mergeMessages()`) - a session with
    * nothing new since the last `fetch()` is still listed, with no message children, which is also
    * how a late-connecting caller learns a session already existed before it started polling.
    */
   public async fetch(): Promise<void> {
      this.requireCapability();
      const request = new ECPacket(ECOpcode.EC_OP_GET_CHAT_SESSIONS);
      if (this.cursor !== 0n) {
         request.add(new ECUInt32Tag(ECTagNames.EC_TAG_CHAT_MSG_ID, Number(this.cursor)));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_CHAT_SESSIONS) {
         throw new Error(`Expected EC_OP_CHAT_SESSIONS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.cursor = reply.find(ECTagNames.EC_TAG_CHAT_MSG_ID)?.intValue ?? this.cursor;
      const previousByClientId = new Map(this.sessions.map((session) => [session.clientId, session]));
      this.sessions = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_CHAT_SESSION;
         })
         .map((tag) => {
            const update = ChatSession.fromTag(tag);
            const previous = previousByClientId.get(update.clientId);
            const messages = previous ? mergeMessages(previous.messages, update.messages) : update.messages;
            return new ChatSession(update.clientId, update.peerName, update.clientEcid, update.friendEcid, messages);
         });
      debug("fetch: %d session(s)", this.sessions.length);
   }

   /**
    * Backfills one session's messages without waiting for `fetch()`'s incremental cursor to reach
    * it - `EC_OP_GET_CHAT_MESSAGES`/`EC_OP_CHAT_MESSAGES`, repurposed by upstream (see class doc)
    * into a non-destructive read of ONE session, useful for opening a session that already existed
    * before this connection started polling. `cursor`, when given, scopes the backfill to messages
    * newer than it *within this session only* - unlike `fetch()`'s own cursor, which is global
    * across the whole store; omit it for this session's entire retained history.
    *
    * Merges into that session's messages the same way `fetch()` does (see `mergeMessages()`) rather
    * than replacing them, so a session `fetch()` had already partly populated keeps what it had.
    * Also advances `fetch()`'s own resume cursor from this reply's top-level id, since it carries
    * the identical "you have everything up to this id" meaning - without that, a later `fetch()`
    * would re-deliver messages this call already merged in (harmlessly deduplicated by
    * `mergeMessages()`, but wastefully).
    */
   public async fetchHistory(clientId: bigint, cursor?: bigint): Promise<void> {
      this.requireCapability();
      const request = new ECPacket(ECOpcode.EC_OP_GET_CHAT_MESSAGES);
      request.add(new ECUInt64Tag(ECTagNames.EC_TAG_CHAT_CLIENT_ID, clientId));
      if (cursor !== undefined) {
         request.add(new ECUInt32Tag(ECTagNames.EC_TAG_CHAT_MSG_ID, Number(cursor)));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason =
            reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to fetch chat history for session ${clientId}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_CHAT_MESSAGES) {
         throw new Error(`Expected EC_OP_CHAT_MESSAGES, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.cursor = reply.find(ECTagNames.EC_TAG_CHAT_MSG_ID)?.intValue ?? this.cursor;
      const sessionTag = reply.find(ECTagNames.EC_TAG_CHAT_SESSION);
      if (!sessionTag) {
         debug("fetchHistory: clientId=%s, no session tag in reply", clientId);
         return;
      }
      const update = ChatSession.fromTag(sessionTag);
      const previous = this.sessions.find((session) => session.clientId === clientId);
      const messages = previous ? mergeMessages(previous.messages, update.messages) : update.messages;
      const merged = new ChatSession(update.clientId, update.peerName, update.clientEcid, update.friendEcid, messages);
      this.sessions = [...this.sessions.filter((session) => session.clientId !== clientId), merged];
      debug("fetchHistory: clientId=%s, %d message(s)", clientId, merged.messages.length);
   }

   /**
    * Sends `EC_OP_CHAT_SEND` addressed by `targetTag`, returning the resolved `clientId` (the
    * GUI_ID `sendToSession()`/`closeSession()` address a session by) - shared by
    * `sendToSession()`/`sendToClient()`/`sendToFriend()`, which differ only in which tag addresses
    * the target. A `false`-ish send result at the daemon (message queued while a connection to the
    * peer is still being established) is not surfaced as failure here either, matching upstream's
    * own reasoning: it is not an error, the message still arrives once connected.
    */
   private async sendTo(targetTag: ECTag, text: string, failureMessage: string): Promise<bigint> {
      this.requireCapability();
      const request = new ECPacket(ECOpcode.EC_OP_CHAT_SEND);
      request.add(new ECStringTag(ECTagNames.EC_TAG_CHAT, text));
      request.add(targetTag);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : failureMessage;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      return reply.find(ECTagNames.EC_TAG_CHAT_CLIENT_ID)?.intValue ?? 0n;
   }

   /**
    * Sends a message within an already-open session, by its `clientId` - what the desktop GUI's
    * own chat tabs do, since a tab already knows its peer's `clientId` from when the session was
    * opened.
    */
   public async sendToSession(clientId: bigint, text: string): Promise<bigint> {
      const resolved = await this.sendTo(
         new ECUInt64Tag(ECTagNames.EC_TAG_CHAT_CLIENT_ID, clientId),
         text,
         `Failed to send to chat session ${clientId}.`,
      );
      debug("sendToSession: clientId=%s", clientId);
      return resolved;
   }

   /**
    * Starts or continues a conversation with a currently-connected client, by ECID - correlate
    * against `ChatSession.clientEcid` or `Uploads`/`Update`'s own client entries.
    */
   public async sendToClient(clientEcid: bigint, text: string): Promise<bigint> {
      const resolved = await this.sendTo(
         new ECUInt32Tag(ECTagNames.EC_TAG_CLIENT, Number(clientEcid)),
         text,
         `Failed to send to client ${clientEcid}.`,
      );
      debug("sendToClient: clientEcid=%s", clientEcid);
      return resolved;
   }

   /**
    * Starts or continues a conversation with a friend who may currently be OFFLINE, by ECID -
    * resolved daemon-side through the friend's own stored address, which is what makes messaging
    * an offline friend work at all. Correlate against `ChatSession.friendEcid` or `Friends`'s own
    * entries.
    */
   public async sendToFriend(friendEcid: bigint, text: string): Promise<bigint> {
      const resolved = await this.sendTo(
         new ECUInt32Tag(ECTagNames.EC_TAG_FRIEND, Number(friendEcid)),
         text,
         `Failed to send to friend ${friendEcid}.`,
      );
      debug("sendToFriend: friendEcid=%s", friendEcid);
      return resolved;
   }

   /**
    * Closes a chat session globally - every EC client (and the desktop GUI, if attached) drops its
    * tab, the same as closing a search tab destroys its core bucket for every client -
    * `EC_OP_CHAT_CLOSE_SESSION`. Does not remove the session from `sessions` itself: call `fetch()`
    * again to see it reflected, the same convention as every other mutation in this library (see
    * e.g. `Downloads.cancel()`'s doc).
    */
   public async closeSession(clientId: bigint): Promise<void> {
      this.requireCapability();
      const request = new ECPacket(ECOpcode.EC_OP_CHAT_CLOSE_SESSION);
      request.add(new ECUInt64Tag(ECTagNames.EC_TAG_CHAT_CLIENT_ID, clientId));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to close chat session ${clientId}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("closeSession: clientId=%s", clientId);
   }
}
