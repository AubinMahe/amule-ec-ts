import * as ec from "../../../src/index.js";
import { SERVER_PRIORITY_NAMES } from "../help.js";
import { printServers } from "../views/servers.js";

/**
 * server disconnect/priority/remove/add/update, plus "show servers" - all operate on ec.Servers
 * alone.
 */
export class ServersController {
   public constructor(private readonly servers: ec.Servers) {}

   public async show(): Promise<void> {
      await this.servers.fetch();
      printServers(this.servers.servers);
   }

   public async priority(args: string[]): Promise<void> {
      const ecidText = args[0];
      const options: { static?: boolean; prio?: ec.ServerPriority } = {};
      for (const token of args.slice(1)) {
         const lower = token.toLowerCase();
         if (lower === "static") {
            options.static = true;
         } else if (lower === "nostatic") {
            options.static = false;
         } else if (lower in SERVER_PRIORITY_NAMES) {
            options.prio = SERVER_PRIORITY_NAMES[lower];
         }
      }
      if (!ecidText || (options.static === undefined && options.prio === undefined)) {
         console.error(`Usage: server priority <ecid> [static|nostatic] [${Object.keys(SERVER_PRIORITY_NAMES).join("|")}]`);
         return;
      }
      // setStatic()/setPriority() are two separate wire calls (mirroring amule-remote-gui.cpp's own
      // SetStaticServer()/SetServerPrio(), never combined) - this command accepts both tokens on
      // one line purely for REPL convenience, issuing one call per token actually given.
      const ecid = BigInt(ecidText);
      if (options.static !== undefined) {
         await this.servers.setStatic(ecid, options.static);
      }
      if (options.prio !== undefined) {
         await this.servers.setPriority(ecid, options.prio);
      }
      console.log(`Server priority updated: ecid=${ecidText}.`);
   }

   public async remove(args: string[]): Promise<void> {
      const ipPort = args[0];
      if (!ipPort) {
         console.error("Usage: server remove <ip:port>");
         return;
      }
      await this.servers.remove(ipPort);
      console.log(`Server removed: ${ipPort}.`);
   }

   public async add(args: string[]): Promise<void> {
      const ipPort = args[0];
      if (!ipPort) {
         console.error("Usage: server add <ip:port> [name]");
         return;
      }
      const name = args.slice(1).join(" ");
      await this.servers.add(ipPort, name);
      console.log(`Server added: ${ipPort}.`);
   }

   public async updateFromUrl(args: string[]): Promise<void> {
      const url = args[0];
      if (!url) {
         console.error("Usage: server update <url>");
         return;
      }
      await this.servers.updateFromUrl(url);
      console.log(`Server list update requested: ${url}.`);
   }

   public async dispatch(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "disconnect") {
         await this.servers.disconnect();
         console.log("Disconnected from the current server.");
         return;
      }
      if (sub === "priority") {
         await this.priority(args.slice(1));
         return;
      }
      if (sub === "remove") {
         return this.remove(args.slice(1));
      }
      if (sub === "add") {
         return this.add(args.slice(1));
      }
      if (sub === "update") {
         return this.updateFromUrl(args.slice(1));
      }
      console.error("Usage: server <disconnect|priority ...|remove <ip:port>|add <ip:port> [name]|update <url>>");
   }
}
