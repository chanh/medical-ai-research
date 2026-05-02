/* tree.js — D3.js v7 horizontal tree visualization */
(function (global) {
  'use strict';

  function render(selector, treeData, chapterColors, onDiseaseClick) {
    const container = document.querySelector(selector);
    if (!container || !window.d3) return;

    container.innerHTML = '';
    const W = container.clientWidth || 900;
    const H = container.clientHeight || 600;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', W)
      .attr('height', H)
      .style('display', 'block');

    const defs = svg.append('defs');
    defs.append('filter').attr('id', 'glow')
      .html('<feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>');

    const g = svg.append('g').attr('transform', 'translate(40,0)');

    const zoom = d3.zoom()
      .scaleExtent([0.1, 3])
      .on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoom);

    // Build hierarchy from tree array
    const root = {
      id: 'root', name: 'ICD-11', node_type: 'root',
      children: treeData
    };

    let hierarchyRoot = d3.hierarchy(root, d => d._collapsed ? null : (d.children || []));
    hierarchyRoot._fullData = root;

    // Store full children for collapse
    function storeChildren(node) {
      node._children = node.data.children || [];
      node.data._allChildren = node.data.children || [];
      if (node.children) node.children.forEach(storeChildren);
    }
    function buildHierarchy(data) {
      return d3.hierarchy(data, d => {
        if (d._collapsed) return null;
        return d.children;
      });
    }

    let rootData = JSON.parse(JSON.stringify(root));

    // Collapse all chapters by default (show only root + chapters)
    rootData.children.forEach(ch => {
      ch._collapsed = true;
    });

    let currentRoot = d3.hierarchy(rootData, d => d._collapsed ? null : (d.children || []));

    const color = d3.scaleOrdinal()
      .domain(d3.range(1, 27))
      .range(chapterColors.slice(1));

    function getColor(d) {
      if (d.data.node_type === 'root') return '#6366f1';
      if (d.data.node_type === 'chapter') {
        const idx = rootData.children.findIndex(c => c.id === d.data.id);
        return chapterColors[idx + 1] || '#6366f1';
      }
      // Walk up to chapter
      let cur = d;
      while (cur && cur.data.node_type !== 'chapter') cur = cur.parent;
      if (cur) {
        const idx = rootData.children.findIndex(c => c.id === cur.data.id);
        return chapterColors[idx + 1] || '#6366f1';
      }
      return '#6366f1';
    }

    function update() {
      currentRoot = d3.hierarchy(rootData, d => d._collapsed ? null : (d.children || []));

      const treeLayout = d3.tree()
        .nodeSize([22, 220])
        .separation((a, b) => (a.parent === b.parent ? 1 : 1.4));

      treeLayout(currentRoot);

      const nodes = currentRoot.descendants();
      const links = currentRoot.links();

      // Links
      const link = g.selectAll('.link')
        .data(links, d => `${d.source.data.id}-${d.target.data.id}`);

      const linkEnter = link.enter().append('path')
        .attr('class', 'link')
        .style('fill', 'none')
        .style('stroke', d => getColor(d.target))
        .style('stroke-opacity', 0.35)
        .style('stroke-width', 1.5);

      link.merge(linkEnter)
        .transition().duration(300)
        .attr('d', d3.linkHorizontal()
          .x(d => d.y)
          .y(d => d.x));

      link.exit().remove();

      // Nodes
      const node = g.selectAll('.node')
        .data(nodes, d => d.data.id);

      const nodeEnter = node.enter().append('g')
        .attr('class', d => `node node-${d.data.node_type}`)
        .attr('transform', d => `translate(${d.y},${d.x})`)
        .style('cursor', d => (d.data.node_type === 'disease' || d.data._allChildren?.length > 0 || d.data.children?.length > 0) ? 'pointer' : 'default')
        .on('click', function (event, d) {
          event.stopPropagation();
          if (d.data.node_type === 'disease') {
            if (onDiseaseClick) onDiseaseClick(d.data.id);
          } else if (d.data.node_type !== 'root') {
            d.data._collapsed = !d.data._collapsed;
            update();
          }
        });

      // Shapes
      nodeEnter.each(function (d) {
        const sel = d3.select(this);
        const c = getColor(d);
        if (d.data.node_type === 'root') {
          sel.append('rect')
            .attr('x', -45).attr('y', -12).attr('width', 90).attr('height', 24)
            .attr('rx', 6).style('fill', '#1a1d27').style('stroke', c).style('stroke-width', 2);
        } else if (d.data.node_type === 'chapter') {
          sel.append('rect')
            .attr('x', -60).attr('y', -10).attr('width', 120).attr('height', 20)
            .attr('rx', 4).style('fill', c + '22').style('stroke', c).style('stroke-width', 1.5);
        } else if (d.data.node_type === 'block') {
          sel.append('rect')
            .attr('x', -50).attr('y', -8).attr('width', 100).attr('height', 16)
            .attr('rx', 3).style('fill', '#252836').style('stroke', c).style('stroke-width', 1);
        } else {
          // disease — circle
          sel.append('circle')
            .attr('r', 5)
            .style('fill', c + '66')
            .style('stroke', c)
            .style('stroke-width', 1.5);
        }
      });

      // Labels
      nodeEnter.append('text')
        .attr('dy', d => d.data.node_type === 'disease' ? '.35em' : '.35em')
        .attr('x', d => {
          if (d.data.node_type === 'root') return 0;
          if (d.data.node_type === 'chapter' || d.data.node_type === 'block') return 0;
          return 9;
        })
        .attr('text-anchor', d => {
          if (d.data.node_type === 'root' || d.data.node_type === 'chapter' || d.data.node_type === 'block') return 'middle';
          return 'start';
        })
        .style('font-size', d => {
          if (d.data.node_type === 'root') return '11px';
          if (d.data.node_type === 'chapter') return '9px';
          if (d.data.node_type === 'block') return '8px';
          return '8px';
        })
        .style('fill', d => {
          if (d.data.node_type === 'root') return '#e2e8f0';
          if (d.data.node_type === 'chapter') return '#e2e8f0';
          return '#94a3b8';
        })
        .style('pointer-events', 'none')
        .text(d => {
          const n = d.data.name || '';
          if (d.data.node_type === 'root') return 'ICD-11';
          if (d.data.node_type === 'disease') return n.length > 22 ? n.slice(0, 20) + '…' : n;
          return n.length > 18 ? n.slice(0, 16) + '…' : n;
        });

      // Merge & update
      node.merge(nodeEnter)
        .transition().duration(300)
        .attr('transform', d => `translate(${d.y},${d.x})`);

      node.exit().remove();

      // Center view
      svg.call(zoom.transform, d3.zoomIdentity.translate(W / 4, H / 2));
    }

    update();

    return {
      expandAll() {
        function expand(d) {
          d._collapsed = false;
          if (d.children) d.children.forEach(expand);
        }
        expand(rootData);
        update();
      },
      collapseAll() {
        rootData.children.forEach(ch => { ch._collapsed = true; });
        update();
      },
      resetZoom() {
        svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(W / 4, H / 2));
      }
    };
  }

  global.TreeViz = { render };
})(window);
