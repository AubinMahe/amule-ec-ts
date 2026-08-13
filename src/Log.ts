import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECStringTag, ECCustomTag } from "./ECTags.js";

const debug = debuglog("amule-ec:log");

/** The daemon's accumulated log, as returned by EC_OP_GET_LOG / EC_OP_LOG. */
export class Log implements ECFetchable {
   public lines: readonly string[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Confirmed against
    * https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2888-L2890:
    * unlike the list-style replies elsewhere in this client, the whole log
    * is carried as a *single* EC_TAG_STRING (`theApp->GetLog(false)`),
    * newline-separated - not one tag per line. No request tag is needed
    * (Get_EC_Response_Log ignores the request packet's content).
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_LOG);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_LOG) {
         throw new Error(`Expected EC_OP_LOG, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const textTag = reply.find(ECTagNames.EC_TAG_STRING);
      const text = textTag instanceof ECStringTag ? textTag.value : "";
      this.lines = text
         .split(/\r?\n/)
         .map((line) => line.trim())
         .filter((line) => line.length > 0);
      debug("fetch: %d line(s)", this.lines.length);
   }

   /**
    * Clears the daemon's log - the EC equivalent of amulecmd's "reset"
    * command. Confirmed against ExternalConn.cpp:2896-2899
    * (`case EC_OP_RESET_LOG: theApp->GetLog(true); response = new
    * CECPacket(EC_OP_NOOP);`): no request tag needed, and the reply
    * carries no data of its own, just the opcode.
    */
   public async reset(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_RESET_LOG);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("reset: log cleared");
   }

   /**
    * Appends a line to the daemon's log - EC_OP_ADDLOGLINE.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_ADDLOGLINE case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3675-L3682):
    * the request carries the text as an EC_TAG_STRING tag; a bare,
    * presence-only EC_TAG_LOG_TO_STATUS tag (no value read, just checked
    * for existence - same shape ECConnection.ts's capability negotiation
    * already uses, `new ECCustomTag(name, new Uint8Array())`) picks
    * AddLogLineC (also echoed to the status bar) over AddLogLineN (log
    * only) when present. No first-party caller exists anywhere in the
    * aMule tree for this opcode - unlike every other method in this
    * library, the daemon's own request-parsing code is the only source
    * confirming this shape. Always replies EC_OP_NOOP. Unlike
    * DebugLog.addLine()'s toStatus, this one's `false`/omitted path
    * (AddLogLineN) is *not* gated behind a debug build - it always
    * records the line either way, `toStatus` only adds the status-bar
    * echo here.
    */
   public async addLine(text: string, toStatus?: boolean): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_ADDLOGLINE);
      request.add(new ECStringTag(ECTagNames.EC_TAG_STRING, text));
      if (toStatus) {
         request.add(new ECCustomTag(ECTagNames.EC_TAG_LOG_TO_STATUS, new Uint8Array()));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("addLine: %s", text);
   }

   /**
    * Fetches only the daemon log's single latest line -
    * EC_OP_GET_LAST_LOG_ENTRY.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_GET_LAST_LOG_ENTRY case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3711-L3717):
    * reuses the *main* log's EC_OP_LOG reply opcode (not a distinct one),
    * carrying only the text after the log's last '\n' - not the full
    * cumulative log fetch() caches. Deliberately does not touch
    * `this.lines`, which stays whatever the last fetch() populated -
    * this is a separate, lightweight query. No request tag needed.
    * Returns undefined if the log is empty.
    */
   public async fetchLast(): Promise<string | undefined> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_LAST_LOG_ENTRY);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_LOG) {
         throw new Error(`Expected EC_OP_LOG, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const textTag = reply.find(ECTagNames.EC_TAG_STRING);
      const text = textTag instanceof ECStringTag ? textTag.value.trim() : "";
      debug("fetchLast: %s", text);
      return text.length > 0 ? text : undefined;
   }
}

/** The daemon's accumulated debug log, as returned by EC_OP_GET_DEBUGLOG / EC_OP_DEBUGLOG - structurally identical to Log. */
export class DebugLog implements ECFetchable {
   public lines: readonly string[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Confirmed against ExternalConn.cpp's EC_OP_GET_DEBUGLOG case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3699-L3702,
    * `theApp->GetDebugLog(false)`): same shape as Log.fetch() - one
    * EC_TAG_STRING, newline-separated. No first-party caller exists
    * anywhere in the aMule tree for this opcode. No request tag needed.
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_DEBUGLOG);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_DEBUGLOG) {
         throw new Error(`Expected EC_OP_DEBUGLOG, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const textTag = reply.find(ECTagNames.EC_TAG_STRING);
      const text = textTag instanceof ECStringTag ? textTag.value : "";
      this.lines = text
         .split(/\r?\n/)
         .map((line) => line.trim())
         .filter((line) => line.length > 0);
      debug("DebugLog.fetch: %d line(s)", this.lines.length);
   }

   /**
    * Clears the daemon's debug log - EC_OP_RESET_DEBUGLOG.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_RESET_DEBUGLOG case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3707-L3710,
    * `theApp->GetDebugLog(true)`): exact mirror of Log.reset(). No
    * request tag needed, always replies EC_OP_NOOP.
    */
   public async reset(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_RESET_DEBUGLOG);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("DebugLog.reset: debug log cleared");
   }

   /**
    * Appends a line to the daemon's debug log - EC_OP_ADDDEBUGLOGLINE.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_ADDDEBUGLOGLINE case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3684-L3691,
    * `AddDebugLogLineC/N(logGeneral, ...)`): same shape as Log.addLine() -
    * EC_TAG_STRING for the text, optional presence-only EC_TAG_LOG_TO_STATUS.
    * Always replies EC_OP_NOOP - **but that reply does not mean the line
    * was recorded**. Confirmed against Logger.h:409-449 and reproduced
    * live against a real amuled: `AddDebugLogLineN` (toStatus omitted) is
    * `#define`d to a complete no-op unless the daemon binary itself was
    * built with `__DEBUG__` - a normal release `amuled` silently drops the
    * line while still replying EC_OP_NOOP. `AddDebugLogLineC` (toStatus:
    * true) is **not** gated this way and always records the line,
    * regardless of build type. In other words: on a typical daemon,
    * `toStatus: true` isn't just "also echo to the status bar" as its name
    * suggests - it's the only variant of this call that reliably does
    * anything at all.
    */
   public async addLine(text: string, toStatus?: boolean): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_ADDDEBUGLOGLINE);
      request.add(new ECStringTag(ECTagNames.EC_TAG_STRING, text));
      if (toStatus) {
         request.add(new ECCustomTag(ECTagNames.EC_TAG_LOG_TO_STATUS, new Uint8Array()));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("DebugLog.addLine: %s", text);
   }
}
