import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Preferences.getMessageFilter", () => {
   it("requests EC_PREFS_MESSAGEFILTER and parses presence-encoded booleans plus strings", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_MESSAGEFILTER, new Uint8Array(), [
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_MSGFILTER_ENABLED, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_MSGFILTER_BY_KEYWORD, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_MSGFILTER_KEYWORDS, "spam,ad"),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS, ""),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getMessageFilter();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_PREFERENCES);
      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.MESSAGEFILTER));
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
      expect(detailTag?.intValue).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_UPDATE));
      const section = sent?.find(ec.ECTagNames.EC_TAG_PREFS_MESSAGEFILTER);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_MSGFILTER_ENABLED)).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_MSGFILTER_FRIENDS)).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_MSGFILTER_ALL)).to.be.undefined;
      expect(section?.childString(ec.ECTagNames.EC_TAG_MSGFILTER_KEYWORDS)).to.equal("kw");
      expect(section?.childString(ec.ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS)).to.equal("ck");
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

function connectionsPrefsFixture(): ec.ConnectionsPrefs {
   return {
      maxGraphUploadRate: 100,
      maxGraphDownloadRate: 200,
      maxUpload: 50,
      maxDownload: 500,
      slotAllocation: 10,
      tcpPort: 4662,
      udpPort: 4672,
      udpDisabled: false,
      maxSourcesPerFile: 300,
      maxConnections: 500,
      autoConnect: true,
      reconnect: false,
      networkEd2k: true,
      networkKademlia: true,
      bindAddress: "",
      bindInterface: "",
      proxy: {
         enabled: false,
         type: ec.ECProxyType.NONE,
         host: "",
         port: 0,
         enablePassword: false,
         userName: "",
         password: "",
      },
      upnpEnabled: true,
      upnpTcpPort: 43_690,
   };
}

describe("Preferences.getConnections", () => {
   it("requests EC_PREFS_CONNECTIONS and parses both boolean encodings correctly", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_CONNECTIONS, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CONN_UL_CAP, 100),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CONN_DL_CAP, 200),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CONN_MAX_UL, 50),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CONN_MAX_DL, 500),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CONN_SLOT_ALLOCATION, 10),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CONN_TCP_PORT, 4662),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CONN_UDP_PORT, 4672),
            // EC_TAG_CONN_UDP_DISABLE omitted: presence-encoded, false here
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CONN_MAX_FILE_SOURCES, 300),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CONN_MAX_CONN, 500),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CONN_AUTOCONNECT, new Uint8Array()),
            // EC_TAG_CONN_RECONNECT omitted: presence-encoded, false here
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_NETWORK_ED2K, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_NETWORK_KADEMLIA, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_CONN_BIND_ADDRESS, ""),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_CONN_BIND_INTERFACE, ""),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PROXY_ENABLE, 0),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PROXY_TYPE, ec.ECProxyType.NONE),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PROXY_HOST, ""),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_PROXY_PORT, 0),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PROXY_AUTH, 0),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PROXY_USER, ""),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PROXY_PASSWORD, ""),
            // upnpEnabled is explicit int-valued, not presence-encoded - true here
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CONN_UPNP_ENABLED, 1),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CONN_UPNP_TCP_PORT, 43_690),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getConnections();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.CONNECTIONS));
      expect(prefs).to.deep.equal(connectionsPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getConnections(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setConnections", () => {
   it("presence-encodes AUTOCONNECT/RECONNECT/etc, but sends PROXY_ENABLE/PROXY_AUTH/UPNP_ENABLED as explicit ints", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setConnections(connectionsPrefsFixture());

      const sent = fake.sent[0];
      expect(sent?.opcode).to.equal(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      const section = sent?.find(ec.ECTagNames.EC_TAG_PREFS_CONNECTIONS);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_CONN_AUTOCONNECT)).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_CONN_RECONNECT)).to.be.undefined;
      expect(section?.childInt(ec.ECTagNames.EC_TAG_PROXY_ENABLE)).to.equal(0n);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_CONN_UPNP_ENABLED)).to.equal(1n);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_PROXY_TYPE)).to.equal(BigInt(ec.ECProxyType.NONE));
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setConnections(connectionsPrefsFixture()), /EC_OP_NOOP/);
   });
});

