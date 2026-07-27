import { debuglog } from "node:util";
import { ECTagType } from "./ECTagType.js";
import { ECCapabilities } from "./ECCapabilities.js";
import { ECTagNames } from "./ECTagNames.js";

const debug = debuglog("amule-ec:tags");

/**
 * Base class of all EC tags.
 */
export abstract class ECTag {

   public readonly name: number;
   public readonly children: readonly ECTag[];

   protected constructor(name: number, children: readonly ECTag[] = []) {
      this.name = name;
      this.children = children;
   }

   public abstract get type(): ECTagType;

   /** Reads this tag's integer value, whatever its concrete subtype - undefined if it doesn't have one. */
   public get intValue(): bigint | undefined {
      const value = (this as { value?: bigint }).value;
      return typeof value === "bigint" ? value : undefined;
   }

   public findChild(name: number): ECTag | undefined {
      return this.children.find((child) => child.name === name);
   }

   public childString(name: number): string | undefined {
      const child = this.findChild(name);
      return child instanceof ECStringTag ? child.value : undefined;
   }

   public childInt(name: number): bigint | undefined {
      return this.findChild(name)?.intValue;
   }

   /**
    * Encodes this tag's full entry: TAGNAME, TAGTYPE, TAGLEN, optional
    * child TAGCOUNT + children, then the tag's own data.
    *
    * TAGLEN itself does NOT count the child-TAGCOUNT field's own bytes -
    * confirmed against CECTag::GetTagLen()/WriteTag()
    * (/home/aubin/Dev/git/amule/src/libs/ec/cpp/ECTag.cpp:469-498,625-648):
    * GetTagLen() sums `m_dataLen` (own data) plus, per child, that child's
    * own GetTagLen() *and* the child's TAGNAME/TAGTYPE/TAGLEN header size -
    * never this tag's own TAGCOUNT field, even though WriteTag() physically
    * writes those TAGCOUNT bytes right after TAGLEN (via WriteChildren()).
    * Including childCountBuffer.length here (as an earlier version of this
    * method did) desynchronizes TAGLEN from the actual byte layout for any
    * tag that has children - previously invisible, since no request built
    * by this client carried children until Search.ts's composite
    * EC_TAG_SEARCH_TYPE request tag: the resulting corrupt TAGLEN made the
    * daemon's parser lose byte-accounting for the rest of the packet, and
    * it dropped the connection outright (no EC_OP_FAILED, just a close).
    */
   public encode(caps: ECCapabilities): Buffer {
      const hasChildren = this.children.length > 0;
      const nameBuffer = encodeTagName(this.name, hasChildren, caps);
      const typeBuffer = Buffer.from([this.type]);
      let childCountBuffer: Buffer = RESULT_EMPTY;
      let childrenBuffer: Buffer = RESULT_EMPTY;
      if (hasChildren) {
         childCountBuffer = encodeCount(this.children.length, caps);
         childrenBuffer = Buffer.concat(
            this.children.map((child) => child.encode(caps)),
         );
      }
      const dataBuffer = this.encodeOwnData(caps);
      const tagLen = childrenBuffer.length + dataBuffer.length;
      const lenBuffer = encodeTagLen(tagLen, caps);
      return Buffer.concat([
         nameBuffer,
         typeBuffer,
         lenBuffer,
         childCountBuffer,
         childrenBuffer,
         dataBuffer,
      ]);
   }

   private encodeOwnData(caps: ECCapabilities): Buffer {
      switch (this.type) {
         case ECTagType.UINT8:
         case ECTagType.UINT16:
         case ECTagType.UINT32:
         case ECTagType.UINT64: {
            const value = (this as unknown as ECIntegerTag).value;
            return encodeUint(value, fixedWidthFor(this.type), caps);
         }
         case ECTagType.UINT128: {
            const value = (this as unknown as ECUInt128Tag).value;
            return encodeUint(value, 16, caps);
         }
         case ECTagType.STRING:
            return encodeCString((this as unknown as ECStringTag).value);
         case ECTagType.DOUBLE:
            // Floating point values are transported as their string
            // representation, always using '.' as the decimal separator.
            return encodeCString(
               (this as unknown as ECDoubleTag).value.toString(),
            );
         case ECTagType.HASH16:
            return Buffer.from((this as unknown as ECHash16Tag).value);
         case ECTagType.IPV4: {
            const ip = this as unknown as ECIPv4Tag;
            const portBuffer = Buffer.alloc(2);
            portBuffer.writeUInt16BE(ip.port, 0);
            return Buffer.concat([Buffer.from(ip.address), portBuffer]);
         }
         case ECTagType.CUSTOM:
            return Buffer.from((this as unknown as ECCustomTag).value);
         default:
            throw new Error(`Cannot encode unknown tag type ${this.type}.`);
      }
   }
}

