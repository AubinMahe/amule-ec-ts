import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECTag, ECUInt8Tag } from "./ECTags.js";

const debug = debuglog("amule-ec:statstree");

/**
 * `EC_TAG_STAT_VALUE_TYPE` values - a display-format hint layered on top of
 * a `StatValue`'s own wire type, confirmed against `EValueType`/the
 * `EC_VALUE_*` constants
 * (https://github.com/amule-org/amule/blob/master/src/libs/ec/abstracts/ECCodes.abstract#L670-L677).
 * Absence means plain integer (`EC_VALUE_INTEGER`'s implicit role - the
 * reply builder never actually sends this tag for that case, see
 * `CStatTreeItemSimple::AddECValues`,
 * https://github.com/amule-org/amule/blob/master/src/StatTree.cpp#L267-L296).
 */
export enum ECStatValueType {
   INTEGER = 0,
   /** Formatted with a `stShowPercent`-style suffix on some counters - still a plain integer underneath. */
   ISTRING = 1,
   BYTES = 2,
   ISHORT = 3,
   /** Seconds, meant to be displayed as hours:minutes. */
   TIME = 4,
   /** Bytes/second. */
   SPEED = 5,
   STRING = 6,
   DOUBLE = 7,
}

/**
 * One `EC_TAG_STAT_NODE_VALUE` tag from a stats-tree node - confirmed
 * against every `CStatTreeItemXxx::AddECValues` override in
 * `StatTree.cpp` (https://github.com/amule-org/amule/blob/master/src/StatTree.cpp#L267-L691): despite
 * 14 different C++ node classes, they all funnel their value(s) through
 * this one tag name, distinguished only by `type` and by the concrete
 * wire type of the tag's own data (int/double/string) - so a single
 * class here covers every case, no per-node-type modeling needed.
 *
 * `companion` is a second `EC_TAG_STAT_NODE_VALUE` nested *inside* this
 * one - used for "session (all-time)" pairs (`CStatTreeItemUlDlCounter`,
 * `CStatTreeItemPackets`/`PacketTotals`) where the outer value is the
 * live/session figure and `companion` is the cumulative one.
 */
export class StatValue {

   public readonly type: ECStatValueType | undefined;
   public readonly intValue: bigint | undefined;
   public readonly doubleValue: number | undefined;
   public readonly stringValue: string | undefined;
   /** Locale-independent sentinel token (`"not_available"`, `"never"`) - `EC_TAG_STAT_VALUE_ENUM`, present instead of a meaningful value on `CStatTreeItemRatio`/`CStatTreeItemMaxConnLimitReached`'s edge cases. */
   public readonly enumToken: string | undefined;
   public readonly companion: StatValue | undefined;

   private constructor(fields: {
      type: ECStatValueType | undefined;
      intValue: bigint | undefined;
      doubleValue: number | undefined;
      stringValue: string | undefined;
      enumToken: string | undefined;
      companion: StatValue | undefined;
   }) {
      this.type = fields.type;
      this.intValue = fields.intValue;
      this.doubleValue = fields.doubleValue;
      this.stringValue = fields.stringValue;
      this.enumToken = fields.enumToken;
      this.companion = fields.companion;
   }

   public static fromTag(tag: ECTag): StatValue {
      const companionTag = tag.children.find((child) => {
         const name: ECTagNames = child.name;
         return name === ECTagNames.EC_TAG_STAT_NODE_VALUE;
      });
      const typeValue = tag.childInt(ECTagNames.EC_TAG_STAT_VALUE_TYPE);
      return new StatValue({
         type: typeValue === undefined ? undefined : Number(typeValue),
         intValue: tag.intValue,
         doubleValue: tag.doubleValue,
         stringValue: tag.stringValue,
         enumToken: tag.childString(ECTagNames.EC_TAG_STAT_VALUE_ENUM),
         companion: companionTag ? StatValue.fromTag(companionTag) : undefined,
      });
   }
}

/**
 * One node of the statistics tree - `EC_TAG_STATTREE_NODE`. Confirmed
 * against `CStatTreeItemBase::CreateECTag`
 * (https://github.com/amule-org/amule/blob/master/src/StatTree.cpp#L189-L220): every node, regardless
 * of its concrete C++ class, has the same generic shape - an untranslated
 * label as its own string value, a stable numeric ID, optional
 * `key`/`rawValue` machine-readable strings, zero or more `values`
 * (`CStatTreeItemTotalClients` is the one class that emits two sibling
 * value tags rather than zero or one), an optional `ratio`/`ratioTotal`
 * pair (`CStatTreeItemRatio` only), and any number of child nodes -
 * recursively the same shape. `key` is this library's recommended way to
 * find a specific node (`findByKey`) since it is stable across daemon
 * versions and locales, unlike `label` (untranslated but still prose) or
 * position in the tree.
 */
