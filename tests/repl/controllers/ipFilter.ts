import * as ec from "../../../src/index.js";

export class IPFilterController {
   public constructor(private readonly ipFilter: ec.IPFilter) {}

   public async dispatch(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "reload") {
         await this.ipFilter.reload();
         console.log("IP filter reloaded.");
         return;
      }
      if (sub === "update") {
         const url = args[1];
         await this.ipFilter.updateFromUrl(url);
         console.log(`IP filter update requested: ${url ?? "(default URL)"}.`);
         return;
      }
      console.error("Usage: ipfilter <reload|update [url]>");
   }
}