/**
 * Base class for integer tags.
 */
abstract class ECIntegerTag extends ECTag {

   public readonly value: bigint;

   protected constructor(
      name: number,
      value: bigint,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
      this.value = value;
   }
}

export class ECUInt8Tag extends ECIntegerTag {

   public constructor(
      name: number,
      value: number,
      children: readonly ECTag[] = [],
   ) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff) {
         throw new RangeError("UINT8 value out of range.");
      }
      super(name, BigInt(value), children);
   }

   public override get type(): ECTagType {
      return ECTagType.UINT8;
   }
}

export class ECUInt16Tag extends ECIntegerTag {

   public constructor(
      name: number,
      value: number,
      children: readonly ECTag[] = [],
   ) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
         throw new RangeError("UINT16 value out of range.");
      }
      super(name, BigInt(value), children);
   }

   public override get type(): ECTagType {
      return ECTagType.UINT16;
   }
}

export class ECUInt32Tag extends ECIntegerTag {

   public constructor(
      name: number,
      value: number,
      children: readonly ECTag[] = [],
   ) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
         throw new RangeError("UINT32 value out of range.");
      }
      super(name, BigInt(value), children);
   }

   public override get type(): ECTagType {
      return ECTagType.UINT32;
   }
}

export class ECUInt64Tag extends ECIntegerTag {

   public constructor(
      name: number,
      value: bigint,
      children: readonly ECTag[] = [],
   ) {
      if (value < 0n || value > 0xffffffffffffffffn) {
         throw new RangeError("UINT64 value out of range.");
      }
      super(name, value, children);
   }

   public override get type(): ECTagType {
      return ECTagType.UINT64;
   }
}

class ECUInt128Tag extends ECTag {

   public readonly value: bigint;

   public constructor(
      name: number,
      value: bigint,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
      if (value < 0n || value >= 1n << 128n) {
         throw new RangeError("UINT128 value out of range.");
      }
      this.value = value;
   }

   public override get type(): ECTagType {
      return ECTagType.UINT128;
   }
}

export class ECStringTag extends ECTag {

   public constructor(
      name: number,
      public readonly value: string,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
   }

   public override get type(): ECTagType {
      return ECTagType.STRING;
   }
}

class ECDoubleTag extends ECTag {

   public constructor(
      name: number,
      public readonly value: number,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
   }

   public override get type(): ECTagType {
      return ECTagType.DOUBLE;
   }
}

export class ECHash16Tag extends ECTag {

   public constructor(
      name: number,
      public readonly value: Uint8Array,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
      if (value.length !== 16) {
         throw new RangeError("HASH16 must contain exactly 16 bytes.");
      }
   }

   public override get type(): ECTagType {
      return ECTagType.HASH16;
   }
}

export class ECIPv4Tag extends ECTag {

   public constructor(
      name: number,
      public readonly address: Uint8Array,
      public readonly port: number,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
      if (address.length !== 4) {
         throw new RangeError("IPv4 address must contain exactly 4 bytes.");
      }
      if (!Number.isInteger(port) || port < 0 || port > 0xffff) {
         throw new RangeError("Port out of range.");
      }
   }

   public override get type(): ECTagType {
      return ECTagType.IPV4;
   }
}

export class ECCustomTag extends ECTag {

   public constructor(
      name: number,
      public readonly value: Uint8Array,
      children: readonly ECTag[] = [],
   ) {
      super(name, children);
   }

   public override get type(): ECTagType {
      return ECTagType.CUSTOM;
   }
}

