import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

function serverTag(
   address: number[],
   port: number,
   fields: {
      name?: string;
      ping?: number;
      users?: number;
      usersMax?: number;
      files?: number;
      priority?: ec.ServerPriority;
      isStatic?: boolean;
      filesSoft?: number;
      filesHard?: number;
      tcpFlags?: number;
      udpFlags?: number;
   } = {},
): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.name !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVER_NAME, fields.name));
   }
   if (fields.ping !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_PING, fields.ping));
   }
   if (fields.users !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_USERS, fields.users));
   }
   if (fields.usersMax !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_USERS_MAX, fields.usersMax));
   }
   if (fields.files !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_FILES, fields.files));
   }
   if (fields.priority !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SERVER_PRIO, fields.priority));
   }
   if (fields.isStatic !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SERVER_STATIC, fields.isStatic ? 1 : 0));
   }
   if (fields.filesSoft !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_FILES_SOFT, fields.filesSoft));
   }
   if (fields.filesHard !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_FILES_HARD, fields.filesHard));
   }
   if (fields.tcpFlags !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_TCP_FLAGS, fields.tcpFlags));
   }
   if (fields.udpFlags !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_UDP_FLAGS, fields.udpFlags));
   }
   return new ec.ECIPv4Tag(ec.ECTagNames.EC_TAG_SERVER, new Uint8Array(address), port, children);
}

describe("ServerInfo.fromTag", () => {
   it("reads ip/port from own data and name from EC_TAG_SERVER_NAME", () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, { name: "eMule Security" }));
      expect(info?.ip).to.equal("192.0.2.1");
      expect(info?.port).to.equal(4712);
      expect(info?.name).to.equal("eMule Security");
      expect(info?.ipPort).to.equal("192.0.2.1:4712");
   });

   it("returns undefined for a tag that isn't an IPV4 tag", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.ServerInfo.fromTag(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SERVER, 0))).to.be.undefined;
   });

   it("reads ping/users/usersMax/files from EC_DETAIL_FULL children when present", () => {
      const info = ec.ServerInfo.fromTag(
         serverTag([192, 0, 2, 1], 4712, {
            name: "eMule Security",
            ping: 42,
            users: 1234,
            usersMax: 9000,
            files: 5_000_000,
         }),
      );
      expect(info?.ping).to.equal(42n);
      expect(info?.users).to.equal(1234n);
      expect(info?.usersMax).to.equal(9000n);
      expect(info?.files).to.equal(5_000_000n);
   });

   it("leaves ping/users/usersMax/files undefined when the daemon omits them", () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, { name: "eMule Security" }));
      /* eslint-disable @typescript-eslint/no-unused-expressions -- chai's getter-style assertion */
      expect(info?.ping).to.be.undefined;
      expect(info?.users).to.be.undefined;
      expect(info?.usersMax).to.be.undefined;
      expect(info?.files).to.be.undefined;
      /* eslint-enable @typescript-eslint/no-unused-expressions */
   });

   it("reads priority/isStatic from EC_DETAIL_FULL children when present", () => {
      const info = ec.ServerInfo.fromTag(
         serverTag([192, 0, 2, 1], 4712, {
            name: "eMule Security",
            priority: ec.ServerPriority.SRV_PR_HIGH,
            isStatic: true,
         }),
      );
      expect(info?.priority).to.equal(ec.ServerPriority.SRV_PR_HIGH);
      expect(info?.isStatic).to.equal(true);
   });

   it("defaults priority/isStatic to SRV_PR_NORMAL/false when the daemon omits them (their own real default)", () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, { name: "eMule Security" }));
      expect(info?.priority).to.equal(ec.ServerPriority.SRV_PR_NORMAL);
      expect(info?.isStatic).to.equal(false);
   });

   it("decodes isStatic as false (not undefined) when EC_TAG_SERVER_STATIC is present but zero", () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, { name: "eMule Security", isStatic: false }));
      expect(info?.isStatic).to.equal(false);
   });

   it("reads filesSoft/filesHard/tcpFlags/udpFlags from EC_DETAIL_FULL children when present", () => {
      const info = ec.ServerInfo.fromTag(
         serverTag([192, 0, 2, 1], 4712, {
            name: "eMule Security",
            filesSoft: 300,
            filesHard: 600,
            tcpFlags: 0x01,
            udpFlags: 0x02,
         }),
      );
      expect(info?.filesSoft).to.equal(300n);
      expect(info?.filesHard).to.equal(600n);
      expect(info?.tcpFlags).to.equal(1n);
      expect(info?.udpFlags).to.equal(2n);
   });

   it("defaults filesSoft/filesHard/tcpFlags/udpFlags to 0n when the daemon omits them (their own real default)", () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, { name: "eMule Security" }));
      expect(info?.filesSoft).to.equal(0n);
      expect(info?.filesHard).to.equal(0n);
      expect(info?.tcpFlags).to.equal(0n);
      expect(info?.udpFlags).to.equal(0n);
   });

   it('defaults name to "" when EC_TAG_SERVER_NAME is absent', () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, {}));
      expect(info?.name).to.equal("");
   });
});

