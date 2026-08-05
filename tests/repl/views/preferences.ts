import * as ec from "../../../src/index.js";

export function printMessageFilterPrefs(prefs: ec.MessageFilterPrefs): void {
   console.log(`enabled: ${prefs.enabled}`);
   console.log(
      `  filterAll: ${prefs.filterAll}  friendsOnly: ${prefs.friendsOnly}  secureOnly: ${prefs.secureOnly}`,
   );
   console.log(`  byKeyword: ${prefs.byKeyword}  keywords: "${prefs.keywords}"`);
   console.log(
      `  showInLog: ${prefs.showInLog}  filterComments: ${prefs.filterComments}  commentKeywords: "${prefs.commentKeywords}"`,
   );
}

export function printConnectionsPrefs(prefs: ec.ConnectionsPrefs): void {
   console.log(
      `graph caps: ul ${prefs.maxGraphUploadRate} / dl ${prefs.maxGraphDownloadRate}  actual caps: ul ${prefs.maxUpload} / dl ${prefs.maxDownload}`,
   );
   console.log(
      `  slotAllocation: ${prefs.slotAllocation}  tcpPort: ${prefs.tcpPort}  udpPort: ${prefs.udpPort}  udpDisabled: ${prefs.udpDisabled}`,
   );
   console.log(
      `  maxSourcesPerFile: ${prefs.maxSourcesPerFile}  maxConnections: ${prefs.maxConnections}`,
   );
   console.log(
      `  autoConnect: ${prefs.autoConnect}  reconnect: ${prefs.reconnect}  networkEd2k: ${prefs.networkEd2k}  networkKademlia: ${prefs.networkKademlia}`,
   );
   console.log(
      `  bindAddress: "${prefs.bindAddress}"  bindInterface: "${prefs.bindInterface}"`,
   );
   console.log(
      `  proxy: enabled=${prefs.proxy.enabled} type=${ec.ECProxyType[prefs.proxy.type]} host=${prefs.proxy.host} port=${prefs.proxy.port}`,
   );
   console.log(`  upnpEnabled: ${prefs.upnpEnabled}  upnpTcpPort: ${prefs.upnpTcpPort}`);
}

export function printFilesPrefs(prefs: ec.FilesPrefs): void {
   console.log(
      `ichEnabled: ${prefs.ichEnabled}  aichTrust: ${prefs.aichTrust}  newFilesPaused: ${prefs.newFilesPaused}`,
   );
   console.log(
      `  newAutoDownloadPriority: ${prefs.newAutoDownloadPriority}  newAutoUploadPriority: ${prefs.newAutoUploadPriority}  previewPrio: ${prefs.previewPrio}`,
   );
   console.log(
      `  endgame: ${prefs.endgame}  startNextFilePaused: ${prefs.startNextFilePaused}  resumeSameCategory: ${prefs.resumeSameCategory}  startNextFileAlpha: ${prefs.startNextFileAlpha}`,
   );
   console.log(
      `  saveSources: ${prefs.saveSources}  allocFullFileSize: ${prefs.allocFullFileSize}  createFilesNormal: ${prefs.createFilesNormal}`,
   );
   console.log(
      `  mmapSupported: ${prefs.mmapSupported}  mmapEnabled: ${prefs.mmapEnabled}`,
   );
   console.log(
      `  checkFreeSpace: ${prefs.checkFreeSpace}  minFreeDiskSpaceMb: ${prefs.minFreeDiskSpaceMb}`,
   );
   console.log(
      `  mediaMetadataEnabled: ${prefs.mediaMetadataEnabled}  mediaMetadataFfprobePath: "${prefs.mediaMetadataFfprobePath}"`,
   );
}

export function printDirectoriesPrefs(prefs: ec.DirectoriesPrefs): void {
   console.log(`incomingDir: "${prefs.incomingDir}"`);
   console.log(`  tempDir: "${prefs.tempDir}"`);
   console.log(`  sharedDirs: [${prefs.sharedDirs.join(", ")}]`);
   console.log(
      `  shareHiddenFiles: ${prefs.shareHiddenFiles}  autoRescanSharedDirs: ${prefs.autoRescanSharedDirs}  followSymlinksInShares: ${prefs.followSymlinksInShares}`,
   );
   console.log(
      `  excludeSharePatterns: "${prefs.excludeSharePatterns}"  excludeSharePatternsUseRegex: ${prefs.excludeSharePatternsUseRegex}`,
   );
}

export function printSecurityPrefs(prefs: ec.SecurityPrefs): void {
   console.log(
      `canSeeShares: ${ec.ECVisibleShareAccess[prefs.canSeeShares]}  secureIdentEnabled: ${prefs.secureIdentEnabled}`,
   );
   console.log(
      `  ipFilterClients: ${prefs.ipFilterClients}  ipFilterServers: ${prefs.ipFilterServers}  ipFilterAutoUpdate: ${prefs.ipFilterAutoUpdate}`,
   );
   console.log(
      `  ipFilterUpdateUrl: "${prefs.ipFilterUpdateUrl}"  ipFilterLevel: ${prefs.ipFilterLevel}  filterLanIps: ${prefs.filterLanIps}`,
   );
   console.log(
      `  obfuscationSupported: ${prefs.obfuscationSupported}  obfuscationRequested: ${prefs.obfuscationRequested}  obfuscationRequired: ${prefs.obfuscationRequired}`,
   );
   console.log(
      `  ipFilterParanoid: ${prefs.ipFilterParanoid}  ipFilterSystem: ${prefs.ipFilterSystem}`,
   );
}

