import { expect } from "chai";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ec from "../src/index.js";
import { startFakeEcServer, computeSaltedHash, type FakeEcServer, type FakeEcPeer } from "./fakeEcServer.js";
import { hexHash } from "./testUtils.js";

/** Builds an EC_TAG_PARTFILE_SOURCE_NAMES container, as parseSourceNames() reads it (see Downloads.ts's doc). */
function sourceNamesTag(entries: readonly { id: number; name: string; count: number }[]): ec.ECTag {
   const children = entries.map(
      (entry) =>
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES, entry.id, [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES, entry.name),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES_COUNTS, entry.count),
         ]),
   );
   return new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES, new Uint8Array(), children);
}

/** A full-detail EC_TAG_PARTFILE entry (own data: ecid), as Downloads.fetch()/a fresh-file notification carry it. */
function partFileTag(fields: {
   ecid: number;
   hash: string;
   name: string;
   sizeFull: bigint;
   sizeDone: bigint;
   sourceNames?: ec.ECTag;
}): ec.ECTag {
   const children: ec.ECTag[] = [
      new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PARTFILE_HASH, new Uint8Array(Buffer.from(fields.hash, "hex"))),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_FULL, fields.sizeFull),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, fields.sizeDone),
   ];
   if (fields.sourceNames) children.push(fields.sourceNames);
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, fields.ecid, children);
}

describe("alt-names cache population (Downloads.fetch()/DownloadTracker.apply() -> ECEngine.altNamesCache)", () => {
   const PASSWORD_HASH = hexHash("d");
   const SALT = 0x1122_3344_5566_7788n;
   let server: FakeEcServer;
   let dir: string;
   let cachePath: string;

   beforeEach(async () => {
      server = await startFakeEcServer();
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "amule-ec-alt-names-population-"));
      cachePath = path.join(dir, "names.json");
   });

   afterEach(async () => {
      // ECEngine.start() always arms a reconnect loop - disarm before closing the fake server, same
      // reasoning as ECEngine.test.ts.
      ec.ECEngine.connection.removeAllListeners("disconnected");
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
   });

   async function acceptAuthentication(peer: FakeEcPeer): Promise<void> {
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      const authPasswd = await peer.readPacket();
      const hashTag = authPasswd.find(ec.ECTagNames.EC_TAG_PASSWD_HASH) as ec.ECHash16Tag;
      expect(Buffer.from(hashTag.value)).to.deep.equal(Buffer.from(computeSaltedHash(PASSWORD_HASH, SALT)));
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK));
   }

   async function startEngine(): Promise<FakeEcPeer> {
      const [, peer] = await Promise.all([
         ec.ECEngine.start({ host: "127.0.0.1", port: server.port, passwordHash: PASSWORD_HASH, altNamesCachePath: cachePath }),
         server.nextPeer().then(async (p) => {
            await acceptAuthentication(p);
            return p;
         }),
      ]);
      return peer;
   }

   it("fetch() caches a file's source names once it's past 75% complete", async () => {
      const peer = await startEngine();
      const downloads = new ec.Downloads(ec.ECEngine.connection);

      const [, request] = await Promise.all([
         downloads.fetch(),
         peer.readPacket().then((req) => {
            const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
            reply.add(
               partFileTag({
                  ecid: 1,
                  hash: hexHash("1"),
                  name: "Movie.mkv",
                  sizeFull: 1_000n,
                  sizeDone: 800n, // 80% - past the threshold
                  sourceNames: sourceNamesTag([{ id: 1, name: "Movie.avi", count: 3 }]),
               }),
            );
            peer.writePacket(reply);
            return req;
         }),
      ]);
      expect(request.opcode).to.equal(ec.ECOpcode.EC_OP_GET_DLOAD_QUEUE);

      await ec.ECEngine.altNamesCache?.flush();
      expect(ec.ECEngine.altNamesCache?.get("Movie.mkv")).to.deep.equal(["Movie.avi"]);
   });

   it("fetch() does not cache a file that hasn't reached 75% complete yet", async () => {
      const peer = await startEngine();
      const downloads = new ec.Downloads(ec.ECEngine.connection);

      await Promise.all([
         downloads.fetch(),
         peer.readPacket().then(() => {
            const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
            reply.add(
               partFileTag({
                  ecid: 1,
                  hash: hexHash("1"),
                  name: "Movie.mkv",
                  sizeFull: 1_000n,
                  sizeDone: 500n, // 50% - below the threshold
                  sourceNames: sourceNamesTag([{ id: 1, name: "Movie.avi", count: 3 }]),
               }),
            );
            peer.writePacket(reply);
         }),
      ]);

      await ec.ECEngine.altNamesCache?.flush();
      expect(ec.ECEngine.altNamesCache?.get("Movie.mkv")).to.deep.equal([]);
   });

   it("DownloadTracker.apply() caches a push-notified file once it's past 75% complete", async () => {
      await startEngine();
      const tracker = new ec.DownloadTracker(ec.ECEngine.connection);

      const notification = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      notification.add(
         partFileTag({
            ecid: 1,
            hash: hexHash("2"),
            name: "Series S01E01.mkv",
            sizeFull: 2_000n,
            sizeDone: 1_600n, // 80%
            sourceNames: sourceNamesTag([{ id: 1, name: "Series.S01E01.mkv", count: 1 }]),
         }),
      );
      tracker.apply(notification);

      await ec.ECEngine.altNamesCache?.flush();
      expect(ec.ECEngine.altNamesCache?.get("Series S01E01.mkv")).to.deep.equal(["Series.S01E01.mkv"]);
   });

   it("ECEngine.altNamesCache is undefined when altNamesCachePath was never given - fetch() doesn't throw", async () => {
      const [, peer] = await Promise.all([
         ec.ECEngine.start({ host: "127.0.0.1", port: server.port, passwordHash: PASSWORD_HASH }),
         server.nextPeer().then(async (p) => {
            await acceptAuthentication(p);
            return p;
         }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.ECEngine.altNamesCache).to.be.undefined;

      const downloads = new ec.Downloads(ec.ECEngine.connection);
      await Promise.all([
         downloads.fetch(),
         peer.readPacket().then(() => {
            const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
            reply.add(
               partFileTag({
                  ecid: 1,
                  hash: hexHash("1"),
                  name: "Movie.mkv",
                  sizeFull: 1_000n,
                  sizeDone: 900n,
                  sourceNames: sourceNamesTag([{ id: 1, name: "Movie.avi", count: 3 }]),
               }),
            );
            peer.writePacket(reply);
         }),
      ]);
      expect(downloads.files[0]?.name).to.equal("Movie.mkv");
   });
});
