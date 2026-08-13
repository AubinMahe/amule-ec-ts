import * as ec from "../../../src/index.js";
import { printStatsGraphs } from "../views/statsGraphs.js";

export class StatsGraphsController {
   public constructor(private readonly statsGraphs: ec.StatsGraphs) {}

   public async show(): Promise<void> {
      // scale/width match amule-remote-gui.cpp/WebServer.cpp's own polling
      // convention (see StatsGraphs.fetch()'s doc) - omitting them isn't
      // "use the daemon's default", it's width=0, which always looks like
      // "no new points".
      await this.statsGraphs.fetch({ last: this.statsGraphs.last, scale: 1, width: 32 });
      printStatsGraphs(this.statsGraphs);
   }
}
