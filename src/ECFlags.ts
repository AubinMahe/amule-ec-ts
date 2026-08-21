export const enum ECFlag {
   /**
    * 1 << 0
    */
   ZLIB = 1,
   /**
    * 1 << 1
    */
   UTF8_NUMBERS = 2,
   /**
    * 1 << 4
    */
   LARGE_TAG_COUNT = 16,
   /**
    * 1 << 5
    */
   PROTOCOL_MARKER = 32,
}

const VALIDATION_MASK = (1 << 5) | (1 << 6);

const RESERVED_MASK = ~(ECFlag.ZLIB | ECFlag.UTF8_NUMBERS | ECFlag.LARGE_TAG_COUNT | ECFlag.PROTOCOL_MARKER) >>> 0;

function has(flags: number, flag: ECFlag): boolean {
   return (flags & flag) !== 0;
}

function set(flags: number, flag: ECFlag): number {
   return flags | flag;
}

function clear(flags: number, flag: ECFlag): number {
   return flags & ~flag;
}

export const ECFlags = {
   DEFAULT: ECFlag.PROTOCOL_MARKER,
   VALIDATION_MASK,
   RESERVED_MASK,

   create(compressed = false, utf8Numbers = false, largeTagCount = false): number {
      let flags: number = ECFlags.DEFAULT;
      flags = compressed ? set(flags, ECFlag.ZLIB) : clear(flags, ECFlag.ZLIB);
      flags = utf8Numbers ? set(flags, ECFlag.UTF8_NUMBERS) : clear(flags, ECFlag.UTF8_NUMBERS);
      flags = largeTagCount ? set(flags, ECFlag.LARGE_TAG_COUNT) : clear(flags, ECFlag.LARGE_TAG_COUNT);
      return flags;
   },

   isCompressed(flags: number): boolean {
      return has(flags, ECFlag.ZLIB);
   },

   usesUtf8Numbers(flags: number): boolean {
      return has(flags, ECFlag.UTF8_NUMBERS);
   },

   usesLargeTagCount(flags: number): boolean {
      return has(flags, ECFlag.LARGE_TAG_COUNT);
   },

   enableCompression(flags: number): number {
      return set(flags, ECFlag.ZLIB);
   },

   disableCompression(flags: number): number {
      return clear(flags, ECFlag.ZLIB);
   },

   enableUtf8Numbers(flags: number): number {
      return set(flags, ECFlag.UTF8_NUMBERS);
   },

   disableUtf8Numbers(flags: number): number {
      return clear(flags, ECFlag.UTF8_NUMBERS);
   },

   enableLargeTagCount(flags: number): number {
      return set(flags, ECFlag.LARGE_TAG_COUNT);
   },

   disableLargeTagCount(flags: number): number {
      return clear(flags, ECFlag.LARGE_TAG_COUNT);
   },

   hasValidMarker(flags: number): boolean {
      const marker: ECFlag = flags & VALIDATION_MASK;
      return marker === ECFlag.PROTOCOL_MARKER;
   },

   hasReservedBitsClear(flags: number): boolean {
      return (flags & RESERVED_MASK) === 0;
   },

   validate(flags: number): void {
      if (!ECFlags.hasValidMarker(flags)) {
         throw new Error("Invalid EC protocol marker.");
      }
      if (!ECFlags.hasReservedBitsClear(flags)) {
         throw new Error("Reserved EC flag bits are set.");
      }
   },
};
