import { expect } from "chai";
import * as ec from "../src/index.js";

describe("ECFlags.create", () => {
   it("with no arguments, sets only the protocol marker", () => {
      const flags = ec.ECFlags.create();
      expect(flags).to.equal(ec.ECFlags.DEFAULT);
      expect(ec.ECFlags.isCompressed(flags)).to.equal(false);
      expect(ec.ECFlags.usesUtf8Numbers(flags)).to.equal(false);
      expect(ec.ECFlags.usesLargeTagCount(flags)).to.equal(false);
   });

   it("sets exactly the requested bits, alongside the marker", () => {
      const flags = ec.ECFlags.create(true, true, true);
      expect(ec.ECFlags.isCompressed(flags)).to.equal(true);
      expect(ec.ECFlags.usesUtf8Numbers(flags)).to.equal(true);
      expect(ec.ECFlags.usesLargeTagCount(flags)).to.equal(true);
      expect(ec.ECFlags.hasValidMarker(flags)).to.equal(true);
   });

   it("toggles bits independently of one another", () => {
      const flags = ec.ECFlags.create(true, false, true);
      expect(ec.ECFlags.isCompressed(flags)).to.equal(true);
      expect(ec.ECFlags.usesUtf8Numbers(flags)).to.equal(false);
      expect(ec.ECFlags.usesLargeTagCount(flags)).to.equal(true);
   });
});

describe("ECFlags enable/disable helpers", () => {
   it("enableCompression/disableCompression round-trip without touching other bits", () => {
      const base = ec.ECFlags.create(false, true, true);
      const enabled = ec.ECFlags.enableCompression(base);
      expect(ec.ECFlags.isCompressed(enabled)).to.equal(true);
      expect(ec.ECFlags.usesUtf8Numbers(enabled)).to.equal(true);
      expect(ec.ECFlags.usesLargeTagCount(enabled)).to.equal(true);
      const disabled = ec.ECFlags.disableCompression(enabled);
      expect(ec.ECFlags.isCompressed(disabled)).to.equal(false);
      expect(ec.ECFlags.usesUtf8Numbers(disabled)).to.equal(true);
      expect(ec.ECFlags.usesLargeTagCount(disabled)).to.equal(true);
   });

   it("enableUtf8Numbers/disableUtf8Numbers round-trip", () => {
      const base = ec.ECFlags.create();
      const enabled = ec.ECFlags.enableUtf8Numbers(base);
      expect(ec.ECFlags.usesUtf8Numbers(enabled)).to.equal(true);
      expect(ec.ECFlags.usesUtf8Numbers(ec.ECFlags.disableUtf8Numbers(enabled))).to.equal(false);
   });

   it("enableLargeTagCount/disableLargeTagCount round-trip", () => {
      const base = ec.ECFlags.create();
      const enabled = ec.ECFlags.enableLargeTagCount(base);
      expect(ec.ECFlags.usesLargeTagCount(enabled)).to.equal(true);
      expect(ec.ECFlags.usesLargeTagCount(ec.ECFlags.disableLargeTagCount(enabled))).to.equal(false);
   });
});

describe("ECFlags.validate", () => {
   it("does not throw for a normally-constructed value", () => {
      expect(() => {
         ec.ECFlags.validate(ec.ECFlags.create(true, true, true));
      }).to.not.throw();
   });

   it("rejects a value with no protocol marker", () => {
      expect(() => {
         ec.ECFlags.validate(0);
      }).to.throw("Invalid EC protocol marker.");
   });

   it("rejects a value with reserved bits set", () => {
      const withReservedBit = ec.ECFlags.create() | (1 << 10);
      expect(ec.ECFlags.hasValidMarker(withReservedBit)).to.equal(true);
      expect(() => {
         ec.ECFlags.validate(withReservedBit);
      }).to.throw("Reserved EC flag bits are set.");
   });
});
