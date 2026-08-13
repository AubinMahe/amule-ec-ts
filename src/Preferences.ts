import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECPreferencesSelection } from "./ECPreferencesSelection.js";
import { ECTag, ECUInt8Tag, ECUInt16Tag, ECUInt32Tag, ECUInt64Tag, ECStringTag, ECCustomTag, ECHash16Tag } from "./ECTags.js";

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

/**
 * `CanSeeShares` values - confirmed against `Preferences.h`
 * (https://github.com/amule-org/amule/blob/master/src/Preferences.h#L1030, `// 0=everybody
 * 1=friends only 2=noone`) and the `vsfaEverybody`/`vsfaFriends`/`vsfaNobody` enumerators
 * used at the call sites (e.g.
 * https://github.com/amule-org/amule/blob/master/src/ClientTCPSocket.cpp#L819-L820).
 */
export enum ECVisibleShareAccess {
   EVERYBODY = 0,
   FRIENDS = 1,
   NOBODY = 2,
}

/**
 * SECURITY section of the daemon preferences - EC_TAG_PREFS_SECURITY.
 * Despite the name, most of this section is actually the IP filter's
 * config (`EC_TAG_IPFILTER_*`) - see the dedicated `IPFilter` class for
 * the two IP-filter *actions* (`reload`/`updateFromUrl`), which are
 * separate from this section's settings.
 *
 * `canSeeShares` is NOT presence-encoded - it's always sent as an
 * explicit uint8 value, like `ConnectionsPrefs.upnpEnabled`.
 */
export interface SecurityPrefs {
   canSeeShares: ECVisibleShareAccess;
   ipFilterClients: boolean;
   ipFilterServers: boolean;
   ipFilterAutoUpdate: boolean;
   ipFilterUpdateUrl: string;
   ipFilterLevel: number;
   filterLanIps: boolean;
   secureIdentEnabled: boolean;
   obfuscationSupported: boolean;
   obfuscationRequested: boolean;
   obfuscationRequired: boolean;
   ipFilterParanoid: boolean;
   ipFilterSystem: boolean;
}

/** ONLINESIG section of the daemon preferences - EC_TAG_PREFS_ONLINESIG. */
export interface OnlineSigPrefs {
   enabled: boolean;
   directory: string;
   /** Seconds between refreshes - confirmed against amule.cpp's own consumer, which compares elapsed milliseconds against `GetOSUpdate() * 1000` (https://github.com/amule-org/amule/blob/master/src/amule.cpp#L2033). */
   updateIntervalSeconds: number;
}

/**
 * SERVERS section of the daemon preferences - EC_TAG_PREFS_SERVERS.
 *
 * `EC_TAG_SERVERS_URL_LIST` is declared in `ECTagNames.ts` but was never
 * implemented upstream - the reply builder has a literal `// Here should
 * come the URL list...` comment in its place
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L306) - so it's
 * excluded here too, same reasoning as the two dead `FilesPrefs` tags.
 */
export interface ServersPrefs {
   removeDeadServers: boolean;
   deadServerRetries: number;
   autoUpdateServerList: boolean;
   addServersFromServer: boolean;
   addServersFromClient: boolean;
   useScoreSystem: boolean;
   smartIdCheck: boolean;
   safeServerConnect: boolean;
   autoConnectStaticOnly: boolean;
   manualHighPriority: boolean;
   updateUrl: string;
}

/**
 * KADEMLIA section of the daemon preferences - EC_TAG_PREFS_KADEMLIA. The
 * smallest section in the protocol: a single URL
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L481-L485).
 */
export interface KademliaPrefs {
   nodesUpdateUrl: string;
}

/**
 * GENERAL section of the daemon preferences - EC_TAG_PREFS_GENERAL.
 *
 * `versionCheckAvailable`/`upnpAvailable` are read-only capability
 * signals: `Apply()` only ever consults an incoming value for these
 * under `#ifdef CLIENT_GUI`
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L578-L593) - i.e. it's
 * the remote GUI mirroring the daemon's own advertised capability
 * locally, not something a daemon build ever applies to itself.
 * `setGeneral()` doesn't transmit either back for that reason.
 */
export interface GeneralPrefs {
   userNick: string;
   /** Hex-encoded MD4 hash identifying this client - EC_TAG_USER_HASH. */
   userHash: string;
   userHost: string;
   checkNewVersion: boolean;
   versionCheckAvailable: boolean;
   upnpAvailable: boolean;
}

/**
 * amuleapi's per-account section of REMOTECONTROLS - see
 * `RemoteControlsPrefs`'s doc comment for the full request/state duality
 * this models.
 */
export interface AmuleApiAccountPrefs {
   enabled: boolean;
   /** GET: real hash if one happens to be readable (rare/legacy path) - almost always undefined even when a password IS configured. SET: provide to set/replace; omit to leave unchanged. */
   passwordHash?: string;
}

/**
 * REMOTECONTROLS section of the daemon preferences -
 * EC_TAG_PREFS_REMOTECTRL. Confirmed against the reply builder
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L214-L283) and
 * `Apply()` (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L695-L759).
 *
 * Three different password hashes ride this section, at three different
 * nesting depths, with three different semantics:
 *  - `webserverPasswordHash`: a direct child of the section. The real
 *    hash is always echoed back on GET when a password is set; on SET,
 *    provide to set/replace, omit to leave unchanged. There is no way to
 *    clear it via this opcode once set.
 *  - `webserverGuest.passwordHash`: nested under the guest container,
 *    which itself is presence-encoded (`webserverGuest.enabled`). The
 *    real hash is echoed on GET when guest access is enabled and a
 *    distinct password is set. On SET, enabling/disabling the guest
 *    account never touches its stored password (same no-clear behavior
 *    as the admin one) - provide `passwordHash` alongside `enabled: true`
 *    only when actually changing it.
 *  - `amuleApiAdmin.passwordHash`: amuleapi's credentials are stored
 *    salted and stretched (`AmuleApiCredentials`), so unlike the
 *    webserver's there is normally no digest to put on the wire - GET
 *    almost always reports `enabled` (a password is configured) with
 *    `passwordHash` left undefined. SET: provide `passwordHash` to
 *    set/replace it; omit to leave it unchanged. `enabled` has no "off"
 *    state here on purpose - clearing it from a stray prefs push would
 *    leave a non-loopback deployment with no way back in.
 *  - `amuleApiGuest.passwordHash`: unlike every other credential here,
 *    disabling amuleapi guest access (`enabled: false`) DOES clear the
 *    stored guest password server-side - re-enabling later requires
 *    setting a new one.
 */
