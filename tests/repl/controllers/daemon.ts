import * as ec from "../../../src/index.js";

export class DaemonController {

   public constructor(private readonly daemon: ec.Daemon) {}

   public async shutdown(): Promise<void> {
      await this.daemon.shutdown();
      console.log("Shutdown requested.");
   }

   public async checkVersion(): Promise<void> {
      await this.daemon.checkVersion();
      console.log("Version check requested.");
   }
}
