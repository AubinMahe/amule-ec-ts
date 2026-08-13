export function formatSize(bytes: bigint | undefined): string {
   if (bytes === undefined) return "?";

   const units = ["B", "KB", "MB", "GB", "TB"];
   let value = Number(bytes);
   let unitIndex = 0;

   while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
   }

   return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSecond: bigint | undefined): string {
   if (bytesPerSecond === undefined) return "?";
   return `${formatSize(bytesPerSecond)}/s`;
}

export function formatPercent(done: bigint | undefined, full: bigint | undefined): string {
   if (done === undefined || full === undefined || full === 0n) return "  ?%";
   const percent = (Number(done) / Number(full)) * 100;
   return `${percent.toFixed(1).padStart(5, " ")}%`;
}
