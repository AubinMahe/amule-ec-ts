import { expect } from "chai";
import * as ec from "../../src/index.js";

/**
 * A minimal stand-in for ECConnection, structurally compatible with what
 * every ec/*.ts service actually calls on it (send/receive) - none of them
 * touch anything else, so a real net.Socket is never needed to unit-test
 * request-building/reply-parsing. queueReply() feeds canned packets for
 * receive() to hand back, in order; sent records every packet passed to
 * send(), so tests can assert on the request shape too.
 */
export interface FakeConnection {
   readonly connection: ec.ECConnection;
   readonly sent: ec.ECPacket[];
   queueReply(packet: ec.ECPacket): void;
}

export function createFakeConnection(): FakeConnection {
   const sent: ec.ECPacket[] = [];
   const replies: ec.ECPacket[] = [];

   const fake = {
      send: (packet: ec.ECPacket): Promise<void> => {
         sent.push(packet);
         return Promise.resolve();
      },
      receive: (): Promise<ec.ECPacket> => {
         const next = replies.shift();
         if (!next) {
            throw new Error("FakeConnection: no queued reply for receive().");
         }
         return Promise.resolve(next);
      },
   };

   return {
      connection: fake as unknown as ec.ECConnection,
      sent,
      queueReply(packet: ec.ECPacket): void {
         replies.push(packet);
      },
   };
}

/**
 * Plain chai has no built-in async-rejection matcher (no chai-as-promised
 * in this project) - this is the vanilla try/catch pattern, factored out
 * since every service's error-path test needs it.
 */
export async function expectRejection(
   promise: Promise<unknown>,
   matcher: RegExp | string,
): Promise<void> {
   try {
      await promise;
   } catch (error) {
      expect((error as Error).message).to.match(
         typeof matcher === "string" ? new RegExp(matcher) : matcher,
      );
      return;
   }
   expect.fail("Expected the promise to reject, but it resolved.");
}

/** Builds a hex string of the given length (default 32, an MD4 hash) repeating `fill`. */
export function hexHash(fill: string): string {
   return fill.repeat(32).slice(0, 32);
}
