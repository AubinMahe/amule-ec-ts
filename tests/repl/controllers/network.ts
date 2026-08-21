import * as ec from "../../../src/index.js";

/**
 * Top-level connect/disconnect (network-wide - tries both ed2k/Kad) plus
 * the Kad-specific start/stop/update/bootstrap sub-commands. Grouped in
 * one controller since bare "connect"/"disconnect" have no single feature
 * class of their own - they fan out to Kad and, for a specific address,
 * Servers.
 */
export class NetworkController {
   public constructor(
      private readonly kad: ec.Kad,
      private readonly servers: ec.Servers,
   ) {}

   /**
    * Bare "connect" is Kad.connect() (ed2k/Kad per daemon prefs); "connect <ip:port>" is
    * Servers.connect().
    */
   public async connect(args: string[]): Promise<void> {
      const ipPort = args[0];
      if (!ipPort) {
         const messages = await this.kad.connect();
         console.log(messages.length > 0 ? messages.join("\n") : "Nothing to connect to.");
         return;
      }
      await this.servers.connect(ipPort);
      console.log(`Connect requested: ${ipPort}.`);
   }

   public async disconnect(): Promise<void> {
      const messages = await this.kad.disconnect();
      console.log(messages.length > 0 ? messages.join("\n") : "Nothing was connected.");
   }

   public async kadCommand(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      switch (sub) {
         case "start":
            await this.kad.start();
            console.log("Kad started.");
            return;

         case "stop":
            await this.kad.stop();
            console.log("Kad stopped.");
            return;

         case "update": {
            const url = args[1];
            if (!url) {
               console.error("Usage: kad update <url>");
               return;
            }
            await this.kad.updateNodesFromUrl(url);
            console.log(`nodes.dat update requested: ${url}.`);
            return;
         }

         case "bootstrap": {
            const ip = args[1];
            const port = Number(args[2]);
            if (!ip || !args[2] || Number.isNaN(port)) {
               console.error("Usage: kad bootstrap <ip> <port>");
               return;
            }
            await this.kad.bootstrapFromIp(ip, port);
            console.log(`Bootstrap requested: ${ip}:${port}.`);
            return;
         }

         default:
            console.error("Usage: kad <start|stop|update <url>|bootstrap <ip> <port>>");
      }
   }
}
