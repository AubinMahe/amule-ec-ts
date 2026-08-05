import * as ec from "../../../src/index.js";

export function printUpdate(update: ec.Update): void {
   console.log(
      `${update.sharedFiles.length} shared file(s), ${update.downloads.length} download(s), ${update.clients.length} client(s), ${update.servers.length} server(s), ${update.friends.length} friend(s)`,
   );
   for (const file of update.sharedFiles) {
      console.log(`  [shared] ${file.name ?? "(unchanged)"}  hash=${file.hash ?? "?"}`);
   }
   for (const file of update.downloads) {
      console.log(`  [download] ${file.name ?? "(unchanged)"}  hash=${file.hash ?? "?"}`);
   }
   for (const client of update.clients) {
      console.log(
         `  [client] ecid=${client.ecid}  name=${client.name ?? "(unchanged)"}  upSpeed=${client.uploadSpeed ?? "?"}  downSpeed=${client.downloadSpeed ?? "?"}`,
      );
   }
   for (const server of update.servers) {
      console.log(
         `  [server] ecid=${server.ecid}  name=${server.name ?? "(unchanged)"}  ${server.ip ?? "?"}:${server.port ?? "?"}`,
      );
   }
   for (const friend of update.friends) {
      console.log(
         `  [friend] ecid=${friend.ecid}  name=${friend.name ?? "(unchanged)"}  linkedClientEcid=${friend.linkedClientEcid ?? "?"}`,
      );
   }
}
