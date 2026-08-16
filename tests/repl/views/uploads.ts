import * as ec from "../../../src/index.js";
import { formatSpeed } from "../format.js";

export function printUploadClient(client: ec.UploadClient): void {
   console.log(`${client.name}  [${client.hash}]`);
   console.log(
      `  file: ${client.fileName ?? "(none)"}` +
         `  @ ${formatSpeed(client.speedUp)}  session: ${formatSpeed(client.sessionUp)}` +
         `  total: ${client.totalUp ?? "?"}  software: ${client.softwareText}  state: ${client.uploadState ?? "?"}`,
   );
}

export function printUploadClients(clients: readonly ec.UploadClient[]): void {
   if (clients.length === 0) {
      console.log("No active uploads.");
      return;
   }

   console.log(`${clients.length} upload(s):\n`);

   for (const client of clients) {
      printUploadClient(client);
   }
}
