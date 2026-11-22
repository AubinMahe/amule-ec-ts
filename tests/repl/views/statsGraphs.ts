import * as ec from "../../../src/index.js";
import { formatSize, formatSpeed } from "../format.js";

export function printStatsGraphs(statsGraphs: ec.StatsGraphs): void {
   if (statsGraphs.points.length === 0) {
      console.log(`No new graph points. (last: ${statsGraphs.last}, depth: ${statsGraphs.depth})`);
      return;
   }
   console.log(
      `--- StatsGraphs: ${statsGraphs.points.length} point(s), last: ${statsGraphs.last}, depth: ${statsGraphs.depth} ---`,
   );
   statsGraphs.points.forEach((point, i) => {
      const clients =
         point.uploadingClients !== undefined || point.downloadingClients !== undefined
            ? `  clients up: ${point.uploadingClients ?? "?"} down: ${point.downloadingClients ?? "?"}`
            : "";
      console.log(
         `  [${i.toString().padStart(2, " ")}] down: ${formatSpeed(point.downloadSpeed)} (${point.downloadSpeed} B/s)  up: ${formatSpeed(point.uploadSpeed)} (${point.uploadSpeed} B/s)` +
            `  connections: ${point.connections}  kad nodes: ${point.kadNodes}${clients}`,
      );
   });
   console.log(
      `session: down ${formatSize(statsGraphs.sessionDownloaded)} / up ${formatSize(statsGraphs.sessionUploaded)}` +
         `  kad nodes: ${statsGraphs.sessionKadNodes ?? "?"}` +
         `  timespan: ${statsGraphs.sessionTimespan?.toFixed(0) ?? "?"}s`,
   );
}
