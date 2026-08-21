import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECTag } from "./ECTags.js";
import { ECTagNames } from "./ECTagNames.js";

const debug = debuglog("amule-ec:partfile-status");

/** One contiguous byte range - see DownloadFile.gaps/.requestedRanges' doc. */
export interface ByteRange {
   readonly start: bigint;
   readonly end: bigint;
}

/**
 * RLE-decodes one EC_TAG_PARTFILE_GAP_STATUS/_REQ_STATUS/_PART_STATUS tag's raw payload into the
 * "diff" bytes it encodes - the same output RLE_Data::Decode()'s first pass produces in the C++
 * source (RLE.cpp:107-166) before that function XORs it onto the previous state (see
 * reconstructState() below, which does that XOR step client-side). A run of the same byte value
 * (2 or more, up to 255) is written twice followed by a count byte; any other byte is a single
 * literal - confirmed against RLE_Data::Encode()'s output format (RLE.cpp:191-212).
 */
function rleDecodeDiff(encoded: Uint8Array): Uint8Array {
   const buffer = Buffer.from(encoded);
   const out: number[] = [];
   let i = 0;
   while (i < buffer.length) {
      const value = buffer.readUInt8(i);
      if (i < buffer.length - 2 && buffer.readUInt8(i + 1) === value) {
         const count = buffer.readUInt8(i + 2);
         for (let k = 0; k < count; k++) out.push(value);
         i += 3;
      } else {
         out.push(value);
         i += 1;
      }
   }
   return Uint8Array.from(out);
}

/**
 * XORs a freshly RLE-decoded diff onto the previous state, resizing first exactly like
 * RLE_Data::Realloc() does (RLE.cpp:80-105): growing zero-extends, shrinking truncates - both
 * *before* the XOR, so a byte position that only exists in the new size starts from zero rather
 * than leftover data at a stale offset.
 */
function reconstructState(previous: Uint8Array | undefined, diff: Uint8Array): Uint8Array {
   const diffBuf = Buffer.from(diff);
   const prevBuf = previous ? Buffer.from(previous) : Buffer.alloc(0);
   const out: number[] = [];
   for (let i = 0; i < diffBuf.length; i++) {
      const prevByte = i < prevBuf.length ? prevBuf.readUInt8(i) : 0;
      out.push(prevByte ^ diffBuf.readUInt8(i));
   }
   return Uint8Array.from(out);
}

/**
 * Reinterprets a reconstructed byte buffer as a *column-major* array of uint64 values - 8 bytes
 * per value, byte `j` of value `i` stored at `bytes[i + j*size]`, not the usual per-value-
 * contiguous layout - confirmed against RLE_Data::Encode(const ArrayOfUInts64&)/Decode(...,
 * ArrayOfUInts64&) (RLE.cpp:245-266/268-282; the encode-side comment there spells out why: it lets
 * the initial RLE pass benefit from same-valued high bytes across entries, e.g. every offset's
 * high bytes being zero). GAP_STATUS/REQ_STATUS both carry this shape - a flat, even-length list
 * of values that's really consecutive (start, end) pairs (CPartFile_Encoder::Encode(),
 * ExternalConn.cpp:3263-3264/3284-3285).
 */
function bytesToByteRanges(bytes: Uint8Array): readonly ByteRange[] {
   const buffer = Buffer.from(bytes);
   const size = Math.floor(buffer.length / 8);
   const values: bigint[] = [];
   for (let i = 0; i < size; i++) {
      let value = 0n;
      for (let j = 8; j-- > 0;) {
         value = (value << 8n) | BigInt(buffer.readUInt8(i + j * size));
      }
      values.push(value);
   }
   const ranges: ByteRange[] = [];
   for (let i = 0; i + 1 < values.length; i += 2) {
      const [start, end] = values.slice(i, i + 2);
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
   }
   return ranges;
}

/**
 * Reinterprets a reconstructed byte buffer as a per-part source-availability count - one byte
 * (0-255) per file part, already truncated to a byte on the encode side
 * (RLE_Data::Encode(const ArrayOfUInts16&), RLE.cpp:226-243) so no further grouping is needed,
 * unlike the uint64 ranges above.
 */
function bytesToPartAvailability(bytes: Uint8Array): readonly number[] {
   return Array.from(bytes);
}

type StatusKind = "gap" | "req" | "part";

