import * as crypto from "node:crypto";
import { expect } from "chai";
import * as aead from "../src/ECAEADCipher.js";
import { ECFlag } from "../src/ECFlags.js";

describe("ECAEADCipher and session sealing", () => {
   function setupSession(cipherId: aead.ECAEADCipherId): {
      clientSession: aead.ECAEADSession;
      serverSession: aead.ECAEADSession;
   } {
      const clientKeys = aead.generateX25519KeyPair();
      const serverKeys = aead.generateX25519KeyPair();

      const clientShared = aead.computeX25519SharedSecret(clientKeys.privateKey, serverKeys.rawPublicKey);
      const serverShared = aead.computeX25519SharedSecret(serverKeys.privateKey, clientKeys.rawPublicKey);
      expect(clientShared.equals(serverShared)).to.equal(true);

      const clientNonce = crypto.randomBytes(32);
      const serverNonce = crypto.randomBytes(32);
      const offeredCiphers = Buffer.from([1, 2]);

      const transcript = aead.buildAEADTranscript({
         offeredCiphers,
         selectedCipherId: cipherId,
         clientNonce,
         serverNonce,
         clientPublicKey: clientKeys.rawPublicKey,
         serverPublicKey: serverKeys.rawPublicKey,
      });

      const clientSession = new aead.ECAEADSession({
         sharedSecret: clientShared,
         clientNonce,
         serverNonce,
         selectedCipherId: cipherId,
         transcript,
         isServer: false,
      });

      const serverSession = new aead.ECAEADSession({
         sharedSecret: serverShared,
         clientNonce,
         serverNonce,
         selectedCipherId: cipherId,
         transcript,
         isServer: true,
      });

      return { clientSession, serverSession };
   }

   for (const cipher of [
      { name: "AES-128-GCM", id: aead.ECAEADCipherId.AES_128_GCM },
      { name: "ChaCha20-Poly1305", id: aead.ECAEADCipherId.CHACHA20_POLY1305 },
   ]) {
      describe(cipher.name, () => {
         it("seals and unseals bodies symmetrically across client and server", () => {
            const { clientSession, serverSession } = setupSession(cipher.id);
            const plaintext = Buffer.from("Test aMule EC packet payload 12345");

            // Client -> Server
            const sealedByClient = clientSession.sealBody(plaintext);
            expect(sealedByClient).to.have.lengthOf(plaintext.length + 16);
            const unsealedByServer = serverSession.unsealBody(sealedByClient);
            expect(unsealedByServer.equals(plaintext)).to.equal(true);

            // Server -> Client
            const replyPlaintext = Buffer.from("Server response payload 67890");
            const sealedByServer = serverSession.sealBody(replyPlaintext);
            const unsealedByClient = clientSession.unsealBody(sealedByServer);
            expect(unsealedByClient.equals(replyPlaintext)).to.equal(true);
         });

         it("seals and unseals full EC frames (header + body) and sets ECFlag.ENCRYPTED", () => {
            const { clientSession, serverSession } = setupSession(cipher.id);
            const body = Buffer.from("Full packet body content");
            const rawHeader = Buffer.alloc(8);
            rawHeader.writeUInt32BE(ECFlag.PROTOCOL_MARKER | ECFlag.ZLIB, 0);
            rawHeader.writeUInt32BE(body.length, 4);
            const fullPacket = Buffer.concat([rawHeader, body]);

            const sealedPacket = clientSession.sealPacket(fullPacket);
            const sealedFlags = sealedPacket.readUInt32BE(0);
            const sealedLength = sealedPacket.readUInt32BE(4);

            expect(sealedFlags & ECFlag.ENCRYPTED).to.equal(ECFlag.ENCRYPTED);
            expect(sealedLength).to.equal(body.length + 16);

            const { clearFlags, body: decryptedBody } = serverSession.unsealPacket(sealedFlags, sealedPacket.subarray(8));
            expect(clearFlags).to.equal(ECFlag.PROTOCOL_MARKER | ECFlag.ZLIB);
            expect(decryptedBody.equals(body)).to.equal(true);
         });

         it("increments counters and handles sequential packet streams", () => {
            const { clientSession, serverSession } = setupSession(cipher.id);
            for (let i = 0; i < 5; i++) {
               const msg = Buffer.from(`Message sequence number ${i}`);
               const sealed = clientSession.sealBody(msg);
               const unsealed = serverSession.unsealBody(sealed);
               expect(unsealed.equals(msg)).to.equal(true);
            }
         });

         it("rejects tampered ciphertext with an authentication error", () => {
            const { clientSession, serverSession } = setupSession(cipher.id);
            const plaintext = Buffer.from("Sensitive payload");
            const sealed = clientSession.sealBody(plaintext);

            // Tamper with one byte of ciphertext
            sealed[0] = (sealed[0] ?? 0) ^ 0x42;

            expect(() => {
               serverSession.unsealBody(sealed);
            }).to.throw(/unable to authenticate data|bad decrypt/i);
         });
      });
   }
});

