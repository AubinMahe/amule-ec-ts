import * as ec from "../../../src/index.js";

/** Download-category CRUD (EC_OP_CREATE/UPDATE/DELETE_CATEGORY) - listing lives on PreferencesController since there's no GET_CATEGORIES opcode. */
export class CategoriesController {

   public constructor(private readonly categories: ec.Categories) {}

   public async create(args: string[]): Promise<void> {
      const [title, path, comment, colorText, prioText] = args;
      if (!title || !path) {
         console.error("Usage: category create <title> <path> [comment] [color] [prio]");
         return;
      }
      await this.categories.create(
         title,
         path,
         comment,
         colorText === undefined ? undefined : Number(colorText),
         prioText === undefined ? undefined : Number(prioText),
      );
      console.log(`Category created: ${title}.`);
   }

   public async update(args: string[]): Promise<void> {
      const [indexText, title, path, comment, colorText, prioText] = args;
      const index = indexText ? Number(indexText) : NaN;
      if (Number.isNaN(index) || !title || !path) {
         console.error(
            "Usage: category update <index> <title> <path> [comment] [color] [prio]",
         );
         return;
      }
      await this.categories.update(
         index,
         title,
         path,
         comment,
         colorText === undefined ? undefined : Number(colorText),
         prioText === undefined ? undefined : Number(prioText),
      );
      console.log(`Category updated: ${index}.`);
   }

   public async delete(args: string[]): Promise<void> {
      const indexText = args[0];
      const index = indexText ? Number(indexText) : NaN;
      if (Number.isNaN(index)) {
         console.error("Usage: category delete <index>");
         return;
      }
      await this.categories.delete(index);
      console.log(`Category deleted: ${index}.`);
   }

   public async dispatch(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "create") return this.create(args.slice(1));
      if (sub === "update") return this.update(args.slice(1));
      if (sub === "delete") return this.delete(args.slice(1));
      console.error("Usage: category <create ...|update ...|delete <index>>");
   }
}