export class StatNode {

   public readonly label: string;
   public readonly nodeId: bigint;
   public readonly key: string | undefined;
   public readonly rawValue: string | undefined;
   public readonly values: readonly StatValue[];
   public readonly ratio: number | undefined;
   public readonly ratioTotal: number | undefined;
   public readonly children: readonly StatNode[];

   private constructor(fields: {
      label: string;
      nodeId: bigint;
      key: string | undefined;
      rawValue: string | undefined;
      values: readonly StatValue[];
      ratio: number | undefined;
      ratioTotal: number | undefined;
      children: readonly StatNode[];
   }) {
      this.label = fields.label;
      this.nodeId = fields.nodeId;
      this.key = fields.key;
      this.rawValue = fields.rawValue;
      this.values = fields.values;
      this.ratio = fields.ratio;
      this.ratioTotal = fields.ratioTotal;
      this.children = fields.children;
   }

   public static fromTag(tag: ECTag): StatNode {
      const values: StatValue[] = [];
      const children: StatNode[] = [];
      for (const child of tag.children) {
         const name: ECTagNames = child.name;
         if (name === ECTagNames.EC_TAG_STAT_NODE_VALUE) {
            values.push(StatValue.fromTag(child));
         } else if (name === ECTagNames.EC_TAG_STATTREE_NODE) {
            children.push(StatNode.fromTag(child));
         }
      }
      return new StatNode({
         label: tag.stringValue ?? "",
         nodeId: tag.childInt(ECTagNames.EC_TAG_STATTREE_NODEID) ?? 0n,
         key: tag.childString(ECTagNames.EC_TAG_STAT_NODE_KEY),
         rawValue: tag.childString(ECTagNames.EC_TAG_STAT_NODE_RAW),
         values,
         ratio: tag.childDouble(ECTagNames.EC_TAG_STAT_NODE_RATIO),
         ratioTotal: tag.childDouble(ECTagNames.EC_TAG_STAT_NODE_RATIO_TOTAL),
         children,
      });
   }

   /**
    * Depth-first search for a descendant (or this node itself) with the
    * given stable `key` - see the class doc on why `key` rather than
    * `label` is the recommended lookup. Returns `undefined` if no node in
    * this subtree was ever given that key (`SetKey()` is optional -
    * https://github.com/amule-org/amule/blob/master/src/StatTree.h#L179-L183 - most nodes have
    * none).
    */
   public findByKey(key: string): StatNode | undefined {
      if (this.key === key) return this;
      for (const child of this.children) {
         const found = child.findByKey(key);
         if (found) return found;
      }
      return undefined;
   }
}

/**
 * The daemon's statistics tree - `EC_OP_GET_STATSTREE`/`EC_OP_STATSTREE`.
 * Mirrors the aMule GUI's "Statistics" tab (Transfer/Uploads/Downloads/
 * Connection/Servers/Shared Files and more), rooted at a node keyed
 * `"statistics"` (https://github.com/amule-org/amule/blob/master/src/Statistics.cpp#L779).
 *
 * `fetch()`'s `maxChildrenPerNode` maps to `EC_TAG_STATTREE_CAPPING` -
 * only a handful of nodes actually cap their children on it
 * (`stCapChildren`, e.g. the known-client-versions/OS breakdowns), every
 * other node is unaffected regardless of this value. `0` (the default)
 * means unlimited - confirmed against `CreateECTag`'s
 * `m_visible_counter = max_children - 1`
 * (https://github.com/amule-org/amule/blob/master/src/StatTree.cpp#L200): with `max_children == 0`
 * this underflows to the type's max value, which is de facto "never runs
 * out". The daemon truncates this value to a `uint8` internally
 * (`GetECStatTree(uint8)`,
 * https://github.com/amule-org/amule/blob/master/src/Statistics.h#L464-L467), so anything above 255
 * behaves the same as 255, not "more unlimited".
 */
export class StatsTree {

   public root: StatNode | undefined;

   public constructor(public readonly connection: ECConnection) {}

   public async fetch(maxChildrenPerNode = 0): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_STATSTREE);
      request.add(
         new ECUInt8Tag(ECTagNames.EC_TAG_STATTREE_CAPPING, maxChildrenPerNode),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_STATSTREE) {
         throw new Error(
            `Expected EC_OP_STATSTREE, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      const rootTag = reply.find(ECTagNames.EC_TAG_STATTREE_NODE);
      this.root = rootTag ? StatNode.fromTag(rootTag) : undefined;
      debug("fetch: root=%s", this.root?.label);
   }
}
