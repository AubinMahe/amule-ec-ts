import { expect } from "chai";
import * as ec from "../../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

function serverTag(address: number[], port: number, name?: string): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (name !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVER_NAME, name));
   }
   return new ec.ECIPv4Tag(ec.ECTagNames.EC_TAG_SERVER, new Uint8Array(address), port, children);
}

describe("ServerInfo.fromTag", () => {
   it("reads ip/port from own data and name from EC_TAG_SERVER_NAME", () => {
      const info = ec.ServerInfo.fromTag(serverTag([192, 0, 2, 1], 4712, "eMule Security"));
      expect(info?.ip).to.equal("192.0.2.1");
      expect(info?.port).to.equal(4712);
      expect(info?.name).to.equal("eMule Security");
      expect(info?.ipPort).to.equal("192.0.2.1:4712");
   });

   it("returns undefined for a tag that isn't an IPV4 tag", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.ServerInfo.fromTag(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SERVER, 0))).to.be.undefined;
   });
});

describe("Servers.fetch", () => {
   it("requests EC_DETAIL_CMD and parses each EC_TAG_SERVER reply tag", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SERVER_LIST);
      reply.add(serverTag([192, 0, 2, 1], 4712, "eMule Security"));
      reply.add(serverTag([198, 51, 100, 1], 4712, "eMule Sunrise"));
      fake.queueReply(reply);

      await servers.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_SERVER_LIST);
      expect(servers.servers).to.have.lengthOf(2);
      expect(servers.servers.map((s) => s.name)).to.deep.equal(["eMule Security", "eMule Sunrise"]);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const servers = new ec.Servers(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(servers.fetch(), /EC_OP_SERVER_LIST/);
   });
});

describe("Servers.connect", () => {
   it("parses \"ip:port\" and sends it as an EC_TAG_SERVER IPV4 tag", async () => {
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