function filesPrefsFixture(): ec.FilesPrefs {
   return {
      ichEnabled: true,
      aichTrust: false,
      newFilesPaused: false,
      newAutoDownloadPriority: true,
      previewPrio: false,
      endgame: true,
      newAutoUploadPriority: false,
      startNextFilePaused: true,
      resumeSameCategory: false,
      saveSources: true,
      allocFullFileSize: false,
      mmapSupported: true,
      mmapEnabled: true,
      checkFreeSpace: true,
      minFreeDiskSpaceMb: 500,
      createFilesNormal: false,
      mediaMetadataEnabled: true,
      mediaMetadataFfprobePath: "/usr/bin/ffprobe",
      startNextFileAlpha: false,
   };
}

describe("Preferences.getFiles", () => {
   it("requests EC_PREFS_FILES and parses presence-encoded booleans plus MIN_FREE_SPACE/FFPROBE_PATH", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_FILES, new Uint8Array(), [
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_ICH_ENABLED, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_NEW_AUTO_DL_PRIO, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_ENDGAME, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_START_NEXT_PAUSED, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_SAVE_SOURCES, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_MMAP_SUPPORTED, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_MMAP_ENABLED, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_CHECK_FREE_SPACE, new Uint8Array()),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FILES_MIN_FREE_SPACE, 500),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FILES_MEDIA_METADATA_ENABLED, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_FILES_MEDIA_FFPROBE_PATH, "/usr/bin/ffprobe"),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getFiles();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.FILES));
      expect(prefs).to.deep.equal(filesPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getFiles(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setFiles", () => {
   it("presence-encodes booleans and sends MIN_FREE_SPACE/FFPROBE_PATH as plain value tags", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setFiles(filesPrefsFixture());

      const sent = fake.sent[0];
      expect(sent?.opcode).to.equal(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      const section = sent?.find(ec.ECTagNames.EC_TAG_PREFS_FILES);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_FILES_ICH_ENABLED)).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_FILES_AICH_TRUST)).to.be.undefined;
      // FILES_MMAP_SUPPORTED is GET-only informational - never sent back.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_FILES_MMAP_SUPPORTED)).to.be.undefined;
      expect(section?.childInt(ec.ECTagNames.EC_TAG_FILES_MIN_FREE_SPACE)).to.equal(500n);
      expect(section?.childString(ec.ECTagNames.EC_TAG_FILES_MEDIA_FFPROBE_PATH)).to.equal("/usr/bin/ffprobe");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setFiles(filesPrefsFixture()), /EC_OP_NOOP/);
   });
});

function directoriesPrefsFixture(): ec.DirectoriesPrefs {
   return {
      incomingDir: "/downloads/incoming",
      tempDir: "/downloads/temp",
      sharedDirs: ["/media/movies", "/media/music"],
      shareHiddenFiles: false,
      autoRescanSharedDirs: true,
      followSymlinksInShares: false,
      excludeSharePatterns: "*.tmp;*.part",
      excludeSharePatternsUseRegex: false,
   };
}

describe("Preferences.getDirectories", () => {
   it("requests EC_PREFS_DIRECTORIES and parses the shared-dirs list plus the explicit-int EXCLUDE_REGEX flag", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_DIRECTORIES, new Uint8Array(), [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_DIRECTORIES_INCOMING, "/downloads/incoming"),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_DIRECTORIES_TEMP, "/downloads/temp"),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_DIRECTORIES_SHARED, 2, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "/media/movies"),
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "/media/music"),
            ]),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_DIRECTORIES_AUTO_RESCAN, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_PATTERNS, "*.tmp;*.part"),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_REGEX, 0),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getDirectories();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.DIRECTORIES));
      expect(prefs).to.deep.equal(directoriesPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getDirectories(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setDirectories", () => {
   it("sends the shared-dirs list as EC_TAG_STRING children and EXCLUDE_REGEX as an explicit int", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setDirectories(directoriesPrefsFixture());

      const sent = fake.sent[0];
      expect(sent?.opcode).to.equal(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      const section = sent?.find(ec.ECTagNames.EC_TAG_PREFS_DIRECTORIES);
      const sharedTag = section?.findChild(ec.ECTagNames.EC_TAG_DIRECTORIES_SHARED);
      expect(sharedTag?.intValue).to.equal(2n);
      expect(sharedTag?.children.map((child) => (child instanceof ec.ECStringTag ? child.value : undefined))).to.deep.equal([
         "/media/movies",
         "/media/music",
      ]);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_REGEX)).to.equal(0n);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setDirectories(directoriesPrefsFixture()), /EC_OP_NOOP/);
   });
});

