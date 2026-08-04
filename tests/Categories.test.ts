import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Categories.create", () => {
   it("sends title/path/comment/color/prio as EC_TAG_CATEGORY children and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await categories.create("Videos", "/videos", "my videos", 0xff0000, 3);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CREATE_CATEGORY);
      const catTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CATEGORY);
      expect(catTag).to.be.instanceOf(ec.ECUInt32Tag);
      expect(
         (catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_TITLE) as ec.ECStringTag).value,
      ).to.equal("Videos");
      expect(
         (catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_PATH) as ec.ECStringTag).value,
      ).to.equal("/videos");
      expect(
         (catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_COMMENT) as ec.ECStringTag).value,
      ).to.equal("my videos");
      expect(catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_COLOR)?.intValue).to.equal(
         0xff0000n,
      );
      expect(catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_PRIO)?.intValue).to.equal(3n);
   });

   it("defaults comment/color/prio when omitted", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await categories.create("Videos", "/videos");

      const catTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CATEGORY);
      expect(
         (catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_COMMENT) as ec.ECStringTag).value,
      ).to.equal("");
      expect(catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_COLOR)?.intValue).to.equal(0n);
      expect(catTag?.findChild(ec.ECTagNames.EC_TAG_CATEGORY_PRIO)?.intValue).to.equal(0n);
   });

   it("throws an error assembled from EC_TAG_CATEGORY/EC_TAG_CATEGORY_PATH on EC_OP_FAILED (invalid/uncreatable path)", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CATEGORY, 1));
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_PATH, "/home/user/Incoming"));
      fake.queueReply(failure);

      await expectRejection(
         categories.create("Videos", "/videos"),
         /index #1.*using "\/home\/user\/Incoming" instead/,
      );
   });
});

describe("Categories.update", () => {
   it("sends the index as EC_TAG_CATEGORY's own data", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await categories.update(2, "Videos", "/videos", "updated", 1, 2);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_UPDATE_CATEGORY);
      const catTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CATEGORY);
      expect(catTag?.intValue).to.equal(2n);
   });

   it("throws an error on EC_OP_FAILED (invalid/uncreatable path), reporting the previous path kept in place", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CATEGORY, 2));
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_PATH, "/old/music/path"));
      fake.queueReply(failure);

      await expectRejection(
         categories.update(2, "Music", "/music"),
         /index #2.*using "\/old\/music\/path" instead/,
      );
   });
});

describe("Categories.delete", () => {
   it("sends the index as a single EC_TAG_CATEGORY tag with no children", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await categories.delete(2);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_DELETE_CATEGORY);
      const catTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_CATEGORY);
      expect(catTag?.intValue).to.equal(2n);
      expect(catTag?.children).to.have.lengthOf(0);
   });

   it("always resolves on EC_OP_NOOP, no failure case", async () => {
      const fake = createFakeConnection();
      const categories = new ec.Categories(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await categories.delete(99);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_DELETE_CATEGORY);
   });
});
