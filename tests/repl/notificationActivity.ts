/**
 * Presentation-side tally of what's changed via push notifications since
 * the REPL last showed it, so the prompt can point the user at a command
 * instead of dumping full details for every single update as it arrives.
 */
export class NotificationActivity {
   private downloadUpdates = 0;
   private sharedFileUpdates = 0;
   private statusChanged = false;

   public noteDownloadUpdate(): void {
      this.downloadUpdates++;
   }

   public noteSharedFileUpdate(): void {
      this.sharedFileUpdates++;
   }

   public noteStatusChange(): void {
      this.statusChanged = true;
   }

   /** Returns (and clears) a one-line summary of what changed, or undefined if nothing did. */
   public consume(): string | undefined {
      const parts: string[] = [];

      if (this.downloadUpdates > 0) {
         parts.push(`show dl (${this.downloadUpdates})`);
      }
      if (this.sharedFileUpdates > 0) {
         parts.push(`show shared (${this.sharedFileUpdates})`);
      }
      if (this.statusChanged) {
         parts.push("status");
      }

      this.downloadUpdates = 0;
      this.sharedFileUpdates = 0;
      this.statusChanged = false;

      return parts.length > 0
         ? `Updates available: ${parts.join(", ")}`
         : undefined;
   }
}
