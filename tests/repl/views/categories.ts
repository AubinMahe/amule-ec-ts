import * as ec from "../../../src/index.js";

export function printCategories(categories: readonly ec.Category[]): void {
   if (categories.length === 0) {
      console.log("No categories beyond the built-in default (\"All\").");
      return;
   }

   console.log(`${categories.length} categor(y/ies):\n`);

   for (const category of categories) {
      console.log(`[${category.index}] ${category.title}  (${category.path})`);
      console.log(
         `  comment: "${category.comment}"  color: ${category.color}  prio: ${category.prio}`,
      );
   }
}
