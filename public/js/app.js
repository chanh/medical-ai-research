/* app.js — Disease Directory
 * Data sources:
 *   data/diseases.json  – tree + flat_nav (loaded upfront)
 *   data/details.json   – full disease data (lazy-loaded on first disease view)
 */
(function () {
  'use strict';

  // ── Colour palette (8 DO top-level categories) ──────────────────────────────
  const CHAPTER_COLORS = [
    null,
    '#ef4444','#f97316','#f59e0b','#eab308',
    '#84cc16','#22c55e','#10b981','#14b8a6',
  ];

  // State
  let DATA    = null;  // { version, total_diseases, tree, flat }
  let DETAILS = null;  // lazy: { id: { description, aliases, xrefs } }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const qs  = (s, r) => (r || document).querySelector(s);
  const qsa = (s, r) => [...(r || document).querySelectorAll(s)];

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    children.flat(Infinity).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ── Chapter colours ──────────────────────────────────────────────────────────
  const chapterIdxMap = {};  // chapter_id → index (1-based)

  function buildChapterMap() {
    DATA.tree.forEach((ch, i) => { chapterIdxMap[String(ch.id)] = i + 1; });
  }

  function chapterColorFor(nodeId) {
    let cur = DATA.flat[String(nodeId)];
    while (cur && cur.node_type !== 'chapter') {
      if (cur.parent_id == null) break;
      cur = DATA.flat[String(cur.parent_id)];
    }
    if (cur) {
      const idx = chapterIdxMap[String(cur.id)] || 0;
      return CHAPTER_COLORS[idx] || '#6366f1';
    }
    return '#6366f1';
  }

  function chapterOf(nodeId) {
    let cur = DATA.flat[String(nodeId)];
    while (cur && cur.node_type !== 'chapter') {
      if (cur.parent_id == null) return null;
      cur = DATA.flat[String(cur.parent_id)];
    }
    return cur || null;
  }

  // ── Views ────────────────────────────────────────────────────────────────────
  function showView(id) {
    qsa('.view').forEach(v => { v.hidden = (v.id !== id); });
  }

  // ── Data loading ─────────────────────────────────────────────────────────────
  async function loadData() {
    showView('view-loading');
    try {
      const res = await fetch('data/diseases.json');
      if (!res.ok) throw new Error(`HTTP ${res.status} loading diseases.json`);
      DATA = await res.json();
      buildChapterMap();
      buildSidebar();
      window.addEventListener('hashchange', () => { if (DATA) route(); });
      route();
    } catch (e) {
      showView('view-error');
      qs('#error-msg').textContent = e.message + ' — Serve via HTTP: cd public && python3 -m http.server 8080';
    }
  }

  async function ensureDetails() {
    if (DETAILS) return;
    const res = await fetch('data/details.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} loading details.json`);
    DETAILS = await res.json();
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  function buildSidebar() {
    const nav = qs('#chapter-nav');
    nav.innerHTML = '';
    DATA.tree.forEach((chapter, i) => {
      const color = CHAPTER_COLORS[i + 1] || '#6366f1';
      const link = el('a', {
        class: 'chapter-link',
        href:  `#/browse/${chapter.id}`,
        style: { '--chapter-color': color },
      },
        el('span', { class: 'chapter-dot' }),
        el('span', { class: 'chapter-num' }, `${i + 1}`),
        chapter.name
      );
      nav.appendChild(link);
    });
  }

  function setActiveChapter(chapterId) {
    qsa('.chapter-link').forEach(l => {
      l.classList.toggle('active', l.getAttribute('href') === `#/browse/${chapterId}`);
    });
  }

  // ── Router ───────────────────────────────────────────────────────────────────
  function route() {
    const hash  = location.hash || '#/';
    const parts = hash.slice(1).split('/').filter(Boolean);
    const view  = parts[0] || '';
    qsa('.chapter-link').forEach(l => l.classList.remove('active'));
    if (!view)              renderHome();
    else if (view === 'browse'  && parts[1]) renderBrowse(parts[1]);
    else if (view === 'disease' && parts[1]) renderDisease(parts[1]);
    else if (view === 'tree')                renderTree();
    else                                     renderHome();
    window.scrollTo(0, 0);
  }

  // ── Breadcrumb helper ────────────────────────────────────────────────────────
  function buildBreadcrumb(nodeId) {
    const path = [];
    let cur = DATA.flat[String(nodeId)];
    while (cur) {
      path.unshift(cur);
      cur = cur.parent_id != null ? DATA.flat[String(cur.parent_id)] : null;
    }
    const bc = el('div', { class: 'breadcrumb' });
    bc.appendChild(el('a', { href: '#/' }, 'Home'));
    path.forEach((n, i) => {
      bc.appendChild(document.createTextNode(' › '));
      if (i < path.length - 1) {
        bc.appendChild(el('a', { href: `#/browse/${n.id}` }, n.name));
      } else {
        bc.appendChild(el('span', null, n.name));
      }
    });
    return bc;
  }

  // ── Home View ─────────────────────────────────────────────────────────────────
  function renderHome() {
    showView('view-home');
    const container = qs('#view-home');
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'home-hero' },
      el('h1', null, '🧬 Disease Directory'),
      el('p', null,
        'Browse ', el('strong', null, DATA.total_diseases.toLocaleString()),
        ' diseases sourced from the ',
        el('a', { href: 'https://disease-ontology.org', target: '_blank', rel: 'noopener' },
           'Human Disease Ontology'),
        ' with cross-references to ICD-10, OMIM, MESH, NCI, Orphanet and more.'
      )
    ));
    container.appendChild(el('div', { class: 'stats-bar' },
      statCard(DATA.tree.length,            'Top Categories'),
      statCard(DATA.total_diseases,          'Diseases'),
      statCard(Object.keys(DATA.flat).length,'Total Nodes'),
      statCard('DO',                          'Ontology')
    ));
    container.appendChild(el('h2', { style: { margin: '1.5rem 0 .75rem' } }, 'Browse by Category'));
    const grid = el('div', { class: 'chapter-grid' });
    DATA.tree.forEach((ch, i) => {
      const color = CHAPTER_COLORS[i + 1] || '#6366f1';
      const diseaseCount = ch.childIds
        ? countDescInFlat(ch.id, 'disease')
        : 0;
      grid.appendChild(el('a', {
        class: 'chapter-card',
        href:  `#/browse/${ch.id}`,
        style: { '--chapter-color': color },
      },
        el('div', { class: 'cc-num' }, `${i + 1}`),
        el('div', { class: 'cc-name' }, ch.name),
        el('div', { class: 'cc-count' }, `${diseaseCount.toLocaleString()} diseases`)
      ));
    });
    container.appendChild(grid);
    container.appendChild(el('div', { class: 'home-footer' },
      el('a', { href: '#/tree' }, '🌳 View interactive tree'),
      ' · ',
      el('a', { href: 'https://github.com/DiseaseOntology/HumanDiseaseOntology', target: '_blank', rel: 'noopener' },
         'Disease Ontology on GitHub')
    ));
  }

  function statCard(num, label) {
    return el('div', { class: 'stat-card' },
      el('div', { class: 'stat-num' }, typeof num === 'number' ? num.toLocaleString() : num),
      el('div', { class: 'stat-label' }, label)
    );
  }

  function countDescInFlat(nodeId, type) {
    let count = 0;
    const node = DATA.flat[String(nodeId)];
    if (!node) return 0;
    if (node.node_type === type) count++;
    for (const cid of (node.childIds || [])) {
      count += countDescInFlat(cid, type);
    }
    return count;
  }

  // ── Browse / Category View ────────────────────────────────────────────────────
  function renderBrowse(id) {
    const node = DATA.flat[String(id)];
    if (!node) { renderHome(); return; }

    // If it's a disease leaf, show disease detail instead
    if (node.node_type === 'disease' || (node.childIds && node.childIds.length === 0)) {
      renderDisease(id);
      return;
    }

    showView('view-chapter');
    const container = qs('#view-chapter');
    container.innerHTML = '';

    const ch = chapterOf(id);
    if (ch) setActiveChapter(ch.id);
    const color = chapterColorFor(id);

    container.appendChild(buildBreadcrumb(id));
    container.appendChild(el('div', { class: 'chapter-header' },
      el('h1', null, node.name,
        node.is_rare ? el('span', { class: 'badge-rare' }, 'Rare') : null
      ),
      node.doid ? el('div', { class: 'chapter-code-badge' }, node.doid) : null,
      node.desc ? el('p', { class: 'chapter-desc' }, node.desc) : null
    ));

    const children = (node.childIds || []).map(cid => DATA.flat[String(cid)]).filter(Boolean);
    const categories = children.filter(c => c.node_type !== 'disease');
    const diseases   = children.filter(c => c.node_type === 'disease');

    if (categories.length > 0) {
      container.appendChild(el('h2', { class: 'section-heading' }, 'Subcategories'));
      const grid = el('div', { class: 'chapter-grid small' });
      categories.forEach(cat => {
        const childCount = (cat.childIds || []).length;
        const diseaseCount = countDescInFlat(cat.id, 'disease');
        grid.appendChild(el('a', {
          class: 'chapter-card',
          href:  `#/browse/${cat.id}`,
          style: { '--chapter-color': color },
        },
          el('div', { class: 'cc-name' }, cat.name),
          el('div', { class: 'cc-count' },
            diseaseCount > 0 ? `${diseaseCount.toLocaleString()} disease${diseaseCount !== 1 ? 's' : ''}` : `${childCount} subcategories`
          ),
          cat.desc ? el('div', { class: 'cc-desc' }, cat.desc) : null
        ));
      });
      container.appendChild(grid);
    }

    if (diseases.length > 0) {
      container.appendChild(el('h2', { class: 'section-heading' }, `Diseases (${diseases.length.toLocaleString()})`));
      const grid = el('div', { class: 'disease-grid' });
      diseases.forEach(d => grid.appendChild(diseaseCard(d, color)));
      container.appendChild(grid);
    }

    if (children.length === 0) {
      container.appendChild(el('p', { style: { color: 'var(--color-muted)', marginTop: '2rem' } }, 'No entries in this category.'));
    }
  }

  function diseaseCard(d, color) {
    return el('a', {
      class: 'disease-card',
      href:  `#/disease/${d.id}`,
      style: { '--chapter-color': color },
    },
      el('div', { class: 'dc-code' }, d.doid || d.code || ''),
      el('div', { class: 'dc-name' },
        d.name,
        d.is_rare ? el('span', { class: 'badge-rare' }, 'Rare') : null
      ),
      d.desc ? el('div', { class: 'dc-desc' }, d.desc) : null
    );
  }

  // ── Disease Detail View ───────────────────────────────────────────────────────
  async function renderDisease(id) {
    showView('view-disease');
    const container = qs('#view-disease');
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'loading-inline' }, 'Loading details…'));

    const nav = DATA.flat[String(id)];
    if (!nav) { renderHome(); return; }

    try {
      await ensureDetails();
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(el('p', { class: 'error-msg' }, 'Could not load details: ' + e.message));
      return;
    }

    const det = DETAILS[String(id)] || {};
    const d   = { ...nav, ...det };

    const ch = chapterOf(id);
    if (ch) setActiveChapter(ch.id);
    const color = chapterColorFor(id);

    container.innerHTML = '';
    container.appendChild(buildBreadcrumb(id));

    // Title row
    container.appendChild(el('div', { class: 'disease-title-row' },
      el('div', null,
        el('h1', null, d.name,
          d.is_rare ? el('span', { class: 'badge-rare' }, 'Rare Disease') : null
        ),
        el('div', { class: 'icd-code-pill', style: { '--chapter-color': color } }, d.doid || '')
      )
    ));

    if (d.description) {
      container.appendChild(el('p', { class: 'disease-desc' }, d.description));
    }

    // Aliases
    const aliases = d.aliases || [];
    if (aliases.length) container.appendChild(tagSection('Also Known As', aliases, 'alias'));

    // Cross-references grid
    const xrefs = d.xrefs || {};
    if (Object.keys(xrefs).length > 0) {
      container.appendChild(xrefSection(xrefs, d.name));
    }

    container.appendChild(linksSection(xrefs, d.name));
  }

  function xrefSection(xrefs, name) {
    const XREF_META = {
      ICD10CM: { label: 'ICD-10',    urlFn: c => `https://icd.who.int/browse10/2019/en#/${c}` },
      MIM:     { label: 'OMIM',      urlFn: c => `https://www.omim.org/entry/${c}` },
      MESH:    { label: 'MeSH',      urlFn: c => `https://meshb.nlm.nih.gov/record/ui?ui=${c}` },
      NCI:     { label: 'NCI',       urlFn: c => `https://ncit.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=${c}` },
      ORDO:    { label: 'Orphanet',  urlFn: c => `https://www.orpha.net/consor/cgi-bin/OC_Exp.php?Expert=${c}` },
      GARD:    { label: 'NIH GARD',  urlFn: c => `https://rarediseases.info.nih.gov/diseases/${c}/info` },
    };
    const section = el('div', { class: 'xref-section' });
    section.appendChild(el('h3', null, 'Database Cross-References'));
    const grid = el('div', { class: 'xref-grid' });
    Object.entries(xrefs).forEach(([key, codes]) => {
      const meta = XREF_META[key];
      if (!meta || !codes.length) return;
      const cell = el('div', { class: 'xref-cell' },
        el('div', { class: 'xref-label' }, meta.label),
        el('div', { class: 'xref-codes' },
          ...codes.map(c => el('a', {
            href: meta.urlFn(c), target: '_blank', rel: 'noopener',
            class: 'xref-code',
          }, c))
        )
      );
      grid.appendChild(cell);
    });
    section.appendChild(grid);
    return section;
  }

  function linksSection(xrefs, name) {
    const links = [];
    const pubmed = name.replace(/\s+/g, '+');
    links.push({ title: '🔬 PubMed — Latest Research', url: `https://pubmed.ncbi.nlm.nih.gov/?term=${pubmed}&sort=date` });
    links.push({ title: '📖 Wikipedia', url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(name)}` });
    links.push({ title: '🏥 MedlinePlus', url: `https://medlineplus.gov/search.html?query=${encodeURIComponent(name)}` });
    links.push({ title: '🔎 ClinicalTrials.gov', url: `https://clinicaltrials.gov/search?cond=${encodeURIComponent(name)}` });
    for (const mim of (xrefs.MIM || []).slice(0, 1))
      links.push({ title: `OMIM #${mim}`, url: `https://www.omim.org/entry/${mim}` });
    for (const gard of (xrefs.GARD || []).slice(0, 1))
      links.push({ title: `NIH GARD`, url: `https://rarediseases.info.nih.gov/diseases/${gard}/info` });
    for (const ordo of (xrefs.ORDO || []).slice(0, 1))
      links.push({ title: `Orphanet`, url: `https://www.orpha.net/consor/cgi-bin/OC_Exp.php?Expert=${ordo}` });

    return el('div', { class: 'links-section' },
      el('h3', null, 'External Resources'),
      el('div', { class: 'links-grid' },
        ...links.map(l => el('a', {
          class: 'ext-link', href: l.url, target: '_blank', rel: 'noopener',
        }, l.title))
      )
    );
  }

  function tagSection(title, items, cls) {
    return el('div', { class: 'tag-section' },
      el('h3', null, title),
      el('div', { class: 'tag-list' },
        ...items.map(item => el('span', { class: `tag ${cls}` }, item))
      )
    );
  }

  // ── Tree View ─────────────────────────────────────────────────────────────────
  function renderTree() {
    showView('view-tree');
    const container = qs('#view-tree');
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'tree-view-header' },
      el('h1', null, 'Disease Hierarchy — Interactive Tree'),
      el('p', null, 'Click category nodes to expand/collapse. Click a disease to view details.')
    ));
    const controls = el('div', { class: 'tree-controls' },
      el('button', { class: 'btn', id: 'btn-expand-all'   }, 'Expand All'),
      el('button', { class: 'btn', id: 'btn-collapse-all' }, 'Collapse All'),
      el('button', { class: 'btn', id: 'btn-reset-zoom'   }, 'Reset Zoom')
    );
    container.appendChild(controls);
    const treeContainer = el('div', { id: 'tree-container' });
    container.appendChild(treeContainer);
    setTimeout(() => {
      if (window.TreeViz) {
        const viz = window.TreeViz.render('#tree-container', DATA.tree, CHAPTER_COLORS, id => {
          location.hash = `#/disease/${id}`;
        });
        qs('#btn-expand-all').onclick    = () => viz.expandAll();
        qs('#btn-collapse-all').onclick  = () => viz.collapseAll();
        qs('#btn-reset-zoom').onclick    = () => viz.resetZoom();
      }
    }, 50);
  }

  // ── Search ────────────────────────────────────────────────────────────────────
  const searchInput   = qs('#search-input');
  const searchResults = qs('#search-results');
  let searchTimer     = null;

  function doSearch(q) {
    q = q.trim().toLowerCase();
    if (!DATA || q.length < 2) { searchResults.hidden = true; return; }

    const matches = [];
    Object.values(DATA.flat).forEach(n => {
      if (n.node_type !== 'disease') return;
      const name = (n.name || '').toLowerCase();
      const desc = (n.desc || '').toLowerCase();
      const score =
        (name === q                         ? 20 : 0) +
        (name.startsWith(q)                 ? 15 : 0) +
        (name.includes(q)                   ? 10 : 0) +
        ((n.doid || '').toLowerCase().includes(q) ?  8 : 0) +
        (desc.includes(q)                   ?  2 : 0);
      if (score > 0) matches.push({ score, node: n });
    });

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, 12);

    searchResults.innerHTML = '';
    if (!top.length) {
      searchResults.appendChild(el('div', { class: 'search-empty' }, 'No results found'));
    } else {
      top.forEach(({ node: n }) => {
        const item = el('div', { class: 'search-item' },
          el('span', { class: 's-code' }, n.doid || n.code || ''),
          el('div', null,
            el('div', { class: 's-name' }, n.name),
            el('div', { class: 's-snippet' }, (n.desc || '').slice(0, 80))
          )
        );
        item.addEventListener('click', () => {
          location.hash = `#/disease/${n.id}`;
          searchResults.hidden = true;
          searchInput.value = '';
        });
        searchResults.appendChild(item);
      });
    }
    searchResults.hidden = false;
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(searchInput.value), 200);
  });
  document.addEventListener('click', e => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.hidden = true;
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────────
  loadData();

})();
