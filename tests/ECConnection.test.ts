import { expect } from "chai";
import * as ec from "../src/index.js";
import { startFakeEcServer, computeSaltedHash, type FakeEcServer, type FakeEcPeer } from "./fakeEcServer.js";
import { expectRejection, hexHash } from "./testUtils.js";

const PASSWORD_HASH = hexHash("a");
const SALT = 0x1234_5678_9abc_def0n;

async function connectPeer(server: FakeEcServer): Promise<{ connection: ec.ECConnection; peer: FakeEcPeer }> {
   const [connection, peer] = await Promise.all([ec.ECConnection.connect("127.0.0.1", server.port), server.nextPeer()]);
   return { connection, peer };
}

/**
 * Drives the server's side of one successful 3-step handshake; returns the parsed AUTH_REQ for
 * inspection.
 */
async function acceptAuthentication(peer: FakeEcPeer): Promise<ec.ECPacket> {
   const authRequest = await peer.readPacket();
   peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)));
   const authPasswd = await peer.readPacket();
   const hashTag = authPasswd.find(ec.ECTagNames.EC_TAG_PASSWD_HASH) as ec.ECHash16Tag;
   expect(Buffer.from(hashTag.value)).to.deep.equal(Buffer.from(computeSaltedHash(PASSWORD_HASH, SALT)));
   peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK));
   return authRequest;
}

describe("ECConnection.authenticateWithHash", () => {
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   it("completes the 3-step handshake and sends a correctly salted password hash", async () => {
      const { connection, peer } = await connectPeer(server);

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_PROTOCOL_VERSION)).to.equal(true);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CLIENT_NAME)).to.equal(true);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_NOTIFY)).to.equal(false);
   });

   it("adds EC_TAG_CAN_NOTIFY when localCapabilities.notify is set beforehand", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.notify = true;

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_NOTIFY)).to.equal(true);
   });

   it("adds EC_TAG_CAN_MULTI_SEARCH when localCapabilities.multiSearch is set beforehand", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.multiSearch = true;

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_MULTI_SEARCH)).to.equal(true);
   });

   it("always adds EC_TAG_CAN_SHAREDDIRS_CONFIG, unlike every other capability, with no local flag to set", async () => {
      const { connection, peer } = await connectPeer(server);

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG)).to.equal(true);
   });

   it("sets remoteCapabilities.sharedDirsConfig purely from the echo, with no local flag gating it", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG, new Uint8Array()),
         ),
      );
      await authPromise;

      expect(connection.remoteCapabilities.sharedDirsConfig).to.equal(true);
   });

   it("always adds EC_TAG_CAN_SEARCH_LIST, unlike every other capability, with no local flag to set", async () => {
      const { connection, peer } = await connectPeer(server);

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_SEARCH_LIST)).to.equal(true);
   });

   it("sets remoteCapabilities.searchList purely from the echo, with no local flag gating it", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_SEARCH_LIST, new Uint8Array())),
      );
      await authPromise;

      expect(connection.remoteCapabilities.searchList).to.equal(true);
   });

   it("always adds EC_TAG_CAN_PARTIAL_UPDATE, unlike every other capability, with no local flag to set", async () => {
      const { connection, peer } = await connectPeer(server);

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_PARTIAL_UPDATE)).to.equal(true);
   });

   it("sets remoteCapabilities.partialUpdate purely from the echo, with no local flag gating it", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_PARTIAL_UPDATE, new Uint8Array()),
         ),
      );
      await authPromise;

      expect(connection.remoteCapabilities.partialUpdate).to.equal(true);
   });

   it("always adds EC_TAG_CAN_CLIENT_HISTORY, unlike every other capability, with no local flag to set", async () => {
      const { connection, peer } = await connectPeer(server);

      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_CLIENT_HISTORY)).to.equal(true);
   });

   it("sets remoteCapabilities.clientHistory purely from the echo, with no local flag gating it", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_CLIENT_HISTORY, new Uint8Array()),
         ),
      );
      await authPromise;

      expect(connection.remoteCapabilities.clientHistory).to.equal(true);
   });

   it("sets remoteCapabilities.multiSearch only when both requested and echoed back", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.multiSearch = true;

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_MULTI_SEARCH, new Uint8Array()),
         ),
      );
      await authPromise;

      expect(connection.remoteCapabilities.multiSearch).to.equal(true);
   });

   it("decodes EC_TAG_SESSION_ID from AUTH_OK", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_SESSION_ID, 0x1234_5678n)),
      );
      await authPromise;

      expect(connection.sessionId).to.equal(0x1234_5678n);
   });

   it("leaves sessionId undefined when AUTH_OK omits EC_TAG_SESSION_ID (older daemon)", async () => {
      const { connection, peer } = await connectPeer(server);

      await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(peer)]);

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(connection.sessionId).to.be.undefined;
   });

   it("does not enable a remote capability the server echoed but we never requested", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_LARGE_TAG_COUNT, new Uint8Array()),
         ),
      );
      await authPromise;

      expect(connection.remoteCapabilities.largeTagCount).to.equal(false);
   });

   it("throws the daemon's reason on EC_OP_AUTH_FAIL", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_FAIL).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Invalid password.")),
      );

      await expectRejection(authPromise, /Invalid password\./);
   });

   it("throws when the salt reply has an unexpected opcode", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await expectRejection(authPromise, /EC_OP_AUTH_SALT/);
   });
});