/**
 * Wire-level encoding/decoding helpers for the EC application layer.
 *
 * These implement:
 *  - fixed-width big-endian integers,
 *  - the "UTF-8 numbers" variable-length encoding (EC_FLAG_UTF8_NUMBERS),
 *  - sentinel-extended TAGCOUNT fields (EC_FLAG_LARGE_TAG_COUNT),
 *  - and the recursive tag tree structure described in the EC protocol
 *    documentation (TAGNAME/TAGTYPE/TAGLEN/<children>/<data>).
 *
 * NOTE ON UTF-8 NUMBER ENCODING: the protocol documentation only shows a
 * worked example for a small (11-bit) value. To support the full range of
 * integers the protocol allows (up to 64-bit, and 128-bit for hash-like
 * tags), this implementation extends the same leading-ones/continuation-byte
 * scheme up to 7 bytes (36 bits of capacity), and falls back to a explicit
 * length-prefixed escape (leading byte 0xFF, followed by a length byte and
 * that many raw big-endian bytes) for anything larger. This keeps every
 * value round-trippable through this library while remaining byte-for-byte
 * compatible with the documented example.
 */

const RESULT_EMPTY = Buffer.alloc(0);

/**
 * Thrown by decodeTag/ECPacket.decode with enough context (the tag-name
 * path from the packet root, the byte offset, and a small hex dump around
 * it) to diagnose a malformed or misunderstood wire format without having
 * to manually recount bytes in a raw hex dump.
 */
class ECDecodeError extends Error {

   private static hexAround(buffer: Buffer, offset: number, radius = 12): string {
      const start = Math.max(0, offset - radius);
      const end = Math.min(buffer.length, offset + radius);
      const parts: string[] = [];
      for (const [relativeIndex, byte] of buffer.subarray(start, end).entries()) {
         const byteHex = byte.toString(16).padStart(2, "0");
         parts.push(start + relativeIndex === offset ? `[${byteHex}]` : byteHex);
      }
      return parts.join(" ");
   }

   public constructor(
      message: string,
      public readonly path: number[],
      public readonly offset: number,
      buffer: Buffer,
   ) {
      super(
         `${message}\n` +
            `  tag path (root -> here): [${path.join(" -> ")}]\n` +
            `  byte offset: ${offset} / ${buffer.length}\n` +
            `  bytes around offset: ${ECDecodeError.hexAround(buffer, offset)}`,
      );
      this.name = "ECDecodeError";
   }
}

function writeBigUIntBE(value: bigint, width: number): Buffer {
   const buffer = Buffer.alloc(width);
   let remaining = value;
   for (let i = width - 1; i >= 0; i--) {
      buffer[i] = Number(remaining & 0xffn);
      remaining >>= 8n;
   }
   return buffer;
}

function readBigUIntBE(buffer: Buffer): bigint {
   let value = 0n;
   for (const byte of buffer) {
      value = (value << 8n) | BigInt(byte);
   }
   return value;
}

function utf8EncodeNumber(value: bigint): Buffer {
   if (value < 0n) {
      throw new RangeError("Cannot UTF8-encode a negative number.");
   }
   if (value <= 0x7fn) {
      return Buffer.from([Number(value)]);
   }
   for (let n = 2; n <= 7; n++) {
      const dataBits = 5 * n + 1;
      const capacity = (1n << BigInt(dataBits)) - 1n;
      if (value <= capacity) {
         const bin = value.toString(2).padStart(dataBits, "0");
         const leadDataBits = 7 - n;
         const leadBits = leadDataBits > 0 ? bin.slice(0, leadDataBits) : "";
         const contBits = bin.slice(leadDataBits);
         const leadPrefix = "1".repeat(n) + "0";
         const leadByte = parseInt(leadPrefix + leadBits, 2);
         const bytes: number[] = [leadByte];
         for (let i = 0; i < contBits.length; i += 6) {
            bytes.push(parseInt("10" + contBits.substring(i, i + 6), 2));
         }
         return Buffer.from(bytes);
      }
   }
   // Escape sequence for values beyond 36 bits (e.g. UINT64/UINT128 values).
   let hex = value.toString(16);
   if (hex.length % 2 === 1) hex = "0" + hex;
   const raw = Buffer.from(hex, "hex");
   if (raw.length > 0xff) {
      throw new RangeError("Value too large to UTF8-encode.");
   }
   return Buffer.concat([Buffer.from([0xff, raw.length]), raw]);
}