function securityPrefsFixture(): ec.SecurityPrefs {
   return {
      canSeeShares: ec.ECVisibleShareAccess.FRIENDS,
      ipFilterClients: true,
      ipFilterServers: true,
      ipFilterAutoUpdate: false,
      ipFilterUpdateUrl: "http://example.com/ipfilter.dat",
      ipFilterLevel: 127,
      filterLanIps: false,
      secureIdentEnabled: true,
      obfuscationSupported: true,
      obfuscationRequested: false,
      obfuscationRequired: false,
      ipFilterParanoid: false,
      ipFilterSystem: false,
   };
}

describe("Preferences.getSecurity", () => {
   it("requests EC_PREFS_SECURITY and parses the explicit-int CAN_SEE_SHARES plus presence-encoded booleans", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_SECURITY, new Uint8Array(), [
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SECURITY_CAN_SEE_SHARES, ec.ECVisibleShareAccess.FRIENDS),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_IPFILTER_CLIENTS, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_IPFILTER_SERVERS, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IPFILTER_UPDATE_URL, "http://example.com/ipfilter.dat"),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IPFILTER_LEVEL, 127),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SECURITY_USE_SECIDENT, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SECURITY_OBFUSCATION_SUPPORTED, new Uint8Array()),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getSecurity();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.SECURITY));
      expect(prefs).to.deep.equal(securityPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getSecurity(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setSecurity", () => {
   it("sends CAN_SEE_SHARES as an explicit uint8 and presence-encodes the rest", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setSecurity(securityPrefsFixture());

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_SECURITY);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_SECURITY_CAN_SEE_SHARES)).to.equal(BigInt(ec.ECVisibleShareAccess.FRIENDS));
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_IPFILTER_CLIENTS)).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_IPFILTER_PARANOID)).to.be.undefined;
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setSecurity(securityPrefsFixture()), /EC_OP_NOOP/);
   });
});

function onlineSigPrefsFixture(): ec.OnlineSigPrefs {
   return {
      enabled: true,
      directory: "/home/user/.aMule/OnlineSig",
      updateIntervalSeconds: 5,
   };
}

describe("Preferences.getOnlineSig", () => {
   it("requests EC_PREFS_ONLINESIG and parses the presence-encoded ENABLED flag plus DIRECTORY/UPDATE", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_ONLINESIG, new Uint8Array(), [
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_ONLINESIG_ENABLED, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_ONLINESIG_DIRECTORY, "/home/user/.aMule/OnlineSig"),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_ONLINESIG_UPDATE, 5),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getOnlineSig();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.ONLINESIG));
      expect(prefs).to.deep.equal(onlineSigPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getOnlineSig(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setOnlineSig", () => {
   it("presence-encodes ENABLED and sends DIRECTORY/UPDATE as plain value tags", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setOnlineSig(onlineSigPrefsFixture());

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_ONLINESIG);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_ONLINESIG_ENABLED)).to.not.be.undefined;
      expect(section?.childString(ec.ECTagNames.EC_TAG_ONLINESIG_DIRECTORY)).to.equal("/home/user/.aMule/OnlineSig");
      expect(section?.childInt(ec.ECTagNames.EC_TAG_ONLINESIG_UPDATE)).to.equal(5n);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setOnlineSig(onlineSigPrefsFixture()), /EC_OP_NOOP/);
   });
});

function serversPrefsFixture(): ec.ServersPrefs {
   return {
      removeDeadServers: true,
      deadServerRetries: 3,
      autoUpdateServerList: true,
      addServersFromServer: false,
      addServersFromClient: false,
      useScoreSystem: true,
      smartIdCheck: true,
      safeServerConnect: true,
      autoConnectStaticOnly: false,
      manualHighPriority: false,
      updateUrl: "http://example.com/server.met",
   };
}

