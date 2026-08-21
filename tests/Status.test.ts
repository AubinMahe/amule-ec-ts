import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

function statsReply(): ec.ECPacket {
   const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_STATS);
   packet.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATS_UL_SPEED, 1_000n));
   packet.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATS_DL_SPEED, 2_000n));
   packet.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATS_TEMP_FREE_SPACE, 500_000_000n));
   packet.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATS_INCOMING_FREE_SPACE, 300_000_000n));
   return packet;
}

/**
 * bitmask: 0x01 ed2k connected, 0x10 kad running.
 */
function connStateTag(options: {
   bitmask: number;
   ed2kId?: number;
   serverName?: string;
   ed2kConnectedSince?: number;
   kadConnectedSince?: number;
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (options.ed2kId !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_ED2K_ID, options.ed2kId));
   }
   if (options.serverName !== undefined) {
      children.push(
         new ec.ECIPv4Tag(ec.ECTagNames.EC_TAG_SERVER, new Uint8Array([192, 0, 2, 1]), 4712, [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVER_NAME, options.serverName),
         ]),
      );
   }
   if (options.ed2kConnectedSince !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_ED2K_CONNECTED_SINCE, options.ed2kConnectedSince));
   }
   if (options.kadConnectedSince !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_CONNECTED_SINCE, options.kadConnectedSince));
   }
   return new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CONNSTATE, options.bitmask, children);
}

function connStateReply(tag: ec.ECTag): ec.ECPacket {
   const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_MISC_DATA);
   packet.add(tag);
   return packet;
}

describe("Status.fetch", () => {
   it("merges EC_OP_STATS and EC_OP_GET_CONNSTATE into one snapshot", async () => {
      const fake = createFakeConnection();
      const status = new ec.Status(fake.connection);
      fake.queueReply(statsReply());
      fake.queueReply(
         connStateReply(
            connStateTag({
               bitmask: 0x11,
               ed2kId: 999_999,
               serverName: "eMule Security",
               ed2kConnectedSince: 1_735_689_600,
               kadConnectedSince: 1_735_689_700,
            }),
         ),
      );

      await status.fetch();

      expect(fake.sent).to.have.lengthOf(2);
      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_STAT_REQ);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL)?.intValue).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_FULL));
      expect(fake.sent[1]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_CONNSTATE);
      expect(status.uploadSpeed).to.equal(1_000n);
      expect(status.downloadSpeed).to.equal(2_000n);
      expect(status.ed2kConnected).to.equal(true);
      expect(status.kadRunning).to.equal(true);
      expect(status.kadConnected).to.equal(false);
      expect(status.ed2kId).to.equal(999_999n);
      // Below the "High ID" threshold (16_777_216) => Low ID.
      expect(status.hasLowId).to.equal(true);
      expect(status.serverName).to.equal("eMule Security");
      expect(status.serverIp).to.equal("192.0.2.1");
      expect(status.serverPort).to.equal(4712);
      expect(status.ed2kConnectedSince).to.equal(1_735_689_600n);
      expect(status.kadConnectedSince).to.equal(1_735_689_700n);
      expect(status.tempFreeSpace).to.equal(500_000_000n);
      expect(status.incomingFreeSpace).to.equal(300_000_000n);
   });

   it("throws when the EC_OP_STAT_REQ reply has an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const status = new ec.Status(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(status.fetch(), /EC_OP_STATS/);
   });

   it("throws when the EC_OP_GET_CONNSTATE reply has an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const status = new ec.Status(fake.connection);
      fake.queueReply(statsReply());
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(status.fetch(), /EC_OP_MISC_DATA/);
   });
});

describe("Status.applyNotification", () => {
   it("applies an EC_OP_STATS push carrying only EC_TAG_CONNSTATE, leaving prior speeds untouched", async () => {
      const fake = createFakeConnection();
      const status = new ec.Status(fake.connection);
      fake.queueReply(statsReply());
      fake.queueReply(connStateReply(connStateTag({ bitmask: 0x01 })));
      await status.fetch();

      const notification = new ec.ECPacket(ec.ECOpcode.EC_OP_STATS);
      notification.add(connStateTag({ bitmask: 0x04 }));
      const applied = status.applyNotification(notification);

      expect(applied).to.equal(true);
      expect(status.kadConnected).to.equal(true);
      expect(status.ed2kConnected).to.equal(false);
      // fetch()'s stats snapshot must survive a connState-only notification.
      expect(status.uploadSpeed).to.equal(1_000n);
   });

   it("returns false for any opcode other than EC_OP_STATS", () => {
      const status = new ec.Status(createFakeConnection().connection);
      expect(status.applyNotification(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP))).to.equal(false);
   });

   it("returns false when the EC_OP_STATS packet carries no EC_TAG_CONNSTATE", () => {
      const status = new ec.Status(createFakeConnection().connection);
      expect(status.applyNotification(new ec.ECPacket(ec.ECOpcode.EC_OP_STATS))).to.equal(false);
   });
});
