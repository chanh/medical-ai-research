#!/usr/bin/env python3
"""
Export diseases.db → two JSON files for the static frontend.

  public/data/diseases.json  – tree + nav flat (loaded upfront)
  public/data/details.json   – full disease data (lazy-loaded)
"""
import sqlite3, json, os, datetime, ast

def parse_list(val):
    if not val:
        return []
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        try:
            return ast.literal_eval(val)
        except Exception:
            return []

DB_PATH = os.path.join(os.path.dirname(__file__), "diseases.db")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")
os.makedirs(OUT_DIR, exist_ok=True)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
c = conn.cursor()

print("Loading all nodes ...")
c.execute("""
    SELECT id, code, name, description, parent_id, node_type,
           aliases, causes, symptoms, affected_worldwide, prevalence_text,
           mortality_rate, is_rare, onset, treatments, sources, research_links
    FROM nodes
""")
rows = c.fetchall()
print(f"  {len(rows)} nodes")

# Derive level from node_type
TYPE_LEVEL = {"chapter": 0, "block": 1, "disease": 2}

# ── 1. Build children map ──────────────────────────────────────────────────────
children_map = {}
for r in rows:
    pid = r["parent_id"]
    if pid is not None:
        children_map.setdefault(str(pid), []).append(str(r["id"]))

id_to_name = {str(r["id"]): r["name"] for r in rows}
for pid in children_map:
    children_map[pid].sort(key=lambda cid: id_to_name.get(cid, ""))

# ── 2. Build flat_nav (minimal — for tree nav, breadcrumbs, chapterColor) ─────
print("Building nav flat ...")
flat_nav = {}
for r in rows:
    nt = r["node_type"]
    flat_nav[str(r["id"])] = {
        "id":        r["id"],
        "code":      r["code"],
        "name":      r["name"],
        "parent_id": r["parent_id"],
        "level":     TYPE_LEVEL.get(nt, 2),
        "node_type": nt,
        "is_rare":   bool(r["is_rare"]),
        "childIds":  [int(cid) for cid in children_map.get(str(r["id"]), [])],
        "desc":      (r["description"] or "")[:180] or None,
    }

# ── 3. Find chapter (level=0) nodes for tree root ─────────────────────────────
chapter_ids = sorted(
    [sid for sid, n in flat_nav.items() if n["level"] == 0],
    key=lambda sid: flat_nav[sid]["id"]
)

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
    "version":        "2.0-ICD11",
    "generated_at":   datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "total_diseases": total_diseases,
    "tree":           tree,
    "flat":           flat_nav,
}
diseases_path = os.path.join(OUT_DIR, "diseases.json")
with open(diseases_path, "w") as f:
    json.dump(diseases_out, f, separators=(",", ":"))
print(f"  diseases.json: {os.path.getsize(diseases_path)//1024} KB  ({total_diseases} diseases, {len(flat_nav)} total nodes)")

# ── 6. Build and write details.json ───────────────────────────────────────────
print("Building details ...")
details = {}
for r in rows:
    if flat_nav[str(r["id"])]["node_type"] not in ("disease", "block"):
        continue
    details[str(r["id"])] = {
        "description":        r["description"],
        "aliases":            parse_list(r["aliases"]),
        "causes":             parse_list(r["causes"]),
        "symptoms":           parse_list(r["symptoms"]),
        "treatments":         parse_list(r["treatments"]),
        "affected_worldwide": r["affected_worldwide"],
        "prevalence_text":    r["prevalence_text"],
        "mortality_rate":     r["mortality_rate"],
        "onset":              r["onset"],
        "sources":            parse_list(r["sources"]),
        "research_links":     parse_list(r["research_links"]),
    }

details_path = os.path.join(OUT_DIR, "details.json")
with open(details_path, "w") as f:
    json.dump(details, f, separators=(",", ":"))
print(f"  details.json:  {os.path.getsize(details_path)//1024} KB  ({len(details)} nodes)")

# ── 7. Write JS globals for file:// protocol ──────────────────────────────────
print("Writing JS data files (for file:// mode) ...")
js_dir = os.path.join(OUT_DIR, "..", "js")
os.makedirs(js_dir, exist_ok=True)

diseases_js_path = os.path.join(js_dir, "data-diseases.js")
with open(diseases_js_path, "w") as f:
    f.write("/* Auto-generated by db/export.py — do not edit */\n")
    f.write("window.__DISEASES__=")
    json.dump(diseases_out, f, separators=(",", ":"))
    f.write(";")
print(f"  data-diseases.js: {os.path.getsize(diseases_js_path)//1024} KB")

details_js_path = os.path.join(js_dir, "data-details.js")
with open(details_js_path, "w") as f:
    f.write("/* Auto-generated by db/export.py — do not edit */\n")
    f.write("window.__DETAILS__=")
    json.dump(details, f, separators=(",", ":"))
    f.write(";")
print(f"  data-details.js:  {os.path.getsize(details_js_path)//1024} KB")

print("Done.")
