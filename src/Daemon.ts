import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:daemon");

/** Daemon-wide commands that don't belong to any single resource (ed2k/Kad networks, downloads, ...). */
export class Daemon {
   public constructor(public readonly connection: ECConnection) {}

   /**
    * Tells the daemon to terminate - EC_OP_SHUTDOWN.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_SHUTDOWN case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3087-L3098):
    * no request tags. Replies EC_OP_NOOP if not already shutting down (and
    * then actually shuts down), EC_OP_FAILED ("Already shutting down.")
    * otherwise.
    *
    * Deliberately does NOT wait for that reply, unlike every other method
    * in this library - confirmed against TextClient.cpp's own request
    * dispatch loop (https://github.com/amule-org/amule/blob/master/src/TextClient.cpp#L756-L761):
    * `if (curr->GetOpCode() == EC_OP_SHUTDOWN) { SendPacket(curr); delete
    * curr; return CMD_ID_QUIT; }` - amulecmd sends the packet and quits
    * immediately, skipping the SendRecvMsg_v2() call every other command
    * uses to await a reply, presumably because the daemon may tear the
    * connection down before flushing it. This also means the "Already
    * shutting down." failure case is unreachable here by design, same as
    * for the reference client.
    */
   public async shutdown(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SHUTDOWN);
      await this.connection.send(request);
      debug("shutdown: requested");
   }

   /**
    * Triggers an on-demand check for a new aMule release - EC_OP_VERSION_CHECK.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_VERSION_CHECK case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3149-L3167): no request
    * tags. Fire-and-forget - `StartVersionCheck()` kicks off an async
    * HTTP fetch against GitHub's release API and returns immediately;
    * this call's own reply (EC_OP_NOOP if accepted, EC_OP_FAILED with an
    * EC_TAG_STRING reason - throttled, or compiled out via
    * `ENABLE_VERSION_CHECK` - otherwise) only confirms the check was
    * *triggered*, never its outcome.
    *
    * The outcome itself is NOT relayed anywhere on this (classic EC)
    * protocol - confirmed against `CamuleApp::CheckNewVersion()`
    * (https://github.com/amule-org/amule/blob/master/src/amule.cpp#L2612-L2688, the HTTP download's
    * completion callback): on success it persists the parsed result
    * (`m_versionCheckLatest`/`m_versionCheckOutdated`) for amuleapi's
    * separate REST/JSON `/version` endpoint (a different protocol this
    * library doesn't wrap) and, either way, logs it as plain lines any
    * `Log.fetch()` poll already sees - `"Your copy of aMule is up to
    * date."`, or `"You are using an outdated version of aMule!"` (critical,
    * `AddLogLineC` - the same "!"-prefixed style as other critical log
    * lines) followed by `"Your aMule version is A.B.C and the latest
    * version is X.Y.Z"`, or an error line (`"Failed to download the
    * version check file."` / `"Corrupted version check file"`) if the
    * fetch itself failed. Even aMule's own reference GUI shows no popup
    * for this on a headless daemon build (amuleDlg.cpp's own comment:
    * "no-op on the daemon") - polling the log is the only way to observe
    * the result over EC, not a gap specific to this library.
    *
    * `EC_TAG_GENERAL_VERSION_CHECK_AVAILABLE` (`Preferences.ts`'s
    * `GeneralPrefs.versionCheckAvailable`) is a separate, unrelated
    * signal - confirmed against `Preferences.h`'s
    * `GetVersionCheckAvailable()`/`SetVersionCheckAvailable()`
    * (https://github.com/amule-org/amule/blob/master/src/Preferences.h#L794-L798): a static
    * capability flag ("can this daemon build check for updates at all",
    * mirroring `upnpAvailable`'s own shape), not this call's result -
    * despite the similar name, it does not toggle based on whether a
    * newer version was actually found.
    */
   public async checkVersion(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_VERSION_CHECK);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : "Failed to trigger a version check.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("checkVersion: requested");
   }
}
