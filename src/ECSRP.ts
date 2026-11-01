import * as crypto from "node:crypto";

/**
 * 3072-bit prime N from RFC 5054 Appendix A.
 */
export const SRP_N = BigInt(
   "0x" +
      "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22" +
      "514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6" +
      "F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D" +
      "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB" +
      "9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E8603" +
      "9B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
      "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7D" +
      "B3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864" +
      "D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB31" +
      "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
);

/**
 * Generator g = 5.
 */
export const SRP_G = 5n;

/**
 * Exact byte width of SRP integers on the wire (384 bytes = 3072 bits).
 */
export const SRP_WIDTH = 384;

/**
 * SRP v1 KDF profile bytes: version 1, scrypt N=32768 (1 << 15), r=8, p=1.
 */
export const SRP_PROFILE_BYTES = Buffer.from([1, 15, 8, 1]);

/**
 * Converts an unsigned BigInt into a big-endian Buffer of exactly width bytes (default 384).
 */
export function padBigInt(n: bigint, width = SRP_WIDTH): Buffer {
   let hex = n.toString(16);
   if (hex.length % 2 !== 0) {
      hex = "0" + hex;
   }
   const buf = Buffer.from(hex, "hex");
   if (buf.length === width) {
      return buf;
   }
   if (buf.length > width) {
      throw new RangeError(`BigInt byte length (${buf.length}) exceeds expected width (${width})`);
   }
   const out = Buffer.alloc(width);
   buf.copy(out, width - buf.length);
   return out;
}

/**
 * Converts an unsigned Buffer to a BigInt.
 */
export function bufferToBigInt(buf: Uint8Array): bigint {
   return BigInt("0x" + Buffer.from(buf).toString("hex"));
}

/**
 * Fast modular exponentiation (base^exp mod mod).
 */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
   let res = 1n;
   let b = ((base % mod) + mod) % mod;
   let e = exp;
   while (e > 0n) {
      if (e & 1n) {
         res = (res * b) % mod;
      }
      b = (b * b) % mod;
      e >>= 1n;
   }
   return res;
}

/**
 * Multiplier k = H(PAD(N) || PAD(g)).
 */
export const SRP_K = bufferToBigInt(
   crypto.createHash("sha256").update(Buffer.concat([padBigInt(SRP_N), padBigInt(SRP_G)])).digest(),
);

/**
 * Derives the secret exponent x from the raw password digest (or token) and salt.
 * Uses scrypt with fixed parameters: N=32768, r=8, p=1, dkLen=32.
 */
export function deriveSRPX(digestRaw: Uint8Array, salt: Uint8Array): bigint {
   const xBuf = crypto.scryptSync(digestRaw, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
   });
   return bufferToBigInt(xBuf);
}

/**
 * Computes the SRP proof context string C according to docs/EC_SRP.md:
 * C = 01 || credential_byte || 0f || 08 || 01 || salt || len(T) || T || PAD(A) || PAD(B)
 */
export function buildProofContext(
   credential: number,
   salt: Uint8Array,
   transcript: Uint8Array,
   clientA: bigint,
   serverB: bigint,
): Buffer {
   const lenT = Buffer.alloc(4);
   lenT.writeUInt32BE(transcript.length, 0);
   return Buffer.concat([
      Buffer.from([1, credential, 15, 8, 1]),
      Buffer.from(salt),
      lenT,
      Buffer.from(transcript),
      padBigInt(clientA),
      padBigInt(serverB),
   ]);
}

/**
 * Computes client proof M1 and server proof M2 given shared secret S and context C.
 */
export function computeProofs(sharedSecret: bigint, ctx: Uint8Array): { m1: Buffer; m2: Buffer } {
   const key = crypto.createHash("sha256").update(padBigInt(sharedSecret)).digest();
   const m1 = crypto.createHmac("sha256", key).update(Buffer.concat([Buffer.from("ec-srp-client"), Buffer.from(ctx)])).digest();
   const m2 = crypto.createHmac("sha256", key).update(Buffer.concat([Buffer.from("ec-srp-server"), Buffer.from(ctx), m1])).digest();
   return { m1, m2 };
}

/**
 * Client-side SRP-6a state machine for aMule EC authentication.
 */
export class ECSRPClient {
   public readonly a: bigint;
   public readonly clientA: bigint;
   public readonly clientABytes: Buffer;

   public constructor(explicitA?: bigint) {
      if (explicitA !== undefined) {
         this.a = explicitA;
      } else {
         let candidate = 0n;
         while (candidate === 0n) {
            candidate = bufferToBigInt(crypto.randomBytes(32));
         }
         this.a = candidate;
      }
      this.clientA = modPow(SRP_G, this.a, SRP_N);
      this.clientABytes = padBigInt(this.clientA);
   }

   /**
    * Completes the SRP-6a computation from server response fields.
    *
    * @param serverB Server's ephemeral public key B (384 bytes).
    * @param salt Challenge salt (16 bytes).
    * @param passwordHashHex 32-character hex MD5 digest of the password (or raw credential).
    * @param transcript AEAD exchange transcript.
    * @param credential Credential type: 0 = password (default), 1 = API token, 2 = amuleweb token.
    */
   public completeHandshake(params: {
      serverB: Uint8Array;
      salt: Uint8Array;
      passwordHashHex: string;
      transcript: Uint8Array;
      credential?: number;
   }): {
      m1: Buffer;
      verifyServerProof: (serverM2: Uint8Array) => boolean;
   } {
      if (params.serverB.length !== SRP_WIDTH) {
         throw new Error(`Invalid server SRP B width: expected ${SRP_WIDTH}, got ${params.serverB.length}`);
      }
      const B = bufferToBigInt(params.serverB);
      if (B <= 0n || B >= SRP_N) {
         throw new Error("Invalid server SRP B value: outside (0, N)");
      }

      const uBuf = crypto.createHash("sha256").update(Buffer.concat([this.clientABytes, Buffer.from(params.serverB)])).digest();
      const u = bufferToBigInt(uBuf);
      if (u === 0n) {
         throw new Error("Invalid SRP parameter u: computed as zero");
      }

      // Password digest is 16 raw bytes from MD5 hex string
      const digestRaw = Buffer.from(params.passwordHashHex, "hex");
      const x = deriveSRPX(digestRaw, params.salt);

      // S = (B - k * (g^x mod N))^(a + u * x) mod N
      const gx = modPow(SRP_G, x, SRP_N);
      let base = (B - (SRP_K * gx) % SRP_N) % SRP_N;
      if (base < 0n) {
         base += SRP_N;
      }
      const S = modPow(base, this.a + u * x, SRP_N);

      const credential = params.credential ?? 0;
      const ctx = buildProofContext(credential, params.salt, params.transcript, this.clientA, B);
      const { m1, m2: expectedM2 } = computeProofs(S, ctx);

      return {
         m1,
         verifyServerProof(serverM2: Uint8Array): boolean {
            const serverBuf = Buffer.from(serverM2);
            if (serverBuf.length !== expectedM2.length) {
               return false;
            }
            return crypto.timingSafeEqual(serverBuf, expectedM2);
         },
      };
   }
}

