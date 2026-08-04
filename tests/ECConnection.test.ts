import { expect } from "chai";
import * as ec from "../src/index.js";
import { startFakeEcServer, computeSaltedHash, type FakeEcServer, type FakeEcPeer } from "./fakeEcServer.js";
import { expectRejection, hexHash } from "./testUtils.js";

const PASSWORD_HASH = hexHash("a");
const SALT = 0x1234_5678_9abc_def0n;

async function connectPeer(server: FakeEcServer): Promise<{ connection: ec.ECConnection; peer: FakeEcPeer }> {
   const [connection, peer] = await Promise.all([
      ec.ECConnection.connect("127.0.0.1", server.port),
      server.nextPeer(),
   ]);
   return { connection, peer };
}

/** Drives the server's side of one successful 3-step handshake; returns the parsed AUTH_REQ for inspection. */
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

      const [, authRequest] = await Promise.all([
         connection.authenticateWithHash(PASSWORD_HASH),
         acceptAuthentication(peer),
      ]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_PROTOCOL_VERSION)).to.equal(true);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CLIENT_NAME)).to.equal(true);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_NOTIFY)).to.equal(false);
   });

   it("adds EC_TAG_CAN_NOTIFY when localCapabilities.notify is set beforehand", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.notify = true;

      const [, authRequest] = await Promise.all([
         connection.authenticateWithHash(PASSWORD_HASH),
         acceptAuthentication(peer),
      ]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_NOTIFY)).to.equal(true);
   });

   it("adds EC_TAG_CAN_MULTI_SEARCH when localCapabilities.multiSearch is set beforehand", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.multiSearch = true;

      const [, authRequest] = await Promise.all([
         connection.authenticateWithHash(PASSWORD_HASH),
         acceptAuthentication(peer),
      ]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_MULTI_SEARCH)).to.equal(true);
   });

   it("always adds EC_TAG_CAN_SHAREDDIRS_CONFIG, unlike every other capability, with no local flag to set", async () => {
      const { connection, peer } = await connectPeer(server);

      const [, authRequest] = await Promise.all([
         connection.authenticateWithHash(PASSWORD_HASH),
         acceptAuthentication(peer),
      ]);

      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG)).to.equal(true);
   });

   it("sets remoteCapabilities.sharedDirsConfig purely from the echo, with no local flag gating it", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)));
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG, new Uint8Array())),
      );
      await authPromise;

      expect(connection.remoteCapabilities.sharedDirsConfig).to.equal(true);
   });

   it("sets remoteCapabilities.multiSearch only when both requested and echoed back", async () => {
      const { connection, peer } = await connectPeer(server);
      connection.localCapabilities.multiSearch = true;

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)));
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_MULTI_SEARCH, new Uint8Array())),
      );
      await authPromise;

      expect(connection.remoteCapabilities.multiSearch).to.equal(true);
   });

   it("does not enable a remote capability the server echoed but we never requested", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)));
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK).add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CAN_LARGE_TAG_COUNT, new Uint8Array())),
      );
      await authPromise;

      expect(connection.remoteCapabilities.largeTagCount).to.equal(false);
   });

   it("throws the daemon's reason on EC_OP_AUTH_FAIL", async () => {
      const { connection, peer } = await connectPeer(server);

      const authPromise = connection.authenticateWithHash(PASSWORD_HASH);
      await peer.readPacket();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)));
      await peer.readPacket();
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_FAIL).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Invalid password.")));

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

      await connection.send(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "compressed")));
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

      const [, secondPeer] = await Promise.all([
         connection.reconnect("127.0.0.1", server.port),
         server.nextPeer(),
      ]);
      await Promise.all([
         connection.authenticateWithHash(PASSWORD_HASH),
         acceptAuthentication(secondPeer),
      ]);

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
});
