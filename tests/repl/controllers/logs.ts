import * as ec from "../../../src/index.js";
import { printLog } from "../views/log.js";

export class LogController {
   public constructor(private readonly log: ec.Log) {}

   public async show(): Promise<void> {
      await this.log.fetch();
      printLog(this.log.lines);
   }

   public async reset(): Promise<void> {
      await this.log.reset();
      console.log("Log cleared.");
   }

   public async showLast(): Promise<void> {
      const last = await this.log.fetchLast();
      console.log(last ?? "Log is empty.");
   }

   public async addLine(args: string[]): Promise<void> {
      const text = args.join(" ");
      if (!text) {
         console.error("Usage: addlog <text>");
         return;
      }
      await this.log.addLine(text);
      console.log("Log line added.");
   }
}

export class DebugLogController {
   public constructor(private readonly debugLog: ec.DebugLog) {}

   public async show(): Promise<void> {
      await this.debugLog.fetch();
      printLog(this.debugLog.lines);
   }

   public async reset(): Promise<void> {
      await this.debugLog.reset();
      console.log("Debug log cleared.");
   }

   /**
    * Always passes toStatus: true - see DebugLog.addLine()'s doc: without it, a non-debug-build
    * daemon silently drops the line.
    */
   public async addLine(args: string[]): Promise<void> {
      const text = args.join(" ");
      if (!text) {
         console.error("Usage: adddebuglog <text>");
         return;
      }
      await this.debugLog.addLine(text, true);
      console.log("Debug log line added.");
   }
}

export class ServerLogController {
   public constructor(private readonly serverLog: ec.ServerLog) {}

   public async show(): Promise<void> {
      await this.serverLog.fetch();
      printLog(this.serverLog.lines);
   }

   public async reset(): Promise<void> {
      await this.serverLog.reset();
      console.log("Server log cleared.");
   }
}
