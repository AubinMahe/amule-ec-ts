import { expect } from "chai";
import * as ec from "../src/index.js";

/**
 * Deterministic, seedable PRNG (mulberry32) - a fixed seed keeps a failure reproducible across
 * runs instead of depending on Math.random(), while adding no dependency of its own.
 */
function mulberry32(seed: number): () => number {
   let state = seed;
   return function (): number {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
   };
}

function randomByte(rng: () => number): number {
   return Math.floor(rng() * 256);
}

/**
 * Picks a random element of a known-non-empty array without a non-null assertion - throwing
 * (rather than returning `undefined`) is unreachable for every call site below, all of which pass
 * a fixed, non-empty array.
 */
function pick<T>(rng: () => number, items: readonly T[]): T {
   const item = items[Math.floor(rng() * items.length)];
   if (item === undefined) {
      throw new Error("pick() called on an empty array.");
   }
   return item;
}

function randomBytes(rng: () => number, length: number): Buffer {
   return Buffer.from(Array.from({ length }, () => randomByte(rng)));
}

/**
 * A handful of validly encoded packets covering every tag type this library defines and a few
 * levels of nesting - the seeds the mutators below start from, encoded once per capability set
 * so decode() is always exercised with the same flags the buffer was actually encoded under.
 */
function buildCorpus(caps: ec.ECCapabilities): Buffer[] {
   const leafInt = new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_STRING, 42);
   const leafString = new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "hello, world");
   const leafDouble = new ec.ECDoubleTag(ec.ECTagNames.EC_TAG_STRING, 3.5);
   const leafHash = new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_STRING, new Uint8Array(16).fill(7));
   const leafIp = new ec.ECIPv4Tag(ec.ECTagNames.EC_TAG_STRING, new Uint8Array([192, 0, 2, 1]), 4712);
   const parent = new ec.ECCustomTag(ec.ECTagNames.EC_TAG_STRING, new Uint8Array([1, 2, 3]), [
      leafInt,
      leafString,
      leafDouble,
      leafHash,
      leafIp,
   ]);
   const grandparent = new ec.ECCustomTag(ec.ECTagNames.EC_TAG_STRING, new Uint8Array(), [parent, leafInt]);
   const packets = [
      new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP),
      new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(leafInt),
      new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP).add(leafString).add(leafHash).add(leafIp),
      new ec.ECPacket(ec.ECOpcode.EC_OP_STATS).add(grandparent),
   ];
   return packets.map((packet) => packet.encode(caps));
}

interface Seed {
   buffer: Buffer;
   caps: ec.ECCapabilities;
}

type Mutator = (rng: () => number, buffer: Buffer) => Buffer;

const mutators: readonly Mutator[] = [
   // Flip one random byte.
   (rng, buffer): Buffer => {
      if (buffer.length === 0) {
         return buffer;
      }
      const mutated = Buffer.from(buffer);
      mutated[Math.floor(rng() * mutated.length)] = randomByte(rng);
      return mutated;
   },
   // Truncate at a random offset - the most common real-world malformation (a cut-off stream).
   (rng, buffer): Buffer => buffer.subarray(0, Math.floor(rng() * buffer.length)),
   // Append random garbage past the end.
   (rng, buffer): Buffer => Buffer.concat([buffer, randomBytes(rng, Math.floor(rng() * 32))]),
   // Duplicate a random slice right after itself, growing and desynchronizing the layout.
   (rng, buffer): Buffer => {
      if (buffer.length === 0) {
         return buffer;
      }
      const start = Math.floor(rng() * buffer.length);
      const end = start + Math.floor(rng() * (buffer.length - start));
      return Buffer.concat([buffer, buffer.subarray(start, end)]);
   },
   // Zero out a random range - a common effect of a partially-overwritten or zeroed buffer.
   (rng, buffer): Buffer => {
      if (buffer.length === 0) {
         return buffer;
      }
      const mutated = Buffer.from(buffer);
      const start = Math.floor(rng() * mutated.length);
      mutated.fill(0, start, start + Math.floor(rng() * (mutated.length - start)));
      return mutated;
   },
];

/**
 * One fuzz iteration: builds a buffer (either pure noise or a mutated corpus seed) and decodes
 * it, failing the test if decode() throws anything other than `ECDecodeError`/`RangeError`, or a
 * `RangeError` that is actually a native stack overflow (see `maxTagDepth`'s doc on why that must
 * be unreachable).
 */
function fuzzOnce(rng: () => number, corpus: readonly Seed[], iteration: number): void {
   let buffer: Buffer;
   let caps: ec.ECCapabilities;
   if (rng() < 0.2) {
      // Pure noise, no relation to a valid packet at all - still decoded under one of the two
      // capability sets in `corpus`, picked at random.
      buffer = randomBytes(rng, Math.floor(rng() * 64));
      caps = pick(rng, corpus).caps;
   } else {
      const seed = pick(rng, corpus);
      buffer = pick(rng, mutators)(rng, seed.buffer);
      caps = seed.caps;
   }
   try {
      ec.ECPacket.decode(buffer, caps);
   } catch (error) {
      if (!(error instanceof ec.ECDecodeError) && !(error instanceof RangeError)) {
         const name = error instanceof Error ? error.constructor.name : typeof error;
         expect.fail(`iteration ${iteration} threw ${name}, not ECDecodeError/RangeError: ${String(error)}\nbuffer: ${buffer.toString("hex")}`);
      }
      if (error instanceof RangeError && error.message.includes("call stack")) {
         expect.fail(`iteration ${iteration} overflowed the call stack instead of hitting maxTagDepth: ${String(error)}`);
      }
   }
}

describe("ECPacket.decode() fuzzing", () => {
   const ITERATIONS = 5_000;
   // Fixed seed: a failing iteration is reproducible by rerunning this exact test, not chased
   // through CI flakiness.
   const rng = mulberry32(0xec0d_ec0d);

   it(`survives ${ITERATIONS} randomly mutated valid packets and random byte buffers`, () => {
      const plainCaps = new ec.ECCapabilities();
      const wideCaps = new ec.ECCapabilities();
      wideCaps.utf8Numbers = true;
      wideCaps.largeTagCount = true;
      const corpus: Seed[] = [
         ...buildCorpus(plainCaps).map((buffer) => ({ buffer, caps: plainCaps })),
         ...buildCorpus(wideCaps).map((buffer) => ({ buffer, caps: wideCaps })),
      ];

      const start = Date.now();
      for (let i = 0; i < ITERATIONS; i++) {
         fuzzOnce(rng, corpus, i);
      }

      expect(Date.now() - start).to.be.lessThan(5_000);
   });
});
