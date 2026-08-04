import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECPreferencesSelection } from "./ECPreferencesSelection.js";
import {
   ECTag,
   ECUInt8Tag,
   ECUInt16Tag,
   ECUInt32Tag,
   ECUInt64Tag,
   ECStringTag,
   ECCustomTag,
} from "./ECTags.js";

const debug = debuglog("amule-ec:preferences");

/** MessageFilter section of the daemon preferences - EC_TAG_PREFS_MESSAGEFILTER. */
export interface MessageFilterPrefs {
   enabled: boolean;
   filterAll: boolean;
   friendsOnly: boolean;
   secureOnly: boolean;
   byKeyword: boolean;
   keywords: string;
   showInLog: boolean;
   filterComments: boolean;
   commentKeywords: string;
}

/**
 * CoreTweaks section of the daemon preferences - EC_TAG_PREFS_CORETWEAKS.
 *
 * `fileBufferSize`/`uploadQueueSize` and the three `*Ms` fields are
 * transmitted already fully computed by the daemon (bytes / milliseconds),
 * not the small user-facing settings they're derived from - confirmed
 * against `CPreferences::GetFileBufferSize()`/`GetQueueSize()`/
 * `GetServerKeepAliveTimeout()`/`GetKadSourceReaskTime()`/
 * `GetSourceReaskTime()`
 * (https://github.com/amule-org/amule/blob/master/src/Preferences.h#L374-L428): each multiplies
 * its internal setting (a buffer/queue "level" or a minutes count) before
 * returning it, so no further scaling is needed on this side.
 */
export interface CoreTweaksPrefs {
   maxConnPerFive: number;
   verbose: boolean;
   fileBufferSize: number;
   uploadQueueSize: number;
   serverKeepAliveTimeoutMs: number;
   kadMaxSourceSearches: number;
   kadSourceReaskMs: number;
   sourceReaskMs: number;
}

/**
 * CProxyType values - confirmed against Proxy.h
 * (https://github.com/amule-org/amule/blob/master/src/Proxy.h#L103-L109). `NONE` is declared as
 * signed `-1` on the C++ side but transmitted `static_cast<uint32>(...)`
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L160) - i.e. as
 * `0xffffffff` on the wire - so that's the value used here too, rather than
 * a `-1` this library's UINT32 tag encoder would reject.
 */
export enum ECProxyType {
   NONE = 0xffffffff,
   SOCKS5 = 0,
   SOCKS4 = 1,
   HTTP = 2,
   SOCKS4A = 3,
}

/**
 * Proxy sub-group of the CONNECTIONS section - the daemon routes both P2P
 * traffic and its own HTTP fetches (e.g. IPFilter/Kad-nodes updates)
 * through this. `password` rides in plain text both ways (confirmed
 * against the CONNECTIONS reply builder's own comment,
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L163-L166) - it is a
 * proxy auth credential, not a password hash.
 */
export interface ProxyPrefs {
   enabled: boolean;
   type: ECProxyType;
   host: string;
   port: number;
   enablePassword: boolean;
   userName: string;
   password: string;
}

/**
 * CONNECTIONS section of the daemon preferences - EC_TAG_PREFS_CONNECTIONS.
 *
 * Unlike every other boolean in this class, `proxy.enabled`,
 * `proxy.enablePassword` and `upnpEnabled` are NOT presence-encoded: the
 * reply builder always sends them as an explicit int tag
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L160-L179), and
 * `Apply()` reads them with a plain `GetInt() != 0` rather than going
 * through `ApplyBoolean()`
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L648-L677) - so
 * `setConnections()` sends them unconditionally too, same as any other
 * value-carrying field.
 */
export interface ConnectionsPrefs {
   maxGraphUploadRate: number;
   maxGraphDownloadRate: number;
   maxUpload: number;
   maxDownload: number;
   slotAllocation: number;
   tcpPort: number;
   udpPort: number;
   udpDisabled: boolean;
   maxSourcesPerFile: number;
   maxConnections: number;
   autoConnect: boolean;
   reconnect: boolean;
   networkEd2k: boolean;
   networkKademlia: boolean;
   bindAddress: string;
   bindInterface: string;
   proxy: ProxyPrefs;
   upnpEnabled: boolean;
   upnpTcpPort: number;
}

