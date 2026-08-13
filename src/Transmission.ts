import { ECFlags } from "./ECFlags.js";

export class TransmissionHeader {
   public static readonly SIZE = 8;

   public readonly flags: number;
   public readonly bodyLength: number;

   public constructor(flags: number, bodyLength: number) {
      ECFlags.validate(flags);
      TransmissionHeader.validateUint32(bodyLength, "bodyLength");
      this.flags = flags >>> 0;
      this.bodyLength = bodyLength >>> 0;
   }

   public encode(): Buffer {
      const buffer = Buffer.allocUnsafe(TransmissionHeader.SIZE);
      buffer.writeUInt32BE(this.flags, 0);
      buffer.writeUInt32BE(this.bodyLength, 4);
      return buffer;
   }

   public static decode(buffer: Uint8Array): TransmissionHeader {
      if (buffer.byteLength < TransmissionHeader.SIZE) {
         throw new RangeError(`Transmission header requires ${TransmissionHeader.SIZE} bytes (${buffer.byteLength} provided).`);
      }
      const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      return new TransmissionHeader(view.readUInt32BE(0), view.readUInt32BE(4));
   }

   public get packetLength(): number {
      return TransmissionHeader.SIZE + this.bodyLength;
   }

   public get compressed(): boolean {
      return ECFlags.isCompressed(this.flags);
   }

   public get utf8Numbers(): boolean {
      return ECFlags.usesUtf8Numbers(this.flags);
   }

   public get largeTagCount(): boolean {
      return ECFlags.usesLargeTagCount(this.flags);
   }

   private static validateUint32(value: number, name: string): void {
      if (!Number.isInteger(value)) {
         throw new TypeError(`${name} must be an integer.`);
      }
      if (value < 0 || value > 0xffffffff) {
         throw new RangeError(`${name} must be in [0, 2^32-1].`);
      }
   }
}