describe("Preferences.getServers (preferences section)", () => {
   it("requests EC_PREFS_SERVERS and parses presence-encoded booleans plus RETRIES/UPDATE_URL", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_SERVERS, new Uint8Array(), [
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVERS_REMOVE_DEAD, new Uint8Array()),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_SERVERS_DEAD_SERVER_RETRIES, 3),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVERS_AUTO_UPDATE, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVERS_USE_SCORE_SYSTEM, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVERS_SMART_ID_CHECK, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVERS_SAFE_SERVER_CONNECT, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVERS_UPDATE_URL, "http://example.com/server.met"),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getServers();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.SERVERS));
      expect(prefs).to.deep.equal(serversPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getServers(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setServers (preferences section)", () => {
   it("presence-encodes booleans and sends RETRIES/UPDATE_URL as plain value tags", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setServers(serversPrefsFixture());

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_SERVERS);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_SERVERS_REMOVE_DEAD)).to.not.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_SERVERS_MANUAL_HIGH_PRIO)).to.be.undefined;
      expect(section?.childInt(ec.ECTagNames.EC_TAG_SERVERS_DEAD_SERVER_RETRIES)).to.equal(3n);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setServers(serversPrefsFixture()), /EC_OP_NOOP/);
   });
});

describe("Preferences.getKademlia", () => {
   it("requests EC_PREFS_KADEMLIA and parses the single URL", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_KADEMLIA, new Uint8Array(), [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_KADEMLIA_UPDATE_URL, "http://example.com/nodes.dat"),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getKademlia();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.KADEMLIA));
      expect(prefs).to.deep.equal({
         nodesUpdateUrl: "http://example.com/nodes.dat",
      });
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getKademlia(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setKademlia", () => {
   it("sends the URL as EC_TAG_KADEMLIA_UPDATE_URL", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setKademlia({
         nodesUpdateUrl: "http://example.com/nodes.dat",
      });

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_KADEMLIA);
      expect(section?.childString(ec.ECTagNames.EC_TAG_KADEMLIA_UPDATE_URL)).to.equal("http://example.com/nodes.dat");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setKademlia({ nodesUpdateUrl: "" }), /EC_OP_NOOP/);
   });
});

const USER_HASH_HEX = "0123456789abcdef0123456789abcdef";

function generalPrefsFixture(): ec.GeneralPrefs {
   return {
      userNick: "aMuleUser",
      userHash: USER_HASH_HEX,
      userHost: "myhost.example.com",
      checkNewVersion: true,
      versionCheckAvailable: true,
      upnpAvailable: false,
   };
}

describe("Preferences.getGeneral", () => {
   it("requests EC_PREFS_GENERAL and decodes the hash-typed EC_TAG_USER_HASH", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_GENERAL, new Uint8Array(), [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_USER_NICK, "aMuleUser"),
            new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_USER_HASH, new Uint8Array(Buffer.from(USER_HASH_HEX, "hex"))),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_USER_HOST, "myhost.example.com"),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_GENERAL_CHECK_NEW_VERSION, 1),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_GENERAL_VERSION_CHECK_AVAILABLE, 1),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_GENERAL_UPNP_AVAILABLE, 0),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getGeneral();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.GENERAL));
      expect(prefs).to.deep.equal(generalPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getGeneral(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setGeneral", () => {
   it("sends the hash back as EC_TAG_USER_HASH and never sends the read-only capability signals", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setGeneral(generalPrefsFixture());

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_GENERAL);
      expect(section?.childString(ec.ECTagNames.EC_TAG_USER_NICK)).to.equal("aMuleUser");
      const hashTag = section?.findChild(ec.ECTagNames.EC_TAG_USER_HASH);
      expect(hashTag instanceof ec.ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : undefined).to.equal(USER_HASH_HEX);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_GENERAL_VERSION_CHECK_AVAILABLE)).to.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_GENERAL_UPNP_AVAILABLE)).to.be.undefined;
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setGeneral(generalPrefsFixture()), /EC_OP_NOOP/);
   });
});

