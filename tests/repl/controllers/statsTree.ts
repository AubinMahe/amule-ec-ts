import * as ec from "../../../src/index.js";
import { printStatNode } from "../views/statsTree.js";

export class StatsTreeController {
   public constructor(private readonly statsTree: ec.StatsTree) {}

   public async show(key?: string): Promise<void> {
      await this.statsTree.fetch();
      if (!this.statsTree.root) {
         console.error("Daemon returned no statistics tree.");
         return;
      }
      const node = key ? this.statsTree.root.findByKey(key) : this.statsTree.root;
      if (!node) {
         console.error(`No node with key "${key}".`);
         return;
      }
      printStatNode(node, "");
   }
}