describe("ECConnection.send/receive", () => {
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   it("round-trips an uncompressed packet through a real socket", async () => {
      const { connection, peer } = await connectPeer(server);

      await connection.send(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "hello")));
      const received = await peer.readPacket();

      expect(received.opcode).to.equal(ec.ECOpcode.EC_OP_NOOP);
      expect((received.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal("hello");
   });

   it("compresses the body once localCapabilities.zlib is enabled", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.zlib = true;
      connection.localCapabilities.preferNoZlib = false;

      await connection.send(
         new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "compressed")),
      );
      const received = await peer.readPacket();

      expect((received.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal("compressed");
   });

   it("always compresses an oversized body, even when preferNoZlib is set", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.zlib = true;
      connection.localCapabilities.preferNoZlib = true;
      const bigValue = "x".repeat(150_000);

      await connection.send(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, bigValue)));
      const received = await peer.readPacket();

      expect((received.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal(bigValue);
   });

   it("decodes a compressed reply from the server", async () => {
      const { connection, peer } = await connectPeer(server);

      const receivePromise = connection.receive();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "zipped")), {
         compressed: true,
      });
      const received = await receivePromise;

      expect((received.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal("zipped");
   });
});

describe("ECConnection.request", () => {
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   const message = (text: string): ec.ECPacket =>
      new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, text));
   const textOf = (packet: ec.ECPacket): string => (packet.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value;
   const sleep = (milliseconds: number): Promise<void> =>
      new Promise((resolve) => {
         setTimeout(resolve, milliseconds);
      });

   it("defaults to a 30 s timeout", async () => {
      const { connection } = await connectPeer(server);

      expect(ec.ECConnection.DEFAULT_REQUEST_TIMEOUT_MS).to.equal(30_000);
      expect(connection.requestTimeoutMs).to.equal(30_000);
   });

   it("sends the packet and resolves with the daemon's reply", async () => {
      const { connection, peer } = await connectPeer(server);

      const reply = connection.request(message("question"));
      expect(textOf(await peer.readPacket())).to.equal("question");
      peer.writePacket(message("answer"));

      expect(textOf(await reply)).to.equal("answer");
   });

   it("runs concurrent requests one at a time, each getting its own reply", async () => {
      const { connection, peer } = await connectPeer(server);

      const first = connection.request(message("first"));
      const second = connection.request(message("second"));
      expect(textOf(await peer.readPacket())).to.equal("first");
      let bytesBeforeFirstReply = 0;
      peer.socket.on("data", (chunk: Buffer) => {
         bytesBeforeFirstReply += chunk.length;
      });
      await sleep(100);
      expect(bytesBeforeFirstReply).to.equal(0);

      peer.writePacket(message("reply to first"));
      expect(textOf(await first)).to.equal("reply to first");
      expect(textOf(await peer.readPacket())).to.equal("second");
      peer.writePacket(message("reply to second"));

      expect(textOf(await second)).to.equal("reply to second");
   });

   it("times out when the daemon does not reply, and closes the connection", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.requestTimeoutMs = 100;
      const disconnected = new Promise<void>((resolve) => {
         connection.once("disconnected", resolve);
      });
      const serverSawClose = new Promise<void>((resolve) => {
         peer.socket.once("close", resolve);
      });

      await expectRejection(connection.request(message("anyone there?")), /No reply from the daemon within 100 ms/);

      await disconnected;
      await serverSawClose;
      // A late reply could only be paired with the wrong request: the connection stays closed.
      await expectRejection(connection.request(message("next")), /No reply from the daemon within 100 ms/);
   });

   it("fails a request queued behind one that timed out instead of leaving it waiting", async () => {
      const { connection } = await connectPeer(server);
      connection.requestTimeoutMs = 100;

      const first = expectRejection(connection.request(message("first")), /No reply from the daemon/);
      const second = expectRejection(connection.request(message("second")), /No reply from the daemon/);

      await first;
      await second;
   });

   it("covers the authentication handshake too", async () => {
      const { connection } = await connectPeer(server);
      connection.requestTimeoutMs = 100;

      await expectRejection(connection.authenticateWithHash(PASSWORD_HASH), /No reply from the daemon within 100 ms/);
   });

   it("holds a request made after reconnect() until the fresh connection has authenticated", async () => {
      const { connection, peer: firstPeer } = await connectPeer(server);
      const disconnected = new Promise<void>((resolve) => {
         connection.once("disconnected", resolve);
      });
      firstPeer.socket.destroy();
      await disconnected;
      const [, secondPeer] = await Promise.all([connection.reconnect("127.0.0.1", server.port), server.nextPeer()]);

      // Made by a caller polling while the reconnect loop is about to authenticate.
      const early = connection.request(message("early"));
      const [, authRequest] = await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(secondPeer)]);

      expect(authRequest.opcode).to.equal(ec.ECOpcode.EC_OP_AUTH_REQ);
      expect(textOf(await secondPeer.readPacket())).to.equal("early");
      secondPeer.writePacket(message("late but fine"));
      expect(textOf(await early)).to.equal("late but fine");
   });

   it("waits for as long as it takes when requestTimeoutMs is Infinity", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.requestTimeoutMs = Infinity;

      const reply = connection.request(message("slow"));
      await peer.readPacket();
      await sleep(150);
      peer.writePacket(message("finally"));

      expect(textOf(await reply)).to.equal("finally");
   });
});

