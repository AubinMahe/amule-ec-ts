import * as ec from "../../../src/index.js";

export function printChatSessions(sessions: readonly ec.ChatSession[]): void {
   if (sessions.length === 0) {
      console.log("No chat sessions.");
      return;
   }
   for (const session of sessions) {
      const links: string[] = [];
      if (session.clientEcid !== undefined) {
         links.push(`client-ecid=${session.clientEcid}`);
      }
      if (session.friendEcid !== undefined) {
         links.push(`friend-ecid=${session.friendEcid}`);
      }
      const suffix = links.length > 0 ? ` (${links.join(", ")})` : "";
      console.log(`[${session.clientId}] ${session.peerName || "(unknown)"}${suffix}`);
      for (const message of session.messages) {
         const arrow = message.direction === ec.ChatDirection.OUT ? "->" : "<-";
         console.log(`  ${arrow} ${message.text}`);
      }
   }
}