/**
 * FILES section of the daemon preferences - EC_TAG_PREFS_FILES.
 *
 * Two tags declared in `ECTagNames.ts` are deliberately left out of this
 * interface: `EC_TAG_FILES_UL_FULL_CHUNKS` is a real protocol tag but is
 * never built into a GET_PREFERENCES reply nor read by `Apply()` anywhere
 * in the current C++ source (only a dead reference remains in the
 * deprecated PHP webserver template mapping,
 * https://github.com/amule-org/amule/blob/master/src/webserver/src/php_amule_lib.cpp#L396); and
 * `EC_TAG_FILES_EXTRACT_METADATA` doesn't exist at all upstream (see the
 * commit that first declared it, 3703bba, for how that was found). Both
 * would always read back empty/absent and have no effect if sent.
 *
 * `mmapSupported` is purely informational: on the daemon side, `Apply()`
 * only consults this tag under `#ifdef CLIENT_GUI`
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L829-L833) - i.e. it's
 * the remote GUI mirroring the daemon's own advertised capability locally,
 * not something a daemon build ever applies to itself. `setFiles()`
 * doesn't transmit it back for that reason. `mmapEnabled` is only ever
 * present in a reply when `mmapSupported` is true (nested inside the same
 * `if` in the reply builder,
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L371-L375), but is
 * otherwise a normal presence-encoded, settable boolean.
 */
export interface FilesPrefs {
   ichEnabled: boolean;
   aichTrust: boolean;
   newFilesPaused: boolean;
   newAutoDownloadPriority: boolean;
   previewPrio: boolean;
   endgame: boolean;
   newAutoUploadPriority: boolean;
   startNextFilePaused: boolean;
   resumeSameCategory: boolean;
   saveSources: boolean;
   allocFullFileSize: boolean;
   mmapSupported: boolean;
   mmapEnabled: boolean;
   checkFreeSpace: boolean;
   minFreeDiskSpaceMb: number;
   createFilesNormal: boolean;
   mediaMetadataEnabled: boolean;
   mediaMetadataFfprobePath: string;
   startNextFileAlpha: boolean;
}

/**
 * DIRECTORIES section of the daemon preferences - EC_TAG_PREFS_DIRECTORIES.
 *
 * `sharedDirs` mirrors the same underlying `vector<CPath>` as
 * `SharedFiles.getSharedDirs()`/`setSharedDirs()`
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L844-L850), but as a
 * flat path list with no per-directory `recursive` flag (that flag lives
 * elsewhere, only reachable through the dedicated
 * `EC_OP_GET_SHARED_DIRS`/`EC_OP_SET_SHARED_DIRS` opcodes) - prefer those
 * for anything that needs to preserve recursion settings. Round-tripping
 * `sharedDirs` through get/setDirectories() alone is safe (no recursion
 * data exists at this layer to lose), just coarser.
 *
 * `excludeSharePatternsUseRegex` is, like `ConnectionsPrefs.upnpEnabled`,
 * an explicit 0/1 int tag rather than presence-encoded
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L415-L416,866-871).
 */
export interface DirectoriesPrefs {
   incomingDir: string;
   tempDir: string;
   sharedDirs: string[];
   shareHiddenFiles: boolean;
   autoRescanSharedDirs: boolean;
   followSymlinksInShares: boolean;
   excludeSharePatterns: string;
   excludeSharePatternsUseRegex: boolean;
}

/** One entry of the CATEGORIES section - EC_TAG_CATEGORY. */
export class Category {

   public constructor(
      public readonly index: number,
      public readonly title: string,
      public readonly path: string,
      public readonly comment: string,
      public readonly color: number,
      public readonly prio: number,
   ) {}
}