describe("ECConnection.send request size limit", () => {
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   it("refuses a request whose encoded body exceeds 16 MiB, and the connection stays usable", async () => {
      const { connection, peer } = await connectPeer(server);
      const tooBig = new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "x".repeat(16 * 1024 * 1024)),
      );

      await expectRejection(connection.send(tooBig), /exceeds the 16777216-byte limit/);
      await connection.send(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      // The server reads the small packet next: nothing of the refused one was written.
      expect((await peer.readPacket()).tags).to.have.lengthOf(0);
   });
});

describe("ECConnection disconnect/reconnect", () => {
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   it("emits 'disconnected' once when the server drops the socket", async () => {
      const { connection, peer } = await connectPeer(server);

      const disconnected = new Promise<void>((resolve) => {
         connection.once("disconnected", resolve);
      });
      peer.socket.destroy();

      await disconnected;
      await expectRejection(connection.receive(), /EC connection closed\./);
   });

   it("reconnect() re-establishes the socket in place and a fresh authenticate() succeeds", async () => {
      const { connection, peer: firstPeer } = await connectPeer(server);
      const disconnected = new Promise<void>((resolve) => {
         connection.once("disconnected", resolve);
      });
      firstPeer.socket.destroy();
      await disconnected;

      const [, secondPeer] = await Promise.all([connection.reconnect("127.0.0.1", server.port), server.nextPeer()]);
      await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(secondPeer)]);

      // Proves the new socket is genuinely wired for both directions, not just authenticated.
      await connection.send(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));
      const afterReconnect = await secondPeer.readPacket();
      expect(afterReconnect.opcode).to.equal(ec.ECOpcode.EC_OP_NOOP);
   });

   it("close() ends the socket, observed by the server as 'end'", async () => {
      const { connection, peer } = await connectPeer(server);

      const ended = new Promise<void>((resolve) => {
         peer.socket.once("end", resolve);
      });
      connection.close();

      await ended;
      expect(peer.socket.readableEnded).to.equal(true);
   });

   it(
      "does not emit 'disconnected' when close() caused the closure - " +
         "regression test: this used to fire ECEngine's reconnect loop on every " +
         "deliberate shutdown, leaking an unclosed reconnected socket that kept " +
         "the process running forever (17 orphaned tests/repl/main.ts processes " +
         "found still running from earlier in one real session)",
      async () => {
         const { connection, peer } = await connectPeer(server);
         let disconnectedFired = false;
         connection.once("disconnected", () => {
            disconnectedFired = true;
         });

         connection.close();
         // Drive the socket to a genuine full close (close() alone only
         // half-closes the write side) the same way it reaches one in
         // production, once the peer closes back.
         peer.socket.destroy();
         await new Promise((resolve) => setTimeout(resolve, 50));

         expect(disconnectedFired).to.equal(false);
      },
   );
});

