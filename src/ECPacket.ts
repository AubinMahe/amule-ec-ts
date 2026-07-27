import { debuglog } from "node:util";
import { ECOpcode } from "./ECOpcode.js";
import { ECCapabilities } from "./ECCapabilities.js";
import { ECTag, ECTagDecoder, encodeCount } from "./ECTags.js";

const debug = debuglog("amule-ec:packet");

export class ECPacket {

   public readonly opcode: ECOpcode;
   public readonly tags: ECTag[] = [];

   public constructor(opcode: ECOpcode) {
      this.opcode = opcode;
   }

   public add(tag: ECTag): this {
      this.tags.push(tag);
      return this;
   }

   /** Finds the first top-level tag with the given name, if any. */
   public find(name: number): ECTag | undefined {
      return this.tags.find((tag) => tag.name === name);
   }

   /** Returns whether a top-level tag with the given name is present. */
   public has(name: number): boolean {
      return this.find(name) !== undefined;
   }

   /**
    * Encodes this packet's application-layer bytes (OPCODE, TAGCOUNT, and
    * the tag tree), using `capabilities` to decide whether integers use
    * UTF-8 number encoding and whether TAGCOUNT fields may use the
    * sentinel-extended form. Note that zlib compression, if any, is applied
    * separately at the transmission layer (see ECConnection.send).
    */
   public encode(capabilities: ECCapabilities): Buffer {
      const opcodeBuffer = Buffer.from([this.opcode]);
      const countBuffer = encodeCount(this.tags.length, capabilities);
      const tagsBuffer = Buffer.concat(
         this.tags.map((tag) => tag.encode(capabilities)),
      );
      return Buffer.concat([opcodeBuffer, countBuffer, tagsBuffer]);
   }

   /**
    * Decodes application-layer bytes (already zlib-decompressed, if
    * applicable) into an ECPacket. `capabilities` must reflect the encoding
    * that was actually used for this buffer (typically derived from the
    * transmission-layer flags of the packet that carried it).
    */
   public static decode(
      buffer: Uint8Array,
      capabilities: ECCapabilities,
   ): ECPacket {
      const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const decoder = new ECTagDecoder(data, capabilities);
      const opcode: ECOpcode = decoder.readByte();
      debug("decode: opcode=%s", ECOpcode[opcode]);
      const count = decoder.readCount();
      const packet = new ECPacket(opcode);
      for (let i = 0; i < count; i++) {
         packet.add(decoder.readTag([opcode]));
      }
      return packet;
   }
}