const WEBSERVER_HASH_HEX = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AMULEAPI_GUEST_HASH_HEX = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function remoteControlsPrefsFixture(): ec.RemoteControlsPrefs {
   return {
      webserverPort: 4711,
      webserverAutorun: true,
      webserverPasswordHash: WEBSERVER_HASH_HEX,
      webserverGuest: { enabled: false, passwordHash: undefined },
      webserverUseGzip: true,
      webserverRefreshSeconds: 20,
      webserverTemplate: "default",
      amuleApiPort: 4712,
      amuleApiAutorun: true,
      amuleApiBindAddress: "127.0.0.1",
      amuleApiAdmin: { enabled: true, passwordHash: undefined },
      amuleApiGuest: { enabled: true, passwordHash: AMULEAPI_GUEST_HASH_HEX },
   };
}

describe("Preferences.getRemoteControls", () => {
   it("requests EC_PREFS_REMOTECONTROLS and decodes the 3 differently-nested password hashes", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_REMOTECTRL, new Uint8Array(), [
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_WEBSERVER_PORT, 4711),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_WEBSERVER_AUTORUN, new Uint8Array()),
            new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PASSWD_HASH, new Uint8Array(Buffer.from(WEBSERVER_HASH_HEX, "hex"))),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_WEBSERVER_USEGZIP, new Uint8Array()),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_WEBSERVER_REFRESH, 20),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_WEBSERVER_TEMPLATE, "default"),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_AMULEAPI_PORT, 4712),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_AMULEAPI_AUTORUN, new Uint8Array()),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_AMULEAPI_BIND, "127.0.0.1"),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_AMULEAPI_PASSWD, new Uint8Array()),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_AMULEAPI_GUEST_PASSWD, new Uint8Array(), [
               new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PASSWD_HASH, new Uint8Array(Buffer.from(AMULEAPI_GUEST_HASH_HEX, "hex"))),
            ]),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getRemoteControls();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.REMOTECONTROLS));
      expect(prefs).to.deep.equal(remoteControlsPrefsFixture());
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getRemoteControls(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setRemoteControls", () => {
   it("omits disabled account containers and nests each hash under the right parent", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setRemoteControls(remoteControlsPrefsFixture());

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_REMOTECTRL);
      const topHash = section?.findChild(ec.ECTagNames.EC_TAG_PASSWD_HASH);
      expect(topHash instanceof ec.ECHash16Tag ? Buffer.from(topHash.value).toString("hex") : undefined).to.equal(
         WEBSERVER_HASH_HEX,
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_WEBSERVER_GUEST)).to.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_AMULEAPI_PASSWD)).to.not.be.undefined;
      const guestTag = section?.findChild(ec.ECTagNames.EC_TAG_AMULEAPI_GUEST_PASSWD);
      const guestHash = guestTag?.findChild(ec.ECTagNames.EC_TAG_PASSWD_HASH);
      expect(guestHash instanceof ec.ECHash16Tag ? Buffer.from(guestHash.value).toString("hex") : undefined).to.equal(
         AMULEAPI_GUEST_HASH_HEX,
      );
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setRemoteControls(remoteControlsPrefsFixture()), /EC_OP_NOOP/);
   });
});

function ip2CountryPrefsFixture(): ec.IP2CountryPrefs {
   return {
      supported: true,
      enabled: true,
      source: ec.ECGeoIPSource.MAXMIND,
      customUrl: "",
      maxMindLicense: "abc123",
      autoUpdate: true,
      loadedSource: "MaxMind",
      databasePath: "/var/lib/amule/GeoLite2-Country.mmdb",
      databaseLoaded: true,
      downloading: false,
      lastResult: "OK",
      updateNow: false,
   };
}

