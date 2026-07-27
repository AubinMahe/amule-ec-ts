import { ECConnection } from "./ECConnection.js";

/**
 * Common shape for the EC domain objects that own a connection and know
 * how to (re)populate themselves from it (Downloads, Uploads, SharedFiles,
 * Servers, Log, Status) - `connection` is bound once, at construction, so
 * repeated polling is just `await thing.fetch()` rather than threading the
 * connection through every call site.
 */
export interface ECFetchable {
   readonly connection: ECConnection;

   fetch(): Promise<void>;
}
