import { expect } from "chai";
import * as srp from "../src/ECSRP.js";

describe("ECSRP math and official vectors", () => {
   // Official test vector inputs from aMule's GenerateECSRPVector.py
   const digestHex = "0123456789abcdef0123456789abcdef";
   const salt = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
   const aBytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
   const bBytes = Buffer.from(Array.from({ length: 32 }, (_, i) => 32 + i));
   const a = srp.bufferToBigInt(aBytes);
   const b = srp.bufferToBigInt(bBytes);
   const transcript = Buffer.from(Array.from({ length: 163 }, (_, i) => i));

   // Official expected outputs
   const expectedXHex = "edb279e7728b94d836804399739054ac4cdd450bf37d531f7e73634755ce0f90";
   const expectedM1Hex = "73a65de8539d3ea7d876a3f29af15f7ed1a6cdb5835feae5cc5a5718d3cecaa2";
   const expectedM2Hex = "a99b41113fad5967aacd4c0e8f816965468c948bdd13c9eb33e8cda6781c831e";

   it("computes the expected k multiplier", () => {
      const kHex = srp.SRP_K.toString(16);
      expect(kHex).to.equal("81f4874fa543a371b49a670402fda59ecfab53a1b850fc42e1c357cc846111e");
   });

   it("derives the expected secret exponent x via scrypt", () => {
      const digestRaw = Buffer.from(digestHex, "hex");
      const x = srp.deriveSRPX(digestRaw, salt);
      expect(x.toString(16)).to.equal(expectedXHex);
   });

   it("matches the official aMule SRP v1 vectors for A, B, M1, and M2", () => {
      const client = new srp.ECSRPClient(a);
      expect(client.a).to.equal(a);
      expect(client.clientA).to.equal(srp.modPow(srp.SRP_G, a, srp.SRP_N));

      // Server computes v and B
      const digestRaw = Buffer.from(digestHex, "hex");
      const x = srp.deriveSRPX(digestRaw, salt);
      const v = srp.modPow(srp.SRP_G, x, srp.SRP_N);
      const B = (srp.SRP_K * v + srp.modPow(srp.SRP_G, b, srp.SRP_N)) % srp.SRP_N;
      const serverB = srp.padBigInt(B);

      const { m1, verifyServerProof } = client.completeHandshake({
         serverB,
         salt,
         passwordHashHex: digestHex,
         transcript,
         credential: 0,
      });

      expect(m1.toString("hex")).to.equal(expectedM1Hex);

      const serverM2 = Buffer.from(expectedM2Hex, "hex");
      expect(verifyServerProof(serverM2)).to.equal(true);

      const tamperedM2 = Buffer.from(serverM2);
      tamperedM2[0] = (tamperedM2[0] ?? 0) ^ 0x01;
      expect(verifyServerProof(tamperedM2)).to.equal(false);
   });

   it("rejects an invalid server B outside (0, N)", () => {
      const client = new srp.ECSRPClient(a);
      const zeroB = Buffer.alloc(384);

      expect(() => {
         client.completeHandshake({
            serverB: zeroB,
            salt,
            passwordHashHex: digestHex,
            transcript,
         });
      }).to.throw("Invalid server SRP B value");

      const invalidLengthB = Buffer.alloc(383);
      expect(() => {
         client.completeHandshake({
            serverB: invalidLengthB,
            salt,
            passwordHashHex: digestHex,
            transcript,
         });
      }).to.throw("Invalid server SRP B width");
   });
});

