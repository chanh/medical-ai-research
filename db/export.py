#!/usr/bin/env python3
"""
Export diseases.db → two JSON files for the static frontend.

  public/data/diseases.json  (~2 MB)  – tree + nav flat (loaded upfront)
  public/data/details.json   (~3 MB)  – full disease data (lazy-loaded)
"""
import sqlite3, json, os, datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "diseases.db")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")
os.makedirs(OUT_DIR, exist_ok=True)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
c = conn.cursor()

print("Loading all nodes ...")
c.execute("SELECT id, doid, code, name, description, parent_id, level, node_type, aliases, xrefs, is_rare, sources FROM nodes")
rows = c.fetchall()
print(f"  {len(rows)} nodes")

# ── 1. Build children map ──────────────────────────────────────────────────────
children_map = {}   # parent_id_str -> [child_id_str, ...]
for r in rows:
    pid = r["parent_id"]
    if pid is not None:
        children_map.setdefault(str(pid), []).append(str(r["id"]))

# Sort children alphabetically by name for each parent
id_to_name = {str(r["id"]): r["name"] for r in rows}
for pid in children_map:
    children_map[pid].sort(key=lambda cid: id_to_name.get(cid, ""))

# ── 2. Build flat_nav (minimal — for tree nav, breadcrumbs, chapterColor) ─────
print("Building nav flat ...")
flat_nav = {}
for r in rows:
    flat_nav[str(r["id"])] = {
        "id":        r["id"],
        "doid":      r["doid"],
        "code":      r["code"],
        "name":      r["name"],
        "parent_id": r["parent_id"],
        "level":     r["level"],
        "node_type": r["node_type"],
        "is_rare":   bool(r["is_rare"]),
        "childIds":  [int(cid) for cid in children_map.get(str(r["id"]), [])],
        # Short description for category cards
        "desc":      (r["description"] or "")[:180] or None,
    }

# ── 3. Assign CH codes to level-1 nodes ───────────────────────────────────────
chapter_ids = sorted(
    [sid for sid, n in flat_nav.items() if n["level"] == 1],
    key=lambda sid: flat_nav[sid]["name"]
)
for i, cid in enumerate(chapter_ids):
    flat_nav[cid]["code"]      = f"CH{i+1}"
    flat_nav[cid]["node_type"] = "chapter"

# ── 4. Build minimal nested tree (for D3 vis — 3 levels max) ─────────────────
def build_tree_node(sid, max_level=3):
    n = flat_nav[sid]
    result = {
        "id":        n["id"],
        "code":      n["code"],
        "name":      n["name"],
        "node_type": n["node_type"],
        "is_rare":   n["is_rare"],
    }
    child_ids = [str(cid) for cid in n["childIds"]]
    if child_ids and flat_nav[sid]["level"] < max_level:
        result["children"] = [build_tree_node(cid, max_level) for cid in child_ids]
    else:
        result["hasChildren"] = len(child_ids) > 0
        result["children"] = []
    return result

print("Building tree ...")
tree = [build_tree_node(cid) for cid in chapter_ids]

# ── 5. Write diseases.json ─────────────────────────────────────────────────────
total_diseases = sum(1 for n in flat_nav.values() if n["node_type"] == "disease")
diseases_out = {
    "version":        "2.0-DO",
    "generated_at":   datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "total_diseases": total_diseases,
    "tree":           tree,
    "flat":           flat_nav,
}
diseases_path = os.path.join(OUT_DIR, "diseases.json")
with open(diseases_path, "w") as f:
    json.dump(diseases_out, f, separators=(",", ":"))
print(f"  diseases.json: {os.path.getsize(diseases_path)//1024} KB  ({total_diseases} diseases, {len(flat_nav)} total nodes)")

# ── 6. Build and write details.json (disease leaf nodes only) ─────────────────
print("Building details ...")
details = {}
for r in rows:
    if flat_nav[str(r["id"])]["node_type"] not in ("disease", "category"):
        continue  # skip root
    aliases = json.loads(r["aliases"]) if r["aliases"] else []
    xrefs   = json.loads(r["xrefs"])   if r["xrefs"]   else {}
    sources = json.loads(r["sources"]) if r["sources"] else []

    details[str(r["id"])] = {
        "description": r["description"],
        "aliases":     aliases[:8],
        "xrefs":       {k: v[:3] for k, v in xrefs.items()
                        if k in ("ICD10CM","MIM","MESH","NCI","ORDO","GARD")},
    }

details_path = os.path.join(OUT_DIR, "details.json")
with open(details_path, "w") as f:
    json.dump(details, f, separators=(",", ":"))
print(f"  details.json:  {os.path.getsize(details_path)//1024} KB  ({len(details)} nodes)")

conn.close()
print("Done.")