/**
 * Reads/writes the daemon's runtime preferences - EC_OP_GET_PREFERENCES,
 * EC_OP_SET_PREFERENCES.
 *
 * The protocol groups preferences into 14 named sections (EC_PREFS_* /
 * EC_TAG_PREFS_* pairs, confirmed against ECCodes.abstract
 * (https://github.com/amule-org/amule/blob/master/src/libs/ec/abstracts/ECCodes.abstract#L679-L693)
 * and CEC_Prefs_Packet's constructor
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L89-L216)); this class
 * grows section-by-section across several batches. So far: MESSAGEFILTER,
 * CONNECTIONS, FILES, DIRECTORIES, CORETWEAKS, and the read-only
 * CATEGORIES helper `listCategories()`.
 *
 * Two protocol quirks worth calling out:
 *  - A GET_PREFERENCES reply is a `CEC_Prefs_Packet`, whose base-class
 *    constructor is `CECPacket(EC_OP_SET_PREFERENCES, pref_details)`
 *    (https://github.com/amule-org/amule/blob/master/src/libs/ec/cpp/ECPacket.h#L44-L52) - so the
 *    reply's opcode on the wire is `EC_OP_SET_PREFERENCES`, not
 *    `EC_OP_GET_PREFERENCES`. This isn't a bug; the same reply shape is
 *    meant to be editable and sent straight back as a SET request.
 *  - Boolean fields are encoded as *presence*, not as an explicit 0/1
 *    value: the section-builder only adds the child tag at all when the
 *    preference is true (see e.g. the MESSAGEFILTER block at
 *    https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L185-L210). This
 *    class mirrors that on the SET side by sending a packet-level
 *    `EC_DETAIL_UPDATE` (any non-FULL level - see `CEC_Prefs_Packet::Apply`'s
 *    `use_tag` local,
 *    https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L538-L554,603), under
 *    which an absent boolean tag is applied as `false` rather than "leave
 *    unchanged" - i.e. every set*() call fully replaces its section.
 */
