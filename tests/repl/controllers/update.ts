import * as ec from "../../../src/index.js";
import { printUpdate } from "../views/update.js";

export class UpdateController {

   public constructor(private readonly update: ec.Update) {}

   public async show(): Promise<void> {
      await this.update.fetch();
      printUpdate(this.update);
   }
}
