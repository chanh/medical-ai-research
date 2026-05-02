#!/usr/bin/env python3
"""
Import Human Disease Ontology (DOID) into diseases.db.

Source: https://github.com/DiseaseOntology/HumanDiseaseOntology
Download doid.obo from:
  https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/src/ontology/doid.obo

Usage:
  curl -L -o db/doid.obo https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/src/ontology/doid.obo
  python3 db/seed.py
"""
import sqlite3, re, json, os
import obonet, networkx as nx

DB_PATH  = os.path.join(os.path.dirname(__file__), "diseases.db")
OBO_PATH = os.path.join(os.path.dirname(__file__), "doid.obo")


def clean_def(raw):
    if not raw:
        return None
    cleaned = re.sub(r'\s*\[.*?\]\s*$', '', raw.strip().strip('"'))
    return cleaned.strip() or None


def parse_synonyms(syn_list):
    result = []
    for s in (syn_list or []):
        m = re.match(r'"([^"]+)"', s)
        if m:
            result.append(m.group(1))
    return result


def extract_xrefs(xref_list):
    xrefs = {}
    for x in (xref_list or []):
        if ':' in x:
            prefix, val = x.split(':', 1)
            xrefs.setdefault(prefix, []).append(val)
    return xrefs


def build_sources(xrefs):
    sources = []
    for code in xrefs.get('ICD10CM', [])[:2]:
        sources.append({"title": f"ICD-10-CM: {code}",
                        "url": f"https://icd.who.int/browse10/2019/en#/{code}"})
    for code in xrefs.get('MESH', [])[:1]:
        sources.append({"title": f"MeSH: {code}",
                        "url": f"https://meshb.nlm.nih.gov/record/ui?ui={code}"})
    for code in xrefs.get('MIM', [])[:2]:
        sources.append({"title": f"OMIM: {code}",
                        "url": f"https://www.omim.org/entry/{code}"})
    return sources


def main():
    print(f"Reading {OBO_PATH} ...")
    g = obonet.read_obo(OBO_PATH)
    print(f"  {len(g.nodes)} nodes, {len(g.edges)} edges")

    # Parent map (first is_a parent)
    parent_map = {}
    for node_id in g.nodes:
        parents = list(g.successors(node_id))
        if parents:
            parent_map[node_id] = parents[0]

    # Topological sort → assign integer IDs parent-first
    try:
        topo = list(reversed(list(nx.topological_sort(g))))
    except nx.NetworkXUnfeasible:
        topo = list(g.nodes)

    doid_to_int = {doid: i + 1 for i, doid in enumerate(topo)}

    # Rare disease set
    rare_ids = set()
    for nid, data in g.nodes(data=True):
        subsets = data.get('subset', [])
        if isinstance(subsets, str):
            subsets = [subsets]
        if any('rare' in s.lower() for s in subsets):
            rare_ids.add(nid)

    # Create DB
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE nodes (
            id INTEGER PRIMARY KEY,
            doid TEXT UNIQUE,
            code TEXT,
            name TEXT NOT NULL,
            description TEXT,
            parent_id INTEGER,
            level INTEGER NOT NULL DEFAULT 0,
            node_type TEXT NOT NULL DEFAULT 'category',
            aliases TEXT,
            xrefs TEXT,
            is_rare INTEGER DEFAULT 0,
            sources TEXT,
            FOREIGN KEY (parent_id) REFERENCES nodes(id)
        );
        CREATE INDEX idx_nodes_parent ON nodes(parent_id);
        CREATE INDEX idx_nodes_doid ON nodes(doid);
        CREATE INDEX idx_nodes_name ON nodes(name);
    """)

    # Depth cache
    depth_cache = {}
    def get_depth(nid):
        if nid in depth_cache:
            return depth_cache[nid]
        p = parent_map.get(nid)
        d = (get_depth(p) + 1) if p else 0
        depth_cache[nid] = d
        return d

    inserted = skipped = 0
    for doid in topo:
        data = g.nodes[doid]
        name = data.get('name', '')
        if not name or data.get('is_obsolete'):
            skipped += 1
            continue

        node_id    = doid_to_int[doid]
        parent_doid = parent_map.get(doid)
        parent_id  = doid_to_int.get(parent_doid) if parent_doid else None
        description = clean_def(data.get('def'))
        synonyms   = parse_synonyms(data.get('synonym', []))
        xrefs_raw  = data.get('xref', [])
        if isinstance(xrefs_raw, str):
            xrefs_raw = [xrefs_raw]
        xrefs      = extract_xrefs(xrefs_raw)
        code       = (xrefs.get('ICD10CM') or [doid])[0]
        sources    = build_sources(xrefs)
        depth      = get_depth(doid)
        has_children = len(list(g.predecessors(doid))) > 0
        node_type  = 'root' if depth == 0 else ('category' if (depth <= 2 or has_children) else 'disease')

        c.execute("""
            INSERT INTO nodes (id, doid, code, name, description, parent_id, level, node_type, aliases, xrefs, is_rare, sources)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (node_id, doid, code, name, description, parent_id, depth, node_type,
              json.dumps(synonyms) if synonyms else None,
              json.dumps(xrefs) if xrefs else None,
              1 if doid in rare_ids else 0,
              json.dumps(sources) if sources else None))
        inserted += 1

    conn.commit()
    c.executescript("""
        CREATE VIRTUAL TABLE nodes_fts USING fts5(name, description, content=nodes, content_rowid=id);
        INSERT INTO nodes_fts(rowid, name, description)
            SELECT id, name, coalesce(description,'') FROM nodes;
    """)
    conn.commit()
    conn.close()
    print(f"  Inserted: {inserted}, Skipped: {skipped}")
    print(f"  DB: {DB_PATH}")


if __name__ == "__main__":
    main()
