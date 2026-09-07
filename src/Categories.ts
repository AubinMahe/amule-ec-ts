import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECUInt8Tag, ECUInt32Tag, ECStringTag } from "./ECTags.js";

const debug = debuglog("amule-ec:categories");

/**
 * CRUD on the daemon's download categories - EC_OP_CREATE_CATEGORY,
 * EC_OP_UPDATE_CATEGORY, EC_OP_DELETE_CATEGORY.
 *
 * There is no EC_OP_GET_CATEGORIES: the known categories are only ever sent
 * embedded in an EC_OP_GET_PREFERENCES reply (EC_TAG_PREFS_CATEGORIES,
 * confirmed against CEC_Prefs_Packet's constructor,
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L89-L101) - out of this
 * class's scope. In particular, create()'s reply carries no indication of
 * the new category's assigned index on success (EC_OP_NOOP has no tags at
 * all here) - discovering it requires a follow-up GET_PREFERENCES call. It
 * IS available on the EC_OP_FAILED path (see readFailure()'s doc), but that
 * path means the category's requested download directory wasn't usable,
 * not that create()/update() as a whole should be treated as never having
 * happened.
 *
 * All three opcodes are GUI-only upstream - no amulecmd equivalent exists
 * (no "category" command in TextClient.cpp).
 */
export class Categories {
   public constructor(public readonly connection: ECConnection) {}

   /**
    * Builds the EC_TAG_CATEGORY request tag shared by create()/update() -
    * own data is the category index (ignored by create(), see its doc),
    * with PATH/COMMENT/COLOR/PRIO/TITLE children.
    *
    * Confirmed against CEC_Category_Tag's create/update constructor
    * (https://github.com/amule-org/amule/blob/master/src/libs/ec/cpp/ECSpecialTags.h#L226-L242,
    * implemented at
    * https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L54-L63).
    */
   private static buildCategoryTag(
      index: number,
      title: string,
      path: string,
      comment: string,
      color: number,
      prio: number,
   ): ECUInt32Tag {
      return new ECUInt32Tag(ECTagNames.EC_TAG_CATEGORY, index, [
         new ECStringTag(ECTagNames.EC_TAG_CATEGORY_PATH, path),
         new ECStringTag(ECTagNames.EC_TAG_CATEGORY_COMMENT, comment),
         new ECUInt32Tag(ECTagNames.EC_TAG_CATEGORY_COLOR, color),
         new ECUInt8Tag(ECTagNames.EC_TAG_CATEGORY_PRIO, prio),
         new ECStringTag(ECTagNames.EC_TAG_CATEGORY_TITLE, title),
      ]);
   }

   /**
    * Reads the EC_OP_FAILED reply shared by create()/update()/delete() - two shapes exist,
    * distinguished by whether EC_TAG_STRING is present.
    *
    * **No EC_TAG_STRING (create()/update() only)**: the operation is NOT rolled back -
    * `title`/`comment`/`color`/`prio` are applied unconditionally
    * (`CPreferences::UpdateCategory`,
    * https://github.com/amule-org/amule/blob/master/src/Preferences.cpp#L2348-L2367), only `path`
    * is rejected - when it doesn't already exist as a directory and can't be created as one
    * (`CPath::MakeDir`). The reply carries two top-level tags instead, EC_TAG_CATEGORY (the
    * created/updated category's own index - confirmed live: create()'s index here is NOT
    * 0/ignored like the request's, it's whatever index the daemon actually assigned) and
    * EC_TAG_CATEGORY_PATH (the path now actually in effect for it - the previous path for
    * update(), the incoming directory for create() - since CEC_Category_Tag::Create()/Apply()
    * rewrite the request tag's own PATH child in place before ExternalConn.cpp echoes it back,
    * https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L65-L87). Confirmed
    * against the EC_OP_CREATE_CATEGORY/EC_OP_UPDATE_CATEGORY cases in
    * ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3630-L3661) - NOT a
    * path-collision check against other categories, despite this shape's superficial resemblance
    * to one: a live smoke test creating two categories with the identical path succeeded for
    * both.
    *
    * **EC_TAG_STRING present (update()'s out-of-range index, and every delete() failure)**: a
    * genuine rejection - nothing was applied. Added by amule-org/amule#1228/#1232 (an
    * out-of-range index used to abort the whole daemon rather than reply EC_OP_FAILED - see
    * update()'s/delete()'s own doc). EC_TAG_CATEGORY_PATH is deliberately never attached to this
    * shape: on the other shape above, that tag means "everything but the path was applied," which
    * would misreport a rejection that applied nothing as a partial success.
    */
   private static readFailure(reply: ECPacket, verb: string, title: string): Error {
      const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
      if (reasonTag instanceof ECStringTag) {
         return new Error(reasonTag.value);
      }
      const index = reply.find(ECTagNames.EC_TAG_CATEGORY)?.intValue;
      const pathTag = reply.find(ECTagNames.EC_TAG_CATEGORY_PATH);
      const actualPath = pathTag instanceof ECStringTag ? pathTag.value : undefined;
      if (index !== undefined && actualPath !== undefined) {
         return new Error(
            `Category "${title}" was ${verb}d (index #${index}), but its path could not be set - ` +
               `the requested directory doesn't exist and couldn't be created. It's using "${actualPath}" instead.`,
         );
      }
      return new Error(`Failed to ${verb} category "${title}".`);
   }