describe("Preferences.getIP2Country", () => {
   it("requests EC_PREFS_IP2COUNTRY and parses the explicit-int booleans plus optional live-status fields", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_IP2COUNTRY, new Uint8Array(), [
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_SUPPORTED, 1),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_ENABLED, 1),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_SOURCE, ec.ECGeoIPSource.MAXMIND),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_CUSTOM_URL, ""),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_MAXMIND_LICENSE, "abc123"),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_AUTO_UPDATE, 1),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_LOADED_SOURCE, "MaxMind"),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_DB_PATH, "/var/lib/amule/GeoLite2-Country.mmdb"),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_DB_LOADED, 1),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_DOWNLOADING, 0),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_LAST_RESULT, "OK"),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getIP2Country();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.IP2COUNTRY));
      expect(prefs).to.deep.equal(ip2CountryPrefsFixture());
   });

   it("leaves the live-status fields undefined when the daemon omits them (no resolver)", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_IP2COUNTRY, new Uint8Array(), [
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_SUPPORTED, 0),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_ENABLED, 0),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_SOURCE, ec.ECGeoIPSource.DBIP),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_CUSTOM_URL, ""),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_IP2COUNTRY_MAXMIND_LICENSE, ""),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_IP2COUNTRY_AUTO_UPDATE, 0),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getIP2Country();

      /* eslint-disable @typescript-eslint/no-unused-expressions -- chai's getter-style assertion */
      expect(prefs.loadedSource).to.be.undefined;
      expect(prefs.databasePath).to.be.undefined;
      expect(prefs.databaseLoaded).to.be.undefined;
      expect(prefs.downloading).to.be.undefined;
      expect(prefs.lastResult).to.be.undefined;
      /* eslint-enable @typescript-eslint/no-unused-expressions */
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.getIP2Country(), /EC_OP_SET_PREFERENCES/);
   });
});

describe("Preferences.setIP2Country", () => {
   it("sends ENABLED/SOURCE/AUTO_UPDATE as explicit ints, and UPDATE_NOW only when true", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setIP2Country({
         ...ip2CountryPrefsFixture(),
         updateNow: true,
      });

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_IP2COUNTRY);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_IP2COUNTRY_ENABLED)).to.equal(1n);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_IP2COUNTRY_SOURCE)).to.equal(BigInt(ec.ECGeoIPSource.MAXMIND));
      // SUPPORTED is read-only - never sent back.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_IP2COUNTRY_SUPPORTED)).to.be.undefined;
      expect(section?.childInt(ec.ECTagNames.EC_TAG_IP2COUNTRY_UPDATE_NOW)).to.equal(1n);
   });

   it("omits UPDATE_NOW when false", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await preferences.setIP2Country(ip2CountryPrefsFixture());

      const section = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PREFS_IP2COUNTRY);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(section?.findChild(ec.ECTagNames.EC_TAG_IP2COUNTRY_UPDATE_NOW)).to.be.undefined;
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(preferences.setIP2Country(ip2CountryPrefsFixture()), /EC_OP_NOOP/);
   });
});

describe("Preferences.getCoreTweaks", () => {
   it("requests EC_PREFS_CORETWEAKS and parses ints plus the presence-encoded VERBOSE flag", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_CORETWEAKS, new Uint8Array(), [
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE, 5),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CORETW_FILEBUFFER, 300000),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CORETW_UL_QUEUE, 3000),
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT, 600000n),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_CORETW_KAD_MAX_SEARCHES, 2),
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CORETW_KAD_REASK_MS, 120000n),
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_CORETW_SOURCE_REASK_MS, 180000n),
         ]),
      );
      fake.queueReply(reply);

      const prefs = await preferences.getCoreTweaks();

      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.CORETWEAKS));
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
      expect(section?.findChild(ec.ECTagNames.EC_TAG_CORETW_VERBOSE)).to.not.be.undefined;
      expect(section?.childInt(ec.ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE)).to.equal(8n);
      expect(section?.childInt(ec.ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT)).to.equal(300000n);
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
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PREFS_CATEGORIES, new Uint8Array(), [
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
         ]),
      );
      fake.queueReply(reply);

      const categories = await preferences.listCategories();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_PREFERENCES);
      const selectTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SELECT_PREFS);
      expect(selectTag?.intValue).to.equal(BigInt(ec.ECPreferencesSelection.CATEGORIES));
      expect(categories).to.have.lengthOf(2);
      expect(categories[1]).to.deep.equal(new ec.Category(1, "Movies", "/dl/movies", "c", 255, 2));
   });

   it("returns an empty array when the daemon omits the section (only the default category exists)", async () => {
      const fake = createFakeConnection();
      const preferences = new ec.Preferences(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SET_PREFERENCES));

      const categories = await preferences.listCategories();

      expect(categories).to.deep.equal([]);
   });
});
