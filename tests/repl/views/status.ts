import * as ec from "../../../src/index.js";
import { formatSpeed } from "../format.js";

function formatIdLabel(status: ec.Status): string {
   if (status.hasLowId === undefined) return "";
   return status.hasLowId ? " (Low ID)" : " (High ID)";
}

function formatEd2kState(status: ec.Status): string {
   if (status.ed2kConnected) {
      const server = status.serverName ? ` - ${status.serverName}` : "";
      return `connected${server}${formatIdLabel(status)}`;
   }
   return status.ed2kConnecting ? "connecting" : "disconnected";
}

function formatKadState(status: ec.Status): string {
   if (status.kadConnected) return "connected";
   if (!status.kadRunning) return "off";
   return status.kadFirewalled ? "firewalled" : "running";
}

export function printStatus(status: ec.Status): void {
   if (status.ed2kConnected !== undefined || status.kadConnected !== undefined) {
      console.log(
         `ed2k: ${formatEd2kState(status)}  kad: ${formatKadState(status)}`,
      );
   }

   if (status.uploadSpeed === undefined && status.downloadSpeed === undefined)
      return;

   console.log(
      `up: ${formatSpeed(status.uploadSpeed)} (limit ${formatSpeed(status.uploadSpeedLimit)}, queue: ${status.uploadQueueLength ?? "?"})` +
         `  down: ${formatSpeed(status.downloadSpeed)} (limit ${formatSpeed(status.downloadSpeedLimit)})`,
   );
   console.log(
      `sources: ${status.totalSourceCount ?? "?"}` +
         `  ed2k: ${status.ed2kUsers ?? "?"} users / ${status.ed2kFiles ?? "?"} files` +
         `  kad: ${status.kadUsers ?? "?"} users / ${status.kadFiles ?? "?"} files / ${status.kadNodes ?? "?"} nodes`,
   );
}
