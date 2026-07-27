import { expect } from "chai";
import * as ec from "../../src/index.js";

describe("TransmissionHeader", () => {
   it("round-trips flags and bodyLength through encode()/decode()", () => {
      const flags = ec.ECFlags.create(true, false, true);
      const header = new ec.TransmissionHeader(flags, 12_345);
      const decoded = ec.TransmissionHeader.decode(header.encode());
      expect(decoded.flags).to.equal(flags);
      expect(decoded.bodyLength).to.equal(12_345);
   });

   it("computes packetLength as SIZE + bodyLength", () => {
      const header = new ec.TransmissionHeader(ec.ECFlags.create(), 100);
      expect(header.packetLength).to.equal(ec.TransmissionHeader.SIZE + 100);
   });

   it("exposes compressed/utf8Numbers/largeTagCount from the flags it was built with", () => {
      const header = new ec.TransmissionHeader(ec.ECFlags.create(true, true, true), 0);
      expect(header.compressed).to.equal(true);
      expect(header.utf8Numbers).to.equal(true);
      expect(header.largeTagCount).to.equal(true);
   });

   it("reports false for every capability when none were requested", () => {
      const header = new ec.TransmissionHeader(ec.ECFlags.create(), 0);
      expect(header.compressed).to.equal(false);
      expect(header.utf8Numbers).to.equal(false);
      expect(header.largeTagCount).to.equal(false);
   });

   it("rejects a buffer shorter than SIZE", () => {
      const tooShort = Buffer.alloc(ec.TransmissionHeader.SIZE - 1);
      expect(() => ec.TransmissionHeader.decode(tooShort)).to.throw(RangeError);
   });

   it("rejects flags without a valid protocol marker (delegates to ECFlags.validate)", () => {
      expect(() => new ec.TransmissionHeader(0, 0)).to.throw("Invalid EC protocol marker.");
   });

   it("rejects a non-integer bodyLength", () => {
      expect(() => new ec.TransmissionHeader(ec.ECFlags.create(), 1.5)).to.throw(TypeError);
   });

   it("rejects a negative bodyLength", () => {
      expect(() => new ec.TransmissionHeader(ec.ECFlags.create(), -1)).to.throw(RangeError);
   });

   it("rejects a bodyLength beyond 2^32-1", () => {
      expect(() => new ec.TransmissionHeader(ec.ECFlags.create(), 0x1_0000_0000)).to.throw(RangeError);
   });
});
