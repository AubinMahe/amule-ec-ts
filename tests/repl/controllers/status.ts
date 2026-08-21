import * as ec from "../../../src/index.js";
import { printStatus } from "../views/status.js";

export class StatusController {
   public constructor(private readonly status: ec.Status) {}

   public async show(): Promise<void> {
      await this.status.fetch();
      printStatus(this.status);
   }

   /**
    * Passthrough for the orchestrator's notification dispatch - see
    * ec.Status.applyNotification()'s doc.
    */
   public applyNotification(packet: ec.ECPacket): boolean {
      return this.status.applyNotification(packet);
   }
}
