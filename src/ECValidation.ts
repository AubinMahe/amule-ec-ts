/**
 * Rejects a URL the daemon is about to fetch on the caller's behalf unless it is empty or an
 * absolute `http:`/`https:` one. The daemon does the fetching, from its own network position, so
 * a caller that forwards user input to it would otherwise let that input pick any scheme the
 * daemon's downloader understands (`file:`, `ftp:`, ...). An empty string is accepted: there is
 * nothing to fetch, the daemon decides (IPFilter.updateFromUrl() documents its own fallback).
 *
 * Only the scheme is checked - a host on the daemon's own network is still reachable.
 */
export function assertEmptyOrHttpUrl(url: string): void {
   if (url === "") {
      return;
   }
   let protocol: string;
   try {
      protocol = new URL(url).protocol;
   } catch {
      throw new RangeError("Invalid URL: only an absolute http: or https: URL can be sent to the daemon.");
   }
   if (protocol !== "http:" && protocol !== "https:") {
      throw new RangeError(`Invalid URL scheme "${protocol}": only http: and https: URLs can be sent to the daemon.`);
   }
}