function utf8DecodeNumber(
   buffer: Buffer,
   offset: number,
): { value: bigint; bytesRead: number } {
   const first = buffer[offset];
   if (first === undefined) {
      throw new RangeError("Buffer underrun while decoding a UTF8 number.");
   }
   if (first === 0xff) {
      const len = buffer[offset + 1];
      if (len === undefined) {
         throw new RangeError(
            "Buffer underrun while decoding a UTF8 number's escape length.",
         );
      }
      const raw = buffer.subarray(offset + 2, offset + 2 + len);
      return { value: readBigUIntBE(Buffer.from(raw)), bytesRead: 2 + len };
   }
   if ((first & 0x80) === 0) {
      return { value: BigInt(first), bytesRead: 1 };
   }
   let n = 0;
   let mask = 0x80;
   while ((first & mask) !== 0) {
      n++;
      mask >>= 1;
   }
   const leadDataBits = 7 - n;
   let bits = "";
   if (leadDataBits > 0) {
      const leadMask = (1 << leadDataBits) - 1;
      bits += (first & leadMask).toString(2).padStart(leadDataBits, "0");
   }
   for (let i = 1; i < n; i++) {
      const b = buffer[offset + i];
      if (b === undefined) {
         throw new RangeError("Buffer underrun while decoding a UTF8 number.");
      }
      bits += (b & 0x3f).toString(2).padStart(6, "0");
   }
   const value = bits.length > 0 ? BigInt("0b" + bits) : 0n;
   return { value, bytesRead: n };
}

function encodeUint(
   value: bigint,
   width: number,
   caps: ECCapabilities,
): Buffer {
   return caps.utf8Numbers
      ? utf8EncodeNumber(value)
      : writeBigUIntBE(value, width);
}

function decodeUint(
   buffer: Buffer,
   offset: number,
   width: number,
   caps: ECCapabilities,
): { value: bigint; bytesRead: number } {
   if (caps.utf8Numbers) {
      return utf8DecodeNumber(buffer, offset);
   }
   const slice = buffer.subarray(offset, offset + width);
   return { value: readBigUIntBE(Buffer.from(slice)), bytesRead: width };
}

/** Encodes a TAGNAME field: (actual_code << 1) | has_children. */
function encodeTagName(
   name: number,
   hasChildren: boolean,
   caps: ECCapabilities,
): Buffer {
   const raw = BigInt((name << 1) | (hasChildren ? 1 : 0));
   return encodeUint(raw, 2, caps);
}

function decodeTagName(
   buffer: Buffer,
   offset: number,
   caps: ECCapabilities,
): { name: number; hasChildren: boolean; bytesRead: number } {
   const { value, bytesRead } = decodeUint(buffer, offset, 2, caps);
   const raw = Number(value);
   return { name: raw >>> 1, hasChildren: (raw & 1) === 1, bytesRead };
}

/** Encodes a TAGLEN field (uint32 byte count). */
function encodeTagLen(length: number, caps: ECCapabilities): Buffer {
   return encodeUint(BigInt(length), 4, caps);
}

function decodeTagLen(
   buffer: Buffer,
   offset: number,
   caps: ECCapabilities,
): { length: number; bytesRead: number } {
   const { value, bytesRead } = decodeUint(buffer, offset, 4, caps);
   return { length: Number(value), bytesRead };
}

/**
 * Encodes a TAGCOUNT field, using the sentinel-extended (0xFFFF + uint32)
 * form when EC_FLAG_LARGE_TAG_COUNT is in effect and the count doesn't fit
 * in the normal 16-bit field.
 */
