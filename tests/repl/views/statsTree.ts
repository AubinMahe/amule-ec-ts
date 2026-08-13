import * as ec from "../../../src/index.js";

export function formatStatValue(value: ec.StatValue): string {
   let base = "?";
   if (value.stringValue !== undefined) {
      base = value.stringValue;
   } else if (value.intValue !== undefined) {
      base = value.intValue.toString();
   } else if (value.doubleValue !== undefined) {
      base = value.doubleValue.toFixed(2);
   }
   const withEnum = value.enumToken ? `${base} [${value.enumToken}]` : base;
   const withType = value.type !== undefined ? `${withEnum} (${ec.ECStatValueType[value.type]})` : withEnum;
   return value.companion ? `${withType} / ${formatStatValue(value.companion)}` : withType;
}

export function printStatNode(node: ec.StatNode, indent: string): void {
   const valuesText = node.values.map(formatStatValue).join(", ");
   const suffix = valuesText ? `: ${valuesText}` : "";
   const keyText = node.key ? `  [${node.key}]` : "";
   let ratioText = "";
   if (node.ratio !== undefined) {
      ratioText = `  ratio=${node.ratio.toFixed(2)}`;
      if (node.ratioTotal !== undefined) {
         ratioText += ` (total ${node.ratioTotal.toFixed(2)})`;
      }
   }
   console.log(`${indent}${node.label}${suffix}${keyText}${ratioText}`);
   for (const child of node.children) {
      printStatNode(child, `${indent}  `);
   }
}
