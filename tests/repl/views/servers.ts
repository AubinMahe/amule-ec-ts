import * as ec from "../../../src/index.js";

export function printServer(server: ec.ServerInfo): void {
   console.log(`${server.name ?? "(unknown name)"}  [${server.ipPort}]`);
   console.log(
      `  ping: ${server.ping ?? "?"}ms  users: ${server.users ?? "?"}/${server.usersMax ?? "?"}  files: ${server.files ?? "?"}`,
   );
}

export function printServers(servers: readonly ec.ServerInfo[]): void {
   if (servers.length === 0) {
      console.log("No known servers.");
      return;
   }

   console.log(`${servers.length} server(s):\n`);

   for (const server of servers) {
      printServer(server);
   }
}
