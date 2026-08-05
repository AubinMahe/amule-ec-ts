import * as ec from "../../../src/index.js";
import { formatSize, formatSpeed } from "../format.js";

export function printStatsGraphs(statsGraphs: ec.StatsGraphs): void {
   if (statsGraphs.points.length === 0) {
      console.log("No new graph points.");
      return;
   }
   for (const point of statsGraphs.points) {
      const clients =
         point.uploadingClients !== undefined || point.downloadingClients !== undefined
            ? `  clients up: ${point.uploadingClients ?? "?"} down: ${point.downloadingClients ?? "?"}`
            : "";
      console.log(
         `down: ${formatSpeed(point.downloadSpeed)}  up: ${formatSpeed(point.uploadSpeed)}` +
            `  connections: ${point.connections}  kad nodes: ${point.kadNodes}${clients}`,
      );
   }
   console.log(
      `session: down ${formatSize(statsGraphs.sessionDownloaded)} / up ${formatSize(statsGraphs.sessionUploaded)}` +
         `  kad nodes: ${statsGraphs.sessionKadNodes ?? "?"}` +
         `  timespan: ${statsGraphs.sessionTimespan?.toFixed(0) ?? "?"}s`,
   );
}
