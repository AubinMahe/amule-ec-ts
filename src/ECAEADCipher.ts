import * as crypto from "node:crypto";
import { ECFlag } from "./ECFlags.js";

export const enum ECAEADCipherId {
   AES_128_GCM = 1,
   CHACHA20_POLY1305 = 2,
}

const SPKI_X25519_HEADER = Buffer.from("302a300506032b656e032100", "hex");

/**
 * Generates an ephemeral X25519 key pair and exports the raw 32-byte public key.
 */
export function generateX25519KeyPair(): {
   privateKey: crypto.KeyObject;
   publicKey: crypto.KeyObject;
   rawPublicKey: Buffer;
} {
   const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
   const der = publicKey.export({ type: "spki", format: "der" });
   const rawPublicKey = der.subarray(-32);
   return { privateKey, publicKey, rawPublicKey };
}

/**
 * Derives a 32-byte X25519 shared secret from a local private key and a
 * remote raw 32-byte public key.
 */
export function computeX25519SharedSecret(localPrivateKey: crypto.KeyObject, remoteRawPublicKey: Uint8Array): Buffer {
   if (remoteRawPublicKey.length !== 32) {
      throw new Error(`Invalid X25519 public key length: expected 32, got ${remoteRawPublicKey.length}`);
   }
   const spki = Buffer.concat([SPKI_X25519_HEADER, Buffer.from(remoteRawPublicKey)]);
   const remoteKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
   return crypto.diffieHellman({
      privateKey: localPrivateKey,
      publicKey: remoteKey,
   });
}

/**
 * Builds the AEAD handshake transcript:
 * len(offered) || offered || cipher_id || client_nonce || server_nonce ||
 * client_pubkey || server_pubkey
 */
export function buildAEADTranscript(params: {
   offeredCiphers: Uint8Array;
   selectedCipherId: number;
   clientNonce: Uint8Array;
   serverNonce: Uint8Array;
   clientPublicKey: Uint8Array;
   serverPublicKey: Uint8Array;
}): Buffer {
   return Buffer.concat([
      Buffer.from([params.offeredCiphers.length]),
      Buffer.from(params.offeredCiphers),
      Buffer.from([params.selectedCipherId]),
      Buffer.from(params.clientNonce),
      Buffer.from(params.serverNonce),
      Buffer.from(params.clientPublicKey),
      Buffer.from(params.serverPublicKey),
   ]);
}

function counterToNonce(prefix: Uint8Array, counter: bigint): Buffer {
   const buf = Buffer.alloc(12);
   Buffer.from(prefix).copy(buf, 0, 0, 4);
   buf.writeBigUInt64BE(counter, 4);
   return buf;
}

/**
 * Encrypted EC session channel handling AEAD packet sealing and unsealing.
 */
export class ECAEADSession {
   public readonly cipherId: ECAEADCipherId;
   private readonly nodeCipherName: "aes-128-gcm" | "chacha20-poly1305";
   private readonly txKey: Buffer;
   private readonly rxKey: Buffer;
   private readonly txPrefix: Buffer;
   private readonly rxPrefix: Buffer;
   private txCounter = 0n;
   private rxCounter = 0n;

