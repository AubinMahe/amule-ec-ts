import { setTimeout } from "node:timers/promises";
import { debuglog } from "node:util";

import { AlternateNamesCache } from "./AlternateNamesCache.js";
import { ECConnection } from "./ECConnection.js";

const debug = debuglog("amule-ec:engine");

const DEFAULT_HOST = "localhost";

const RECONNECT_INITIAL_DELAY_MS = 2_000;

const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * How long an AlternateNamesCache entry survives without being touched again - see
 * ECEngineStartOptions.altNamesCachePath and AlternateNamesCache.init().
 */
const ALT_NAMES_CACHE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1_000;

let instance: ECConnection | undefined;
let altNamesCacheInstance: AlternateNamesCache | undefined;

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
    *
    * Don't set this on a connection also used for send()/receive() request
    * polling - see ECConnection.dispatchPacket()'s doc for the request/
    * reply race this creates. `ECEngine` is a singleton (one `connection`
    * for the whole app), so a second `notify: true` connection needs its
    * own `ECConnection.connect()` + `authenticateWithHash()` call outside
    * `ECEngine`, used purely for `onNotification()` and nothing else, while
    * `ECEngine.connection` stays `notify: false`.
    */
   notify?: boolean;
   /**
    * Sets connection.localCapabilities.multiSearch before authenticating -
    * same timing constraint as `notify`: ECConnection.authenticateWithHash()
    * negotiates EC_TAG_CAN_MULTI_SEARCH as part of the AUTH_REQ packet
    * itself. See Search.ts's SearchSession doc for what this unlocks.
    */
   multiSearch?: boolean;
   /**
    * Path to a JSON file persisting alternate filenames observed for downloads - see
    * AlternateNamesCache's doc for what it stores and why, Downloads.ts's
    * cacheAltNamesIfEligible() for the population policy (progress threshold, fetch()/notification
    * hooks). Omitted entirely (the default): no cache is created and ECEngine.altNamesCache stays
    * undefined. This is the one option that gives the library filesystem access of its own - every
    * other option only ever talks to amuled over the network.
    */
   altNamesCachePath?: string;
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
      } catch (error) {
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
      altNamesCacheInstance = options.altNamesCachePath ? new AlternateNamesCache(options.altNamesCachePath) : undefined;
      if (altNamesCacheInstance) {
         await altNamesCacheInstance.init(ALT_NAMES_CACHE_MAX_AGE_MS);
      }
      armReconnect(connection, host, options.port, options.passwordHash, notify, multiSearch);
   },

   get connection(): ECConnection {
      if (!instance) {
         throw new Error("ECEngine.start() must complete before ECEngine.connection is used.");
      }
      return instance;
   },

   /**
    * The cache configured via ECEngineStartOptions.altNamesCachePath, or undefined if that option
    * was never given. Unlike `connection`, never throws - Downloads.ts's cacheAltNamesIfEligible()
    * (and any caller-side code, e.g. a "free rename" outside the EC protocol) can check this
    * unconditionally, cache-disabled being just as valid a configuration as cache-enabled.
    */
   get altNamesCache(): AlternateNamesCache | undefined {
      return altNamesCacheInstance;
   },
};