export function printOnlineSigPrefs(prefs: ec.OnlineSigPrefs): void {
   console.log(`enabled: ${prefs.enabled}`);
   console.log(`  directory: "${prefs.directory}"`);
   console.log(`  updateIntervalSeconds: ${prefs.updateIntervalSeconds}`);
}

export function printServersPrefs(prefs: ec.ServersPrefs): void {
   console.log(
      `removeDeadServers: ${prefs.removeDeadServers}  deadServerRetries: ${prefs.deadServerRetries}  autoUpdateServerList: ${prefs.autoUpdateServerList}`,
   );
   console.log(
      `  addServersFromServer: ${prefs.addServersFromServer}  addServersFromClient: ${prefs.addServersFromClient}`,
   );
   console.log(
      `  useScoreSystem: ${prefs.useScoreSystem}  smartIdCheck: ${prefs.smartIdCheck}  safeServerConnect: ${prefs.safeServerConnect}`,
   );
   console.log(
      `  autoConnectStaticOnly: ${prefs.autoConnectStaticOnly}  manualHighPriority: ${prefs.manualHighPriority}`,
   );
   console.log(`  updateUrl: "${prefs.updateUrl}"`);
}

export function printKademliaPrefs(prefs: ec.KademliaPrefs): void {
   console.log(`nodesUpdateUrl: "${prefs.nodesUpdateUrl}"`);
}

export function printGeneralPrefs(prefs: ec.GeneralPrefs): void {
   console.log(`userNick: "${prefs.userNick}"  userHash: ${prefs.userHash}`);
   console.log(`  userHost: "${prefs.userHost}"`);
   console.log(
      `  checkNewVersion: ${prefs.checkNewVersion}  versionCheckAvailable: ${prefs.versionCheckAvailable}  upnpAvailable: ${prefs.upnpAvailable}`,
   );
}

export function printRemoteControlsPrefs(prefs: ec.RemoteControlsPrefs): void {
   console.log(
      `webserverPort: ${prefs.webserverPort}  webserverAutorun: ${prefs.webserverAutorun}  webserverPasswordSet: ${prefs.webserverPasswordHash !== undefined}`,
   );
   console.log(
      `  webserverGuest: enabled=${prefs.webserverGuest.enabled} passwordSet=${prefs.webserverGuest.passwordHash !== undefined}`,
   );
   console.log(
      `  webserverUseGzip: ${prefs.webserverUseGzip}  webserverRefreshSeconds: ${prefs.webserverRefreshSeconds}  webserverTemplate: "${prefs.webserverTemplate}"`,
   );
   console.log(
      `  amuleApiPort: ${prefs.amuleApiPort}  amuleApiAutorun: ${prefs.amuleApiAutorun}  amuleApiBindAddress: "${prefs.amuleApiBindAddress}"`,
   );
   console.log(
      `  amuleApiAdmin: enabled=${prefs.amuleApiAdmin.enabled} passwordSet=${prefs.amuleApiAdmin.passwordHash !== undefined}`,
   );
   console.log(
      `  amuleApiGuest: enabled=${prefs.amuleApiGuest.enabled} passwordSet=${prefs.amuleApiGuest.passwordHash !== undefined}`,
   );
}

export function printIP2CountryPrefs(prefs: ec.IP2CountryPrefs): void {
   console.log(
      `supported: ${prefs.supported}  enabled: ${prefs.enabled}  source: ${ec.ECGeoIPSource[prefs.source]}  autoUpdate: ${prefs.autoUpdate}`,
   );
   console.log(
      `  customUrl: "${prefs.customUrl}"  maxMindLicense: ${prefs.maxMindLicense ? "(set)" : "(empty)"}`,
   );
   console.log(
      `  loadedSource: ${prefs.loadedSource ?? "(n/a)"}  databasePath: ${prefs.databasePath ?? "(n/a)"}`,
   );
   console.log(
      `  databaseLoaded: ${prefs.databaseLoaded ?? "(n/a)"}  downloading: ${prefs.downloading ?? "(n/a)"}  lastResult: ${prefs.lastResult ?? "(n/a)"}`,
   );
}

export function printCoreTweaksPrefs(prefs: ec.CoreTweaksPrefs): void {
   console.log(
      `maxConnPerFive: ${prefs.maxConnPerFive}  verbose: ${prefs.verbose}`,
   );
   console.log(
      `  fileBufferSize: ${prefs.fileBufferSize}B  uploadQueueSize: ${prefs.uploadQueueSize}`,
   );
   console.log(
      `  serverKeepAliveTimeoutMs: ${prefs.serverKeepAliveTimeoutMs}  kadMaxSourceSearches: ${prefs.kadMaxSourceSearches}`,
   );
   console.log(
      `  kadSourceReaskMs: ${prefs.kadSourceReaskMs}  sourceReaskMs: ${prefs.sourceReaskMs}`,
   );
}