   /**
    * Creates a new download category - EC_OP_CREATE_CATEGORY.
    *
    * Confirmed against the EC_OP_CREATE_CATEGORY case in
    * ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3629-L3641) and
    * CEC_Category_Tag::Create()
    * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L76-L87): the
    * category's index is assigned by the daemon and not returned on
    * success (see class doc) - only `title`/`path`/`comment`/`color`/`prio`
    * are meaningful here. Replies EC_OP_NOOP on success, EC_OP_FAILED (see
    * readFailure()'s doc) if `path` doesn't exist and can't be created - the
    * category is still created in that case, just with a fallback path.
    */
   public async create(title: string, path: string, comment = "", color = 0, prio = 0): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_CREATE_CATEGORY);
      request.add(Categories.buildCategoryTag(0, title, path, comment, color, prio));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         throw Categories.readFailure(reply, "create", title);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("create: title=%s, path=%s", title, path);
   }

   /**
    * Updates an existing download category, identified by its index -
    * EC_OP_UPDATE_CATEGORY.
    *
    * Confirmed against the EC_OP_UPDATE_CATEGORY case in
    * ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3647-L3659) and
    * CEC_Category_Tag::Apply()
    * (https://github.com/amule-org/amule/blob/master/src/ECSpecialMuleTags.cpp#L65-L74): unlike
    * create(), `index` here does identify the target category. Replies EC_OP_NOOP on success,
    * EC_OP_FAILED (see readFailure()'s doc) if `path` doesn't exist and can't be created - the
    * category's other fields are still updated in that case, just leaving its previous path in
    * place.
    *
    * An out-of-range `index` also replies EC_OP_FAILED as of amule-org/amule#1228 - per that PR's
    * own description, before this fix it took the whole daemon down with SIGABRT
    * (`CPreferences::UpdateCategory` indexed its category vector with no bounds check at all),
    * reproducible every time (reported with 5 categories and an index of 28) - not merely a
    * theoretical risk here, since a caller can easily hold a stale index after another client
    * deletes a category. Not independently reproduced against a pre-fix daemon by this library;
    * documented from the upstream PR alone.
    */
   public async update(index: number, title: string, path: string, comment = "", color = 0, prio = 0): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_UPDATE_CATEGORY);
      request.add(Categories.buildCategoryTag(index, title, path, comment, color, prio));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         throw Categories.readFailure(reply, "update", title);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("update: index=%d, title=%s, path=%s", index, title, path);
   }

   /**
    * Deletes a download category, identified by its index -
    * EC_OP_DELETE_CATEGORY.
    *
    * Confirmed against the EC_OP_DELETE_CATEGORY case in ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3663-L3670): the
    * request carries a single EC_TAG_CATEGORY tag whose own data is the category's index, no
    * children. Replies EC_OP_NOOP on an actual deletion.
    *
    * As of amule-org/amule#1232, three requests that delete nothing now reply EC_OP_FAILED (via
    * readFailure()) instead of the EC_OP_NOOP they used to get: index 0 (deliberately refused,
    * never a real category), a malformed request, and - the one worth calling out - an
    * out-of-range index. Before that fix all three were silently reported as successful, which
    * matters because category indices are positional: a client holding a stale index after any
    * delete was told its *next* delete succeeded too, silently diverging from the daemon's real
    * list (the same kind of divergence #1228 turned into a crash on the update path - see
    * update()'s doc). Against a pre-#1232 daemon this still always replies EC_OP_NOOP either way,
    * so this method's behavior there is unchanged from before this update.
    */
   public async delete(index: number): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_DELETE_CATEGORY);
      request.add(new ECUInt32Tag(ECTagNames.EC_TAG_CATEGORY, index));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         throw Categories.readFailure(reply, "delete", `#${index}`);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("delete: index=%d", index);
   }
}
