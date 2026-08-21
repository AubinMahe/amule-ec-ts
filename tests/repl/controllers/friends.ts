import { setTimeout } from "node:timers/promises";
import * as ec from "../../../src/index.js";
import { printSearchResults } from "../views/search.js";

const SEARCH_POLL_INTERVAL_MS = 250;

export class FriendsController {
   public constructor(private readonly friends: ec.Friends) {}

   public async add(args: string[]): Promise<void> {
      if (args.length === 1) {
         const [ecid] = args as [string];
         await this.friends.addByEcid(BigInt(ecid));
         console.log(`Friend added: ecid=${ecid}.`);
         return;
      }
      if (args.length === 4) {
         const [hash, ip, portText, name] = args as [string, string, string, string];
         await this.friends.addByHash(hash, ip, Number(portText), name);
         console.log(`Friend added: ${name}.`);
         return;
      }
      console.error("Usage: friend add <ecid>  |  friend add <hash> <ip> <port> <name>");
   }

   /**
    * Browses a currently-connected client's shared files ("View Files") - polls to completion,
    * then prints results like `search <keywords>` does.
    */
   public async browse(args: string[]): Promise<void> {
      const ecidText = args[0];
      if (!ecidText) {
         console.error("Usage: friend browse <client-ecid>");
         return;
      }
      const session = await this.friends.browseSharedFiles(BigInt(ecidText));
      let progress: ec.ECSearchProgress;
      do {
         await setTimeout(SEARCH_POLL_INTERVAL_MS);
         progress = await session.progress();
      } while (progress.state === ec.ECSearchLifecycleState.RUNNING);
      await session.fetch();
      printSearchResults(session.results);
   }

   public async dispatch(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "add") {
         await this.add(args.slice(1));
         return;
      }
      if (sub === "browse") {
         await this.browse(args.slice(1));
         return;
      }
      if (sub === "remove") {
         const ecid = args[1];
         if (!ecid) {
            console.error("Usage: friend remove <ecid>");
            return;
         }
         await this.friends.remove(BigInt(ecid));
         console.log(`Friend removed: ecid=${ecid}.`);
         return;
      }
      if (sub === "slot") {
         const ecid = args[1];
         const state = args[2]?.toLowerCase();
         if (!ecid || (state !== "on" && state !== "off")) {
            console.error("Usage: friend slot <ecid> <on|off>");
            return;
         }
         await this.friends.setFriendSlot(BigInt(ecid), state === "on");
         console.log(`Friend slot ${state}: ecid=${ecid}.`);
         return;
      }
      console.error("Usage: friend <add ...|browse <client-ecid>|remove <ecid>|slot <ecid> <on|off>>");
   }
}
