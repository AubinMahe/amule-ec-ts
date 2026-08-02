import { expect } from "chai";
import * as ec from "../src/index.js";

const caps = new ec.ECCapabilities();

function roundTrip(tag: ec.ECTag): ec.ECTag {
   const encoded = tag.encode(caps);
   const decoder = new ec.ECTagDecoder(encoded, caps);
   return decoder.readTag();
}

describe("ECTag encode/decode round-trip", () => {
   it("round-trips a leaf UINT8 tag with no children", () => {
      const tag = new ec.ECUInt8Tag(
         ec.ECTagNames.EC_TAG_DETAIL_LEVEL,
         ec.ECDetailLevel.EC_DETAIL_CMD,
      );
      const decoded = roundTrip(tag);
      expect(decoded).to.be.instanceOf(ec.ECUInt8Tag);
      expect(decoded.name).to.equal(ec.ECTagNames.EC_TAG_DETAIL_LEVEL);
      expect(decoded.intValue).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_CMD));
   });

   it("round-trips a leaf STRING tag, including non-ASCII UTF-8 (e.g. a search keyword)", () => {
      const tag = new ec.ECStringTag(ec.ECTagNames.EC_TAG_SEARCH_NAME, "Astérix");
      const decoded = roundTrip(tag);
      expect(decoded).to.be.instanceOf(ec.ECStringTag);
      expect((decoded as ec.ECStringTag).value).to.equal("Astérix");
   });

   it("round-trips a leaf HASH16 tag", () => {
      const hash = new Uint8Array(16).map((_, i) => i);
      const tag = new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PARTFILE, hash);
      const decoded = roundTrip(tag);
      expect(decoded).to.be.instanceOf(ec.ECHash16Tag);
      expect(Buffer.from((decoded as ec.ECHash16Tag).value)).to.deep.equal(Buffer.from(hash));
   });

   it("round-trips an IPV4 tag (address + port as own data)", () => {
      const tag = new ec.ECIPv4Tag(
         ec.ECTagNames.EC_TAG_SERVER,
         new Uint8Array([1, 2, 3, 4]),
         4712,
      );
      const decoded = roundTrip(tag) as ec.ECIPv4Tag;
      expect(Array.from(decoded.address)).to.deep.equal([1, 2, 3, 4]);
      expect(decoded.port).to.equal(4712);
   });

   it(
      "round-trips a tag that carries BOTH own data and children - " +
      "regression test for the TAGLEN bug that closed the EC connection " +
      "the first time a search was run",
      () => {
         // Mirrors ec/Search.ts's EC_TAG_SEARCH_TYPE composite request tag:
         // own data is an integer, with string children. This is the first
         // tag shape in the whole client that ever combined non-empty own
         // data with children - the one that exposed encode()'s TAGLEN
         // wrongly including the child-count field's own byte size (see
         // ECTags.ts's encode() doc for the full story: the daemon silently
         // closed the connection rather than reply with EC_OP_FAILED).
         const tag = new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCH_TYPE, 1, [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_SEARCH_NAME, "Astérix"),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_SEARCH_FILE_TYPE, "Video"),
         ]);
         const decoded = roundTrip(tag);
         expect(decoded.intValue).to.equal(1n);
         expect(decoded.children).to.have.lengthOf(2);
         const [nameChild, fileTypeChild] = decoded.children;
         expect(nameChild).to.be.instanceOf(ec.ECStringTag);
         expect((nameChild as ec.ECStringTag).value).to.equal("Astérix");
         expect(fileTypeChild).to.be.instanceOf(ec.ECStringTag);
         expect((fileTypeChild as ec.ECStringTag).value).to.equal("Video");
      },
   );

   it(
      "round-trips a packet with a composite tag followed by a sibling tag - " +
      "catches TAGLEN corruption that misaligns whatever comes next, which " +
      "is the actual failure mode a single tag's own round-trip can miss",
      () => {
         const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_START);
         packet.add(
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCH_TYPE, 1, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_SEARCH_NAME, "Astérix"),
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_SEARCH_FILE_TYPE, "Video"),
            ]),
         );
         packet.add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_DETAIL_LEVEL, 2));
         const encoded = packet.encode(caps);
         const decoded = ec.ECPacket.decode(encoded, caps);
         expect(decoded.tags).to.have.lengthOf(2);
         expect(decoded.tags[0]?.children).to.have.lengthOf(2);
         expect(decoded.tags[1]).to.be.instanceOf(ec.ECUInt8Tag);
         expect(decoded.tags[1]?.intValue).to.equal(2n);
      },
   );
});