export interface RemoteControlsPrefs {
   webserverPort: number;
   webserverAutorun: boolean;
   webserverPasswordHash?: string;
   webserverGuest: AmuleApiAccountPrefs;
   webserverUseGzip: boolean;
   webserverRefreshSeconds: number;
   webserverTemplate: string;
   amuleApiPort: number;
   amuleApiAutorun: boolean;
   amuleApiBindAddress: string;
   amuleApiAdmin: AmuleApiAccountPrefs;
   amuleApiGuest: AmuleApiAccountPrefs;
}

/**
 * GeoIP source selector - confirmed against `Preferences.h`
 * (https://github.com/amule-org/amule/blob/master/src/Preferences.h#L859-L864).
 */
export enum ECGeoIPSource {
   DBIP = 0,
   MAXMIND = 1,
   CUSTOM = 2,
}

/**
 * IP2COUNTRY section of the daemon preferences - EC_TAG_PREFS_IP2COUNTRY.
 *
 * `supported` is a read-only capability signal (like
 * `GeneralPrefs.versionCheckAvailable`) - `setIP2Country()` never sends
 * it back. `loadedSource`/`databasePath`/`databaseLoaded`/`downloading`/
 * `lastResult` are read-only live resolver status, only populated by a
 * daemon/monolithic build with an active resolver
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L505-L519) - undefined
 * otherwise. `updateNow` is a write-only one-shot trigger: set it to
 * `true` on a `setIP2Country()` call to make the daemon immediately
 * re-download its GeoIP database from the just-applied source;
 * `getIP2Country()` always reports it as `false` (the daemon's own reply
 * never carries a request-in-progress marker for this).
 */