export class Preferences {

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Sends EC_OP_GET_PREFERENCES selecting a single section and returns
    * that section's own tag (with its children) from the reply.
    */
   private async fetchSection(
      selection: ECPreferencesSelection,
      sectionTagName: number,
   ): Promise<ECTag | undefined> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_PREFERENCES);
      request.add(new ECUInt32Tag(ECTagNames.EC_TAG_SELECT_PREFS, selection));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SET_PREFERENCES) {
         throw new Error(
            `Expected EC_OP_SET_PREFERENCES, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      return reply.find(sectionTagName);
   }

   /**
    * Sends `section` as an EC_OP_SET_PREFERENCES request at EC_DETAIL_UPDATE
    * (full-replace boolean semantics - see the class doc comment).
    */
   private async applySection(section: ECTag): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SET_PREFERENCES);
      request.add(
         new ECUInt8Tag(
            ECTagNames.EC_TAG_DETAIL_LEVEL,
            ECDetailLevel.EC_DETAIL_UPDATE,
         ),
      );
      request.add(section);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
   }

   /** Fetches the MESSAGEFILTER section - EC_TAG_PREFS_MESSAGEFILTER. */
   public async getMessageFilter(): Promise<MessageFilterPrefs> {
      const section = await this.fetchSection(
         ECPreferencesSelection.MESSAGEFILTER,
         ECTagNames.EC_TAG_PREFS_MESSAGEFILTER,
      );
      if (!section) {
         throw new Error("Daemon did not return the MESSAGEFILTER section.");
      }
      const has = (name: number): boolean =>
         section.findChild(name) !== undefined;
      const prefs: MessageFilterPrefs = {
         enabled: has(ECTagNames.EC_TAG_MSGFILTER_ENABLED),
         filterAll: has(ECTagNames.EC_TAG_MSGFILTER_ALL),
         friendsOnly: has(ECTagNames.EC_TAG_MSGFILTER_FRIENDS),
         secureOnly: has(ECTagNames.EC_TAG_MSGFILTER_SECURE),
         byKeyword: has(ECTagNames.EC_TAG_MSGFILTER_BY_KEYWORD),
         keywords:
            section.childString(ECTagNames.EC_TAG_MSGFILTER_KEYWORDS) ?? "",
         showInLog: has(ECTagNames.EC_TAG_MSGFILTER_SHOW_IN_LOG),
         filterComments: has(ECTagNames.EC_TAG_MSGFILTER_FILTER_COMMENTS),
         commentKeywords:
            section.childString(ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS) ??
            "",
      };
      debug("getMessageFilter: %o", prefs);
      return prefs;
   }

   /** Replaces the whole MESSAGEFILTER section - EC_TAG_PREFS_MESSAGEFILTER. */
   public async setMessageFilter(prefs: MessageFilterPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] =>
         value ? [new ECCustomTag(name, new Uint8Array())] : [];
      const section = new ECCustomTag(
         ECTagNames.EC_TAG_PREFS_MESSAGEFILTER,
         new Uint8Array(),
         [
            ...flag(ECTagNames.EC_TAG_MSGFILTER_ENABLED, prefs.enabled),
            ...flag(ECTagNames.EC_TAG_MSGFILTER_ALL, prefs.filterAll),
            ...flag(ECTagNames.EC_TAG_MSGFILTER_FRIENDS, prefs.friendsOnly),
            ...flag(ECTagNames.EC_TAG_MSGFILTER_SECURE, prefs.secureOnly),
            ...flag(ECTagNames.EC_TAG_MSGFILTER_BY_KEYWORD, prefs.byKeyword),
            new ECStringTag(
               ECTagNames.EC_TAG_MSGFILTER_KEYWORDS,
               prefs.keywords,
            ),
            ...flag(ECTagNames.EC_TAG_MSGFILTER_SHOW_IN_LOG, prefs.showInLog),
            ...flag(
               ECTagNames.EC_TAG_MSGFILTER_FILTER_COMMENTS,
               prefs.filterComments,
            ),
            new ECStringTag(
               ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS,
               prefs.commentKeywords,
            ),
         ],
      );
      await this.applySection(section);
      debug("setMessageFilter: applied");
   }

   /** Fetches the CONNECTIONS section - EC_TAG_PREFS_CONNECTIONS. */
   public async getConnections(): Promise<ConnectionsPrefs> {
      const section = await this.fetchSection(
         ECPreferencesSelection.CONNECTIONS,
         ECTagNames.EC_TAG_PREFS_CONNECTIONS,
      );
      if (!section) {
         throw new Error("Daemon did not return the CONNECTIONS section.");
      }
      const has = (name: number): boolean =>
         section.findChild(name) !== undefined;
      const num = (name: number): number => Number(section.childInt(name) ?? 0n);
      const str = (name: number): string => section.childString(name) ?? "";
      const prefs: ConnectionsPrefs = {
         maxGraphUploadRate: num(ECTagNames.EC_TAG_CONN_UL_CAP),
         maxGraphDownloadRate: num(ECTagNames.EC_TAG_CONN_DL_CAP),
         maxUpload: num(ECTagNames.EC_TAG_CONN_MAX_UL),
         maxDownload: num(ECTagNames.EC_TAG_CONN_MAX_DL),
         slotAllocation: num(ECTagNames.EC_TAG_CONN_SLOT_ALLOCATION),
         tcpPort: num(ECTagNames.EC_TAG_CONN_TCP_PORT),
         udpPort: num(ECTagNames.EC_TAG_CONN_UDP_PORT),
         udpDisabled: has(ECTagNames.EC_TAG_CONN_UDP_DISABLE),
         maxSourcesPerFile: num(ECTagNames.EC_TAG_CONN_MAX_FILE_SOURCES),
         maxConnections: num(ECTagNames.EC_TAG_CONN_MAX_CONN),
         autoConnect: has(ECTagNames.EC_TAG_CONN_AUTOCONNECT),
         reconnect: has(ECTagNames.EC_TAG_CONN_RECONNECT),
         networkEd2k: has(ECTagNames.EC_TAG_NETWORK_ED2K),
         networkKademlia: has(ECTagNames.EC_TAG_NETWORK_KADEMLIA),
         bindAddress: str(ECTagNames.EC_TAG_CONN_BIND_ADDRESS),
         bindInterface: str(ECTagNames.EC_TAG_CONN_BIND_INTERFACE),
         proxy: {
            enabled: num(ECTagNames.EC_TAG_PROXY_ENABLE) !== 0,
            type: num(ECTagNames.EC_TAG_PROXY_TYPE),
            host: str(ECTagNames.EC_TAG_PROXY_HOST),
            port: num(ECTagNames.EC_TAG_PROXY_PORT),
            enablePassword: num(ECTagNames.EC_TAG_PROXY_AUTH) !== 0,
            userName: str(ECTagNames.EC_TAG_PROXY_USER),
            password: str(ECTagNames.EC_TAG_PROXY_PASSWORD),
         },
         upnpEnabled: num(ECTagNames.EC_TAG_CONN_UPNP_ENABLED) !== 0,
         upnpTcpPort: num(ECTagNames.EC_TAG_CONN_UPNP_TCP_PORT),
      };
      debug("getConnections: %o", prefs);
      return prefs;
   }

   /** Replaces the whole CONNECTIONS section - EC_TAG_PREFS_CONNECTIONS. */
   public async setConnections(prefs: ConnectionsPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] =>
         value ? [new ECCustomTag(name, new Uint8Array())] : [];
      const section = new ECCustomTag(
         ECTagNames.EC_TAG_PREFS_CONNECTIONS,
         new Uint8Array(),
         [
            new ECUInt32Tag(ECTagNames.EC_TAG_CONN_UL_CAP, prefs.maxGraphUploadRate),
            new ECUInt32Tag(
               ECTagNames.EC_TAG_CONN_DL_CAP,
               prefs.maxGraphDownloadRate,
            ),
            new ECUInt32Tag(ECTagNames.EC_TAG_CONN_MAX_UL, prefs.maxUpload),
            new ECUInt32Tag(ECTagNames.EC_TAG_CONN_MAX_DL, prefs.maxDownload),
            new ECUInt32Tag(
               ECTagNames.EC_TAG_CONN_SLOT_ALLOCATION,
               prefs.slotAllocation,
            ),
            new ECUInt16Tag(ECTagNames.EC_TAG_CONN_TCP_PORT, prefs.tcpPort),
            new ECUInt16Tag(ECTagNames.EC_TAG_CONN_UDP_PORT, prefs.udpPort),
            ...flag(ECTagNames.EC_TAG_CONN_UDP_DISABLE, prefs.udpDisabled),
            new ECUInt16Tag(
               ECTagNames.EC_TAG_CONN_MAX_FILE_SOURCES,
               prefs.maxSourcesPerFile,
            ),
            new ECUInt16Tag(ECTagNames.EC_TAG_CONN_MAX_CONN, prefs.maxConnections),
            ...flag(ECTagNames.EC_TAG_CONN_AUTOCONNECT, prefs.autoConnect),
            ...flag(ECTagNames.EC_TAG_CONN_RECONNECT, prefs.reconnect),
            ...flag(ECTagNames.EC_TAG_NETWORK_ED2K, prefs.networkEd2k),
            ...flag(ECTagNames.EC_TAG_NETWORK_KADEMLIA, prefs.networkKademlia),
            new ECStringTag(
               ECTagNames.EC_TAG_CONN_BIND_ADDRESS,
               prefs.bindAddress,
            ),
            new ECStringTag(
               ECTagNames.EC_TAG_CONN_BIND_INTERFACE,
               prefs.bindInterface,
            ),
            new ECUInt8Tag(
               ECTagNames.EC_TAG_PROXY_ENABLE,
               prefs.proxy.enabled ? 1 : 0,
            ),
            new ECUInt32Tag(ECTagNames.EC_TAG_PROXY_TYPE, prefs.proxy.type),
            new ECStringTag(ECTagNames.EC_TAG_PROXY_HOST, prefs.proxy.host),
            new ECUInt16Tag(ECTagNames.EC_TAG_PROXY_PORT, prefs.proxy.port),
            new ECUInt8Tag(
               ECTagNames.EC_TAG_PROXY_AUTH,
               prefs.proxy.enablePassword ? 1 : 0,
            ),
            new ECStringTag(ECTagNames.EC_TAG_PROXY_USER, prefs.proxy.userName),
            new ECStringTag(
               ECTagNames.EC_TAG_PROXY_PASSWORD,
               prefs.proxy.password,
            ),
            new ECUInt8Tag(
               ECTagNames.EC_TAG_CONN_UPNP_ENABLED,
               prefs.upnpEnabled ? 1 : 0,
            ),
            new ECUInt16Tag(
               ECTagNames.EC_TAG_CONN_UPNP_TCP_PORT,
               prefs.upnpTcpPort,
            ),
         ],
      );
      await this.applySection(section);
      debug("setConnections: applied");
   }

   /** Fetches the FILES section - EC_TAG_PREFS_FILES. */
   public async getFiles(): Promise<FilesPrefs> {
      const section = await this.fetchSection(
         ECPreferencesSelection.FILES,
         ECTagNames.EC_TAG_PREFS_FILES,
      );
      if (!section) {
         throw new Error("Daemon did not return the FILES section.");
      }
      const has = (name: number): boolean =>
         section.findChild(name) !== undefined;
      const prefs: FilesPrefs = {
         ichEnabled: has(ECTagNames.EC_TAG_FILES_ICH_ENABLED),
         aichTrust: has(ECTagNames.EC_TAG_FILES_AICH_TRUST),
         newFilesPaused: has(ECTagNames.EC_TAG_FILES_NEW_PAUSED),
         newAutoDownloadPriority: has(ECTagNames.EC_TAG_FILES_NEW_AUTO_DL_PRIO),
         previewPrio: has(ECTagNames.EC_TAG_FILES_PREVIEW_PRIO),
         endgame: has(ECTagNames.EC_TAG_FILES_ENDGAME),
         newAutoUploadPriority: has(ECTagNames.EC_TAG_FILES_NEW_AUTO_UL_PRIO),
         startNextFilePaused: has(ECTagNames.EC_TAG_FILES_START_NEXT_PAUSED),
         resumeSameCategory: has(ECTagNames.EC_TAG_FILES_RESUME_SAME_CAT),
         saveSources: has(ECTagNames.EC_TAG_FILES_SAVE_SOURCES),
         allocFullFileSize: has(ECTagNames.EC_TAG_FILES_ALLOC_FULL_SIZE),
         mmapSupported: has(ECTagNames.EC_TAG_FILES_MMAP_SUPPORTED),
         mmapEnabled: has(ECTagNames.EC_TAG_FILES_MMAP_ENABLED),
         checkFreeSpace: has(ECTagNames.EC_TAG_FILES_CHECK_FREE_SPACE),
         minFreeDiskSpaceMb: Number(
            section.childInt(ECTagNames.EC_TAG_FILES_MIN_FREE_SPACE) ?? 0n,
         ),
         createFilesNormal: has(ECTagNames.EC_TAG_FILES_CREATE_NORMAL),
         mediaMetadataEnabled: has(ECTagNames.EC_TAG_FILES_MEDIA_METADATA_ENABLED),
         mediaMetadataFfprobePath:
            section.childString(ECTagNames.EC_TAG_FILES_MEDIA_FFPROBE_PATH) ?? "",
         startNextFileAlpha: has(ECTagNames.EC_TAG_FILES_START_NEXT_ALPHA),
      };
      debug("getFiles: %o", prefs);
      return prefs;
   }

   /** Replaces the whole FILES section - EC_TAG_PREFS_FILES. */
   public async setFiles(prefs: FilesPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] =>
         value ? [new ECCustomTag(name, new Uint8Array())] : [];
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_FILES, new Uint8Array(), [
         ...flag(ECTagNames.EC_TAG_FILES_ICH_ENABLED, prefs.ichEnabled),
         ...flag(ECTagNames.EC_TAG_FILES_AICH_TRUST, prefs.aichTrust),
         ...flag(ECTagNames.EC_TAG_FILES_NEW_PAUSED, prefs.newFilesPaused),
         ...flag(
            ECTagNames.EC_TAG_FILES_NEW_AUTO_DL_PRIO,
            prefs.newAutoDownloadPriority,
         ),
         ...flag(ECTagNames.EC_TAG_FILES_PREVIEW_PRIO, prefs.previewPrio),
         ...flag(ECTagNames.EC_TAG_FILES_ENDGAME, prefs.endgame),
         ...flag(
            ECTagNames.EC_TAG_FILES_NEW_AUTO_UL_PRIO,
            prefs.newAutoUploadPriority,
         ),
         ...flag(
            ECTagNames.EC_TAG_FILES_START_NEXT_PAUSED,
            prefs.startNextFilePaused,
         ),
         ...flag(
            ECTagNames.EC_TAG_FILES_RESUME_SAME_CAT,
            prefs.resumeSameCategory,
         ),
         ...flag(ECTagNames.EC_TAG_FILES_SAVE_SOURCES, prefs.saveSources),
         ...flag(
            ECTagNames.EC_TAG_FILES_ALLOC_FULL_SIZE,
            prefs.allocFullFileSize,
         ),
         ...flag(ECTagNames.EC_TAG_FILES_MMAP_ENABLED, prefs.mmapEnabled),
         ...flag(ECTagNames.EC_TAG_FILES_CHECK_FREE_SPACE, prefs.checkFreeSpace),
         new ECUInt32Tag(
            ECTagNames.EC_TAG_FILES_MIN_FREE_SPACE,
            prefs.minFreeDiskSpaceMb,
         ),
         ...flag(ECTagNames.EC_TAG_FILES_CREATE_NORMAL, prefs.createFilesNormal),
         ...flag(
            ECTagNames.EC_TAG_FILES_MEDIA_METADATA_ENABLED,
            prefs.mediaMetadataEnabled,
         ),
         new ECStringTag(
            ECTagNames.EC_TAG_FILES_MEDIA_FFPROBE_PATH,
            prefs.mediaMetadataFfprobePath,
         ),
         ...flag(
            ECTagNames.EC_TAG_FILES_START_NEXT_ALPHA,
            prefs.startNextFileAlpha,
         ),
      ]);
      await this.applySection(section);
      debug("setFiles: applied");
   }

   /** Fetches the DIRECTORIES section - EC_TAG_PREFS_DIRECTORIES. */
   public async getDirectories(): Promise<DirectoriesPrefs> {
      const section = await this.fetchSection(
         ECPreferencesSelection.DIRECTORIES,
         ECTagNames.EC_TAG_PREFS_DIRECTORIES,
      );
      if (!section) {
         throw new Error("Daemon did not return the DIRECTORIES section.");
      }
      const sharedTag = section.findChild(ECTagNames.EC_TAG_DIRECTORIES_SHARED);
      const prefs: DirectoriesPrefs = {
         incomingDir:
            section.childString(ECTagNames.EC_TAG_DIRECTORIES_INCOMING) ?? "",
         tempDir: section.childString(ECTagNames.EC_TAG_DIRECTORIES_TEMP) ?? "",
         sharedDirs: (sharedTag?.children ?? []).map((child) =>
            child instanceof ECStringTag ? child.value : "",
         ),
         shareHiddenFiles:
            section.findChild(ECTagNames.EC_TAG_DIRECTORIES_SHARE_HIDDEN) !==
            undefined,
         autoRescanSharedDirs:
            section.findChild(ECTagNames.EC_TAG_DIRECTORIES_AUTO_RESCAN) !==
            undefined,
         followSymlinksInShares:
            section.findChild(ECTagNames.EC_TAG_DIRECTORIES_FOLLOW_SYMLINKS) !==
            undefined,
         excludeSharePatterns:
            section.childString(ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_PATTERNS) ??
            "",
         excludeSharePatternsUseRegex:
            Number(
               section.childInt(ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_REGEX) ??
                  0n,
            ) !== 0,
      };
      debug("getDirectories: %o", prefs);
      return prefs;
   }

   /** Replaces the whole DIRECTORIES section - EC_TAG_PREFS_DIRECTORIES. */
   public async setDirectories(prefs: DirectoriesPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] =>
         value ? [new ECCustomTag(name, new Uint8Array())] : [];
      const section = new ECCustomTag(
         ECTagNames.EC_TAG_PREFS_DIRECTORIES,
         new Uint8Array(),
         [
            new ECStringTag(
               ECTagNames.EC_TAG_DIRECTORIES_INCOMING,
               prefs.incomingDir,
            ),
            new ECStringTag(ECTagNames.EC_TAG_DIRECTORIES_TEMP, prefs.tempDir),
            new ECUInt32Tag(
               ECTagNames.EC_TAG_DIRECTORIES_SHARED,
               prefs.sharedDirs.length,
               prefs.sharedDirs.map(
                  (path) => new ECStringTag(ECTagNames.EC_TAG_STRING, path),
               ),
            ),
            ...flag(
               ECTagNames.EC_TAG_DIRECTORIES_SHARE_HIDDEN,
               prefs.shareHiddenFiles,
            ),
            ...flag(
               ECTagNames.EC_TAG_DIRECTORIES_AUTO_RESCAN,
               prefs.autoRescanSharedDirs,
            ),
            ...flag(
               ECTagNames.EC_TAG_DIRECTORIES_FOLLOW_SYMLINKS,
               prefs.followSymlinksInShares,
            ),
            new ECStringTag(
               ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_PATTERNS,
               prefs.excludeSharePatterns,
            ),
            new ECUInt8Tag(
               ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_REGEX,
               prefs.excludeSharePatternsUseRegex ? 1 : 0,
            ),
         ],
      );
      await this.applySection(section);
      debug("setDirectories: applied");
   }

   /** Fetches the CORETWEAKS section - EC_TAG_PREFS_CORETWEAKS. */
   public async getCoreTweaks(): Promise<CoreTweaksPrefs> {
      const section = await this.fetchSection(
         ECPreferencesSelection.CORETWEAKS,
         ECTagNames.EC_TAG_PREFS_CORETWEAKS,
      );
      if (!section) {
         throw new Error("Daemon did not return the CORETWEAKS section.");
      }
      const num = (name: number): number => Number(section.childInt(name) ?? 0n);
      const prefs: CoreTweaksPrefs = {
         maxConnPerFive: num(ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE),
         verbose: section.findChild(ECTagNames.EC_TAG_CORETW_VERBOSE) !== undefined,
         fileBufferSize: num(ECTagNames.EC_TAG_CORETW_FILEBUFFER),
         uploadQueueSize: num(ECTagNames.EC_TAG_CORETW_UL_QUEUE),
         serverKeepAliveTimeoutMs: num(
            ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT,
         ),
         kadMaxSourceSearches: num(ECTagNames.EC_TAG_CORETW_KAD_MAX_SEARCHES),
         kadSourceReaskMs: num(ECTagNames.EC_TAG_CORETW_KAD_REASK_MS),
         sourceReaskMs: num(ECTagNames.EC_TAG_CORETW_SOURCE_REASK_MS),
      };
      debug("getCoreTweaks: %o", prefs);
      return prefs;
   }

   /** Replaces the whole CORETWEAKS section - EC_TAG_PREFS_CORETWEAKS. */
   public async setCoreTweaks(prefs: CoreTweaksPrefs): Promise<void> {
      const children: ECTag[] = [
         new ECUInt16Tag(
            ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE,
            prefs.maxConnPerFive,
         ),
      ];
      if (prefs.verbose) {
         children.push(
            new ECCustomTag(ECTagNames.EC_TAG_CORETW_VERBOSE, new Uint8Array()),
         );
      }
      children.push(
         new ECUInt32Tag(
            ECTagNames.EC_TAG_CORETW_FILEBUFFER,
            prefs.fileBufferSize,
         ),
         new ECUInt32Tag(
            ECTagNames.EC_TAG_CORETW_UL_QUEUE,
            prefs.uploadQueueSize,
         ),
         new ECUInt64Tag(
            ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT,
            BigInt(prefs.serverKeepAliveTimeoutMs),
         ),
         new ECUInt16Tag(
            ECTagNames.EC_TAG_CORETW_KAD_MAX_SEARCHES,
            prefs.kadMaxSourceSearches,
         ),
         new ECUInt64Tag(
            ECTagNames.EC_TAG_CORETW_KAD_REASK_MS,
            BigInt(prefs.kadSourceReaskMs),
         ),
         new ECUInt64Tag(
            ECTagNames.EC_TAG_CORETW_SOURCE_REASK_MS,
            BigInt(prefs.sourceReaskMs),
         ),
      );
      const section = new ECCustomTag(
         ECTagNames.EC_TAG_PREFS_CORETWEAKS,
         new Uint8Array(),
         children,
      );
      await this.applySection(section);
      debug("setCoreTweaks: applied");
   }

   /**
    * Fetches the known download categories - EC_TAG_PREFS_CATEGORIES.
    *
    * The daemon omits this section entirely when only the built-in default
    * category (index 0, "All") exists
    * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L93-L101,
    * `GetCatCount() > 1`) - in that case this returns an empty array rather
    * than a single "All" entry. Each returned category always carries all
    * of title/path/comment/color/prio regardless of requested detail level,
    * since the daemon builds these sub-tags at a hardcoded EC_DETAIL_FULL
    * (https://github.com/amule-org/amule/blob/master/src/libs/ec/cpp/ECSpecialTags.h#L244-L249).
    */
   public async listCategories(): Promise<Category[]> {
      const section = await this.fetchSection(
         ECPreferencesSelection.CATEGORIES,
         ECTagNames.EC_TAG_PREFS_CATEGORIES,
      );
      if (!section) {
         return [];
      }
      return section.children
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_CATEGORY;
         })
         .map(
            (tag) =>
               new Category(
                  Number(tag.intValue ?? 0n),
                  tag.childString(ECTagNames.EC_TAG_CATEGORY_TITLE) ?? "",
                  tag.childString(ECTagNames.EC_TAG_CATEGORY_PATH) ?? "",
                  tag.childString(ECTagNames.EC_TAG_CATEGORY_COMMENT) ?? "",
                  Number(tag.childInt(ECTagNames.EC_TAG_CATEGORY_COLOR) ?? 0n),
                  Number(tag.childInt(ECTagNames.EC_TAG_CATEGORY_PRIO) ?? 0n),
               ),
         );
   }
}
