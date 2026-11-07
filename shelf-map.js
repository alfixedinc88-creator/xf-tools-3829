// 🗺 The shelving map (owner 2026-10-30), shared by Inventory → 📥 Put on Shelf and Pack & Ship → 🧭 Picking by scan (owner 2026-11-07).
// The code between the two markers is the SAME as inventory.html's (a keep-working check fails when they differ) — change it there, then here.
(function() {
// ── from inventory.html ──
  var INV_SHELF_MAP = {
    shelves: [
      { id: 's4', x: 340, y: 38, w: 125, h: 62 }, { id: 's3', x: 485, y: 38, w: 115, h: 62 }, { id: 's2', x: 615, y: 38, w: 100, h: 62 },
      { id: 's5', x: 285, y: 145, w: 52, h: 135 }, { id: 's21', x: 35, y: 355, w: 70, h: 145 },
      { id: 'A', x: 355, y: 340, w: 315, h: 70 }, { id: 'B', x: 355, y: 535, w: 315, h: 70 }, { id: 'C', x: 340, y: 715, w: 330, h: 65 },
      { id: 'D', x: 340, y: 880, w: 330, h: 85 }, { id: 'F', x: 715, y: 615, w: 55, h: 340 }, { id: 's32', x: 820, y: 950, w: 40, h: 130 },
      { id: 'E', x: 345, y: 1090, w: 515, h: 75 }, { id: 'R1', x: 875, y: 605, w: 210, h: 40 }, { id: 'R2', x: 875, y: 715, w: 190, h: 40 }, { id: 'R3', x: 1055, y: 645, w: 30, h: 70 },
      { id: 'G', x: 690, y: 318, w: 58, h: 285 } ],
    faces: [
      { n: '4', s: 's4', side: 'b' }, { n: '3', s: 's3', side: 'b' }, { n: '2', s: 's2', side: 'b' }, { n: '5', s: 's5', side: 'r' }, { n: '21', s: 's21', side: 'r' },
      { n: '23', s: 'A', side: 'b' }, { n: '24', s: 'B', side: 't' }, { n: '25', s: 'B', side: 'b' }, { n: '26', s: 'C', side: 't' }, { n: '27', s: 'C', side: 'b' },
      { n: '28', s: 'D', side: 't' }, { n: '29', s: 'D', side: 'b' }, { n: '30', s: 'F', side: 'l', lx: 706, ly: 845 }, { n: '31', s: 'F', side: 'r', lx: 780, ly: 845 }, { n: '32', s: 's32', side: 'l' }, // 30 / 31: next to its own half (owner)
      { n: '201', s: 'E', side: 't' }, { n: '202', s: 'E', side: 'b' }, { n: '34', s: 'R1', side: 'b', lx: 866, ly: 636 }, { n: '33', s: 'R2', side: 't', lx: 866, ly: 746 },
      { n: '42', s: 'G', side: 'r', name: 'Basement' } ], // name: said with the number (owner: "42 — write Basement too") // owner (2026-10-30): "the basement (box on the map) is one of our shelves too, number 42"
    other: [ { t: 'box', x: 15, y: 640, w: 80, h: 155, label: 'Packing' }, { t: 'box', x: 15, y: 1020, w: 85, h: 140, label: 'Packing' } ],
    text: [ { x: 470, y: 205, t: 'FRONT OFFICE' }, { x: 200, y: 470, t: 'FRONT', rot: 90 }, { x: 205, y: 1060, t: 'BACK', rot: 90 }, { x: 1110, y: 690, t: 'SMALL ROOM', rot: 90 } ]
  };
  function invShelfName(no) { var f = INV_SHELF_MAP.faces.filter(function(x) { return x.n === String(no); })[0]; return f && f.name ? f.name : ''; }
  function invShelfNo(part) { var m = /^\s*(\d+)/.exec(String(part || '')); return m ? String(parseInt(m[1], 10)) : ''; }
  // the map (SVG) with the shelf face of this part # lit up; '' part = the whole map
  function invShelfMapHtml(part) {
    var M = INV_SHELF_MAP, n = invShelfNo(part), hit = M.faces.filter(function(f) { return f.n === n; })[0], S = {};
    M.shelves.forEach(function(r) { S[r.id] = r; });
    var e = function(v) { return String(v).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var svg = '<svg class="ps2-map-svg" viewBox="0 0 1140 1260" style="width:100%;max-width:440px;height:auto;display:block;margin:0 auto;background:#fff;border-radius:10px" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">';
    M.other.forEach(function(o) { svg += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" fill="#f1f5f9" stroke="#94a3b8" stroke-width="4" stroke-dasharray="10 6"/>'
      + '<text x="' + (o.x + o.w / 2) + '" y="' + (o.y + o.h / 2) + '" font-size="26" fill="#475569" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ' + (o.x + o.w / 2) + ' ' + (o.y + o.h / 2) + ')">' + e(o.label) + '</text>'; });
    // 🔀 Owner (2026-10-30): "split 28 and 29 into two — if 202 gets picked only the 202 half turns red, 201 stays the same colour": a shelf
    // with 2 numbers is drawn as 2 halves (a line down the middle); only the half of the number lit is coloured.
    var faces2 = {}; M.faces.forEach(function(f) { faces2[f.s] = (faces2[f.s] || 0) + 1; });
    M.shelves.forEach(function(r) {
      svg += '<rect class="ps2-shelf" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#cbd5e1" stroke="#475569" stroke-width="3" rx="4"/>';
      var two = faces2[r.id] > 1, on = hit && hit.s === r.id, wide = r.w >= r.h;
      if (on) { var hx = r.x, hy = r.y, hw = r.w, hh = r.h;
        if (two) { if (hit.side === 'b') { hy = r.y + r.h / 2; hh = r.h / 2; } else if (hit.side === 't') { hh = r.h / 2; } else if (hit.side === 'r') { hx = r.x + r.w / 2; hw = r.w / 2; } else { hw = r.w / 2; } }
        svg += '<rect class="ps2-shelf-on" x="' + hx + '" y="' + hy + '" width="' + hw + '" height="' + hh + '" fill="#f87171" stroke="#c2410c" stroke-width="6" rx="4"/>'; }
      M.faces.forEach(function(f) { if (f.s === r.id && f.name) { var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        svg += '<text x="' + cx + '" y="' + cy + '" font-size="26" font-weight="800" fill="#1e293b" text-anchor="middle" dominant-baseline="middle"' + (wide ? '' : ' transform="rotate(90 ' + cx + ' ' + cy + ')"') + '>' + e(f.name.toUpperCase()) + '</text>'; } });
      if (two) svg += wide ? '<line x1="' + r.x + '" y1="' + (r.y + r.h / 2) + '" x2="' + (r.x + r.w) + '" y2="' + (r.y + r.h / 2) + '" stroke="#475569" stroke-width="3"/>'
        : '<line x1="' + (r.x + r.w / 2) + '" y1="' + r.y + '" x2="' + (r.x + r.w / 2) + '" y2="' + (r.y + r.h) + '" stroke="#475569" stroke-width="3"/>';
    });
    M.text.forEach(function(t) { svg += '<text x="' + t.x + '" y="' + t.y + '" font-size="34" font-weight="700" fill="#64748b" text-anchor="middle"' + (t.rot ? ' transform="rotate(' + t.rot + ' ' + t.x + ' ' + t.y + ')"' : '') + '>' + e(t.t) + '</text>'; });
    M.faces.forEach(function(f) { var r = S[f.s], on = hit === f, pad = 26, x, y;
      x = f.side === 'l' ? r.x - pad : f.side === 'r' ? r.x + r.w + pad : r.x + 4; y = f.side === 't' ? r.y - 12 : f.side === 'b' ? r.y + r.h + 32 : r.y + r.h - 10;
      if (f.side === 't' || f.side === 'b') { x = r.x - 6; }
      if (f.lx) { x = f.lx; y = f.ly; } // a label placed by hand (the small room)
      var anchor = f.side === 'l' ? 'end' : f.side === 'r' ? 'start' : 'end';
      if (f.side === 't' || f.side === 'b') { svg += '<text class="ps2-face' + (on ? ' ps2-face-on' : '') + '" x="' + x + '" y="' + y + '" font-size="' + (on ? 44 : 28) + '" font-weight="' + (on ? 900 : 700) + '" fill="' + (on ? '#c2410c' : '#1e293b') + '" text-anchor="end">' + e(f.n) + '</text>'; }
      else svg += '<text class="ps2-face' + (on ? ' ps2-face-on' : '') + '" x="' + x + '" y="' + y + '" font-size="' + (on ? 44 : 28) + '" font-weight="' + (on ? 900 : 700) + '" fill="' + (on ? '#c2410c' : '#1e293b') + '" text-anchor="' + anchor + '">' + e(f.n) + '</text>';
      if (on) { // the face itself: a thick line + an arrow pointing at it
        var x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y;
        if (f.side === 'b') { y1 = y2 = r.y + r.h; } if (f.side === 'l') { x2 = r.x; y2 = r.y + r.h; } if (f.side === 'r') { x1 = x2 = r.x + r.w; y2 = r.y + r.h; }
        svg += '<line class="ps2-face-line" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#dc2626" stroke-width="16" stroke-linecap="round"/>';
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = f.side === 'l' ? -1 : f.side === 'r' ? 1 : 0, dy = f.side === 't' ? -1 : f.side === 'b' ? 1 : 0;
        svg += '<text x="' + (mx + dx * 80) + '" y="' + (my + dy * 80 + 18) + '" font-size="64" text-anchor="middle">' + (dy < 0 ? '⬇' : dy > 0 ? '⬆' : dx < 0 ? '➡' : '⬅') + '</text>';
      } });
    svg += '</svg>';
    return '<div class="ps2-map" style="margin-top:8px;padding:8px;border-radius:10px;border:2px solid ' + (hit ? '#c2410c' : 'var(--border)') + ';background:var(--bg2)">'
      + '<div style="font-size:13px;font-weight:800;margin-bottom:4px;color:' + (hit ? '#c2410c' : 'var(--text2)') + '">' + (hit ? '🗺 Shelf <span style="font-size:20px">' + e(n) + '</span>' + (hit.name ? ' <span style="font-size:18px">(' + e(hit.name) + ')</span>' : '') + ' — the red side on the map' : n ? '🗺 Shelf ' + e(n) + ' is not on the map yet (basement / other room?) — tell the office' : '🗺 The shelf map') + '</div>' + svg + '</div>';
  }
// ── end ──
  window.xfShelfMapHtml = invShelfMapHtml; window.xfShelfNo = invShelfNo; window.xfShelfName = invShelfName;
})();
