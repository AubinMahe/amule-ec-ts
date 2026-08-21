import * as ec from "../../../src/index.js";
import { printCategories } from "../views/categories.js";
import {
   printConnectionsPrefs,
   printCoreTweaksPrefs,
   printDirectoriesPrefs,
   printFilesPrefs,
   printGeneralPrefs,
   printIP2CountryPrefs,
   printKademliaPrefs,
   printMessageFilterPrefs,
   printOnlineSigPrefs,
   printRemoteControlsPrefs,
   printSecurityPrefs,
   printServersPrefs,
} from "../views/preferences.js";

/**
 * "show prefs <section>"/"prefs <section> ..."/"show categories" - all operate on ec.Preferences
 * alone (the biggest feature class in the library, so also the biggest controller here).
 */
export class PreferencesController {
   public constructor(private readonly preferences: ec.Preferences) {}

   private readonly showHandlers: Record<string, () => Promise<void>> = {
      general: async () => {
         printGeneralPrefs(await this.preferences.getGeneral());
      },
      messagefilter: async () => {
         printMessageFilterPrefs(await this.preferences.getMessageFilter());
      },
      connections: async () => {
         printConnectionsPrefs(await this.preferences.getConnections());
      },
      files: async () => {
         printFilesPrefs(await this.preferences.getFiles());
      },
      directories: async () => {
         printDirectoriesPrefs(await this.preferences.getDirectories());
      },
      security: async () => {
         printSecurityPrefs(await this.preferences.getSecurity());
      },
      onlinesig: async () => {
         printOnlineSigPrefs(await this.preferences.getOnlineSig());
      },
      servers: async () => {
         printServersPrefs(await this.preferences.getServers());
      },
      kademlia: async () => {
         printKademliaPrefs(await this.preferences.getKademlia());
      },
      remotecontrols: async () => {
         printRemoteControlsPrefs(await this.preferences.getRemoteControls());
      },
      ip2country: async () => {
         printIP2CountryPrefs(await this.preferences.getIP2Country());
      },
      coretweaks: async () => {
         printCoreTweaksPrefs(await this.preferences.getCoreTweaks());
      },
   };

   /**
    * Dispatches "show prefs <section>" - kept out of the orchestrator's own switch to stay under
    * its max-case limit.
    */
   public async showSection(subject: string): Promise<void> {
      const handler = this.showHandlers[subject];
      if (!handler) {
         console.error(`Usage: show prefs <${Object.keys(this.showHandlers).join("|")}>`);
         return;
      }
      await handler();
   }

   public async showCategories(): Promise<void> {
      const categories = await this.preferences.listCategories();
      printCategories(categories);
   }

   public async dispatch(args: string[]): Promise<void> {
      const section = args[0]?.toLowerCase();
      const rest = args.slice(1);
      if (section === "messagefilter") {
         await this.messageFilter(rest);
         return;
      }
      if (section === "connections") {
         await this.connections(rest);
         return;
      }
      if (section === "files") {
         await this.files(rest);
         return;
      }
      if (section === "directories") {
         await this.directories(rest);
         return;
      }
      if (section === "security") {
         await this.security(rest);
         return;
      }
      if (section === "onlinesig") {
         await this.onlineSig(rest);
         return;
      }
      if (section === "servers") {
         await this.servers(rest);
         return;
      }
      if (section === "kademlia") {
         await this.kademlia(rest);
         return;
      }
      if (section === "general") {
         await this.general(rest);
         return;
      }
      if (section === "remotecontrols") {
         await this.remoteControls(rest);
         return;
      }
      if (section === "ip2country") {
         await this.ip2Country(rest);
         return;
      }
      if (section === "coretweaks") {
         await this.coreTweaks(rest);
         return;
      }
      console.error(
         "Usage: prefs <general|messagefilter|connections|files|directories|security|onlinesig|servers|kademlia|remotecontrols|ip2country|coretweaks> ...",
      );
   }

   private async security(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "filterlan" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs security filterlan <on|off>");
         return;
      }
      const current = await this.preferences.getSecurity();
      await this.preferences.setSecurity({
         ...current,
         filterLanIps: onOff === "on",
      });
      console.log(`LAN IP filtering ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async onlineSig(args: string[]): Promise<void> {
      const onOff = args[0]?.toLowerCase();
      if (onOff !== "on" && onOff !== "off") {
         console.error("Usage: prefs onlinesig <on|off>");
         return;
      }
      const current = await this.preferences.getOnlineSig();
      await this.preferences.setOnlineSig({
         ...current,
         enabled: onOff === "on",
      });
      console.log(`Online signature ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async servers(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "autoupdate" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs servers autoupdate <on|off>");
         return;
      }
      const current = await this.preferences.getServers();
      await this.preferences.setServers({
         ...current,
         autoUpdateServerList: onOff === "on",
      });
      console.log(`Server-list auto-update ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async kademlia(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      const url = args[1];
      if (sub !== "seturl" || !url) {
         console.error("Usage: prefs kademlia seturl <url>");
         return;
      }
      await this.preferences.setKademlia({ nodesUpdateUrl: url });
      console.log(`Kademlia nodes.dat update URL set: ${url}.`);
   }

   private async general(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "checknewversion" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs general checknewversion <on|off>");
         return;
      }
      const current = await this.preferences.getGeneral();
      await this.preferences.setGeneral({
         ...current,
         checkNewVersion: onOff === "on",
      });
      console.log(`Check-new-version preference ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async remoteControls(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "gzip" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs remotecontrols gzip <on|off>");
         return;
      }
      const current = await this.preferences.getRemoteControls();
      await this.preferences.setRemoteControls({
         ...current,
         webserverUseGzip: onOff === "on",
      });
      console.log(`Webserver gzip ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async ip2Country(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "autoupdate" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs ip2country autoupdate <on|off>");
         return;
      }
      const current = await this.preferences.getIP2Country();
      await this.preferences.setIP2Country({
         ...current,
         autoUpdate: onOff === "on",
      });
      console.log(`GeoIP auto-update ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async files(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "checkfreespace" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs files checkfreespace <on|off>");
         return;
      }
      const current = await this.preferences.getFiles();
      await this.preferences.setFiles({
         ...current,
         checkFreeSpace: onOff === "on",
      });
      console.log(`Free-disk-space check ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async directories(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "autorescan" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs directories autorescan <on|off>");
         return;
      }
      const current = await this.preferences.getDirectories();
      await this.preferences.setDirectories({
         ...current,
         autoRescanSharedDirs: onOff === "on",
      });
      console.log(`Shared-dirs auto-rescan ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async messageFilter(args: string[]): Promise<void> {
      const onOff = args[0]?.toLowerCase();
      if (onOff !== "on" && onOff !== "off") {
         console.error("Usage: prefs messagefilter <on|off>");
         return;
      }
      const current = await this.preferences.getMessageFilter();
      await this.preferences.setMessageFilter({
         ...current,
         enabled: onOff === "on",
      });
      console.log(`Message filter ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async connections(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "reconnect" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs connections reconnect <on|off>");
         return;
      }
      const current = await this.preferences.getConnections();
      await this.preferences.setConnections({
         ...current,
         reconnect: onOff === "on",
      });
      console.log(`ed2k auto-reconnect ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async coreTweaks(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "verbose" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs coretweaks verbose <on|off>");
         return;
      }
      const current = await this.preferences.getCoreTweaks();
      await this.preferences.setCoreTweaks({
         ...current,
         verbose: onOff === "on",
      });
      console.log(`Core verbose logging ${onOff === "on" ? "enabled" : "disabled"}.`);
   }
}
