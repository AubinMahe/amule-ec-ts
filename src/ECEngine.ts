import { setTimeout } from "node:timers/promises";
import { debuglog } from "node:util";

import { ECConnection } from "./ECConnection.js";

const debug = debuglog("amule-ec:engine");

const DEFAULT_HOST = "localhost";

const RECONNECT_INITIAL_DELAY_MS = 2_000;

const RECONNECT_MAX_DELAY_MS = 30_000;

let instance: ECConnection | undefined;

export interface ECEngineStartOptions {
   /**
    * Defaults to "localhost" - the daemon and this client are expected to run
    * on the same machine.
    */
   host?: string;
   /**
    * The daemon's EC port, e.g. read from its own config's [ExternalConnect]
    * section (ECPort).
    */
   port: number;
   /**
    * MD5(plaintext) hex, e.g. read as-is from the daemon's own config
    * (ECPassword is already stored in this form).
    */
   passwordHash: string;
   /**
    * Sets connection.localCapabilities.notify before authenticating -
    * it must be set before, not after: ECConnection.authenticateWithHash()
    * negotiates EC_TAG_CAN_NOTIFY as part of the AUTH_REQ packet itself,
    * so setting the capability on the connection afterward (once start()
    * has returned) is too late to have any effect.
    */
   notify?: boolean;
   /**
    * Sets connection.localCapabilities.multiSearch before authenticating -
    * same timing constraint as `notify`: ECConnection.authenticateWithHash()
    * negotiates EC_TAG_CAN_MULTI_SEARCH as part of the AUTH_REQ packet
    * itself. See Search.ts's SearchSession doc for what this unlocks.
    */
   multiSearch?: boolean;
}

/**
 * Waits for `connection` to report a "disconnected" event (see
 * ECConnection.onClose()'s doc - typically amuled restarting underneath an
 * open TCP connection, per the "socket ended by other party"/EPIPE errors
 * that otherwise repeat on every periodic poll forever), then retries
 * ECConnection.reconnect() + authenticateWithHash() with an exponential
 * backoff (capped at RECONNECT_MAX_DELAY_MS) until one succeeds, and rearms
 * itself for the next disconnect. Every service already holds this same
 * `connection` instance (captured once via ECEngine.connection at
 * construction), so nothing else needs to change once it's reconnected -
 * the next scheduled poll just starts working again.
 */
export function armReconnect(
   connection: ECConnection,
   host: string,
   port: number,
   passwordHash: string,
   notify: boolean,
   multiSearch: boolean,
): void {
   connection.once("disconnected", () => {
      console.error("amule-ec: connection to amuled lost, reconnecting...");
      void reconnectLoop(connection, host, port, passwordHash, notify, multiSearch);
   });
}

async function reconnectLoop(
   connection: ECConnection,
   host: string,
   port: number,
   passwordHash: string,
   notify: boolean,
   multiSearch: boolean,
): Promise<void> {
   let delayMs = RECONNECT_INITIAL_DELAY_MS;
   for (let attempt = 1; ; attempt++) {
      await setTimeout(delayMs);
      debug("reconnectLoop: attempt %d, after %dms backoff", attempt, delayMs);
      try {
         await connection.reconnect(host, port);
         connection.localCapabilities.notify = notify;
         connection.localCapabilities.multiSearch = multiSearch;
         await connection.authenticateWithHash(passwordHash);
         console.log("amule-ec: reconnected to amuled.");
         armReconnect(connection, host, port, passwordHash, notify, multiSearch);
         return;
      }
      catch (error) {
         console.error("amule-ec: reconnect attempt failed, retrying...", error);
         delayMs = Math.min(delayMs * 2, RECONNECT_MAX_DELAY_MS);
      }
   }
}

/**
 * Owns the single EC connection shared by every service in this app -
 * established once at boot (see main.ts) from the caller-supplied
 * host/port/passwordHash (typically read from aMule's own
 * [ExternalConnect] config section - this library has no filesystem
 * access of its own and no opinion on where that comes from), then handed
 * out via `connection`. Survives amuled restarting underneath it - see
 * armReconnect()'s doc.
 */
export const ECEngine = {
   async start(options: ECEngineStartOptions): Promise<void> {
      const host = options.host ?? DEFAULT_HOST;
      const notify = options.notify ?? false;
      const multiSearch = options.multiSearch ?? false;
      const connection = await ECConnection.connect(host, options.port);
      connection.localCapabilities.notify = notify;
      connection.localCapabilities.multiSearch = multiSearch;
      await connection.authenticateWithHash(options.passwordHash);
      instance = connection;
      armReconnect(connection, host, options.port, options.passwordHash, notify, multiSearch);
   },

   get connection(): ECConnection {
      if (!instance) {
         throw new Error(
            "ECEngine.start() must complete before ECEngine.connection is used.",
         );
      }
      return instance;
   },
};