describe("Servers.fetch", () => {
   it("requests EC_DETAIL_FULL and parses each EC_TAG_SERVER reply tag", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SERVER_LIST);
      reply.add(
         serverTag([192, 0, 2, 1], 4712, { name: "eMule Security", ping: 42, users: 1234, usersMax: 9000, files: 5_000_000 }),
      );
      reply.add(serverTag([198, 51, 100, 1], 4712, { name: "eMule Sunrise" }));
      fake.queueReply(reply);

      await servers.fetch();

      const [request] = fake.sent;
      expect(request?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_SERVER_LIST);
      const detailLevel = request?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL) as ec.ECUInt8Tag;
      expect(detailLevel.value).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_FULL));
      expect(servers.servers).to.have.lengthOf(2);
      expect(servers.servers.map((s) => s.name)).to.deep.equal(["eMule Security", "eMule Sunrise"]);
      expect(servers.servers[0]?.ping).to.equal(42n);
      expect(servers.servers[0]?.users).to.equal(1234n);
      expect(servers.servers[0]?.usersMax).to.equal(9000n);
      expect(servers.servers[0]?.files).to.equal(5_000_000n);
      /* eslint-disable @typescript-eslint/no-unused-expressions -- chai's getter-style assertion */
      expect(servers.servers[1]?.ping).to.be.undefined;
      /* eslint-enable @typescript-eslint/no-unused-expressions */
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(servers.fetch(), /EC_OP_SERVER_LIST/);
   });
});

describe("Servers.connect", () => {
   it('parses "ip:port" and sends it as an EC_TAG_SERVER IPV4 tag', async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.connect("192.0.2.1:4712");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_CONNECT);
      const tag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER) as ec.ECIPv4Tag;
      expect(Array.from(tag.address)).to.deep.equal([192, 0, 2, 1]);
      expect(tag.port).to.equal(4712);
   });

   it("throws the daemon's reason when the server isn't found", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "server not found"));
      fake.queueReply(failure);

      await expectRejection(servers.connect("192.0.2.1:4712"), /server not found/);
   });
});

describe("Servers.remove", () => {
   it('parses "ip:port" and sends it as an EC_TAG_SERVER IPV4 tag', async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.remove("192.0.2.1:4712");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_REMOVE);
      const tag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER) as ec.ECIPv4Tag;
      expect(Array.from(tag.address)).to.deep.equal([192, 0, 2, 1]);
      expect(tag.port).to.equal(4712);
   });

   it("throws the daemon's reason when the server isn't found", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "server not found"));
      fake.queueReply(failure);

      await expectRejection(servers.remove("192.0.2.1:4712"), /server not found/);
   });
});