/**
 * Per-connection, per-ecid, per-field accumulation of GAP_STATUS/REQ_STATUS/PART_STATUS - the
 * same "hide the protocol's stateful delta encoding" shape PartFileSourceNames.ts already uses
 * for sourceNames (see its class doc for the general rationale), but with a real difference this
 * field family doesn't share: *whether* a response is a delta at all depends on which opcode
 * produced it, not just which connection it's on.
 *
 * Get_EC_Response_GetDownloadQueue and Get_EC_Response_GetSharedFiles (what Downloads.fetch()/
 * SharedFiles.fetch() use, always at EC_DETAIL_CMD) call `enc->ResetEncoder()` immediately before
 * `enc->Encode()` whenever the request isn't at EC_DETAIL_UPDATE (ExternalConn.cpp:1818-1819/
 * 2172-2173) - and CPartFile_Encoder::ResetEncoder() *does* clear m_gap_status/m_req_status (and
 * the base class's m_enc_data behind PART_STATUS), unlike its m_sourcenameItemMap oversight
 * (ExternalConn.cpp:3359-3363). So on that path, whatever bytes arrive are XORed against a
 * just-emptied buffer daemon-side - i.e. they *are* the absolute value, not a diff. Get_EC_
 * Response_GetUpdate (what Update.fetch() uses) never resets anything (ExternalConn.cpp:1911-
 * 2076) - its bytes are a genuine diff against whatever this connection's encoder last held, from
 * *any* of the three opcodes.
 *
 * resolve() below always XORs onto the cache (the Update.fetch() case). `resetsEncoder` lets a
 * caller that knows the daemon just reset - Downloads.fetch()/SharedFiles.fetch() - forget the
 * stale cached state first, so their own resolve() call starts from zero and the result is
 * correct either way.
 */
const byConnection = new WeakMap<ECConnection, Map<string, Uint8Array>>();

function cacheKey(kind: StatusKind, ecid: bigint): string {
   return `${kind}:${ecid}`;
}

function cacheFor(connection: ECConnection): Map<string, Uint8Array> {
   let cache = byConnection.get(connection);
   if (!cache) {
      cache = new Map();
      byConnection.set(connection, cache);
   }
   return cache;
}

function resolveBytes(
   kind: StatusKind,
   tagName: ECTagNames,
   tag: ECTag,
   connection: ECConnection | undefined,
   ecid: bigint | undefined,
   resetsEncoder: boolean,
): Uint8Array | undefined {
   const raw = tag.childBytes(tagName);
   const diff = raw ? rleDecodeDiff(raw) : undefined;
   if (connection === undefined || ecid === undefined) return diff;
   const key = cacheKey(kind, ecid);
   const cache = cacheFor(connection);
   if (resetsEncoder) cache.delete(key);
   if (diff !== undefined) {
      cache.set(key, reconstructState(cache.get(key), diff));
   }
   return cache.get(key);
}

/** See the class doc above `byConnection` for `resetsEncoder`'s meaning. */
export function resolveGaps(
   tag: ECTag,
   connection: ECConnection | undefined,
   ecid: bigint | undefined,
   resetsEncoder: boolean,
): readonly ByteRange[] | undefined {
   const bytes = resolveBytes("gap", ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, tag, connection, ecid, resetsEncoder);
   return bytes === undefined ? undefined : bytesToByteRanges(bytes);
}

/** See the class doc above `byConnection` for `resetsEncoder`'s meaning. */
export function resolveRequestedRanges(
   tag: ECTag,
   connection: ECConnection | undefined,
   ecid: bigint | undefined,
   resetsEncoder: boolean,
): readonly ByteRange[] | undefined {
   const bytes = resolveBytes("req", ECTagNames.EC_TAG_PARTFILE_REQ_STATUS, tag, connection, ecid, resetsEncoder);
   return bytes === undefined ? undefined : bytesToByteRanges(bytes);
}

/** See the class doc above `byConnection` for `resetsEncoder`'s meaning. */
export function resolvePartAvailability(
   tag: ECTag,
   connection: ECConnection | undefined,
   ecid: bigint | undefined,
   resetsEncoder: boolean,
): readonly number[] | undefined {
   const bytes = resolveBytes("part", ECTagNames.EC_TAG_PARTFILE_PART_STATUS, tag, connection, ecid, resetsEncoder);
   return bytes === undefined ? undefined : bytesToPartAvailability(bytes);
}

/** Forgets everything accumulated for one file on one connection - call once it leaves the queue, so a later ecid reuse can't inherit a stale history (mirrors PartFileSourceNames.ts's forgetSourceNames()). */
export function forgetPartFileStatus(connection: ECConnection, ecid: bigint): void {
   const cache = byConnection.get(connection);
   if (!cache) return;
   let forgotAny = false;
   for (const kind of ["gap", "req", "part"] as const) {
      forgotAny = cache.delete(cacheKey(kind, ecid)) || forgotAny;
   }
   if (forgotAny) debug("forgetPartFileStatus: ecid=%s", ecid);
}
