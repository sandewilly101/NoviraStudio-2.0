// Real furniture the designer can choose per event: each style is a sourced 3D
// model already in the import library (BlenderKit, royalty-free). Chosen
// models replace the catalogue defaults on every chair / table of the design.
import { q } from "../db.js";

export const CHAIR_STYLES = {
  "gold-banquet": { externalId: "c695b469-9891-4268-8898-d9170796056f", note: "gold-frame banquet chair with a cream seat — weddings, galas, elegant dinners" },
  "cane-wood": { externalId: "43c9a81e-2e4e-4168-8461-e9965c1809f6", note: "natural wood chair with a woven cane back — African, boho, garden, rustic, cultural celebrations" },
  "wood-dining": { externalId: "9b776be3-4668-49fb-8db7-d6a95bae8997", note: "solid wood dining chair — rustic, farmhouse, long feasts" },
  upholstered: { externalId: "a43cd298-6d8c-42bb-9cb2-44e88259888a", note: "upholstered modern dining chair — luxury dinners, modern weddings" },
  stacking: { externalId: "c87d2dda-59e0-4ac4-ae4d-cb9407eaff0c", note: "padded stacking banquet chair, royal-blue seat and back — conferences, corporate events (dress it in covers unless blue suits the palette)" },
};
export const TABLE_STYLES = {
  linen: { externalId: null, note: "round tables dressed in floor-length linen in the theme colour" },
  "rustic-wood": { externalId: "f67da01b-0c71-4dec-8302-968c0a713e94", note: "bare round rustic wood tables, no cloth — boho, African, garden, rustic" },
  marble: { externalId: "f2ce7f0d-230f-45aa-9963-c405a241cf6f", note: "bare round marble tables — modern luxury" },
};
export const stylesForPrompt = () =>
  `"chairStyle": ${Object.entries(CHAIR_STYLES).map(([k, v]) => `"${k}" (${v.note})`).join(" | ")},\n  "tableStyle": ${Object.entries(TABLE_STYLES).map(([k, v]) => `"${k}" (${v.note})`).join(" | ")}`;

async function assetFor(externalId) {
  const [row] = await q("SELECT * FROM assets WHERE external_id = ? AND file_url IS NOT NULL LIMIT 1", [externalId]);
  return row ? { url: row.file_url, name: row.name, thumbnail: row.thumbnail_url, author: row.author, license: row.license, source: row.source, externalId } : null;
}

/** Put the chosen real chairs and tables on a scene (unknown or missing styles keep the defaults). */
export async function furnish(objects, design = {}) {
  const chair = CHAIR_STYLES[design.chairStyle] ? await assetFor(CHAIR_STYLES[design.chairStyle].externalId) : null;
  const tableId = TABLE_STYLES[design.tableStyle]?.externalId;
  const table = tableId ? await assetFor(tableId) : null;
  return objects.map((o) => {
    if (o.type === "chair" && chair) { const { tint, ...rest } = o; return { ...rest, asset: chair }; } // its own finish, not a tint
    if (o.type === "round_table" && table) return { ...o, asset: table, linen: false };
    return o;
  });
}
