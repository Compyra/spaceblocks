// House of Cards — chapters and level definitions.
// World is 1600x900. Each chapter changes the perspective / gravity:
//   side-down  — classic side view, gravity down, plasma floor at y=850
//   void       — head-on view, zero gravity, containment ring kills at its edge
//   deck       — top-down view, no gravity, sliding friction, deck edges kill
//   side-up    — side view, gravity points UP, plasma ceiling at y=60
//   side-right — side view, gravity points RIGHT, plasma wall at x=1560
// 'static' items are permanent, indestructible structures.
const CHAPTERS = (() => {
  const GROUND_TOP = 850;

  function makeAPI(items) {
    return {
      // Explicit block: x,y is the body center.
      block(x, y, w, h, mat = 'wood') {
        items.push({ kind: 'block', x, y, w, h, mat });
      },

      // Round block — it rolls. x,y is the center.
      ball(x, y, r, mat = 'wood') {
        items.push({ kind: 'ball', x, y, r, mat });
      },

      // Equilateral triangle, flat bottom with apex up (flip = apex down). r = circumradius.
      tri(x, y, r, mat = 'wood', flip = false) {
        items.push({ kind: 'tri', x, y, r, mat, flip });
      },

      // Regular hexagon, flat top/bottom (side = flat left/right instead). r = circumradius.
      hex(x, y, r, mat = 'wood', side = false) {
        items.push({ kind: 'hex', x, y, r, mat, side });
      },

      // Row of blocks with explicit per-block widths, centered on cx, standing on baseY.
      row(cx, baseY, widths, h, mat, gap = 2) {
        const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
        let x = cx - total / 2;
        widths.forEach((w, i) => {
          const m = typeof mat === 'function' ? mat(i) : mat;
          this.block(x + w / 2, baseY - h / 2, w, h - 2, m);
          x += w + gap;
        });
        return baseY - h;
      },

      staticRect(x, y, w, h) {
        items.push({ kind: 'static', x, y, w, h });
      },

      // Permanent pillar standing on the ground, with its top surface at topY.
      pillar(cx, w, topY) {
        this.staticRect(cx, (topY + GROUND_TOP) / 2, w, GROUND_TOP - topY);
        return topY;
      },

      // Permanent floating slab whose top surface is at topY.
      slab(cx, topY, w, h = 34) {
        this.staticRect(cx, topY + h / 2, w, h);
        return topY;
      },

      // Rectangular grid of blocks standing on a surface at baseY.
      // mat may be a string or a function (row, col) => material; row 0 is the bottom.
      stack(cx, baseY, cols, rows, bw, bh, mat) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const m = typeof mat === 'function' ? mat(r, c) : mat;
            this.block(cx + (c - (cols - 1) / 2) * bw, baseY - bh / 2 - r * bh, bw - 2, bh - 2, m);
          }
        }
        return baseY - rows * bh;
      },

      // Pyramid with baseCols blocks on the bottom row, shrinking by one per row.
      pyramid(cx, baseY, baseCols, bw, bh, mat) {
        for (let r = 0; r < baseCols; r++) {
          const cols = baseCols - r;
          for (let c = 0; c < cols; c++) {
            const m = typeof mat === 'function' ? mat(r, c) : mat;
            this.block(cx + (c - (cols - 1) / 2) * bw, baseY - bh / 2 - r * bh, bw - 2, bh - 2, m);
          }
        }
        return baseY - baseCols * bh;
      },

      // Grid hanging below a ceiling face at baseY (for gravity-up chapters).
      stackDown(cx, baseY, cols, rows, bw, bh, mat) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const m = typeof mat === 'function' ? mat(r, c) : mat;
            this.block(cx + (c - (cols - 1) / 2) * bw, baseY + bh / 2 + r * bh, bw - 2, bh - 2, m);
          }
        }
        return baseY + rows * bh;
      },

      // Grid extending left from a wall face at baseX (for gravity-right chapters).
      stackLeft(baseX, cy, rows, cols, bw, bh, mat) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const m = typeof mat === 'function' ? mat(r, c) : mat;
            this.block(baseX - bw / 2 - r * bw, cy + (c - (cols - 1) / 2) * bh, bw - 2, bh - 2, m);
          }
        }
        return baseX - rows * bw;
      },
    };
  }

  const chapters = [];
  let cur = null;
  function chapter(name, mode, tagline) {
    cur = { name, mode, tagline, levels: [] };
    chapters.push(cur);
  }
  function lvl(name, par, build) {
    cur.levels.push({
      name,
      par,
      items() {
        const items = [];
        build(makeAPI(items));
        return items;
      },
    });
  }

  // ============ CHAPTER 1 — side view, gravity down ============
  chapter('Orbital Yard', 'side-down', 'Standard gravity. Drop every block onto the plasma floor.');

  lvl('First Topple', 2, (a) => {
    a.pillar(1250, 150, 700);
    a.stack(1250, 700, 2, 2, 64, 56, 'wood');
    a.block(1250, 575, 136, 28, 'wood');
    a.ball(1250, 541, 20, 'glass');
  });

  lvl('The Pyramid', 4, (a) => {
    a.pillar(1230, 430, 765);
    a.row(1230, 765, [66, 66, 66, 66, 66], 50, 'wood');
    a.row(1230, 715, [160, 160], 46, 'wood');
    a.row(1230, 669, [66, 66, 66], 50, (i) => (i === 1 ? 'glass' : 'wood'));
    a.block(1230, 595, 70, 46, 'wood');
    a.tri(1230, 549, 46, 'glass');
    a.ball(1035, 749, 16, 'wood');
    a.ball(1425, 749, 16, 'wood');
  });

  lvl('Glass House', 4, (a) => {
    a.pillar(1270, 300, 740);
    a.block(1180, 695, 36, 90, 'wood');
    a.block(1270, 695, 36, 90, 'wood');
    a.block(1360, 695, 36, 90, 'wood');
    a.block(1225, 697, 54, 86, 'glass');
    a.block(1315, 697, 54, 86, 'glass');
    a.block(1270, 634, 230, 32, 'wood');
    a.block(1200, 592, 52, 52, 'wood');
    a.block(1340, 592, 52, 52, 'wood');
    a.block(1270, 594, 56, 48, 'glass');
    a.block(1270, 552, 230, 28, 'wood');
    a.tri(1270, 515, 46, 'glass');
    a.ball(1185, 522, 16, 'glass');
    a.ball(1355, 522, 16, 'glass');
  });

  lvl('The Castle', 5, (a) => {
    a.pillar(1230, 520, 780);
    a.stack(1060, 780, 2, 4, 56, 52, 'wood');
    a.stack(1400, 780, 2, 4, 56, 52, 'wood');
    a.block(1230, 558, 344, 28, 'wood'); // bridge plank resting on both towers
    a.hex(1160, 522, 26, 'glass');
    a.hex(1300, 522, 26, 'glass');
    a.tri(1230, 520, 48, 'glass');
    a.ball(1035, 557, 15, 'wood');
    a.ball(1425, 557, 15, 'wood');
  });

  // ============ CHAPTER 2 — head-on view, zero gravity ============
  chapter('The Deep Void', 'void', 'Zero gravity, head-on. Knock the wreckage out through the containment ring.');

  lvl('Adrift', 3, (a) => {
    a.stack(800, 515, 3, 3, 62, 58, (r, c) => ((r + c) % 2 ? 'glass' : 'wood'));
  });

  lvl('Satellite', 3, (a) => {
    a.hex(800, 420, 38, 'stone');
    a.ball(915, 420, 19, 'glass');
    a.ball(881, 501, 19, 'glass');
    a.ball(800, 535, 19, 'glass');
    a.ball(719, 501, 19, 'glass');
    a.ball(685, 420, 19, 'glass');
    a.ball(719, 339, 19, 'glass');
    a.ball(800, 305, 19, 'glass');
    a.ball(881, 339, 19, 'glass');
    a.block(995, 420, 44, 64, 'wood');
    a.block(605, 420, 44, 64, 'wood');
    a.block(800, 225, 64, 44, 'wood');
    a.block(800, 615, 64, 44, 'wood');
  });

  lvl('Debris Field', 4, (a) => {
    a.stack(640, 390, 2, 2, 56, 54, 'wood');
    a.stack(960, 390, 2, 2, 56, 54, 'wood');
    a.block(800, 330, 46, 120, 'stone');
    a.ball(764, 560, 18, 'glass');
    a.ball(800, 560, 18, 'glass');
    a.ball(836, 560, 18, 'glass');
    a.ball(782, 528, 18, 'glass');
    a.ball(818, 528, 18, 'glass');
    a.ball(800, 496, 18, 'glass');
  });

  lvl('The Core', 5, (a) => {
    a.block(800, 296, 224, 40, 'stone');
    a.block(800, 544, 224, 40, 'stone');
    a.block(696, 420, 40, 208, 'stone');
    a.block(904, 420, 40, 208, 'stone');
    a.block(756, 376, 48, 48, 'glass');
    a.block(844, 376, 48, 48, 'glass');
    a.block(756, 464, 48, 48, 'glass');
    a.block(844, 464, 48, 48, 'glass');
    a.ball(800, 420, 20, 'stone');
  });

  // ============ CHAPTER 3 — top-down view, deck friction ============
  chapter('The Landing Deck', 'deck', 'Seen from above. Slide every crate off the edge of the deck.');

  lvl('Ten Pin', 2, (a) => {
    a.hex(950, 620, 26, 'wood');
    a.hex(910, 550, 26, 'wood');
    a.hex(990, 550, 26, 'wood');
    a.hex(870, 480, 26, 'wood');
    a.hex(950, 480, 26, 'glass');
    a.hex(1030, 480, 26, 'wood');
    a.hex(830, 410, 26, 'wood');
    a.hex(910, 410, 26, 'wood');
    a.hex(990, 410, 26, 'wood');
    a.hex(1070, 410, 26, 'wood');
  });

  lvl('Cargo Slide', 3, (a) => {
    a.block(950, 560, 100, 48, 'stone');
    a.stack(950, 428, 4, 2, 60, 56, 'wood');
    a.ball(875, 270, 18, 'glass');
    a.ball(925, 270, 18, 'glass');
    a.ball(975, 270, 18, 'glass');
    a.ball(1025, 270, 18, 'glass');
  });

  lvl('Airlock', 4, (a) => {
    a.block(950, 420, 54, 54, 'stone');
    a.block(890, 420, 54, 54, 'stone');
    a.block(1010, 420, 54, 54, 'stone');
    a.block(950, 360, 54, 54, 'stone');
    a.block(950, 480, 54, 54, 'stone');
    a.block(860, 330, 46, 46, 'glass');
    a.block(1040, 330, 46, 46, 'glass');
    a.block(860, 510, 46, 46, 'glass');
    a.block(1040, 510, 46, 46, 'glass');
    a.block(760, 250, 56, 56, 'wood');
    a.block(1140, 250, 56, 56, 'wood');
    a.block(760, 590, 56, 56, 'wood');
    a.block(1140, 590, 56, 56, 'wood');
  });

  lvl('Containment', 5, (a) => {
    a.block(870, 290, 64, 46, 'stone');
    a.block(950, 290, 64, 46, 'stone');
    a.block(1030, 290, 64, 46, 'stone');
    a.block(870, 550, 64, 46, 'stone');
    a.block(950, 550, 64, 46, 'stone');
    a.block(1030, 550, 64, 46, 'stone');
    a.block(800, 370, 46, 64, 'stone');
    a.block(800, 470, 46, 64, 'stone');
    a.block(1100, 370, 46, 64, 'stone');
    a.block(1100, 470, 46, 64, 'stone');
    a.block(915, 395, 46, 46, 'glass');
    a.block(985, 395, 46, 46, 'glass');
    a.block(915, 475, 46, 46, 'glass');
    a.block(985, 475, 46, 46, 'glass');
  });

  // ============ CHAPTER 4 — side view, gravity UP ============
  chapter('Countergravity', 'side-up', 'Gravity points UP. Everything falls into the sky plasma.');

  lvl('Upside Down', 2, (a) => {
    a.slab(1250, 200, 150, 30);
    a.stackDown(1250, 230, 2, 3, 62, 58, 'wood');
    a.ball(1250, 423, 20, 'glass');
  });

  lvl('Stalactites', 3, (a) => {
    a.slab(1000, 150, 140, 30);
    a.stackDown(1000, 180, 2, 2, 58, 54, 'wood');
    a.tri(1000, 308, 42, 'glass', true);
    a.slab(1350, 220, 140, 30);
    a.hex(1350, 276, 30, 'wood');
    a.hex(1350, 328, 30, 'wood');
    a.hex(1350, 380, 30, 'glass');
    a.ball(1350, 424, 18, 'glass');
  });

  lvl('Hanging Gardens', 4, (a) => {
    a.slab(1200, 120, 520, 36);
    a.stackDown(1060, 156, 2, 4, 56, 50, 'wood');
    a.stackDown(1340, 156, 2, 4, 56, 50, 'wood');
    a.block(1200, 370, 344, 28, 'wood'); // bridge pressed up against both towers
    a.hex(1130, 406, 26, 'glass');
    a.hex(1270, 406, 26, 'glass');
    a.tri(1200, 408, 48, 'glass', true);
  });

  lvl('The Chandelier', 5, (a) => {
    a.slab(1230, 100, 480, 36);
    a.stackDown(1035, 136, 1, 4, 60, 56, 'stone');
    a.stackDown(1425, 136, 1, 4, 60, 56, 'stone');
    a.block(1230, 380, 440, 40, 'stone'); // lintel pressed up against the columns
    a.stackDown(1175, 136, 1, 2, 56, 52, 'glass');
    a.ball(1175, 258, 17, 'glass');
    a.stackDown(1310, 136, 2, 2, 56, 52, 'wood');
  });

  // ============ CHAPTER 5 — side view, gravity RIGHT ============
  chapter('Event Horizon', 'side-right', 'Gravity pulls RIGHT, into the horizon wall.');

  lvl('Sideways', 2, (a) => {
    a.staticRect(1100, 450, 40, 320);
    a.stackLeft(1080, 450, 3, 2, 58, 56, 'wood');
    a.ball(887, 450, 20, 'glass');
  });

  lvl('The Masts', 3, (a) => {
    a.staticRect(1150, 300, 40, 260);
    a.stackLeft(1130, 300, 2, 2, 56, 52, 'wood');
    a.ball(1000, 300, 18, 'glass');
    a.staticRect(1250, 620, 40, 260);
    a.hex(1204, 620, 30, 'wood', true);
    a.hex(1152, 620, 30, 'wood', true);
    a.hex(1100, 620, 30, 'glass', true);
    a.ball(1056, 620, 18, 'glass');
  });

  lvl('Broadside', 4, (a) => {
    a.staticRect(1200, 450, 44, 560);
    a.stackLeft(1178, 450, 3, 4, 56, 52, (r) => (r === 1 ? 'glass' : 'wood'));
    a.stackLeft(1010, 450, 1, 2, 52, 48, 'stone');
  });

  lvl('Terminus', 5, (a) => {
    a.staticRect(1150, 250, 40, 280);
    a.stackLeft(1130, 250, 2, 2, 56, 52, 'wood');
    a.ball(1000, 250, 18, 'glass');
    a.staticRect(1350, 650, 40, 280);
    a.stackLeft(1330, 650, 3, 2, 56, 52, (r) => (r === 0 ? 'stone' : 'wood'));
    a.hex(1136, 650, 30, 'glass', true);
    a.staticRect(1450, 450, 36, 160);
    a.stackLeft(1432, 450, 2, 2, 50, 48, 'glass');
  });

  return chapters;
})();

// Flat list used for global numbering, unlocks and saves.
const LEVELS = [];
CHAPTERS.forEach((ch, ci) =>
  ch.levels.forEach((lv, li) => {
    lv.chapter = ci;
    lv.inChapter = li;
    LEVELS.push(lv);
  })
);

