import * as net from "node:net";

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

/**
 * Whether `host` is recognized as loopback: the literal string `"localhost"`, an IPv4 address in
 * `127.0.0.0/8`, or one of the two common spellings of the IPv6 loopback address. Anything this
 * doesn't recognize - a real hostname, a non-loopback IP, an IPv6 loopback written some other
 * way - is treated as non-loopback, the safe direction to err in: `assertLoopbackOrAllowed()`'s
 * whole point is to refuse by default, not to be a complete address classifier.
 */
function isLoopbackHost(host: string): boolean {
   const normalized = host.toLowerCase();
   if (normalized === "localhost") {
      return true;
   }
   if (net.isIPv4(normalized)) {
      return normalized.startsWith("127.");
   }
   if (net.isIPv6(normalized)) {
      return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
   }
   return false;
}

/**
 * Refuses a non-loopback `host` unless `allowNonLoopback` is set - called by
 * `ECConnection.connect()`/`.reconnect()` before a socket is even opened. EC is neither encrypted
 * nor authenticated per packet (see `ISSUES.md`'s "The EC session is neither encrypted nor
 * authenticated per packet"): on a real network, an on-path attacker can read the password
 * exchange and every reply, or inject packets into an established session. Loopback keeps the
 * traffic inside the machine; anything else needs a caller who has actually thought about it -
 * an SSH tunnel or VPN presenting a non-loopback address locally, say - and says so explicitly.
 */
export function assertLoopbackOrAllowed(host: string, allowNonLoopback: boolean): void {
   if (allowNonLoopback || isLoopbackHost(host)) {
      return;
   }
   throw new RangeError(
      `Refusing to connect to "${host}": not a loopback address, and allowNonLoopback was not set. EC is not encrypted - see ` +
         `ISSUES.md's "The EC session is neither encrypted nor authenticated per packet" entry. Pass allowNonLoopback: true if ` +
         "this is deliberate, e.g. over an SSH tunnel or VPN.",
   );
}