export function encodeCount(count: number, caps: ECCapabilities): Buffer {
   if (count >= 0xffff) {
      if (!caps.largeTagCount) {
         throw new RangeError(
            "Tag count exceeds 0xFFFE and EC_FLAG_LARGE_TAG_COUNT is not enabled.",
         );
      }
      const sentinel = encodeUint(0xffffn, 2, caps);
      const extended = encodeUint(BigInt(count), 4, caps);
      return Buffer.concat([sentinel, extended]);
   }
   return encodeUint(BigInt(count), 2, caps);
}

function decodeCount(
   buffer: Buffer,
   offset: number,
   caps: ECCapabilities,
): { count: number; bytesRead: number } {
   const { value: raw, bytesRead: sentinelBytes } = decodeUint(
      buffer,
      offset,
      2,
      caps,
   );
   if (caps.largeTagCount && raw === 0xffffn) {
      const { value: extended, bytesRead: extendedBytes } = decodeUint(
         buffer,
         offset + sentinelBytes,
         4,
         caps,
      );
      return {
         count: Number(extended),
         bytesRead: sentinelBytes + extendedBytes,
      };
   }
   return { count: Number(raw), bytesRead: sentinelBytes };
}

function fixedWidthFor(type: ECTagType): number {
   switch (type) {
      case ECTagType.UINT8:
         return 1;
      case ECTagType.UINT16:
         return 2;
      case ECTagType.UINT32:
         return 4;
      case ECTagType.UINT64:
         return 8;
      case ECTagType.UINT128:
         return 16;
      default:
         throw new Error(`Tag type ${type} is not an integer type.`);
   }
}