describe("ECConnection error containment", () => {
   let server: FakeEcServer;
   let originalConsoleError: typeof console.error;

   beforeEach(async () => {
      server = await startFakeEcServer();
      originalConsoleError = console.error;
      console.error = (): void => undefined;
   });

   afterEach(async () => {
      console.error = originalConsoleError;
      await server.close();
   });

   it("keeps delivering replies after a 'notification' listener throws", async () => {
      const { connection, peer } = await connectPeer(server);
      const notified = new Promise<void>((resolve) => {
         connection.onNotification(() => {
            resolve();
            throw new Error("listener bug");
         });
      });

      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));
      await notified;
      const reply = connection.receive();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "still alive")));

      expect(((await reply).find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal("still alive");
   });

   it("still calls the other 'notification' listeners when one throws", async () => {
      const { connection, peer } = await connectPeer(server);
      const calls: string[] = [];
      connection.onNotification(() => {
         calls.push("first");
         throw new Error("listener bug");
      });
      const secondListenerCalled = new Promise<void>((resolve) => {
         connection.onNotification(() => {
            calls.push("second");
            resolve();
         });
      });

      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));
      await secondListenerCalled;

      expect(calls).to.deep.equal(["first", "second"]);
   });

   it("tears the connection down when a packet cannot be decoded, instead of leaving it half-alive", async () => {
      const { connection, peer } = await connectPeer(server);
      const disconnected = new Promise<void>((resolve) => {
         connection.once("disconnected", resolve);
      });
      const serverSawClose = new Promise<void>((resolve) => {
         peer.socket.once("close", resolve);
      });
      const pending = expectRejection(connection.receive(), /TAGTYPE/);

      const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]);
      peer.socket.write(Buffer.concat([new ec.TransmissionHeader(ec.ECFlags.create(), garbage.length).encode(), garbage]));

      await pending;
      await disconnected;
      await serverSawClose;
      await expectRejection(connection.receive(), /TAGTYPE/);
   });
});

describe("ECConnection.reconnect() on a still-open socket", () => {
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   it("destroys the previous socket and is not affected by its late 'close'", async () => {
      const { connection, peer: firstPeer } = await connectPeer(server);
      const firstSocketClosed = new Promise<void>((resolve) => {
         firstPeer.socket.once("close", resolve);
      });
      let disconnectedFired = false;
      connection.once("disconnected", () => {
         disconnectedFired = true;
      });

      const [, secondPeer] = await Promise.all([connection.reconnect("127.0.0.1", server.port), server.nextPeer()]);
      await firstSocketClosed;
      // Let the client-side 'close' event of the destroyed socket be delivered.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const reply = connection.receive();
      secondPeer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      expect((await reply).opcode).to.equal(ec.ECOpcode.EC_OP_NOOP);
      expect(disconnectedFired).to.equal(false);
   });

   it("rejects a receive() still pending on the replaced socket", async () => {
      const { connection } = await connectPeer(server);
      const stale = expectRejection(connection.receive(), /replaced by reconnect\(\)/);

      await Promise.all([connection.reconnect("127.0.0.1", server.port), server.nextPeer()]);

      await stale;
   });
});