describe("Servers.add", () => {
   it("sends the address/name as top-level EC_TAG_SERVER_ADDRESS/EC_TAG_SERVER_NAME string tags", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.add("192.0.2.1:4712", "Test Server");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_ADD);
      const addressTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER_ADDRESS);
      expect((addressTag as ec.ECStringTag).value).to.equal("192.0.2.1:4712");
      const nameTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER_NAME);
      expect((nameTag as ec.ECStringTag).value).to.equal("Test Server");
   });

   it("defaults the name to an empty string when omitted", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.add("192.0.2.1:4712");

      const nameTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER_NAME);
      expect((nameTag as ec.ECStringTag).value).to.equal("");
   });

   it("throws a generic reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Server not added"));
      fake.queueReply(failure);

      await expectRejection(servers.add("192.0.2.1:4712"), /Server not added/);
   });
});

describe("Servers.updateFromUrl", () => {
   it("sends the URL as a single EC_TAG_SERVERS_UPDATE_URL tag and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.updateFromUrl("http://example.com/server.met");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_UPDATE_FROM_URL);
      const urlTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVERS_UPDATE_URL);
      expect((urlTag as ec.ECStringTag).value).to.equal("http://example.com/server.met");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(servers.updateFromUrl("http://example.com/server.met"), /EC_OP_NOOP/);
   });
});

describe("Servers.disconnect", () => {
   it("sends no request tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.disconnect();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_DISCONNECT);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(servers.disconnect(), /EC_OP_NOOP/);
   });
});

describe("Servers.setStatic", () => {
   it("sends the ECID as a plain EC_TAG_SERVER uint32 (not an IPv4 tag), with only EC_TAG_SERVER_STATIC as a child", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.setStatic(7n, true);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_SET_STATIC_PRIO);
      const tag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER);
      expect(tag).to.be.instanceOf(ec.ECUInt32Tag);
      expect(tag?.intValue).to.equal(7n);
      expect(tag?.findChild(ec.ECTagNames.EC_TAG_SERVER_STATIC)?.intValue).to.equal(1n);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(tag?.findChild(ec.ECTagNames.EC_TAG_SERVER_PRIO)).to.be.undefined;
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(servers.setStatic(7n, false), /EC_OP_NOOP/);
   });
});

describe("Servers.setPriority", () => {
   it("sends the ECID as a plain EC_TAG_SERVER uint32 (not an IPv4 tag), with only EC_TAG_SERVER_PRIO as a child", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await servers.setPriority(7n, ec.ServerPriority.SRV_PR_HIGH);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SERVER_SET_STATIC_PRIO);
      const tag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SERVER);
      expect(tag).to.be.instanceOf(ec.ECUInt32Tag);
      expect(tag?.intValue).to.equal(7n);
      expect(tag?.findChild(ec.ECTagNames.EC_TAG_SERVER_PRIO)?.intValue).to.equal(BigInt(ec.ServerPriority.SRV_PR_HIGH));
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(tag?.findChild(ec.ECTagNames.EC_TAG_SERVER_STATIC)).to.be.undefined;
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(servers.setPriority(7n, ec.ServerPriority.SRV_PR_LOW), /EC_OP_NOOP/);
   });
});

describe("ServerLog.fetch", () => {
   it("splits the single newline-separated EC_TAG_STRING into trimmed, non-empty lines", async () => {
      const fake = createFakeConnection();
      const log = new ec.ServerLog(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SERVERINFO);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "line one\nline two\n\n"));
      fake.queueReply(reply);

      await log.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_SERVERINFO);
      expect(log.lines).to.deep.equal(["line one", "line two"]);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const log = new ec.ServerLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.fetch(), /EC_OP_SERVERINFO/);
   });
});

describe("ServerLog.reset", () => {
   it("sends EC_OP_CLEAR_SERVERINFO with no tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.ServerLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await log.reset();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CLEAR_SERVERINFO);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws when the daemon replies with anything other than EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.ServerLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.reset(), /EC_OP_NOOP/);
   });
});