   public constructor(params: {
      sharedSecret: Uint8Array;
      clientNonce: Uint8Array;
      serverNonce: Uint8Array;
      selectedCipherId: ECAEADCipherId;
      transcript: Uint8Array;
      isServer?: boolean;
   }) {
      this.cipherId = params.selectedCipherId;
      let keyLen: number;
      if (this.cipherId === ECAEADCipherId.AES_128_GCM) {
         this.nodeCipherName = "aes-128-gcm";
         keyLen = 16;
      } else {
         this.nodeCipherName = "chacha20-poly1305";
         keyLen = 32;
      }

      // salt = server_nonce || client_nonce
      const salt = Buffer.concat([Buffer.from(params.serverNonce), Buffer.from(params.clientNonce)]);

      // info = "aMule EC AEAD v1" || cipher_id || transcript
      const info = Buffer.concat([
         Buffer.from("aMule EC AEAD v1"),
         Buffer.from([this.cipherId]),
         Buffer.from(params.transcript),
      ]);

      const okmLen = 2 * keyLen + 8;
      const okm = Buffer.from(crypto.hkdfSync("sha256", params.sharedSecret, salt, info, okmLen));

      const clientKey = okm.subarray(0, keyLen);
      const serverKey = okm.subarray(keyLen, 2 * keyLen);
      const clientPrefix = okm.subarray(2 * keyLen, 2 * keyLen + 4);
      const serverPrefix = okm.subarray(2 * keyLen + 4, 2 * keyLen + 8);

      if (params.isServer) {
         this.txKey = serverKey;
         this.rxKey = clientKey;
         this.txPrefix = serverPrefix;
         this.rxPrefix = clientPrefix;
      } else {
         this.txKey = clientKey;
         this.rxKey = serverKey;
         this.txPrefix = clientPrefix;
         this.rxPrefix = serverPrefix;
      }
   }

   /**
    * Seals (encrypts) an application-layer payload and returns the encrypted body
    * (ciphertext + 16-byte tag).
    */
   public sealBody(body: Uint8Array): Buffer {
      const nonce = counterToNonce(this.txPrefix, this.txCounter);
      this.txCounter += 1n;

      const cipher = crypto.createCipheriv(this.nodeCipherName, this.txKey, nonce, {
         authTagLength: 16,
      } as crypto.CipherGCMOptions) as crypto.CipherGCM;
      const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([ciphertext, tag]);
   }

   /**
    * Seals an entire EC frame (8-byte header + plaintext body), returning the sealed frame
    * with flags | ECFlag.ENCRYPTED and length = body.length + 16.
    */
   public sealPacket(data: Uint8Array): Buffer {
      if (data.length < 8) {
         throw new Error("Cannot seal packet smaller than 8-byte transmission header");
      }
      const flags = Buffer.from(data).readUInt32BE(0);
      const length = Buffer.from(data).readUInt32BE(4);
      if (data.length !== 8 + length) {
         throw new Error(`Packet length mismatch: header says ${length}, got ${data.length - 8}`);
      }

      const sealedBody = this.sealBody(data.subarray(8));
      const header = Buffer.alloc(8);
      header.writeUInt32BE(flags | ECFlag.ENCRYPTED, 0);
      header.writeUInt32BE(sealedBody.length, 4);

      return Buffer.concat([header, sealedBody]);
   }

   /**
    * Unseals (decrypts) a sealed body and verifies its 16-byte authentication tag.
    */
   public unsealBody(sealedBody: Uint8Array): Buffer {
      if (sealedBody.length < 16) {
         throw new Error(`Sealed body too short: expected at least 16 bytes, got ${sealedBody.length}`);
      }
      const nonce = counterToNonce(this.rxPrefix, this.rxCounter);
      this.rxCounter += 1n;

      const ciphertext = sealedBody.subarray(0, sealedBody.length - 16);
      const tag = sealedBody.subarray(sealedBody.length - 16);

      const decipher = crypto.createDecipheriv(this.nodeCipherName, this.rxKey, nonce, {
         authTagLength: 16,
      } as crypto.CipherGCMOptions) as crypto.DecipherGCM;
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
   }

   /**
    * Unseals a sealed packet body given its header flags.
    * Returns the clear flags (without ECFlag.ENCRYPTED) and decrypted body.
    */
   public unsealPacket(headerFlags: number, sealedBody: Uint8Array): { clearFlags: number; body: Buffer } {
      if ((headerFlags & ECFlag.ENCRYPTED) === 0) {
         throw new Error("Packet header does not have ECFlag.ENCRYPTED set");
      }
      const clearFlags = headerFlags & ~ECFlag.ENCRYPTED;
      const body = this.unsealBody(sealedBody);
      return { clearFlags, body };
   }
}
