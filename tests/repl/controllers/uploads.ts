import * as ec from "../../../src/index.js";
import { printUploadClients } from "../views/uploads.js";

export class UploadsController {
   public constructor(private readonly uploads: ec.Uploads) {}

   public async show(): Promise<void> {
      await this.uploads.fetch();
      printUploadClients(this.uploads.clients);
   }

   public async swapClient(args: string[]): Promise<void> {
      const ecidText = args[0];
      const hash = args[1];
      if (!ecidText || !hash) {
         console.error("Usage: swapclient <client-ecid> <hash>");
         return;
      }
      await this.uploads.swapClientToAnotherFile(BigInt(ecidText), hash);
      console.log(`Swap requested: client ${ecidText} -> ${hash}.`);
   }
}
