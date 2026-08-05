export function printLog(lines: readonly string[]): void {
   if (lines.length === 0) {
      console.log("Log is empty.");
      return;
   }

   for (const line of lines) {
      console.log(line);
   }
}
