import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Preferences.getMessageFilter", () => {
   it("requests EC_PREFS_MESSAGEFILTER and parses presence-encoded booleans plus strings", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(
            ec.ECTagNames.EC_TAG_PREFS_MESSAGEFILTER,
            new Uint8Array(),
            [
               new ec.ECCustomTag(
                  ec.ECTagNames.EC_TAG_MSGFILTER_ENABLED,
                  new Uint8Array(),
               ),
               new ec.ECCustomTag(
                  ec.ECTagNames.EC_TAG_MSGFILTER_BY_KEYWORD,
                  new Uint8Array(),
               ),
               new ec.ECStringTag(
                  ec.ECTagNames.EC_TAG_MSGFILTER_KEYWORDS,
                  "spam,ad",
               ),
               new ec.ECStringTag(
                  ec.ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS,
                  "",
               ),
            ],
         ),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getMessageFilter();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_PREFERENCES);
      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(
         BigInt(ec.ECPreferencesSelection.MESSAGEFILTER),
      );
      expect(prefs).to.deep.equal({
         enabled: true,
         filterAll: false,
         friendsOnly: false,
         secureOnly: false,
         byKeyword: true,
         keywords: "spam,ad",
         showInLog: false,
         filterComments: false,
         commentKeywords: "",
      });
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getMessageFilter(), /EC_OP_SET_PREFERENCES/);
   });

   it("throws when the daemon reply omits the section", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES));

      await expectRejection(preferences.getMessageFilter(), /MESSAGEFILTER/);
   });
});

describe("Preferences.setMessageFilter", () => {
   it("sends EC_DETAIL_UPDATE and presence-encodes true booleans only", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setMessageFilter({
         enabled: true,
         filterAll: false,
         friendsOnly: true,
         secureOnly: false,
         byKeyword: false,
         keywords: "kw",
         showInLog: false,
         filterComments: false,
         commentKeywords: "ck",
      });

      const sent = fake.sent[0];
      expect(sent?.opcode).to.equal(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      const detailTag = sent?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL);
      expect(detailTag?.intValue).to.equal(
         BigInt(ec.ECDetailLevel.EC_DETAIL_UPDATE),
      );
      const section = sent?.find(ec.ECTagNames.EC_TAG_PREFS_MESSAGEFILTER);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(
         section?.findChild(ec.ECTagNames.EC_TAG_MSGFILTER_ENABLED),
      ).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(
         section?.findChild(ec.ECTagNames.EC_TAG_MSGFILTER_FRIENDS),
      ).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_MSGFILTER_ALL)).to.be
         .undefined;
      expect(section?.childString(ec.ECTagNames.EC_TAG_MSGFILTER_KEYWORDS)).to.equal(
         "kw",
      );
      expect(
         section?.childString(ec.ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS),
      ).to.equal("ck");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(
         preferences.setMessageFilter({
            enabled: false,
            filterAll: false,
            friendsOnly: false,
            secureOnly: false,
            byKeyword: false,
            keywords: "",
            showInLog: false,
            filterComments: false,
            commentKeywords: "",
         }),
         /EC_OP_NOOP/,
      );
   });
});

describe("Preferences.getCoreTweaks", () => {
   it("requests EC_PREFS_CORETWEAKS and parses ints plus the presence-encoded VERBOSE flag", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(
            ec.ECTagNames.EC_TAG_PREFS_CORETWEAKS,
            new Uint8Array(),
            [
               new ec.ECUInt16Tag(
                  ec.ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE,
                  5,
               ),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CORETW_FILEBUFFER, 300000),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CORETW_UL_QUEUE, 3000),
               new ec.ECUInt64Tag(
                  ec.ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT,
                  600000n,
               ),
               new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CORETW_KAD_MAX_SEARCHES, 2),
               new ec.ECUInt64Tag(
                  ec.ECTagNames.EC_TAG_CORETW_KAD_REASK_MS,
                  120000n,
               ),
               new ec.ECUInt64Tag(
                  ec.ECTagNames.EC_TAG_CORETW_SOURCE_REASK_MS,
                  180000n,
               ),
            ],
         ),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getCoreTweaks();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(
         BigInt(ec.ECPreferencesSelection.CORETWEAKS),
      );
      expect(prefs).to.deep.equal({
         maxConnPerFive: 5,
         verbose: false,
         fileBufferSize: 300000,
         uploadQueueSize: 3000,
         serverKeepAliveTimeoutMs: 600000,
         kadMaxSourceSearches: 2,
         kadSourceReaskMs: 120000,
         sourceReaskMs: 180000,
      });
   });
});

describe("Preferences.setCoreTweaks", () => {
   it("sends EC_DETAIL_UPDATE and omits VERBOSE when false", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setCoreTweaks({
         maxConnPerFive: 8,
         verbose: true,
         fileBufferSize: 450000,
         uploadQueueSize: 5000,
         serverKeepAliveTimeoutMs: 300000,
         kadMaxSourceSearches: 3,
         kadSourceReaskMs: 60000,
         sourceReaskMs: 90000,
      });

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_CORETWEAKS);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(
         section?.findChild(ec.ECTagNames.EC_TAG_CORETW_VERBOSE),
      ).to.not.be.undefined;
      expect(section?.childInt(ec.ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE)).to.equal(
         8n,
      );
      expect(
         section?.childInt(ec.ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT),
      ).to.equal(300000n);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(
         preferences.setCoreTweaks({
            maxConnPerFive: 0,
            verbose: false,
            fileBufferSize: 0,
            uploadQueueSize: 0,
            serverKeepAliveTimeoutMs: 0,
            kadMaxSourceSearches: 0,
            kadSourceReaskMs: 0,
            sourceReaskMs: 0,
         }),
         /EC_OP_NOOP/,
      );
   });
});

describe("Preferences.listCategories", () => {
   it("parses each EC_TAG_CATEGORY entry, keyed by the tag's own index value", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(
            ec.ECTagNames.EC_TAG_PREFS_CATEGORIES,
            new Uint8Array(),
            [
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CATEGORY, 0, [
                  new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_TITLE, "All"),
                  new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_PATH, "/dl"),
                  new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_COMMENT, ""),
                  new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CATEGORY_COLOR, 0),
                  new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CATEGORY_PRIO, 0),
               ]),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CATEGORY, 1, [
                  new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_TITLE, "Movies"),
                  new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_PATH, "/dl/movies"),
                  new ec.ECStringTag(ec.ECTagNames.EC_TAG_CATEGORY_COMMENT, "c"),
                  new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CATEGORY_COLOR, 255),
                  new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CATEGORY_PRIO, 2),
               ]),
            ],
         ),
      );
      fake.queueReply(reply);

      const categories = await preferences.listCategories();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_PREFERENCES);
      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(
         BigInt(ec.ECPreferencesSelection.CATEGORIES),
      );
      expect(categories).to.have.lengthOf(2);
      expect(categories[1]).to.deep.equal(
         new ec.Category(1, "Movies", "/dl/movies", "c", 255, 2),
      );
   });

   it("returns an empty array when the daemon omits the section (only the default category exists)", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES));

      const categories = await preferences.listCategories();

      expect(categories).to.deep.equal([]);
   });
});