export interface IP2CountryPrefs {
   supported: boolean;
   enabled: boolean;
   source: ECGeoIPSource;
   customUrl: string;
   maxMindLicense: string;
   autoUpdate: boolean;
   loadedSource?: string;
   databasePath?: string;
   databaseLoaded?: boolean;
   downloading?: boolean;
   lastResult?: string;
   updateNow: boolean;
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
 * covers all 14 named sections: GENERAL, CONNECTIONS, MESSAGEFILTER,
 * REMOTECONTROLS, ONLINESIG, SERVERS, FILES, DIRECTORIES, SECURITY,
 * CORETWEAKS, KADEMLIA, IP2COUNTRY, plus the read-only CATEGORIES
 * helper `listCategories()`. (STATISTICS is the one exception - it was
 * never implemented upstream either, see `ECPreferencesSelection`.)
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
   private async fetchSection(selection: ECPreferencesSelection, sectionTagName: number): Promise<ECTag | undefined> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_PREFERENCES);
      request.add(new ECUInt32Tag(ECTagNames.EC_TAG_SELECT_PREFS, selection));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SET_PREFERENCES) {
         throw new Error(`Expected EC_OP_SET_PREFERENCES, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      return reply.find(sectionTagName);
   }

   /**
    * Sends `section` as an EC_OP_SET_PREFERENCES request at EC_DETAIL_UPDATE
    * (full-replace boolean semantics - see the class doc comment).
    */
   private async applySection(section: ECTag): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SET_PREFERENCES);
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_UPDATE));
      request.add(section);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
   }

   /** Fetches the MESSAGEFILTER section - EC_TAG_PREFS_MESSAGEFILTER. */
   public async getMessageFilter(): Promise<MessageFilterPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.MESSAGEFILTER, ECTagNames.EC_TAG_PREFS_MESSAGEFILTER);
      if (!section) {
         throw new Error("Daemon did not return the MESSAGEFILTER section.");
      }
      const has = (name: number): boolean => section.findChild(name) !== undefined;
      const prefs: MessageFilterPrefs = {
         enabled: has(ECTagNames.EC_TAG_MSGFILTER_ENABLED),
         filterAll: has(ECTagNames.EC_TAG_MSGFILTER_ALL),
         friendsOnly: has(ECTagNames.EC_TAG_MSGFILTER_FRIENDS),
         secureOnly: has(ECTagNames.EC_TAG_MSGFILTER_SECURE),
         byKeyword: has(ECTagNames.EC_TAG_MSGFILTER_BY_KEYWORD),
         keywords: section.childString(ECTagNames.EC_TAG_MSGFILTER_KEYWORDS) ?? "",
         showInLog: has(ECTagNames.EC_TAG_MSGFILTER_SHOW_IN_LOG),
         filterComments: has(ECTagNames.EC_TAG_MSGFILTER_FILTER_COMMENTS),
         commentKeywords: section.childString(ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS) ?? "",
      };
      debug("getMessageFilter: %o", prefs);
      return prefs;
   }

   /** Replaces the whole MESSAGEFILTER section - EC_TAG_PREFS_MESSAGEFILTER. */
   public async setMessageFilter(prefs: MessageFilterPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_MESSAGEFILTER, new Uint8Array(), [
         ...flag(ECTagNames.EC_TAG_MSGFILTER_ENABLED, prefs.enabled),
         ...flag(ECTagNames.EC_TAG_MSGFILTER_ALL, prefs.filterAll),
         ...flag(ECTagNames.EC_TAG_MSGFILTER_FRIENDS, prefs.friendsOnly),
         ...flag(ECTagNames.EC_TAG_MSGFILTER_SECURE, prefs.secureOnly),
         ...flag(ECTagNames.EC_TAG_MSGFILTER_BY_KEYWORD, prefs.byKeyword),
         new ECStringTag(ECTagNames.EC_TAG_MSGFILTER_KEYWORDS, prefs.keywords),
         ...flag(ECTagNames.EC_TAG_MSGFILTER_SHOW_IN_LOG, prefs.showInLog),
         ...flag(ECTagNames.EC_TAG_MSGFILTER_FILTER_COMMENTS, prefs.filterComments),
         new ECStringTag(ECTagNames.EC_TAG_MSGFILTER_COMMENT_KEYWORDS, prefs.commentKeywords),
      ]);
      await this.applySection(section);
      debug("setMessageFilter: applied");
   }

   /** Fetches the CONNECTIONS section - EC_TAG_PREFS_CONNECTIONS. */
   public async getConnections(): Promise<ConnectionsPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.CONNECTIONS, ECTagNames.EC_TAG_PREFS_CONNECTIONS);
      if (!section) {
         throw new Error("Daemon did not return the CONNECTIONS section.");
      }
      const has = (name: number): boolean => section.findChild(name) !== undefined;
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
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_CONNECTIONS, new Uint8Array(), [
         new ECUInt32Tag(ECTagNames.EC_TAG_CONN_UL_CAP, prefs.maxGraphUploadRate),
         new ECUInt32Tag(ECTagNames.EC_TAG_CONN_DL_CAP, prefs.maxGraphDownloadRate),
         new ECUInt32Tag(ECTagNames.EC_TAG_CONN_MAX_UL, prefs.maxUpload),
         new ECUInt32Tag(ECTagNames.EC_TAG_CONN_MAX_DL, prefs.maxDownload),
         new ECUInt32Tag(ECTagNames.EC_TAG_CONN_SLOT_ALLOCATION, prefs.slotAllocation),
         new ECUInt16Tag(ECTagNames.EC_TAG_CONN_TCP_PORT, prefs.tcpPort),
         new ECUInt16Tag(ECTagNames.EC_TAG_CONN_UDP_PORT, prefs.udpPort),
         ...flag(ECTagNames.EC_TAG_CONN_UDP_DISABLE, prefs.udpDisabled),
         new ECUInt16Tag(ECTagNames.EC_TAG_CONN_MAX_FILE_SOURCES, prefs.maxSourcesPerFile),
         new ECUInt16Tag(ECTagNames.EC_TAG_CONN_MAX_CONN, prefs.maxConnections),
         ...flag(ECTagNames.EC_TAG_CONN_AUTOCONNECT, prefs.autoConnect),
         ...flag(ECTagNames.EC_TAG_CONN_RECONNECT, prefs.reconnect),
         ...flag(ECTagNames.EC_TAG_NETWORK_ED2K, prefs.networkEd2k),
         ...flag(ECTagNames.EC_TAG_NETWORK_KADEMLIA, prefs.networkKademlia),
         new ECStringTag(ECTagNames.EC_TAG_CONN_BIND_ADDRESS, prefs.bindAddress),
         new ECStringTag(ECTagNames.EC_TAG_CONN_BIND_INTERFACE, prefs.bindInterface),
         new ECUInt8Tag(ECTagNames.EC_TAG_PROXY_ENABLE, prefs.proxy.enabled ? 1 : 0),
         new ECUInt32Tag(ECTagNames.EC_TAG_PROXY_TYPE, prefs.proxy.type),
         new ECStringTag(ECTagNames.EC_TAG_PROXY_HOST, prefs.proxy.host),
         new ECUInt16Tag(ECTagNames.EC_TAG_PROXY_PORT, prefs.proxy.port),
         new ECUInt8Tag(ECTagNames.EC_TAG_PROXY_AUTH, prefs.proxy.enablePassword ? 1 : 0),
         new ECStringTag(ECTagNames.EC_TAG_PROXY_USER, prefs.proxy.userName),
         new ECStringTag(ECTagNames.EC_TAG_PROXY_PASSWORD, prefs.proxy.password),
         new ECUInt8Tag(ECTagNames.EC_TAG_CONN_UPNP_ENABLED, prefs.upnpEnabled ? 1 : 0),
         new ECUInt16Tag(ECTagNames.EC_TAG_CONN_UPNP_TCP_PORT, prefs.upnpTcpPort),
      ]);
      await this.applySection(section);
      debug("setConnections: applied");
   }

   /** Fetches the FILES section - EC_TAG_PREFS_FILES. */
   public async getFiles(): Promise<FilesPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.FILES, ECTagNames.EC_TAG_PREFS_FILES);
      if (!section) {
         throw new Error("Daemon did not return the FILES section.");
      }
      const has = (name: number): boolean => section.findChild(name) !== undefined;
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
         minFreeDiskSpaceMb: Number(section.childInt(ECTagNames.EC_TAG_FILES_MIN_FREE_SPACE) ?? 0n),
         createFilesNormal: has(ECTagNames.EC_TAG_FILES_CREATE_NORMAL),
         mediaMetadataEnabled: has(ECTagNames.EC_TAG_FILES_MEDIA_METADATA_ENABLED),
         mediaMetadataFfprobePath: section.childString(ECTagNames.EC_TAG_FILES_MEDIA_FFPROBE_PATH) ?? "",
         startNextFileAlpha: has(ECTagNames.EC_TAG_FILES_START_NEXT_ALPHA),
      };
      debug("getFiles: %o", prefs);
      return prefs;
   }

   /** Replaces the whole FILES section - EC_TAG_PREFS_FILES. */
   public async setFiles(prefs: FilesPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_FILES, new Uint8Array(), [
         ...flag(ECTagNames.EC_TAG_FILES_ICH_ENABLED, prefs.ichEnabled),
         ...flag(ECTagNames.EC_TAG_FILES_AICH_TRUST, prefs.aichTrust),
         ...flag(ECTagNames.EC_TAG_FILES_NEW_PAUSED, prefs.newFilesPaused),
         ...flag(ECTagNames.EC_TAG_FILES_NEW_AUTO_DL_PRIO, prefs.newAutoDownloadPriority),
         ...flag(ECTagNames.EC_TAG_FILES_PREVIEW_PRIO, prefs.previewPrio),
         ...flag(ECTagNames.EC_TAG_FILES_ENDGAME, prefs.endgame),
         ...flag(ECTagNames.EC_TAG_FILES_NEW_AUTO_UL_PRIO, prefs.newAutoUploadPriority),
         ...flag(ECTagNames.EC_TAG_FILES_START_NEXT_PAUSED, prefs.startNextFilePaused),
         ...flag(ECTagNames.EC_TAG_FILES_RESUME_SAME_CAT, prefs.resumeSameCategory),
         ...flag(ECTagNames.EC_TAG_FILES_SAVE_SOURCES, prefs.saveSources),
         ...flag(ECTagNames.EC_TAG_FILES_ALLOC_FULL_SIZE, prefs.allocFullFileSize),
         ...flag(ECTagNames.EC_TAG_FILES_MMAP_ENABLED, prefs.mmapEnabled),
         ...flag(ECTagNames.EC_TAG_FILES_CHECK_FREE_SPACE, prefs.checkFreeSpace),
         new ECUInt32Tag(ECTagNames.EC_TAG_FILES_MIN_FREE_SPACE, prefs.minFreeDiskSpaceMb),
         ...flag(ECTagNames.EC_TAG_FILES_CREATE_NORMAL, prefs.createFilesNormal),
         ...flag(ECTagNames.EC_TAG_FILES_MEDIA_METADATA_ENABLED, prefs.mediaMetadataEnabled),
         new ECStringTag(ECTagNames.EC_TAG_FILES_MEDIA_FFPROBE_PATH, prefs.mediaMetadataFfprobePath),
         ...flag(ECTagNames.EC_TAG_FILES_START_NEXT_ALPHA, prefs.startNextFileAlpha),
      ]);
      await this.applySection(section);
      debug("setFiles: applied");
   }

   /** Fetches the DIRECTORIES section - EC_TAG_PREFS_DIRECTORIES. */
   public async getDirectories(): Promise<DirectoriesPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.DIRECTORIES, ECTagNames.EC_TAG_PREFS_DIRECTORIES);
      if (!section) {
         throw new Error("Daemon did not return the DIRECTORIES section.");
      }
      const sharedTag = section.findChild(ECTagNames.EC_TAG_DIRECTORIES_SHARED);
      const prefs: DirectoriesPrefs = {
         incomingDir: section.childString(ECTagNames.EC_TAG_DIRECTORIES_INCOMING) ?? "",
         tempDir: section.childString(ECTagNames.EC_TAG_DIRECTORIES_TEMP) ?? "",
         sharedDirs: (sharedTag?.children ?? []).map((child) => (child instanceof ECStringTag ? child.value : "")),
         shareHiddenFiles: section.findChild(ECTagNames.EC_TAG_DIRECTORIES_SHARE_HIDDEN) !== undefined,
         autoRescanSharedDirs: section.findChild(ECTagNames.EC_TAG_DIRECTORIES_AUTO_RESCAN) !== undefined,
         followSymlinksInShares: section.findChild(ECTagNames.EC_TAG_DIRECTORIES_FOLLOW_SYMLINKS) !== undefined,
         excludeSharePatterns: section.childString(ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_PATTERNS) ?? "",
         excludeSharePatternsUseRegex: Number(section.childInt(ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_REGEX) ?? 0n) !== 0,
      };
      debug("getDirectories: %o", prefs);
      return prefs;
   }

   /** Replaces the whole DIRECTORIES section - EC_TAG_PREFS_DIRECTORIES. */
   public async setDirectories(prefs: DirectoriesPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_DIRECTORIES, new Uint8Array(), [
         new ECStringTag(ECTagNames.EC_TAG_DIRECTORIES_INCOMING, prefs.incomingDir),
         new ECStringTag(ECTagNames.EC_TAG_DIRECTORIES_TEMP, prefs.tempDir),
         new ECUInt32Tag(
            ECTagNames.EC_TAG_DIRECTORIES_SHARED,
            prefs.sharedDirs.length,
            prefs.sharedDirs.map((path) => new ECStringTag(ECTagNames.EC_TAG_STRING, path)),
         ),
         ...flag(ECTagNames.EC_TAG_DIRECTORIES_SHARE_HIDDEN, prefs.shareHiddenFiles),
         ...flag(ECTagNames.EC_TAG_DIRECTORIES_AUTO_RESCAN, prefs.autoRescanSharedDirs),
         ...flag(ECTagNames.EC_TAG_DIRECTORIES_FOLLOW_SYMLINKS, prefs.followSymlinksInShares),
         new ECStringTag(ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_PATTERNS, prefs.excludeSharePatterns),
         new ECUInt8Tag(ECTagNames.EC_TAG_DIRECTORIES_EXCLUDE_REGEX, prefs.excludeSharePatternsUseRegex ? 1 : 0),
      ]);
      await this.applySection(section);
      debug("setDirectories: applied");
   }

   /** Fetches the SECURITY section - EC_TAG_PREFS_SECURITY. */
   public async getSecurity(): Promise<SecurityPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.SECURITY, ECTagNames.EC_TAG_PREFS_SECURITY);
      if (!section) {
         throw new Error("Daemon did not return the SECURITY section.");
      }
      const has = (name: number): boolean => section.findChild(name) !== undefined;
      const num = (name: number): number => Number(section.childInt(name) ?? 0n);
      const prefs: SecurityPrefs = {
         canSeeShares: num(ECTagNames.EC_TAG_SECURITY_CAN_SEE_SHARES),
         ipFilterClients: has(ECTagNames.EC_TAG_IPFILTER_CLIENTS),
         ipFilterServers: has(ECTagNames.EC_TAG_IPFILTER_SERVERS),
         ipFilterAutoUpdate: has(ECTagNames.EC_TAG_IPFILTER_AUTO_UPDATE),
         ipFilterUpdateUrl: section.childString(ECTagNames.EC_TAG_IPFILTER_UPDATE_URL) ?? "",
         ipFilterLevel: num(ECTagNames.EC_TAG_IPFILTER_LEVEL),
         filterLanIps: has(ECTagNames.EC_TAG_IPFILTER_FILTER_LAN),
         secureIdentEnabled: has(ECTagNames.EC_TAG_SECURITY_USE_SECIDENT),
         obfuscationSupported: has(ECTagNames.EC_TAG_SECURITY_OBFUSCATION_SUPPORTED),
         obfuscationRequested: has(ECTagNames.EC_TAG_SECURITY_OBFUSCATION_REQUESTED),
         obfuscationRequired: has(ECTagNames.EC_TAG_SECURITY_OBFUSCATION_REQUIRED),
         ipFilterParanoid: has(ECTagNames.EC_TAG_IPFILTER_PARANOID),
         ipFilterSystem: has(ECTagNames.EC_TAG_IPFILTER_SYSTEM),
      };
      debug("getSecurity: %o", prefs);
      return prefs;
   }

   /** Replaces the whole SECURITY section - EC_TAG_PREFS_SECURITY. */
   public async setSecurity(prefs: SecurityPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_SECURITY, new Uint8Array(), [
         new ECUInt8Tag(ECTagNames.EC_TAG_SECURITY_CAN_SEE_SHARES, prefs.canSeeShares),
         ...flag(ECTagNames.EC_TAG_IPFILTER_CLIENTS, prefs.ipFilterClients),
         ...flag(ECTagNames.EC_TAG_IPFILTER_SERVERS, prefs.ipFilterServers),
         ...flag(ECTagNames.EC_TAG_IPFILTER_AUTO_UPDATE, prefs.ipFilterAutoUpdate),
         new ECStringTag(ECTagNames.EC_TAG_IPFILTER_UPDATE_URL, prefs.ipFilterUpdateUrl),
         new ECUInt8Tag(ECTagNames.EC_TAG_IPFILTER_LEVEL, prefs.ipFilterLevel),
         ...flag(ECTagNames.EC_TAG_IPFILTER_FILTER_LAN, prefs.filterLanIps),
         ...flag(ECTagNames.EC_TAG_SECURITY_USE_SECIDENT, prefs.secureIdentEnabled),
         ...flag(ECTagNames.EC_TAG_SECURITY_OBFUSCATION_SUPPORTED, prefs.obfuscationSupported),
         ...flag(ECTagNames.EC_TAG_SECURITY_OBFUSCATION_REQUESTED, prefs.obfuscationRequested),
         ...flag(ECTagNames.EC_TAG_SECURITY_OBFUSCATION_REQUIRED, prefs.obfuscationRequired),
         ...flag(ECTagNames.EC_TAG_IPFILTER_PARANOID, prefs.ipFilterParanoid),
         ...flag(ECTagNames.EC_TAG_IPFILTER_SYSTEM, prefs.ipFilterSystem),
      ]);
      await this.applySection(section);
      debug("setSecurity: applied");
   }

   /** Fetches the ONLINESIG section - EC_TAG_PREFS_ONLINESIG. */
   public async getOnlineSig(): Promise<OnlineSigPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.ONLINESIG, ECTagNames.EC_TAG_PREFS_ONLINESIG);
      if (!section) {
         throw new Error("Daemon did not return the ONLINESIG section.");
      }
      const prefs: OnlineSigPrefs = {
         enabled: section.findChild(ECTagNames.EC_TAG_ONLINESIG_ENABLED) !== undefined,
         directory: section.childString(ECTagNames.EC_TAG_ONLINESIG_DIRECTORY) ?? "",
         updateIntervalSeconds: Number(section.childInt(ECTagNames.EC_TAG_ONLINESIG_UPDATE) ?? 0n),
      };
      debug("getOnlineSig: %o", prefs);
      return prefs;
   }

   /** Replaces the whole ONLINESIG section - EC_TAG_PREFS_ONLINESIG. */
   public async setOnlineSig(prefs: OnlineSigPrefs): Promise<void> {
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_ONLINESIG, new Uint8Array(), [
         ...(prefs.enabled ? [new ECCustomTag(ECTagNames.EC_TAG_ONLINESIG_ENABLED, new Uint8Array())] : []),
         new ECStringTag(ECTagNames.EC_TAG_ONLINESIG_DIRECTORY, prefs.directory),
         new ECUInt16Tag(ECTagNames.EC_TAG_ONLINESIG_UPDATE, prefs.updateIntervalSeconds),
      ]);
      await this.applySection(section);
      debug("setOnlineSig: applied");
   }

   /** Fetches the SERVERS section - EC_TAG_PREFS_SERVERS. */
   public async getServers(): Promise<ServersPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.SERVERS, ECTagNames.EC_TAG_PREFS_SERVERS);
      if (!section) {
         throw new Error("Daemon did not return the SERVERS section.");
      }
      const has = (name: number): boolean => section.findChild(name) !== undefined;
      const prefs: ServersPrefs = {
         removeDeadServers: has(ECTagNames.EC_TAG_SERVERS_REMOVE_DEAD),
         deadServerRetries: Number(section.childInt(ECTagNames.EC_TAG_SERVERS_DEAD_SERVER_RETRIES) ?? 0n),
         autoUpdateServerList: has(ECTagNames.EC_TAG_SERVERS_AUTO_UPDATE),
         addServersFromServer: has(ECTagNames.EC_TAG_SERVERS_ADD_FROM_SERVER),
         addServersFromClient: has(ECTagNames.EC_TAG_SERVERS_ADD_FROM_CLIENT),
         useScoreSystem: has(ECTagNames.EC_TAG_SERVERS_USE_SCORE_SYSTEM),
         smartIdCheck: has(ECTagNames.EC_TAG_SERVERS_SMART_ID_CHECK),
         safeServerConnect: has(ECTagNames.EC_TAG_SERVERS_SAFE_SERVER_CONNECT),
         autoConnectStaticOnly: has(ECTagNames.EC_TAG_SERVERS_AUTOCONN_STATIC_ONLY),
         manualHighPriority: has(ECTagNames.EC_TAG_SERVERS_MANUAL_HIGH_PRIO),
         updateUrl: section.childString(ECTagNames.EC_TAG_SERVERS_UPDATE_URL) ?? "",
      };
      debug("getServers: %o", prefs);
      return prefs;
   }

   /** Replaces the whole SERVERS section - EC_TAG_PREFS_SERVERS. */
   public async setServers(prefs: ServersPrefs): Promise<void> {
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_SERVERS, new Uint8Array(), [
         ...flag(ECTagNames.EC_TAG_SERVERS_REMOVE_DEAD, prefs.removeDeadServers),
         new ECUInt16Tag(ECTagNames.EC_TAG_SERVERS_DEAD_SERVER_RETRIES, prefs.deadServerRetries),
         ...flag(ECTagNames.EC_TAG_SERVERS_AUTO_UPDATE, prefs.autoUpdateServerList),
         ...flag(ECTagNames.EC_TAG_SERVERS_ADD_FROM_SERVER, prefs.addServersFromServer),
         ...flag(ECTagNames.EC_TAG_SERVERS_ADD_FROM_CLIENT, prefs.addServersFromClient),
         ...flag(ECTagNames.EC_TAG_SERVERS_USE_SCORE_SYSTEM, prefs.useScoreSystem),
         ...flag(ECTagNames.EC_TAG_SERVERS_SMART_ID_CHECK, prefs.smartIdCheck),
         ...flag(ECTagNames.EC_TAG_SERVERS_SAFE_SERVER_CONNECT, prefs.safeServerConnect),
         ...flag(ECTagNames.EC_TAG_SERVERS_AUTOCONN_STATIC_ONLY, prefs.autoConnectStaticOnly),
         ...flag(ECTagNames.EC_TAG_SERVERS_MANUAL_HIGH_PRIO, prefs.manualHighPriority),
         new ECStringTag(ECTagNames.EC_TAG_SERVERS_UPDATE_URL, prefs.updateUrl),
      ]);
      await this.applySection(section);
      debug("setServers: applied");
   }

   /** Fetches the KADEMLIA section - EC_TAG_PREFS_KADEMLIA. */
   public async getKademlia(): Promise<KademliaPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.KADEMLIA, ECTagNames.EC_TAG_PREFS_KADEMLIA);
      if (!section) {
         throw new Error("Daemon did not return the KADEMLIA section.");
      }
      const prefs: KademliaPrefs = {
         nodesUpdateUrl: section.childString(ECTagNames.EC_TAG_KADEMLIA_UPDATE_URL) ?? "",
      };
      debug("getKademlia: %o", prefs);
      return prefs;
   }

   /** Replaces the whole KADEMLIA section - EC_TAG_PREFS_KADEMLIA. */
   public async setKademlia(prefs: KademliaPrefs): Promise<void> {
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_KADEMLIA, new Uint8Array(), [
         new ECStringTag(ECTagNames.EC_TAG_KADEMLIA_UPDATE_URL, prefs.nodesUpdateUrl),
      ]);
      await this.applySection(section);
      debug("setKademlia: applied");
   }

   /** Fetches the GENERAL section - EC_TAG_PREFS_GENERAL. */
   public async getGeneral(): Promise<GeneralPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.GENERAL, ECTagNames.EC_TAG_PREFS_GENERAL);
      if (!section) {
         throw new Error("Daemon did not return the GENERAL section.");
      }
      const hashTag = section.findChild(ECTagNames.EC_TAG_USER_HASH);
      const prefs: GeneralPrefs = {
         userNick: section.childString(ECTagNames.EC_TAG_USER_NICK) ?? "",
         userHash: hashTag instanceof ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : "",
         userHost: section.childString(ECTagNames.EC_TAG_USER_HOST) ?? "",
         checkNewVersion: Number(section.childInt(ECTagNames.EC_TAG_GENERAL_CHECK_NEW_VERSION) ?? 0n) !== 0,
         versionCheckAvailable: Number(section.childInt(ECTagNames.EC_TAG_GENERAL_VERSION_CHECK_AVAILABLE) ?? 0n) !== 0,
         upnpAvailable: Number(section.childInt(ECTagNames.EC_TAG_GENERAL_UPNP_AVAILABLE) ?? 0n) !== 0,
      };
      debug("getGeneral: %o", prefs);
      return prefs;
   }

   /** Replaces the whole GENERAL section - EC_TAG_PREFS_GENERAL. */
   public async setGeneral(prefs: GeneralPrefs): Promise<void> {
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_GENERAL, new Uint8Array(), [
         new ECStringTag(ECTagNames.EC_TAG_USER_NICK, prefs.userNick),
         new ECHash16Tag(ECTagNames.EC_TAG_USER_HASH, new Uint8Array(Buffer.from(prefs.userHash, "hex"))),
         new ECStringTag(ECTagNames.EC_TAG_USER_HOST, prefs.userHost),
         new ECUInt8Tag(ECTagNames.EC_TAG_GENERAL_CHECK_NEW_VERSION, prefs.checkNewVersion ? 1 : 0),
      ]);
      await this.applySection(section);
      debug("setGeneral: applied");
   }

   /** Fetches the REMOTECONTROLS section - EC_TAG_PREFS_REMOTECTRL. */
   public async getRemoteControls(): Promise<RemoteControlsPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.REMOTECONTROLS, ECTagNames.EC_TAG_PREFS_REMOTECTRL);
      if (!section) {
         throw new Error("Daemon did not return the REMOTECONTROLS section.");
      }
      const hashOf = (tag: ECTag | undefined): string | undefined => {
         const hashChild = tag?.findChild(ECTagNames.EC_TAG_PASSWD_HASH);
         return hashChild instanceof ECHash16Tag ? Buffer.from(hashChild.value).toString("hex") : undefined;
      };
      const webserverGuestTag = section.findChild(ECTagNames.EC_TAG_WEBSERVER_GUEST);
      const amuleApiAdminTag = section.findChild(ECTagNames.EC_TAG_AMULEAPI_PASSWD);
      const amuleApiGuestTag = section.findChild(ECTagNames.EC_TAG_AMULEAPI_GUEST_PASSWD);
      const webserverPasswordTag = section.findChild(ECTagNames.EC_TAG_PASSWD_HASH);
      const prefs: RemoteControlsPrefs = {
         webserverPort: Number(section.childInt(ECTagNames.EC_TAG_WEBSERVER_PORT) ?? 0n),
         webserverAutorun: section.findChild(ECTagNames.EC_TAG_WEBSERVER_AUTORUN) !== undefined,
         webserverPasswordHash:
            webserverPasswordTag instanceof ECHash16Tag ? Buffer.from(webserverPasswordTag.value).toString("hex") : undefined,
         webserverGuest: {
            enabled: webserverGuestTag !== undefined,
            passwordHash: hashOf(webserverGuestTag),
         },
         webserverUseGzip: section.findChild(ECTagNames.EC_TAG_WEBSERVER_USEGZIP) !== undefined,
         webserverRefreshSeconds: Number(section.childInt(ECTagNames.EC_TAG_WEBSERVER_REFRESH) ?? 0n),
         webserverTemplate: section.childString(ECTagNames.EC_TAG_WEBSERVER_TEMPLATE) ?? "",
         amuleApiPort: Number(section.childInt(ECTagNames.EC_TAG_AMULEAPI_PORT) ?? 0n),
         amuleApiAutorun: section.findChild(ECTagNames.EC_TAG_AMULEAPI_AUTORUN) !== undefined,
         amuleApiBindAddress: section.childString(ECTagNames.EC_TAG_AMULEAPI_BIND) ?? "",
         amuleApiAdmin: {
            enabled: amuleApiAdminTag !== undefined,
            passwordHash: hashOf(amuleApiAdminTag),
         },
         amuleApiGuest: {
            enabled: amuleApiGuestTag !== undefined,
            passwordHash: hashOf(amuleApiGuestTag),
         },
      };
      debug("getRemoteControls: %o", prefs);
      return prefs;
   }

   /** Replaces the whole REMOTECONTROLS section - EC_TAG_PREFS_REMOTECTRL. */
   public async setRemoteControls(prefs: RemoteControlsPrefs): Promise<void> {
      const account = (name: number, value: AmuleApiAccountPrefs): ECTag[] => {
         if (!value.enabled) {
            return [];
         }
         const children = value.passwordHash
            ? [new ECHash16Tag(ECTagNames.EC_TAG_PASSWD_HASH, new Uint8Array(Buffer.from(value.passwordHash, "hex")))]
            : [];
         return [new ECCustomTag(name, new Uint8Array(), children)];
      };
      const flag = (name: number, value: boolean): ECTag[] => (value ? [new ECCustomTag(name, new Uint8Array())] : []);
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_REMOTECTRL, new Uint8Array(), [
         new ECUInt16Tag(ECTagNames.EC_TAG_WEBSERVER_PORT, prefs.webserverPort),
         ...flag(ECTagNames.EC_TAG_WEBSERVER_AUTORUN, prefs.webserverAutorun),
         ...(prefs.webserverPasswordHash
            ? [new ECHash16Tag(ECTagNames.EC_TAG_PASSWD_HASH, new Uint8Array(Buffer.from(prefs.webserverPasswordHash, "hex")))]
            : []),
         ...account(ECTagNames.EC_TAG_WEBSERVER_GUEST, prefs.webserverGuest),
         ...flag(ECTagNames.EC_TAG_WEBSERVER_USEGZIP, prefs.webserverUseGzip),
         new ECUInt32Tag(ECTagNames.EC_TAG_WEBSERVER_REFRESH, prefs.webserverRefreshSeconds),
         new ECStringTag(ECTagNames.EC_TAG_WEBSERVER_TEMPLATE, prefs.webserverTemplate),
         new ECUInt16Tag(ECTagNames.EC_TAG_AMULEAPI_PORT, prefs.amuleApiPort),
         ...flag(ECTagNames.EC_TAG_AMULEAPI_AUTORUN, prefs.amuleApiAutorun),
         new ECStringTag(ECTagNames.EC_TAG_AMULEAPI_BIND, prefs.amuleApiBindAddress),
         ...account(ECTagNames.EC_TAG_AMULEAPI_PASSWD, prefs.amuleApiAdmin),
         ...account(ECTagNames.EC_TAG_AMULEAPI_GUEST_PASSWD, prefs.amuleApiGuest),
      ]);
      await this.applySection(section);
      debug("setRemoteControls: applied");
   }

   /** Fetches the IP2COUNTRY section - EC_TAG_PREFS_IP2COUNTRY. */
   public async getIP2Country(): Promise<IP2CountryPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.IP2COUNTRY, ECTagNames.EC_TAG_PREFS_IP2COUNTRY);
      if (!section) {
         throw new Error("Daemon did not return the IP2COUNTRY section.");
      }
      const bool = (name: number): boolean => Number(section.childInt(name) ?? 0n) !== 0;
      const boolOrUndefined = (name: number): boolean | undefined => {
         const value = section.childInt(name);
         return value === undefined ? undefined : Number(value) !== 0;
      };
      const prefs: IP2CountryPrefs = {
         supported: bool(ECTagNames.EC_TAG_IP2COUNTRY_SUPPORTED),
         enabled: bool(ECTagNames.EC_TAG_IP2COUNTRY_ENABLED),
         source: Number(section.childInt(ECTagNames.EC_TAG_IP2COUNTRY_SOURCE) ?? 0n),
         customUrl: section.childString(ECTagNames.EC_TAG_IP2COUNTRY_CUSTOM_URL) ?? "",
         maxMindLicense: section.childString(ECTagNames.EC_TAG_IP2COUNTRY_MAXMIND_LICENSE) ?? "",
         autoUpdate: bool(ECTagNames.EC_TAG_IP2COUNTRY_AUTO_UPDATE),
         loadedSource: section.childString(ECTagNames.EC_TAG_IP2COUNTRY_LOADED_SOURCE),
         databasePath: section.childString(ECTagNames.EC_TAG_IP2COUNTRY_DB_PATH),
         databaseLoaded: boolOrUndefined(ECTagNames.EC_TAG_IP2COUNTRY_DB_LOADED),
         downloading: boolOrUndefined(ECTagNames.EC_TAG_IP2COUNTRY_DOWNLOADING),
         lastResult: section.childString(ECTagNames.EC_TAG_IP2COUNTRY_LAST_RESULT),
         updateNow: false,
      };
      debug("getIP2Country: %o", prefs);
      return prefs;
   }

   /** Replaces the whole IP2COUNTRY section - EC_TAG_PREFS_IP2COUNTRY. */
   public async setIP2Country(prefs: IP2CountryPrefs): Promise<void> {
      const children: ECTag[] = [
         new ECUInt8Tag(ECTagNames.EC_TAG_IP2COUNTRY_ENABLED, prefs.enabled ? 1 : 0),
         new ECUInt8Tag(ECTagNames.EC_TAG_IP2COUNTRY_SOURCE, prefs.source),
         new ECStringTag(ECTagNames.EC_TAG_IP2COUNTRY_CUSTOM_URL, prefs.customUrl),
         new ECStringTag(ECTagNames.EC_TAG_IP2COUNTRY_MAXMIND_LICENSE, prefs.maxMindLicense),
         new ECUInt8Tag(ECTagNames.EC_TAG_IP2COUNTRY_AUTO_UPDATE, prefs.autoUpdate ? 1 : 0),
      ];
      if (prefs.updateNow) {
         children.push(new ECUInt8Tag(ECTagNames.EC_TAG_IP2COUNTRY_UPDATE_NOW, 1));
      }
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_IP2COUNTRY, new Uint8Array(), children);
      await this.applySection(section);
      debug("setIP2Country: applied");
   }

   /** Fetches the CORETWEAKS section - EC_TAG_PREFS_CORETWEAKS. */
   public async getCoreTweaks(): Promise<CoreTweaksPrefs> {
      const section = await this.fetchSection(ECPreferencesSelection.CORETWEAKS, ECTagNames.EC_TAG_PREFS_CORETWEAKS);
      if (!section) {
         throw new Error("Daemon did not return the CORETWEAKS section.");
      }
      const num = (name: number): number => Number(section.childInt(name) ?? 0n);
      const prefs: CoreTweaksPrefs = {
         maxConnPerFive: num(ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE),
         verbose: section.findChild(ECTagNames.EC_TAG_CORETW_VERBOSE) !== undefined,
         fileBufferSize: num(ECTagNames.EC_TAG_CORETW_FILEBUFFER),
         uploadQueueSize: num(ECTagNames.EC_TAG_CORETW_UL_QUEUE),
         serverKeepAliveTimeoutMs: num(ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT),
         kadMaxSourceSearches: num(ECTagNames.EC_TAG_CORETW_KAD_MAX_SEARCHES),
         kadSourceReaskMs: num(ECTagNames.EC_TAG_CORETW_KAD_REASK_MS),
         sourceReaskMs: num(ECTagNames.EC_TAG_CORETW_SOURCE_REASK_MS),
      };
      debug("getCoreTweaks: %o", prefs);
      return prefs;
   }

   /** Replaces the whole CORETWEAKS section - EC_TAG_PREFS_CORETWEAKS. */
   public async setCoreTweaks(prefs: CoreTweaksPrefs): Promise<void> {
      const children: ECTag[] = [new ECUInt16Tag(ECTagNames.EC_TAG_CORETW_MAX_CONN_PER_FIVE, prefs.maxConnPerFive)];
      if (prefs.verbose) {
         children.push(new ECCustomTag(ECTagNames.EC_TAG_CORETW_VERBOSE, new Uint8Array()));
      }
      children.push(
         new ECUInt32Tag(ECTagNames.EC_TAG_CORETW_FILEBUFFER, prefs.fileBufferSize),
         new ECUInt32Tag(ECTagNames.EC_TAG_CORETW_UL_QUEUE, prefs.uploadQueueSize),
         new ECUInt64Tag(ECTagNames.EC_TAG_CORETW_SRV_KEEPALIVE_TIMEOUT, BigInt(prefs.serverKeepAliveTimeoutMs)),
         new ECUInt16Tag(ECTagNames.EC_TAG_CORETW_KAD_MAX_SEARCHES, prefs.kadMaxSourceSearches),
         new ECUInt64Tag(ECTagNames.EC_TAG_CORETW_KAD_REASK_MS, BigInt(prefs.kadSourceReaskMs)),
         new ECUInt64Tag(ECTagNames.EC_TAG_CORETW_SOURCE_REASK_MS, BigInt(prefs.sourceReaskMs)),
      );
      const section = new ECCustomTag(ECTagNames.EC_TAG_PREFS_CORETWEAKS, new Uint8Array(), children);
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
      const section = await this.fetchSection(ECPreferencesSelection.CATEGORIES, ECTagNames.EC_TAG_PREFS_CATEGORIES);
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