function encodeCString(value: string): Buffer {
   return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function decodeCString(data: Buffer): string {
   let end = data.length;
   if (end > 0 && data[end - 1] === 0) end--;
   return data.subarray(0, end).toString("utf8");
}

/**
 * Decodes a tag tree out of a buffer, tracking the read cursor internally
 * so callers don't have to thread an offset through and manually add up
 * every bytesRead - the wire format needs one (a top-level tag or a
 * child's own data can't be sliced without knowing where the previous
 * field ended), so something has to own it; this is that something.
 */
export class ECTagDecoder {

   private offset = 0;

   public constructor(
      private readonly buffer: Buffer,
      private readonly caps: ECCapabilities,
   ) {}

   /** Reads a single raw byte (e.g. the packet's OPCODE) and advances past it. */
   public readByte(): number {
      const byte = this.buffer[this.offset];
      if (byte === undefined) {
         throw new RangeError(
            `Buffer underrun: no byte to read at offset ${this.offset} (length ${this.buffer.length}).`,
         );
      }
      this.offset += 1;
      return byte;
   }

   public readCount(): number {
      const { count, bytesRead } = decodeCount(
         this.buffer,
         this.offset,
         this.caps,
      );
      this.offset += bytesRead;
      return count;
   }

   // Integer tag data is read directly via readBigUIntBE/utf8 decode below,
   // this helper mirrors decodeUint's fixed-width path for pre-sliced data.
   private readBigUIntOrUtf8(data: Buffer): bigint {
      if (this.caps.utf8Numbers) {
         return utf8DecodeNumber(data, 0).value;
      }
      return readBigUIntBE(data);
   }

   private tagFactory(
      name: number,
      type: ECTagType,
      data: Buffer,
      children: ECTag[],
   ): ECTag {
      switch (type) {
         case ECTagType.UINT8:
            return new ECUInt8Tag(
               name,
               Number(this.readBigUIntOrUtf8(data)),
               children,
            );
         case ECTagType.UINT16:
            return new ECUInt16Tag(
               name,
               Number(this.readBigUIntOrUtf8(data)),
               children,
            );
         case ECTagType.UINT32:
            return new ECUInt32Tag(
               name,
               Number(this.readBigUIntOrUtf8(data)),
               children,
            );
         case ECTagType.UINT64:
            return new ECUInt64Tag(
               name,
               this.readBigUIntOrUtf8(data),
               children,
            );
         case ECTagType.UINT128:
            return new ECUInt128Tag(
               name,
               this.readBigUIntOrUtf8(data),
               children,
            );
         case ECTagType.STRING:
            return new ECStringTag(name, decodeCString(data), children);
         case ECTagType.DOUBLE:
            return new ECDoubleTag(
               name,
               parseFloat(decodeCString(data)),
               children,
            );
         case ECTagType.HASH16:
            return new ECHash16Tag(name, new Uint8Array(data), children);
         case ECTagType.IPV4: {
            if (data.length < 6) {
               throw new RangeError(
                  `IPV4 tag data must be at least 6 bytes (4 for address + 2 for port), got ${data.length}.`,
               );
            }
            const address = new Uint8Array(data.subarray(0, 4));
            const port = data.readUInt16BE(4);
            return new ECIPv4Tag(name, address, port, children);
         }
         case ECTagType.CUSTOM:
            return new ECCustomTag(name, new Uint8Array(data), children);
         default:
            throw new Error(`Cannot decode unknown tag type ${type}.`);
      }
   }

   /**
    * Decodes a single tag entry (and, recursively, all of its children) at
    * the current cursor position, advancing past it.
    *
    * `path` is the chain of tag names from the packet root down to (but
    * not including) this tag, used only to build a readable location in
    * ECDecodeError if something goes wrong.
    */
   public readTag(path: number[] = []): ECTag {
      if (this.offset >= this.buffer.length) {
         throw new ECDecodeError(
            "Ran out of bytes while expecting a tag header (TAGNAME).",
            path,
            this.offset,
            this.buffer,
         );
      }
      const {
         name,
         hasChildren,
         bytesRead: nameBytes,
      } = decodeTagName(this.buffer, this.offset, this.caps);
      debug("tag: %s, hasChildren: %s", ECTagNames[name] ?? ("0x" + name.toString(16)), hasChildren);
      this.offset += nameBytes;
      const here = [...path, name];
      if (this.offset >= this.buffer.length) {
         throw new ECDecodeError(
            "Ran out of bytes while expecting TAGTYPE.",
            here,
            this.offset,
            this.buffer,
         );
      }
      const type = this.buffer[this.offset] as ECTagType;
      this.offset += 1;
      const { length: tagLen, bytesRead: lenBytes } = decodeTagLen(
         this.buffer,
         this.offset,
         this.caps,
      );
      this.offset += lenBytes;
      let childCountBytes = 0;
      let childrenBytes = 0;
      const children: ECTag[] = [];
      if (hasChildren) {
         const { count, bytesRead } = decodeCount(
            this.buffer,
            this.offset,
            this.caps,
         );
         childCountBytes = bytesRead;
         this.offset += childCountBytes;
         for (let i = 0; i < count; i++) {
            const childStart = this.offset;
            children.push(this.readTag(here));
            childrenBytes += this.offset - childStart;
         }
      }
      const ownDataLen = tagLen - childrenBytes;
      debug(
         "%s: type=%s, tagLen=%d, childCountBytes=%d, childrenBytes=%d, ownDataLen=%d, cursorBeforeOwnData=%d",
         ECTagNames[name] ?? ("0x" + name.toString(16)),
         ECTagType[type],
         tagLen,
         childCountBytes,
         childrenBytes,
         ownDataLen,
         this.offset,
      );
      if (ownDataLen < 0) {
         throw new ECDecodeError(
            `Computed a negative own-data length (TAGLEN=${tagLen}, childCountBytes=${childCountBytes}, childrenBytes=${childrenBytes}).`,
            here,
            this.offset,
            this.buffer,
         );
      }
      if (this.offset + ownDataLen > this.buffer.length) {
         throw new ECDecodeError(
            `TAGTYPE ${type} own-data length (${ownDataLen} bytes) runs past the end of the buffer.`,
            here,
            this.offset,
            this.buffer,
         );
      }
      const data = Buffer.from(
         this.buffer.subarray(this.offset, this.offset + ownDataLen),
      );
      let tag: ECTag;
      try {
         tag = this.tagFactory(name, type, data, children);
      } catch (error) {
         const reason = error instanceof Error ? error.message : String(error);
         throw new ECDecodeError(
            `Failed to construct tag of TAGTYPE ${type} from ${data.length} byte(s) of own data: ${reason}`,
            here,
            this.offset,
            this.buffer,
         );
      }
      this.offset += ownDataLen;
      return tag;
   }
}
