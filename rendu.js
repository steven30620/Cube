/* =====================================================================
   LE CUBE DES MILLE SUPPLICES — rendu 3D (Three.js r128)
   Salles, portes, pièges, personnages façon briques, cadavres, objets.
   Chaque piège : modèle, animation, déclencheur, préparation, phase
   active, réarmement, collisions et conséquence réelle.
   ===================================================================== */
(function (racine) {
  'use strict';
  const THREE = racine.THREE;
  const C = racine.MoteurCube;
  const CF = C.CONFIG;
  const DM = CF.DEMI, HT = CF.HAUT, EP = CF.MUR, PL = CF.PORTE, HP = 3.2;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fr = (t, periode, off) => (((t + (off || 0)) % periode) + periode) % periode / periode;
  const tri = u => (u < 0.5 ? u * 2 : 2 - u * 2);
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  function teinte(c, k) { // éclaircit (k>0) ou assombrit (k<0)
    let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }
  function melange(a, b, k) {
    const ra = (a >> 16) & 255, ga = (a >> 8) & 255, ba = a & 255, rb = (b >> 16) & 255, gb = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ra + (rb - ra) * k) << 16) | (Math.round(ga + (gb - ga) * k) << 8) | Math.round(ba + (bb - ba) * k);
  }

  // ---------- qualité d'affichage ----------
  let QUALITE = 'haute';
  const TAILLE = () => (QUALITE === 'haute' ? 1024 : QUALITE === 'normale' ? 768 : 512);
  function regler(q) { const n = q === 'basse' || q === 'normale' ? q : 'haute'; if (n !== QUALITE) iPrechauffe = 0; QUALITE = n; }

  // ---------- matériaux et géométries partagés ----------
  const cMat = new Map(), cGeo = new Map();
  function mat(c, o) {
    o = o || {};
    const k = [c, o.r, o.m, o.e, o.ei, o.op, o.add, o.map && o.map.uuid, o.bump && o.bump.uuid, o.bs, o.ds, o.basic, o.env].join('|');
    let m = cMat.get(k);
    if (!m) {
      const p = {
        color: c, map: o.map || null, transparent: (o.op != null && o.op < 1) || !!o.add, opacity: o.op != null ? o.op : 1,
        blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !o.add, side: o.ds ? THREE.DoubleSide : THREE.FrontSide,
      };
      if (o.basic) m = new THREE.MeshBasicMaterial(p);
      else {
        p.roughness = o.r != null ? o.r : 0.8; p.metalness = o.m != null ? o.m : 0.1; p.emissive = new THREE.Color(o.e || 0); p.emissiveIntensity = o.ei != null ? o.ei : 1;
        if (o.bump) { p.bumpMap = o.bump; p.bumpScale = o.bs != null ? o.bs : 0.03; }
        p.envMapIntensity = o.env != null ? o.env : 1;
        m = new THREE.MeshStandardMaterial(p);
      }
      cMat.set(k, m);
    }
    return m;
  }
  /** Plastique de brique (ABS) : brillant, vernis, reflets nets. */
  const cPlast = new Map();
  function plastique(c, o) {
    o = o || {};
    const k = c + '|' + (o.map ? o.map.uuid : '') + '|' + (o.mat ? 1 : 0);
    let m = cPlast.get(k);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ color: c, map: o.map || null, roughness: o.mat ? 0.62 : 0.32, metalness: 0, clearcoat: o.mat ? 0.1 : 0.8, clearcoatRoughness: 0.16, envMapIntensity: 1.1 });
      cPlast.set(k, m);
    }
    return m;
  }
  const geo = (k, f) => { let g = cGeo.get(k); if (!g) { g = f(); cGeo.set(k, g); } return g; };
  const gBoite = (w, h, d) => geo('b' + w + ',' + h + ',' + d, () => new THREE.BoxGeometry(w, h, d));
  const gCyl = (a, b, h, s) => geo('c' + a + ',' + b + ',' + h + ',' + s, () => new THREE.CylinderGeometry(a, b, h, Math.max(16, s || 16)));
  const gSph = (r, s) => geo('s' + r + ',' + s, () => new THREE.SphereGeometry(r, Math.max(20, s || 20), Math.max(12, (s || 20) >> 1)));
  const gCone = (r, h, s) => geo('k' + r + ',' + h + ',' + s, () => new THREE.ConeGeometry(r, h, Math.max(8, s || 8)));
  /** Boîte aux arêtes chanfreinées : les arêtes accrochent la lumière comme un objet réel. */
  const gBiseau = (w, h, d, b) => geo('bz' + [w, h, d, b].join(','), () => {
    b = Math.min(b, w / 4, h / 4, d / 4);
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + b, -h / 2 + b); s.lineTo(w / 2 - b, -h / 2 + b); s.lineTo(w / 2 - b, h / 2 - b); s.lineTo(-w / 2 + b, h / 2 - b); s.lineTo(-w / 2 + b, -h / 2 + b);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, steps: 1 });
    g.translate(0, 0, -(d - 2 * b) / 2); g.computeVertexNormals();
    return g;
  });
  function boite(p, w, h, d, m, x, y, z) { const e = new THREE.Mesh(gBoite(w, h, d), m); e.position.set(x || 0, y || 0, z || 0); if (p) p.add(e); return e; }
  function bloc(p, w, h, d, m, x, y, z, b) { const e = new THREE.Mesh(gBiseau(w, h, d, b != null ? b : 0.035), m); e.position.set(x || 0, y || 0, z || 0); if (p) p.add(e); return e; }
  function cyl(p, a, b, h, s, m, x, y, z) { const e = new THREE.Mesh(gCyl(a, b, h, s), m); e.position.set(x || 0, y || 0, z || 0); if (p) p.add(e); return e; }
  function sph(p, r, m, x, y, z, s) { const e = new THREE.Mesh(gSph(r, s), m); e.position.set(x || 0, y || 0, z || 0); if (p) p.add(e); return e; }
  function cone(p, r, h, m, x, y, z, s) { const e = new THREE.Mesh(gCone(r, h, s), m); e.position.set(x || 0, y || 0, z || 0); if (p) p.add(e); return e; }
  const groupe = (p, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); if (p) p.add(g); return g; };

  // ---------- bruit procédural (grain de la pierre, du métal, du bois) ----------
  function bruitValeur(w, h, cell, seed) {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, r = C.alea(seed), g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = y / cell, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / cell, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), i = y0 * gw + x0;
        const a = g[i], b = g[i + 1], c2 = g[i + gw], d = g[i + gw + 1];
        out[y * w + x] = a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
      }
    }
    return out;
  }
  function fbm(w, h, cell, oct, seed) {
    const out = new Float32Array(w * h); let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) { const n = bruitValeur(w, h, Math.max(1, cell / Math.pow(2, o)), seed + o * 101); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= 0.5; }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  /** Champs de bruit calculés une seule fois, puis décalés pour chaque couleur de salle (évite les saccades). */
  const cChamps = new Map();
  function champ(W, H, cell, oct, seed, dx, dy) {
    const k = [W, H, cell, oct, seed].join(',');
    let base = cChamps.get(k);
    if (!base) { base = fbm(W, H, cell, oct, seed); cChamps.set(k, base); }
    if (!dx && !dy) return base;
    const out = new Float32Array(W * H), ox = ((dx % W) + W) % W, oy = ((dy % H) + H) % H;
    for (let y = 0; y < H; y++) { const sy = ((y + oy) % H) * W, ry = y * W; for (let x = 0; x < W; x++) out[ry + x] = base[sy + (x + ox) % W]; }
    return out;
  }
  const cTex = new Map();
  const memo = (k, f) => { let t = cTex.get(k); if (!t) { t = f(); cTex.set(k, t); } return t; };
  function toileVide(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function versTexture(c, couleur, rep) {
    const t = new THREE.CanvasTexture(c); if (couleur) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); }
    return t;
  }
  const rgb = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  /** Remplit couleur + relief à partir d'une fonction par pixel : f(x, y, i) -> [lum, relief, teinteOptionnelle] */
  function peindre(W, H, base, f) {
    const cC = toileVide(W, H), cH = toileVide(W, H), xc = cC.getContext('2d'), xh = cH.getContext('2d');
    const ic = xc.createImageData(W, H), ih = xh.createImageData(W, H), [br, bg, bb] = rgb(base);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, p = i * 4, v = f(x, y, i);
      const t = v[2];
      ic.data[p] = clamp((t ? t[0] : br) * v[0], 0, 255); ic.data[p + 1] = clamp((t ? t[1] : bg) * v[0], 0, 255); ic.data[p + 2] = clamp((t ? t[2] : bb) * v[0], 0, 255); ic.data[p + 3] = 255;
      const hh = clamp(v[1] * 255, 0, 255); ih.data[p] = ih.data[p + 1] = ih.data[p + 2] = hh; ih.data[p + 3] = 255;
    }
    xc.putImageData(ic, 0, 0); xh.putImageData(ih, 0, 0);
    return { cC, cH, xc, xh };
  }
  function fissures(xc, xh, W, H, n, r) {
    for (let c = 0; c < n; c++) {
      let px = r() * W, py = r() * H; const pts = [[px, py]];
      for (let k = 0; k < 7; k++) { px += (r() - 0.5) * W * 0.08; py += (r() - 0.5) * H * 0.08; pts.push([px, py]); }
      for (const [x, col, lw] of [[xc, 'rgba(10,8,6,0.55)', 1.4], [xh, 'rgba(0,0,0,0.9)', 2.2]]) { x.strokeStyle = col; x.lineWidth = lw; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke(); }
    }
  }

  /** Sol : dalles de pierre (8 × 8, alignées sur les cases des pièges), joints creux, usure, ombre près des murs. */
  const texSol = pal => memo('sol' + pal.sol + QUALITE, () => {
    const W = TAILLE(), n = 8, s = W / n, gr = Math.max(2, s * 0.035);
    const dx = (pal.sol * 7919) % W, dy = (pal.sol * 104729) % W, n1 = champ(W, W, W / 5, 4, 11, dx, dy), n2 = champ(W, W, 5, 2, 12, dy, dx);
    const r = C.alea(pal.sol), teintes = []; for (let i = 0; i < n * n; i++) teintes.push(0.8 + r() * 0.32);
    const base = teinte(pal.sol, 0.38);
    const { cC, cH, xc, xh } = peindre(W, W, base, (x, y, i) => {
      const a = Math.floor(x / s), b = Math.floor(y / s), u = x - a * s, v = y - b * s, e = Math.min(u, s - u, v, s - v);
      const ao = 0.48 + 0.52 * Math.min(1, Math.min(x, W - x, y, W - y) / W / 0.13);
      if (e < gr) return [0.3 * (0.8 + n2[i] * 0.4) * ao, 0.05];
      const bev = Math.min(1, (e - gr) / (gr * 2.4));
      return [teintes[b * n + a] * (0.7 + 0.46 * n1[i] + 0.16 * (n2[i] - 0.5)) * (0.86 + 0.14 * bev) * ao, 0.35 + 0.45 * bev + 0.2 * n2[i]];
    });
    fissures(xc, xh, W, W, 5, r);
    return { map: versTexture(cC, true), bump: versTexture(cH) };
  });

  const STYLE_MUR = { 'laque rouge': 'laque', encre: 'laque', jade: 'laque', 'pierre grise': 'pierre', ocre: 'pierre', bronze: 'metal', 'bois sombre': 'bois' };
  /** Murs : laque à panneaux et treillis, pierre appareillée, plaques de bronze rivetées ou planches, selon la salle. */
  const texMur = pal => memo('mur' + pal.mur + QUALITE, () => {
    const W = TAILLE(), H = W >> 1, style = STYLE_MUR[pal.nom] || 'laque', r = C.alea(pal.mur);
    const dx = (pal.mur * 7919) % W, dy = (pal.mur * 104729) % H, n1 = champ(W, H, W / 6, 4, 21, dx, dy), n2 = champ(W, H, 4, 2, 22, dy, dx);
    let res;
    if (style === 'pierre') {
      const rangs = 7, hR = H / rangs, blocs = [];
      for (let k = 0; k < rangs; k++) { let x = -r() * W * 0.2; const ligne = []; while (x < W) { const l = W * (0.16 + r() * 0.16); ligne.push([x, x + l, 0.78 + r() * 0.3]); x += l; } blocs.push(ligne); }
      res = peindre(W, H, teinte(pal.mur, 0.2), (x, y, i) => {
        const k = Math.min(rangs - 1, Math.floor(y / hR)), v = y - k * hR, bl = blocs[k].find(b => x >= b[0] && x < b[1]) || [0, W, 1];
        const e = Math.min(v, hR - v, x - bl[0], bl[1] - x), j = Math.max(2, W * 0.004);
        if (e < j) return [0.28 + n2[i] * 0.1, 0.05];
        const bev = Math.min(1, (e - j) / (j * 3));
        return [bl[2] * (0.68 + 0.5 * n1[i] + 0.15 * (n2[i] - 0.5)) * (0.85 + 0.15 * bev), 0.3 + 0.4 * bev + 0.3 * n1[i]];
      });
      fissures(res.xc, res.xh, W, H, 4, r);
    } else if (style === 'metal') {
      const pw = W / 4, ph = H / 2;
      res = peindre(W, H, teinte(pal.mur, 0.25), (x, y, i) => {
        const u = x % pw, v = y % ph, e = Math.min(u, pw - u, v, ph - v), patine = n1[i] > 0.6 ? Math.min(1, (n1[i] - 0.6) * 4) : 0;
        const t = patine ? [80 + 40 * patine, 120 + 50 * patine, 100 + 40 * patine] : null;
        if (e < 3) return [0.3, 0.05];
        return [(0.75 + 0.35 * n2[i] + 0.15 * n1[i]) * (t ? 1 : 1), 0.5 + 0.25 * n2[i] - patine * 0.2, t];
      });
      for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) for (let k = 0; k < 6; k++) {
        const cx = a * pw + 14 + k * (pw - 28) / 5, ys = [b * ph + 14, (b + 1) * ph - 14];
        for (const cy of ys) for (const [x, col] of [[res.xc, 'rgba(255,230,180,0.35)'], [res.xh, '#fff']]) { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, W * 0.005, 0, TAU); x.fill(); }
      }
    } else if (style === 'bois') {
      const pl = W / 14;
      res = peindre(W, H, teinte(pal.mur, 0.3), (x, y, i) => {
        const k = Math.floor(x / pl), u = x - k * pl;
        if (u < 2) return [0.25, 0.02];
        const veine = 0.5 + 0.5 * Math.sin((x * 0.9 + n1[i] * 40 + k * 13) * 0.6);
        return [(0.7 + 0.25 * veine + 0.15 * n2[i]) * (0.85 + 0.3 * ((k * 7919) % 13) / 13), 0.45 + 0.3 * veine * 0.5 + 0.2 * n2[i]];
      });
    } else {
      // laque : soubassement de pierre, poteaux, panneaux laqués à filet doré, treillis en haut
      const dado = H * 0.2, poteau = W / 6;
      res = peindre(W, H, teinte(pal.mur, 0.22), (x, y, i) => {
        const fin = n2[i] > 0.82 ? 0.82 : 1; // craquelures de la laque
        if (y > H - dado) return [0.55 + 0.35 * n1[i], 0.35 + 0.3 * n1[i], [120, 112, 100]];
        const u = x % poteau;
        if (u < W * 0.016 || u > poteau - W * 0.016) return [0.62 + 0.15 * n1[i], 0.85];
        return [(0.8 + 0.3 * n1[i] + 0.08 * (n2[i] - 0.5)) * fin, 0.45 + 0.1 * n2[i] - (fin < 1 ? 0.15 : 0)];
      });
      const [ar, ag, ab] = rgb(pal.acc), x2 = res.xc, h2 = res.xh;
      for (let k = 0; k < 6; k++) {
        const x0 = k * poteau + W * 0.03, l = poteau - W * 0.06;
        for (const [ctx, col, lw] of [[x2, `rgba(${ar},${ag},${ab},0.75)`, W * 0.004], [h2, '#e0e0e0', W * 0.005]]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw;
          ctx.strokeRect(x0, H * 0.06, l, H * 0.32); ctx.strokeRect(x0, H * 0.42, l, H - dado - H * 0.46);
          // treillis « 回 » dans le panneau haut
          ctx.lineWidth = lw * 0.8;
          for (let q = 1; q < 4; q++) { ctx.beginPath(); ctx.moveTo(x0 + l * q / 4, H * 0.06); ctx.lineTo(x0 + l * q / 4, H * 0.38); ctx.stroke(); }
          for (let q = 1; q < 3; q++) { ctx.beginPath(); ctx.moveTo(x0, H * 0.06 + H * 0.32 * q / 3); ctx.lineTo(x0 + l, H * 0.06 + H * 0.32 * q / 3); ctx.stroke(); }
        }
      }
      x2.fillStyle = 'rgba(0,0,0,0.5)'; x2.fillRect(0, H - dado - 3, W, 6);
    }
    // occlusion : plus sombre en bas (contre le sol) et en haut
    const g = res.xc.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(0.12, 'rgba(0,0,0,0)'); g.addColorStop(0.86, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    res.xc.fillStyle = g; res.xc.fillRect(0, 0, W, H);
    return { map: versTexture(res.cC, true), bump: versTexture(res.cH) };
  });
  /** Couvercle des salles voisines : plaque de bronze rivetée, patinée. */
  const texCouvercle = pal => memo('cvr' + pal.mur + QUALITE, () => {
    const W = TAILLE() >> 1, d0 = (pal.mur * 7919) % W, n1 = champ(W, W, W / 4, 4, 77, d0, d0 >> 1), n2 = champ(W, W, 4, 2, 78);
    const res = peindre(W, W, teinte(pal.mur, -0.35), (x, y, i) => {
      const e = Math.min(x, W - x, y, W - y), d = Math.hypot(x - W / 2, y - W / 2);
      const relief = e < W * 0.05 ? 0.85 : Math.abs(d - W * 0.18) < W * 0.012 ? 0.9 : 0.5;
      return [0.65 + 0.4 * n1[i] + 0.1 * n2[i], relief + 0.15 * n2[i]];
    });
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; for (const [x, col] of [[res.xc, 'rgba(255,220,160,0.3)'], [res.xh, '#fff']]) { x.fillStyle = col; x.beginPath(); x.arc(W / 2 + Math.cos(a) * W * 0.38, W / 2 + Math.sin(a) * W * 0.38, W * 0.014, 0, TAU); x.fill(); } }
    return { map: versTexture(res.cC, true), bump: versTexture(res.cH) };
  });
  /** Petites textures de matière, répétées sur les objets. */
  const matiere = (nom, base, f) => memo('mat-' + nom + QUALITE, () => {
    const W = 256, n1 = champ(W, W, 48, 4, 31, nom.length * 37, nom.length * 53), n2 = champ(W, W, 4, 2, 37, nom.length * 11, 0);
    const res = peindre(W, W, base, (x, y, i) => f(n1[i], n2[i], x, y));
    return { map: versTexture(res.cC, true, 1), bump: versTexture(res.cH, false, 1) };
  });
  const T = {
    bronze: () => matiere('bronze', 0x8a6a32, (a, b) => { const p = a > 0.62 ? Math.min(1, (a - 0.62) * 3.5) : 0; return [0.75 + 0.35 * b + 0.1 * a, 0.5 + 0.3 * b - 0.25 * p, p ? [138 - 60 * p, 106 + 30 * p, 50 + 60 * p] : null]; }),
    fer: () => matiere('fer', 0x3a3c40, (a, b) => { const rouille = a > 0.66 ? Math.min(1, (a - 0.66) * 3) : 0; return [0.7 + 0.4 * b, 0.5 + 0.35 * b - rouille * 0.3, rouille ? [58 + 70 * rouille, 60 + 20 * rouille, 64 - 30 * rouille] : null]; }),
    bois: () => matiere('bois', 0x5a3820, (a, b, x, y) => { const v = 0.5 + 0.5 * Math.sin((y * 0.35 + a * 30) * 0.9); return [0.72 + 0.28 * v + 0.12 * b, 0.4 + 0.3 * v]; }),
    pierre: () => matiere('pierre', 0x6a655d, (a, b) => [0.65 + 0.45 * a + 0.2 * (b - 0.5), 0.35 + 0.4 * a + 0.25 * b]),
    or: () => matiere('or', 0xd8b25a, (a, b) => [0.88 + 0.12 * a, 0.5 + 0.3 * b]),
    laque: () => matiere('laque', 0x6a1612, (a, b) => [0.8 + 0.25 * a + (b > 0.85 ? -0.2 : 0), 0.5 + (b > 0.85 ? -0.2 : 0.1 * b)]),
  };
  const M = {
    fer: () => mat(0xffffff, { r: 0.6, m: 0.75, map: T.fer().map, bump: T.fer().bump, bs: 0.02 }), ferSombre: () => mat(0x6a6a70, { r: 0.65, m: 0.7, map: T.fer().map, bump: T.fer().bump, bs: 0.02 }),
    acier: () => mat(0xc4cad2, { r: 0.22, m: 1 }), bronze: () => mat(0xffffff, { r: 0.42, m: 0.88, map: T.bronze().map, bump: T.bronze().bump, bs: 0.02 }),
    or: () => mat(0xffffff, { r: 0.24, m: 1, map: T.or().map, bump: T.or().bump, bs: 0.01 }), bois: () => mat(0xffffff, { r: 0.82, map: T.bois().map, bump: T.bois().bump, bs: 0.02 }),
    pierre: () => mat(0xffffff, { r: 0.92, map: T.pierre().map, bump: T.pierre().bump, bs: 0.04 }), noir: () => mat(0x050506, { basic: true }),
    laque: () => mat(0xffffff, { r: 0.28, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 }),
    rougeSceau: () => mat(0x7a1410, { r: 0.6, e: 0x6a0a06, ei: 1.4 }), jade: () => mat(0x4f9a7a, { r: 0.18, m: 0.05, e: 0x06180f }),
    os: () => mat(0xe9e2cf, { r: 0.85 }), poussiere: () => mat(0x8c8476, { r: 1, op: 0.55 }),
    flamme: () => mat(0xff7a1a, { basic: true, add: true, op: 0.9 }), flammeCoeur: () => mat(0xffe08a, { basic: true, add: true, op: 0.95 }),
    lumiere: () => mat(0xfff1c2, { basic: true, add: true, op: 0.22 }), braise: () => mat(0xff3a10, { basic: true, add: true, op: 0.6 }),
  };

  // ---------- halos lumineux (lanternes, flammes, yeux, objets précieux) ----------
  const texHalo = () => memo('halo', () => {
    const c = toileVide(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return versTexture(c, true);
  });
  const cHalo = new Map();
  function halo(p, couleur, taille, x, y, z, op) {
    const k = couleur + '|' + (op || 0.8);
    let m = cHalo.get(k);
    if (!m) { m = new THREE.SpriteMaterial({ map: texHalo(), color: couleur, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op || 0.8 }); cHalo.set(k, m); }
    const s = new THREE.Sprite(m); s.scale.set(taille, taille, 1); s.position.set(x || 0, y || 0, z || 0); s.userData.pasOmbre = true;
    if (p) p.add(s); return s;
  }

  // ---------- environnement (reflets) et ombres ----------
  function texEnvironnement() {
    const c = toileVide(1024, 512), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#120c08'); g.addColorStop(0.42, '#3c2616'); g.addColorStop(0.55, '#2a1a10'); g.addColorStop(1, '#0a0705');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    const tache = (cx, cy, r, col) => { const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(cx - r, cy - r, r * 2, r * 2); };
    tache(512, 70, 170, 'rgba(255,228,180,0.95)');
    [[140, 230], [400, 250], [660, 225], [900, 245]].forEach(([a, b]) => tache(a, b, 70, 'rgba(255,170,90,0.85)'));
    tache(780, 300, 120, 'rgba(110,140,170,0.35)');
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function preparerEnvironnement(renderer, scene) {
    try {
      const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
      const t = texEnvironnement(), env = pm.fromEquirectangular(t).texture; t.dispose(); pm.dispose();
      scene.environment = env; return env;
    } catch (e) { return null; }
  }
  /** Ombres : tout ce qui est opaque projette et reçoit ; murs et sol reçoivent seulement. */
  function preparerOmbres(g) {
    g.traverse(o => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.userData.recoit) { o.castShadow = false; o.receiveShadow = true; return; }
      const opaque = m && !m.isMeshBasicMaterial && !(m.transparent && m.opacity < 0.98) && m.blending !== THREE.AdditiveBlending;
      o.castShadow = !!opaque && !o.userData.pasOmbre; o.receiveShadow = !!m && !m.isMeshBasicMaterial;
    });
  }

  function toile(k, w, h, f) {
    return memo(k, () => { const c = toileVide(w, h), x = c.getContext('2d'); f(x, w, h); return versTexture(c, true); });
  }
  function texGlyphe(n, couleur) { // grand sceau peint : traits procéduraux propres à la salle
    return toile('gly' + n + couleur, 256, 256, (x, w) => {
      x.clearRect(0, 0, w, w);
      const r = C.alea(9000 + n);
      x.strokeStyle = couleur; x.lineCap = 'square'; x.lineWidth = 16;
      x.strokeRect(24, 24, w - 48, w - 48);
      x.lineWidth = 14;
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        const hz = r() < 0.5, a = 60 + Math.floor(r() * 4) * 40, b0 = 50 + r() * 40, b1 = 150 + r() * 50;
        if (hz) { x.moveTo(b0, a); x.lineTo(b1, a); } else { x.moveTo(a, b0); x.lineTo(a, b1); }
        x.stroke();
      }
    });
  }
  /** Visage imprimé, sur fond blanc (la couleur de peau vient du plastique). */
  function texVisage(type) {
    return toile('vis2' + type, 512, 256, (x, w, h) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      const cx = w / 2;
      if (type === 'crane') {
        // repère « carré » : 1 unité = 1 px de hauteur ; le tour de tête vaut ~ 2,16 fois plus en largeur
        x.save(); x.setTransform(0.463, 0, 0, 1, cx, 0);
        x.fillStyle = '#111111';
        x.beginPath(); x.arc(-46, 100, 32, 0, TAU); x.fill(); x.beginPath(); x.arc(46, 100, 32, 0, TAU); x.fill();
        x.beginPath(); x.moveTo(-10, 140); x.lineTo(10, 140); x.lineTo(0, 158); x.closePath(); x.fill();
        // grand sourire noir et dents blanches, d'une joue à l'autre
        x.beginPath(); x.moveTo(-104, 160); x.quadraticCurveTo(-60, 230, 0, 228); x.quadraticCurveTo(60, 230, 104, 160);
        x.quadraticCurveTo(60, 182, 0, 184); x.quadraticCurveTo(-60, 182, -104, 160); x.fill();
        x.fillStyle = '#ffffff';
        for (let i = -3; i <= 3; i++) { const tx = i * 26, h0 = 186 - Math.abs(i) * 2, h1 = 216 - Math.abs(i) * Math.abs(i) * 2.5; x.fillRect(tx - 9, h0, 18, Math.max(6, h1 - h0)); }
        x.fillStyle = '#111111'; x.fillRect(-90, 200, 180, 5);
        x.restore();
        return;
      }
      // yeux avec reflet, sourcils, joues, bouche
      for (const s of [-1, 1]) {
        x.fillStyle = '#16110c'; x.beginPath(); x.ellipse(cx + s * 26, 108, 8.5, 12, 0, 0, TAU); x.fill();
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx + s * 26 - 2.5, 103, 3, 0, TAU); x.fill();
        x.strokeStyle = '#16110c'; x.lineWidth = 5; x.lineCap = 'round';
        x.beginPath(); if (type === 'peur') { x.moveTo(cx + s * 14, 82); x.lineTo(cx + s * 38, 76); } else { x.moveTo(cx + s * 16, 84); x.quadraticCurveTo(cx + s * 27, 76, cx + s * 38, 84); } x.stroke();
      }
      x.fillStyle = 'rgba(220,120,90,0.25)'; x.beginPath(); x.ellipse(cx - 46, 140, 13, 8, 0, 0, TAU); x.fill(); x.beginPath(); x.ellipse(cx + 46, 140, 13, 8, 0, 0, TAU); x.fill();
      x.strokeStyle = '#16110c'; x.lineWidth = 5;
      x.beginPath(); if (type === 'peur') x.ellipse(cx, 160, 12, 10, 0, 0, TAU); else x.arc(cx, 138, 24, 0.22 * Math.PI, 0.78 * Math.PI); x.stroke();
    });
  }
  const texTache = (k, f) => toile('tache' + k, 128, 128, f);
  /** Torse imprimé : robe croisée, broderies, ceinture nouée. */
  function texTorse(tunique, ceinture) {
    return toile('torse' + tunique + '-' + ceinture, 256, 256, (x, w, h) => {
      x.fillStyle = hex(tunique); x.fillRect(0, 0, w, h);
      const sombre = hex(teinte(tunique, -0.35)), clair = hex(teinte(tunique, 0.35)), cb = hex(ceinture);
      x.fillStyle = sombre; x.beginPath(); x.moveTo(w * 0.36, 0); x.lineTo(w * 0.5, h * 0.42); x.lineTo(w * 0.64, 0); x.closePath(); x.fill();
      x.strokeStyle = cb; x.lineWidth = 10;
      x.beginPath(); x.moveTo(w * 0.3, 0); x.lineTo(w * 0.62, h * 0.72); x.stroke();
      x.beginPath(); x.moveTo(w * 0.7, 0); x.lineTo(w * 0.5, h * 0.44); x.stroke();
      x.fillStyle = clair; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(w * 0.18 + (i % 3) * 14, h * 0.25 + Math.floor(i / 3) * 14, 3, 0, TAU); x.fill(); }
      x.fillStyle = cb; x.fillRect(0, h * 0.78, w, h * 0.12);
      x.fillStyle = hex(teinte(ceinture, -0.3)); x.fillRect(w * 0.6, h * 0.76, w * 0.08, h * 0.16);
      x.fillRect(w * 0.62, h * 0.9, w * 0.035, h * 0.1); x.fillRect(w * 0.665, h * 0.9, w * 0.035, h * 0.1);
    });
  }
  const texPaille = () => toile('paille', 256, 64, (x, w, h) => {
    x.fillStyle = '#c7a35a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { x.strokeStyle = `rgba(${Math.random() < 0.5 ? '90,60,20' : '240,210,140'},${0.15 + Math.random() * 0.25})`; x.lineWidth = 1 + Math.random(); const xx = Math.random() * w; x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx + (Math.random() - 0.5) * 8, h); x.stroke(); }
  });

  // =====================================================================
  // PERSONNAGES FAÇON BRIQUES (plastique vernis, formes arrondies)
  // =====================================================================
  const PEAUX = { jaune: 0xf2cd37, clair: 0xf1c9a5, mat: 0xc68a5a, brun: 0x7a4a2a };
  function geoTorse() {
    return geo('torse2', () => {
      const g = new THREE.BoxGeometry(0.66, 0.6, 0.34, 2, 2, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = (p.getY(i) + 0.3) / 0.6; p.setX(i, p.getX(i) * (1 - 0.22 * k)); }
      g.computeVertexNormals(); return g;
    });
  }
  const H_TETE = 0.3;
  function geoTete() {
    return geo('tete3', () => {
      const R = 0.2, H = H_TETE, b = 0.05, pts = [new THREE.Vector2(0.0001, -H / 2)];
      for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(R - b + Math.cos(a) * b, -H / 2 + b + Math.sin(a) * b)); }
      for (let i = 1; i < 6; i++) pts.push(new THREE.Vector2(R, -H / 2 + b + (H - 2 * b) * i / 6));
      for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(R - b + Math.cos(a) * b, H / 2 - b + Math.sin(a) * b)); }
      pts.push(new THREE.Vector2(0.0001, H / 2));
      const g = new THREE.LatheGeometry(pts, 40, -Math.PI, TAU);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) + H / 2) / H);
      return g;
    });
  }
  const geoTenon = () => geo('tenon', () => { const pts = [new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.11, 0), new THREE.Vector2(0.11, 0.06), new THREE.Vector2(0.1, 0.08), new THREE.Vector2(0.0001, 0.08)]; return new THREE.LatheGeometry(pts, 24); });
  const geoMain = () => geo('main', () => new THREE.TorusGeometry(0.072, 0.03, 10, 20, Math.PI * 1.45));
  // ---------------------------------------------------------------------
  // Figurine de brique, proportions relevées sur le modèle fourni (vue de face, 473 px de haut) :
  // jambes 153, hanches 22, torse 160 (150 → 190 de large), cou 12, tête 104 × 143, tenon 23 × 62.
  // 1 px = K unités ; la figurine est ensuite agrandie de 1,3 (corps.scale).
  // ---------------------------------------------------------------------
  const K = 0.0037;
  const FIG = {
    jambeH: 153 * K, piedH: 28 * K, jambeL: 92 * K, ecart: 6 * K, prof: 97 * K,
    hancheH: 22 * K, largeur: 190 * K,
    torseH: 160 * K, torseHaut: 150 * K,
    couH: 12 * K, couR: 30 * K,
    teteH: 104 * K, teteR: 71.5 * K, teteArrondi: 18 * K,
    tenonH: 23 * K, tenonR: 31 * K,
  };
  FIG.yHanche = FIG.jambeH; FIG.yTorse = FIG.yHanche + FIG.hancheH; FIG.yCou = FIG.yTorse + FIG.torseH; FIG.yTete = FIG.yCou + FIG.couH;
  function geoTorseFig() {
    return geo('torseFig', () => {
      const g = new THREE.BoxGeometry(FIG.largeur, FIG.torseH, FIG.prof * 0.92, 4, 4, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = (p.getY(i) + FIG.torseH / 2) / FIG.torseH; p.setX(i, p.getX(i) * (1 - (1 - FIG.torseHaut / FIG.largeur) * k)); }
      g.computeVertexNormals(); return g;
    });
  }
  function geoTeteFig() {
    return geo('teteFig', () => {
      const R = FIG.teteR, H = FIG.teteH, b = FIG.teteArrondi, pts = [new THREE.Vector2(0.0001, -H / 2)];
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(R - b + Math.cos(a) * b, -H / 2 + b + Math.sin(a) * b)); }
      for (let i = 1; i < 6; i++) pts.push(new THREE.Vector2(R, -H / 2 + b + (H - 2 * b) * i / 6));
      for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(R - b + Math.cos(a) * b, H / 2 - b + Math.sin(a) * b)); }
      pts.push(new THREE.Vector2(0.0001, H / 2));
      const g = new THREE.LatheGeometry(pts, 48, -Math.PI, TAU);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) + H / 2) / H);
      return g;
    });
  }
  const geoTenonFig = () => geo('tenonFig', () => {
    const r = FIG.tenonR, h = FIG.tenonH, b = h * 0.18;
    return new THREE.LatheGeometry([[0.0001, 0], [r, 0], [r, h - b], [r - b * 0.6, h - b * 0.25], [r - b, h], [0.0001, h]].map(([a, c]) => new THREE.Vector2(a, c)), 32);
  });
  // main en C : anneau vu de face, ouverture tournée vers le corps et un peu vers le haut
  const geoMainFig = () => geo('mainFig', () => new THREE.TorusGeometry(21 * K, 11.5 * K, 16, 32, Math.PI * 1.5));
  /** Un bras : épaule arrondie, bras qui s'écarte légèrement, avant-bras vers l'avant, main en C. */
  function brasFig(b, s, m, mMain) {
    sph(b, 30 * K, m, 0, 0, 0, 24);
    const coude = new THREE.Vector3(s * 26 * K, -100 * K, 0);
    const haut = cyl(b, 27 * K, 29 * K, 100 * K, 24, m, coude.x / 2, coude.y / 2, 0); haut.rotation.z = Math.atan2(coude.x, -coude.y) * 1;
    const gc = groupe(b, coude.x, coude.y, 0);
    sph(gc, 28 * K, m, 0, 0, 0, 24);
    const avant = cyl(gc, 27 * K, 25 * K, 48 * K, 24, m, s * 3 * K, -10 * K, 22 * K); avant.rotation.x = Math.PI / 2 - 0.35;
    const poignet = cyl(gc, 10 * K, 10 * K, 20 * K, 14, mMain, s * 22 * K, -24 * K, 42 * K); poignet.rotation.z = s * 0.6;
    const main = new THREE.Mesh(geoMainFig(), mMain);
    main.position.set(s * 30 * K, -34 * K, 44 * K);
    // l'arc va de 0 à 270° : l'ouverture est centrée sur -45°. On la tourne vers le corps et un peu vers le haut.
    main.rotation.set(-0.3, s * 0.25, s < 0 ? 1.13 : 3.58);
    gc.add(main);
    return gc;
  }
  /** Figurine de brique classique, identique au modèle fourni. look = { unie } ou { tunique, pantalon, peau }. */
  function creerFigurine(look, opts) {
    opts = opts || {};
    look = look || {};
    if (opts.squelette) return creerSquelette(opts);
    const mod = opts.teinte != null ? (c => melange(c, opts.teinte, opts.force || 0.35)) : (c => c);
    const terne = opts.teinte != null;
    const unie = look.unie != null ? look.unie : null;
    const cTete = unie != null ? unie : (PEAUX[look.peau] || PEAUX.jaune);
    const cTorse = unie != null ? unie : (look.tunique != null ? look.tunique : 0xf4f4f0);
    const cJambes = unie != null ? unie : (look.pantalon != null ? look.pantalon : 0xf4f4f0);
    const mT = plastique(mod(cTorse), { mat: terne }), mJ = plastique(mod(cJambes), { mat: terne }), mH = plastique(mod(cTete), { mat: terne });
    const mSillon = plastique(mod(teinte(cJambes, -0.3)), { mat: terne });
    const racineG = new THREE.Group(), corps = groupe(racineG);
    // hanches (fente centrale) et jambes (couture du pied)
    const hanche = bloc(corps, FIG.largeur, FIG.hancheH, FIG.prof, mJ, 0, FIG.yHanche + FIG.hancheH / 2, 0, 4 * K);
    boite(corps, 3 * K, FIG.hancheH * 0.9, FIG.prof * 1.01, mSillon, 0, FIG.yHanche + FIG.hancheH * 0.45, 0);
    const xJ = (FIG.jambeL + FIG.ecart) / 2;
    const jG = groupe(corps, -xJ, FIG.yHanche, 0), jD = groupe(corps, xJ, FIG.yHanche, 0);
    for (const j of [jG, jD]) {
      bloc(j, FIG.jambeL, FIG.jambeH - FIG.piedH, FIG.prof, mJ, 0, -(FIG.jambeH - FIG.piedH) / 2, 0, 5 * K);
      bloc(j, FIG.jambeL, FIG.piedH, FIG.prof * 1.04, mJ, 0, -FIG.jambeH + FIG.piedH / 2, 0.01 * K, 4 * K);
      boite(j, FIG.jambeL * 0.98, 1.5 * K, FIG.prof * 1.06, mSillon, 0, -FIG.jambeH + FIG.piedH, 0);
    }
    // torse trapézoïdal, cou
    const torse = new THREE.Mesh(geoTorseFig(), mT); torse.position.set(0, FIG.yTorse + FIG.torseH / 2, 0); corps.add(torse);
    const cou = cyl(corps, FIG.couR, FIG.couR, FIG.couH + 0.01, 28, mH, 0, FIG.yCou + FIG.couH / 2, 0);
    // bras, attachés en haut des flancs du torse
    const yEpaule = FIG.yTorse + FIG.torseH - 28 * K, xEpaule = FIG.torseHaut / 2 + 12 * K;
    const bG = groupe(corps, -xEpaule, yEpaule, 0), bD = groupe(corps, xEpaule, yEpaule, 0);
    brasFig(bG, -1, mT, mH); brasFig(bD, 1, mT, mH);
    // tête lisse et tenon
    const tete = groupe(corps, 0, FIG.yTete + FIG.teteH / 2, 0);
    tete.add(new THREE.Mesh(geoTeteFig(), mH));
    const tenon = new THREE.Mesh(geoTenonFig(), mH); tenon.position.y = FIG.teteH / 2 - 0.004; tete.add(tenon);
    if (opts.objetMain) { const l = boite(bD, 0.05, 0.05, 0.9, M.acier(), 0.07, -0.56, 0.4); l.rotation.x = 0.1; }
    corps.scale.setScalar(1.3);
    racineG.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const f = { racine: racineG, corps, jG, jD, bG, bD, tete, hanche, cou, torse };
    f.animer = (pas, vitesse) => {
      const a = Math.sin(pas) * 0.7 * vitesse;
      jG.rotation.x = a; jD.rotation.x = -a; bG.rotation.x = -a * 0.9; bD.rotation.x = a * 0.9;
      corps.position.y = Math.abs(Math.cos(pas)) * 0.05 * vitesse;
    };
    return f;
  }
  /** Squelette de brique, d'après le modèle fourni : crâne imprimé, grosses épaules, cage thoracique bombée,
   *  colonne, bassin en barre, os épais aux genoux noueux, pieds griffus, mains en C. */
  function creerSquelette(opts) {
    const cOs = opts.teinte != null ? melange(0xf2efe6, opts.teinte, Math.min(0.35, opts.force || 0.2)) : 0xf2efe6;
    const mO = plastique(cOs, { mat: opts.teinte != null });
    const racineG = new THREE.Group(), corps = groupe(racineG);
    // bassin : barre transversale et pièce centrale
    bloc(corps, 172 * K, 24 * K, 50 * K, mO, 0, FIG.yHanche + 6 * K, 0, 6 * K);
    bloc(corps, 40 * K, 30 * K, 40 * K, mO, 0, FIG.yHanche + 26 * K, -8 * K, 6 * K);
    const xJ = (FIG.jambeL + FIG.ecart) / 2;
    const jG = groupe(corps, -xJ, FIG.yHanche, 0), jD = groupe(corps, xJ, FIG.yHanche, 0);
    for (const j of [jG, jD]) {
      const hanche = cyl(j, 24 * K, 24 * K, 66 * K, 20, mO, 0, -10 * K, 0); hanche.rotation.z = Math.PI / 2;
      cyl(j, 17 * K, 19 * K, 50 * K, 18, mO, 0, -42 * K, 0);
      const genou = cyl(j, 25 * K, 25 * K, 62 * K, 22, mO, 0, -76 * K, 4 * K); genou.rotation.z = Math.PI / 2;
      cyl(j, 16 * K, 18 * K, 34 * K, 18, mO, 0, -104 * K, 0);
      bloc(j, 84 * K, 30 * K, 92 * K, mO, 0, -FIG.jambeH + 15 * K, 6 * K, 7 * K);
      for (let k = 0; k < 4; k++) bloc(j, 16 * K, 16 * K, 26 * K, mO, (-27 + k * 18) * K, -FIG.jambeH + 8 * K, 58 * K, 5 * K);
    }
    // colonne vertébrale : vertèbres bombées
    for (let i = 0; i < 7; i++) { const v = cyl(corps, 20 * K, 20 * K, 15 * K, 20, mO, 0, FIG.yTorse + 18 * K + i * 19 * K, 6 * K); }
    // cage thoracique : quatre côtes épaisses et bombées vers l'avant, plus étroites en descendant
    // côtes : arches qui retombent sur les flancs, bombées vers l'avant
    const ARC = 2.2;
    for (let i = 0; i < 4; i++) {
      const rr = (96 - i * 7) * K;
      const cote = new THREE.Mesh(geo('coteFig3-' + i, () => new THREE.TorusGeometry(rr, 13 * K, 12, 36, ARC)), mO);
      cote.rotation.z = (Math.PI - ARC) / 2; cote.scale.set(1, 0.5, 1);
      cote.position.set(0, FIG.yTorse + (118 - i * 26) * K - rr * 0.5, 16 * K); corps.add(cote);
      const dos = new THREE.Mesh(geo('coteFig3-' + i), mO); dos.rotation.z = (Math.PI - ARC) / 2; dos.scale.set(1, 0.5, 1);
      dos.position.set(0, FIG.yTorse + (118 - i * 26) * K - rr * 0.5, -26 * K); corps.add(dos);
    }
    bloc(corps, 22 * K, 100 * K, 14 * K, mO, 0, FIG.yTorse + 88 * K, 30 * K, 5 * K); // sternum
    bloc(corps, 130 * K, 22 * K, 56 * K, mO, 0, FIG.yTorse + FIG.torseH - 12 * K, -4 * K, 8 * K); // clavicules
    const cou = cyl(corps, 22 * K, 24 * K, FIG.couH + 12 * K, 20, mO, 0, FIG.yCou + 2 * K, 0);
    // bras : grosses épaulettes, os épais, coude, main en C
    const yEpaule = FIG.yTorse + FIG.torseH - 28 * K, xEpaule = FIG.torseHaut / 2 + 14 * K;
    const bG = groupe(corps, -xEpaule, yEpaule, 0), bD = groupe(corps, xEpaule, yEpaule, 0);
    for (const [b, s] of [[bG, -1], [bD, 1]]) {
      bloc(b, 56 * K, 48 * K, 64 * K, mO, s * 8 * K, 4 * K, 0, 14 * K); // épaulette arrondie
      const haut = cyl(b, 20 * K, 22 * K, 84 * K, 18, mO, s * 16 * K, -56 * K, 0); haut.rotation.z = s * 0.25;
      const gc = groupe(b, s * 26 * K, -100 * K, 0);
      sph(gc, 23 * K, mO, 0, 0, 0, 18);
      const avant = cyl(gc, 19 * K, 20 * K, 48 * K, 18, mO, s * 3 * K, -10 * K, 22 * K); avant.rotation.x = Math.PI / 2 - 0.35;
      const main = new THREE.Mesh(geoMainFig(), mO); main.position.set(s * 30 * K, -34 * K, 44 * K);
      main.rotation.set(-0.3, s * 0.25, s < 0 ? 1.13 : 3.58); gc.add(main);
    }
    // crâne imprimé
    const tete = groupe(corps, 0, FIG.yTete + FIG.teteH / 2, 0);
    tete.add(new THREE.Mesh(geoTeteFig(), plastique(cOs, { map: texVisage('crane'), mat: opts.teinte != null })));
    const tenon = new THREE.Mesh(geoTenonFig(), mO); tenon.position.y = FIG.teteH / 2 - 0.004; tete.add(tenon);
    corps.scale.setScalar(1.3);
    racineG.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const f = { racine: racineG, corps, jG, jD, bG, bD, tete, cou, squelette: true };
    f.animer = (pas, vitesse) => { const a = Math.sin(pas) * 0.7 * vitesse; jG.rotation.x = a; jD.rotation.x = -a; bG.rotation.x = -a * 0.9; bD.rotation.x = a * 0.9; };
    return f;
  }
  // =====================================================================
  // CADAVRES (décomposition visible, indices de la cause)
  // =====================================================================
  function creerCadavre(c, ageJours) {
    const st = C.stadeCorps(ageJours);
    const g = new THREE.Group();
    if (st.stade >= 5) return null;
    const cause = c.cause || '';
    const rr = C.alea(C.h32(String(c.id || '').length * 977 + Math.floor((c.x + 7) * 1000), Math.floor((c.z + 7) * 1000)));
    let fig = null;
    if (st.stade <= 2) {
      const teinteMort = st.stade === 0 ? (cause === 'brule' ? 0x1a1410 : 0x6a6a60) : st.stade === 1 ? 0x5b6b3a : 0x3a3626;
      const force = st.stade === 0 ? (cause === 'brule' ? 0.75 : 0.25) : st.stade === 1 ? 0.45 : 0.62;
      fig = creerFigurine(c.look || {}, { teinte: teinteMort, force, visage: 'peur' });
      if (st.stade === 2) { fig.bG.visible = false; const b = boite(g, 0.16, 0.5, 0.16, M.os(), 0.7, 0.08, 0.3); b.rotation.z = Math.PI / 2; }
    } else {
      fig = creerFigurine(c.look || {}, { squelette: true });
      if (st.stade === 4) {
        const k = st.f;
        fig.bG.visible = k < 0.3; fig.jD.visible = k < 0.55; fig.bD.visible = k < 0.75; fig.tete.visible = k < 0.9;
        fig.racine.scale.set(1, 1 - k * 0.5, 1);
        const pd = new THREE.Mesh(geo('pd', () => new THREE.CircleGeometry(0.9, 18)), M.poussiere()); pd.rotation.x = -Math.PI / 2; pd.position.y = 0.012; pd.scale.setScalar(0.6 + k * 0.7); g.add(pd);
      }
    }
    const f = fig.racine;
    f.rotation.x = -Math.PI / 2; f.position.y = 0.2; f.position.z = 0.8; f.rotation.z = (rr() - 0.5) * 1.2;
    fig.bG.rotation.x = -0.4; fig.bD.rotation.x = 0.9; fig.jG.rotation.x = 0.2;
    if (cause === 'ecrase') f.scale.set(1.1, 1.15, 0.35);
    if (cause === 'tranche' || cause === 'lames') { fig.tete.position.set(0.5, 1.5, 0.2); }
    if (cause === 'chute') f.position.y = -1.6;
    g.add(f);
    // traces au sol
    const decal = (tex, s, op) => { const d = new THREE.Mesh(geo('dc' + s, () => new THREE.PlaneGeometry(s, s)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false })); d.rotation.x = -Math.PI / 2; d.position.y = 0.013; g.add(d); return d; };
    if (cause === 'brule') decal(texTache('suie', (x, w) => { const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, w); }), 3, 0.8);
    if (cause === 'lames' || cause === 'tranche' || cause === 'scie') decal(texTache('entailles', (x) => { x.strokeStyle = 'rgba(10,8,6,0.85)'; x.lineWidth = 3; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(10, 30 + i * 18); x.lineTo(118, 22 + i * 20); x.stroke(); } }), 2.6, 0.9);
    if (cause === 'pointes') decal(texTache('trous', (x) => { x.fillStyle = 'rgba(0,0,0,0.85)'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(20 + i * 29, 20 + j * 29, 5, 0, TAU); x.fill(); } }), 2.2, 0.9);
    if (cause === 'ecrase') decal(texTache('fissures', (x) => { x.strokeStyle = 'rgba(0,0,0,0.8)'; x.lineWidth = 2; for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(64, 64); let px = 64, py = 64; for (let k = 0; k < 4; k++) { px += (Math.random() - 0.5) * 50; py += (Math.random() - 0.5) * 50; x.lineTo(px, py); } x.stroke(); } }), 3, 0.85);
    if (cause === 'fleches') for (let i = 0; i < 3; i++) {
      const fl = cyl(g, 0.02, 0.02, 0.7, 5, M.bois(), (rr() - 0.5) * 1.6, 0.05, (rr() - 0.5) * 1.6 + 0.6); fl.rotation.z = Math.PI / 2; fl.rotation.y = rr() * TAU;
    }
    g.userData.stade = st.stade;
    return g;
  }

  // =====================================================================
  // OBJETS RAMASSABLES
  // =====================================================================
  const COUL_RARETE = { commun: 0xcfc6b0, rare: 0x6fb7ff, epique: 0xc77dff, legendaire: 0xffc94a };
  function creerObjet(type) {
    const def = C.OBJETS[type] || { forme: 'bourse', rarete: 'commun' };
    const g = new THREE.Group(), m = groupe(g, 0, 0.25, 0);
    const or = M.or(), jade = M.jade();
    switch (def.forme) {
      case 'lingot': for (let i = 0; i < 2; i++) bloc(m, 0.5, 0.15, 0.24, or, 0, i * 0.16, i * 0.05, 0.04); break;
      case 'bourse': sph(m, 0.2, mat(0x6b3f1f), 0, 0, 0).scale.set(1, 0.85, 1); cyl(m, 0.06, 0.1, 0.1, 8, or, 0, 0.18, 0); break;
      case 'jetons': [0xa3271f, 0x1e1f26, 0xd8b25a].forEach((c, i) => cyl(m, 0.16, 0.16, 0.05, 16, mat(c, { r: 0.4 }), i * 0.05, i * 0.055, 0)); break;
      case 'fiole': cyl(m, 0.1, 0.12, 0.34, 10, mat(0x0a0a0c, { r: 0.1, m: 0.6, e: 0x1a0f00 }), 0, 0.06, 0); cyl(m, 0.05, 0.05, 0.08, 8, or, 0, 0.27, 0); break;
      case 'encens': for (let i = 0; i < 5; i++) { const s = cyl(m, 0.015, 0.015, 0.6, 4, mat(0x7a3a20), (i - 2) * 0.03, 0.1, 0); s.rotation.z = (i - 2) * 0.08; } break;
      case 'rouleau': { const r = cyl(m, 0.08, 0.08, 0.5, 10, mat(0xd9c99a), 0, 0, 0); r.rotation.z = Math.PI / 2; cyl(m, 0.1, 0.1, 0.04, 10, or, 0.26, 0, 0).rotation.z = Math.PI / 2; break; }
      case 'cle': { const t = new THREE.Mesh(geo('tor', () => new THREE.TorusGeometry(0.1, 0.03, 6, 14)), M.bronze()); t.position.x = -0.18; m.add(t); boite(m, 0.34, 0.04, 0.04, M.bronze(), 0.06, 0, 0); break; }
      case 'jade': m.add(new THREE.Mesh(geo('ico', () => new THREE.IcosahedronGeometry(0.2, 0)), jade)); break;
      case 'lame': { const l = boite(m, 0.7, 0.03, 0.1, M.acier(), 0.1, 0, 0); boite(m, 0.2, 0.06, 0.06, M.bois(), -0.36, 0, 0); break; }
      case 'katana': { boite(m, 1.0, 0.025, 0.06, M.acier(), 0.15, 0, 0); boite(m, 0.3, 0.05, 0.05, mat(0x1a1a1a), -0.5, 0, 0); cyl(m, 0.07, 0.07, 0.02, 12, or, -0.34, 0, 0).rotation.z = Math.PI / 2; break; }
      case 'anneau': m.add(new THREE.Mesh(geo('tor2', () => new THREE.TorusGeometry(0.14, 0.04, 8, 18)), jade)); m.children[0].rotation.x = Math.PI / 2; break;
      case 'disque': cyl(m, 0.24, 0.24, 0.04, 20, M.bronze(), 0, 0, 0); break;
      case 'plastron': for (let i = 0; i < 3; i++) boite(m, 0.5 - i * 0.05, 0.12, 0.08, mat(0x5a1a16, { r: 0.5, m: 0.4 }), 0, i * 0.13, 0); break;
      case 'eventail': { const e = new THREE.Mesh(geo('evt', () => new THREE.CircleGeometry(0.3, 12, 0, Math.PI)), mat(0x2d2a3a, { ds: true, m: 0.6 })); e.rotation.x = -Math.PI / 2; m.add(e); break; }
      case 'perle': sph(m, 0.12, mat(0x15121a, { r: 0.05, m: 0.4, e: 0x150d20 }), 0, 0, 0, 16); break;
      case 'statuette': cone(m, 0.14, 0.4, jade, 0, 0.05, 0, 10); sph(m, 0.08, jade, 0, 0.3, 0); break;
      case 'masque': sph(m, 0.2, mat(0xa3271f, { r: 0.3 }), 0, 0, 0).scale.set(1, 1.1, 0.4); break;
      case 'sceau': boite(m, 0.24, 0.24, 0.24, jade, 0, 0, 0); sph(m, 0.08, jade, 0, 0.17, 0); break;
      case 'plume': { const p = cone(m, 0.06, 0.6, mat(0xff6a2a, { e: 0x5a1a00 }), 0, 0, 0, 6); p.rotation.z = Math.PI / 2.3; break; }
      default: sph(m, 0.18, or, 0, 0, 0);
    }
    const anneau = new THREE.Mesh(geo('halo', () => new THREE.CircleGeometry(0.5, 32)), mat(COUL_RARETE[def.rarete], { basic: true, add: true, op: 0.3 }));
    anneau.rotation.x = -Math.PI / 2; anneau.position.y = 0.02; g.add(anneau);
    const lueur = halo(g, COUL_RARETE[def.rarete], def.rarete === 'legendaire' ? 1.6 : 1.1, 0, 0.35, 0, def.rarete === 'commun' ? 0.25 : 0.45);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    g.userData.anim = t => { m.rotation.y = t * 0.0012; m.position.y = 0.25 + Math.sin(t * 0.003) * 0.05; lueur.material.opacity = (def.rarete === 'commun' ? 0.2 : 0.4) + Math.sin(t * 0.004) * 0.1; };
    return g;
  }

  // =====================================================================
  // PIÈGES
  // =====================================================================
  // repère « face » : la face 0 est le mur nord (z = -DM), l'intérieur est vers +z
  const ANGLE_FACE = f => -f * Math.PI / 2;
  function localDepuisFace(f, a, p) { // a : le long du mur, p : profondeur depuis le mur
    switch (f) { case 0: return [a, -DM + p]; case 1: return [DM - p, a]; case 2: return [-a, DM - p]; default: return [-DM + p, -a]; }
  }
  function faceDepuisLocal(f, x, z) { // inverse : coordonnées (a, p)
    switch (f) { case 0: return [x, z + DM]; case 1: return [z, DM - x]; case 2: return [-x, DM - z]; default: return [-z, x + DM]; }
  }
  const CASE = 1.5;
  const centreCase = i => -DM + CASE * (i + 0.5);

  /** Chaque fabrique renvoie { maj(t, ctx), danger(t, x, z, r, ctx), obstacles(t, ctx, liste), son(t, ctx) }. */
  const FABRIQUES = {
    pointes(p, g, ctx) {
      const cases = [];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const x = centreCase(i), z = centreCase(j), a = p.axe === 'x' ? x : z;
        if (a < p.a0 || a > p.a1) continue;
        if (Math.abs(x) < 1.2 && Math.abs(z) < 1.2) continue;
        const grp = p.motif === 'damier' ? (i + j) % 2 : p.motif === 'rangs' ? (p.axe === 'x' ? i : j) % 3 : (p.axe === 'x' ? i : j);
        cases.push({ x, z, dec: p.motif === 'vague' ? grp * 0.07 : grp * 0.33 });
      }
      const n = cases.length * 5;
      const inst = new THREE.InstancedMesh(gCone(0.09, 0.9, 6), M.acier(), Math.max(1, n));
      g.add(inst);
      for (const c of cases) { const pl = boite(g, CASE - 0.08, 0.04, CASE - 0.08, M.ferSombre(), c.x, 0.02, c.z); pl.receiveShadow = false; }
      const tmp = new THREE.Object3D();
      const haut = (t, c) => {
        const u = fr(t, p.periode * ctx.tempo('pointes'), p.off + c.dec * p.periode);
        if (u < 0.55) return 0; if (u < 0.68) return 0.12; if (u < 0.71) return (u - 0.68) / 0.03; if (u < 0.88) return 1; if (u < 0.97) return 1 - (u - 0.88) / 0.09; return 0;
      };
      return {
        maj(t) {
          let k = 0;
          for (const c of cases) {
            const h = haut(t, c);
            for (let q = 0; q < 5; q++) {
              const ox = q === 4 ? 0 : (q % 2 ? 0.35 : -0.35), oz = q === 4 ? 0 : (q < 2 ? 0.35 : -0.35);
              tmp.position.set(c.x + ox, -0.45 + h * 0.9, c.z + oz); tmp.updateMatrix(); inst.setMatrixAt(k++, tmp.matrix);
            }
          }
          inst.instanceMatrix.needsUpdate = true;
        },
        danger(t, x, z) {
          for (const c of cases) if (Math.abs(x - c.x) < CASE / 2 && Math.abs(z - c.z) < CASE / 2 && haut(t, c) > 0.5) return 'pointes';
          return null;
        },
        son(t) { const c = cases[0]; if (!c) return ''; const h = haut(t, c); return h > 0.5 ? 'pointes' : h > 0 ? 'cliquetis' : ''; },
      };
    },

    lamesMur(p, g, ctx) {
      const fg = groupe(g); fg.rotation.y = ANGLE_FACE(p.mur);
      const lames = p.pos.map((a, k) => {
        const fente = boite(fg, 0.14, 1.0, 0.05, M.noir(), a, 1.05, -DM + EP / 2 + 0.01);
        const l = groupe(fg, a, 1.05, -DM + EP / 2);
        const lame = boite(l, 0.06, 0.8, 1, M.acier(), 0, 0, 0.5);
        const lueur = boite(fg, 0.1, 0.9, 0.02, mat(0xff4020, { basic: true, add: true, op: 0 }), a, 1.05, -DM + EP / 2 + 0.03);
        return { a, l, lame, lueur, dec: k * p.dec };
      });
      const ext = (t, L) => {
        const u = fr(t, p.periode * ctx.tempo('lames'), p.off + L.dec * p.periode);
        if (u < 0.5) return [0, 0]; if (u < 0.62) return [0, (u - 0.5) / 0.12];
        if (u < 0.66) return [p.long * (u - 0.62) / 0.04, 1]; if (u < 0.8) return [p.long, 1]; if (u < 0.9) return [p.long * (1 - (u - 0.8) / 0.1), 0]; return [0, 0];
      };
      return {
        maj(t) { for (const L of lames) { const [e, w] = ext(t, L); L.lame.scale.z = Math.max(0.001, e); L.lame.position.z = e / 2; L.lame.visible = e > 0.02; L.lueur.material.opacity = w * 0.8; } },
        danger(t, x, z, r) {
          const [a, d] = faceDepuisLocal(p.mur, x, z);
          for (const L of lames) { const [e] = ext(t, L); if (e > 0.1 && Math.abs(a - L.a) < 0.1 + r && d < e + EP / 2) return 'lames'; }
          return null;
        },
        son(t) { const [e, w] = ext(t, lames[0]); return e > 0.1 ? 'lame' : w > 0 ? 'cliquetis' : ''; },
      };
    },

    broyeur(p, g, ctx) {
      const ax = p.axe; // 'x' : panneaux sur les murs est/ouest
      const larg = p.c1 - p.c0, cc = (p.c0 + p.c1) / 2;
      const mk = s => {
        const pg = groupe(g);
        boite(pg, 0.6, 3.6, larg, mat(0x2a2522, { r: 0.7, m: 0.5 }), 0, 1.8, 0);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { const c = cone(pg, 0.12, 0.4, M.acier(), -s * 0.45, 0.6 + i * 1.1, -larg / 2 + 0.5 + j * (larg - 1) / 3); c.rotation.z = s * Math.PI / 2; }
        if (ax === 'z') pg.rotation.y = Math.PI / 2;
        return pg;
      };
      const pA = mk(1), pB = mk(-1);
      const rail = boite(g, ax === 'x' ? DM * 2 : 0.2, 0.03, ax === 'x' ? 0.2 : DM * 2, M.ferSombre(), ax === 'x' ? 0 : cc, 0.016, ax === 'x' ? cc : 0);
      const bord = t => {
        const u = fr(t, p.periode * ctx.tempo('broyeur'), p.off);
        if (u < 0.45) return DM; if (u < 0.55) return DM - 0.25 - Math.sin(u * 300) * 0.05;
        if (u < 0.75) { const k = (u - 0.55) / 0.2; return (DM - 0.25) * (1 - k * k); } if (u < 0.8) return 0; return DM * ((u - 0.8) / 0.2);
      };
      return {
        maj(t) {
          const e = bord(t);
          if (ax === 'x') { pA.position.set(e + 0.3, 0, cc); pB.position.set(-e - 0.3, 0, cc); }
          else { pA.position.set(cc, 0, e + 0.3); pB.position.set(cc, 0, -e - 0.3); }
        },
        obstacles(t, ctx2, L) {
          const e = bord(t); if (e > DM - 0.2) return;
          if (ax === 'x') { L.push({ x0: e, x1: DM + 1, z0: p.c0, z1: p.c1, pousse: 1 }); L.push({ x0: -DM - 1, x1: -e, z0: p.c0, z1: p.c1, pousse: 1 }); }
          else { L.push({ z0: e, z1: DM + 1, x0: p.c0, x1: p.c1, pousse: 1 }); L.push({ z0: -DM - 1, z1: -e, x0: p.c0, x1: p.c1, pousse: 1 }); }
        },
        danger(t, x, z, r) {
          const e = bord(t), q = ax === 'x' ? z : x, a = ax === 'x' ? x : z;
          if (q > p.c0 - r * 0.5 && q < p.c1 + r * 0.5 && Math.abs(a) > e - r * 0.6 && e < 2.5) return 'ecrase';
          return null;
        },
        son(t) { const u = fr(t, p.periode * ctx.tempo('broyeur'), p.off); return u >= 0.55 && u < 0.8 ? 'broyeur' : u >= 0.45 && u < 0.55 ? 'grondement' : ''; },
      };
    },

    flammes(p, g, ctx) {
      const jets = p.buses.map(b => {
        const fg = groupe(g); fg.rotation.y = ANGLE_FACE(b.mur);
        const buse = cyl(fg, 0.16, 0.22, 0.35, 10, M.bronze(), b.pos, 1.0, -DM + EP / 2 + 0.15); buse.rotation.x = Math.PI / 2;
        const jet = groupe(fg, b.pos, 1.0, -DM + EP / 2 + 0.3);
        const f1 = cone(jet, 0.55, 1, M.flamme(), 0, 0, 0.5, 10); f1.rotation.x = -Math.PI / 2;
        const f2 = cone(jet, 0.25, 1, M.flammeCoeur(), 0, 0, 0.5, 8); f2.rotation.x = -Math.PI / 2;
        const lueur = halo(fg, 0xff8a3a, 3.2, b.pos, 1.0, -DM + EP / 2 + 1.6, 0.7); lueur.visible = false;
        return { b, jet, f1, f2, lueur };
      });
      const etat = (t, J) => {
        const u = fr(t, p.periode * ctx.tempo('flammes'), p.off + J.b.dec * p.periode);
        if (u < 0.5) return [0, 0]; if (u < 0.6) return [0.12, 0]; if (u < 0.63) return [(u - 0.6) / 0.03, 1]; if (u < 0.85) return [1, 1]; if (u < 0.9) return [1 - (u - 0.85) / 0.05, 1]; return [0, 0];
      };
      return {
        maj(t) {
          for (const J of jets) {
            const [k] = etat(t, J), L = Math.max(0.01, J.b.long * k), fl = 1 + Math.sin(t * 0.05 + J.b.pos) * 0.08 + Math.sin(t * 0.13) * 0.05;
            J.jet.visible = k > 0.01; J.jet.scale.set(fl * (0.6 + k * 0.4), fl * (0.6 + k * 0.4), L);
            J.lueur.visible = k > 0.05; J.lueur.position.z = -DM + EP / 2 + 0.3 + L * 0.45; J.lueur.scale.setScalar(1.5 + L * 0.5);
          }
        },
        danger(t, x, z, r) {
          for (const J of jets) {
            const [k, act] = etat(t, J); if (!act) continue;
            const [a, d] = faceDepuisLocal(J.b.mur, x, z);
            if (Math.abs(a - J.b.pos) < 0.5 + r && d < J.b.long * k + 0.4) return 'brule';
          }
          return null;
        },
        son(t) { const [k, a] = etat(t, jets[0]); return a ? 'flamme' : k > 0 ? 'sifflement' : ''; },
      };
    },

    fleches(p, g, ctx) {
      const fg = groupe(g); fg.rotation.y = ANGLE_FACE(p.mur);
      p.trous.forEach(a => boite(fg, 0.16, 0.16, 0.05, M.noir(), a, 1.1, -DM + EP / 2 + 0.01));
      const fl = p.trous.map(a => { const f = groupe(fg, a, 1.1, 0); const c = cyl(f, 0.025, 0.025, 0.75, 5, M.bois(), 0, 0, 0); c.rotation.x = Math.PI / 2; cone(f, 0.05, 0.15, M.acier(), 0, 0, 0.42, 5).rotation.x = Math.PI / 2; return f; });
      const per = () => p.periode * ctx.tempo('fleches');
      const dist = (t, k) => {
        const u = fr(t, per(), p.off + k * 90);
        if (u < 0.6) return -1; const d = (u - 0.6) * per() / 1000 * p.vitesse; return d > DM * 2 ? -1 : d;
      };
      return {
        maj(t) { fl.forEach((f, k) => { const d = dist(t, k); f.visible = d >= 0; f.position.z = -DM + EP / 2 + d; }); },
        danger(t, x, z, r) {
          const [a, d0] = faceDepuisLocal(p.mur, x, z);
          for (let k = 0; k < p.trous.length; k++) { const d = dist(t, k); if (d >= 0 && Math.abs(a - p.trous[k]) < 0.06 + r && Math.abs(d0 - d) < 0.45 + r) return 'fleches'; }
          return null;
        },
        son(t) { const u = fr(t, per(), p.off); return u >= 0.6 && u < 0.64 ? 'fleches' : u >= 0.52 && u < 0.6 ? 'cliquetis' : ''; },
      };
    },

    dalle(p, g, ctx, idx) {
      const dalles = p.dalles.map((d, k) => {
        const m = boite(g, 1.1, 0.07, 1.1, mat(0x3a332a, { r: 0.6, m: 0.3 }), d.x, 0.035, d.z);
        const fg = groupe(g); fg.rotation.y = ANGLE_FACE(d.mur);
        const [a] = faceDepuisLocal(d.mur, d.x, d.z);
        [-0.35, 0, 0.35].forEach(o => boite(fg, 0.14, 0.14, 0.05, M.noir(), a + o, 1.0, -DM + EP / 2 + 0.01));
        const fl = [-0.35, 0, 0.35].map(o => { const f = groupe(fg, a + o, 1.0, 0); const c = cyl(f, 0.025, 0.025, 0.75, 5, M.bois(), 0, 0, 0); c.rotation.x = Math.PI / 2; f.visible = false; return f; });
        return { d, m, a, fl, k };
      });
      const actifs = t => (ctx.declencheurs || []).filter(e => e.piege === idx && t - e.t0 < 3000);
      const dist = (t, e, j) => { const dt = t - e.t0 - 450 - j * 70; if (dt < 0) return -1; const d = dt / 1000 * 14; return d > DM * 2 ? -1 : d; };
      return {
        dalles,
        maj(t) {
          const ev = actifs(t);
          for (const D of dalles) {
            const e = ev.find(v => v.sub === D.k);
            D.m.position.y = e && t - e.t0 < 1500 ? 0.0 : 0.035;
            D.fl.forEach((f, j) => { const d = e ? dist(t, e, j) : -1; f.visible = d >= 0; f.position.z = -DM + EP / 2 + d; });
          }
        },
        surDalle(x, z) { for (const D of dalles) if (Math.abs(x - D.d.x) < 0.55 && Math.abs(z - D.d.z) < 0.55) return D.k; return -1; },
        danger(t, x, z, r) {
          for (const e of actifs(t)) {
            const D = dalles[e.sub]; if (!D) continue;
            const [a, d0] = faceDepuisLocal(D.d.mur, x, z);
            for (let j = 0; j < 3; j++) { const d = dist(t, e, j); if (d >= 0 && Math.abs(a - D.a - (j - 1) * 0.35) < 0.08 + r && Math.abs(d0 - d) < 0.45 + r) return 'fleches'; }
          }
          return null;
        },
        son(t) { return actifs(t).some(e => t - e.t0 > 450 && t - e.t0 < 700) ? 'fleches' : ''; },
      };
    },

    fosses(p, g, ctx) {
      const cases = p.cases.map(([i, j]) => {
        const x = centreCase(i), z = centreCase(j);
        const trou = boite(g, CASE - 0.1, 0.02, CASE - 0.1, M.noir(), x, -0.005, z); trou.visible = false;
        const fente = boite(g, CASE - 0.04, 0.012, 0.02, mat(0x000000, { op: 0.4 }), x, 0.006, z + CASE / 2 - 0.05);
        return { x, z, trou };
      });
      return {
        cases,
        maj(t, c2) { for (const c of cases) c.trou.visible = !!(c2.fossesOuvertes && c2.fossesOuvertes.has(c.x + ',' + c.z)); },
        danger(t, x, z, r, c2) {
          for (const c of cases) if (Math.abs(x - c.x) < CASE / 2 - r * 0.6 && Math.abs(z - c.z) < CASE / 2 - r * 0.6) {
            if (c2.ouvrirFosse) c2.ouvrirFosse(c.x + ',' + c.z); return 'chute';
          }
          return null;
        },
      };
    },

    solDerobe(p, g, ctx) {
      const tuiles = [];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const x = centreCase(i), z = centreCase(j), q = p.axe === 'x' ? z : x, a = p.axe === 'x' ? x : z;
        if (q < p.c0 || q > p.c1) continue;
        const ord = p.sens > 0 ? (p.axe === 'x' ? i : j) : 7 - (p.axe === 'x' ? i : j);
        const m = boite(g, CASE - 0.06, 0.25, CASE - 0.06, mat(0x3b342c, { r: 0.95 }), x, -0.12 + 0.005, z);
        tuiles.push({ x, z, ord, m });
      }
      boite(g, p.axe === 'x' ? DM * 2 : p.c1 - p.c0, 0.02, p.axe === 'x' ? p.c1 - p.c0 : DM * 2, M.noir(), p.axe === 'x' ? 0 : (p.c0 + p.c1) / 2, -0.26, p.axe === 'x' ? (p.c0 + p.c1) / 2 : 0);
      const etat = (t, T) => {
        const u = fr(t, p.periode * ctx.tempo('sol'), p.off), u0 = 0.32 + T.ord * 0.045;
        if (u < u0 - 0.06) return 0; if (u < u0) return 1; if (u < 0.86) return 2; return u < 0.95 ? 3 : 0;
      };
      return {
        maj(t) {
          for (const T of tuiles) {
            const e = etat(t, T);
            T.m.position.y = e === 2 ? -6 : e === 3 ? -6 * (1 - (fr(t, p.periode * ctx.tempo('sol'), p.off) - 0.86) / 0.09) : -0.12 + (e === 1 ? Math.sin(t * 0.08) * 0.03 : 0);
            T.m.visible = T.m.position.y > -5.9;
          }
        },
        danger(t, x, z, r) {
          for (const T of tuiles) if (Math.abs(x - T.x) < CASE / 2 - r * 0.4 && Math.abs(z - T.z) < CASE / 2 - r * 0.4 && etat(t, T) >= 2) return 'chute';
          return null;
        },
        son(t) { return tuiles.some(T => etat(t, T) === 1) ? 'craquement' : ''; },
      };
    },

    pendule(p, g, ctx) {
      const Lb = HT - 1.0;
      const pend = p.lignes.map(l => {
        const piv = groupe(g, l.axe === 'x' ? 0 : l.c, HT, l.axe === 'x' ? l.c : 0);
        const bras = groupe(piv);
        boite(bras, 0.08, Lb, 0.08, M.fer(), 0, -Lb / 2, 0);
        const lame = boite(bras, l.axe === 'x' ? 0.08 : 1.6, 0.55, l.axe === 'x' ? 1.6 : 0.08, M.acier(), 0, -Lb, 0);
        boite(g, l.axe === 'x' ? DM * 2 : 0.05, 0.01, l.axe === 'x' ? 0.05 : DM * 2, mat(0x000000, { op: 0.35 }), l.axe === 'x' ? 0 : l.c, 0.006, l.axe === 'x' ? l.c : 0);
        return { l, piv, bras };
      });
      const angle = (t, P) => Math.asin(Math.min(0.99, P.l.amp / Lb)) * Math.sin(TAU * (t + P.l.off) / (P.l.periode * ctx.tempo('lames')));
      return {
        maj(t) { for (const P of pend) { const a = angle(t, P); if (P.l.axe === 'x') P.bras.rotation.z = a; else P.bras.rotation.x = -a; } },
        danger(t, x, z, r) {
          for (const P of pend) {
            const a = angle(t, P), s = Lb * Math.sin(a), y = HT - Lb * Math.cos(a) - 0.27;
            if (y > 1.6) continue;
            const along = P.l.axe === 'x' ? x : z, perp = P.l.axe === 'x' ? z : x;
            const sx = s;
            if (Math.abs(along - sx) < 0.12 + r && Math.abs(perp - P.l.c) < 0.8 + r) return 'lames';
          }
          return null;
        },
        son(t) { const P = pend[0]; const a = angle(t, P); return Math.abs(a) < 0.12 ? 'souffle' : ''; },
      };
    },

    herse(p, g, ctx) {
      const faces = p.faces.filter(f => (ctx.spec.portes >> f) & 1);
      const hs = faces.map(f => {
        const fg = groupe(g); fg.rotation.y = ANGLE_FACE(f);
        const h = groupe(fg, 0, 0, -DM + EP / 2 + 0.25);
        for (let i = 0; i < 6; i++) { boite(h, 0.07, HP, 0.07, M.fer(), -PL / 2 + 0.2 + i * (PL - 0.4) / 5, HP / 2, 0); cone(h, 0.06, 0.2, M.fer(), -PL / 2 + 0.2 + i * (PL - 0.4) / 5, -0.1, 0).rotation.x = Math.PI; }
        for (let j = 0; j < 3; j++) boite(h, PL, 0.07, 0.07, M.fer(), 0, 0.6 + j * 1.0, 0);
        return { f, h };
      });
      const haut = t => {
        const u = fr(t, p.periode * ctx.tempo('herse'), p.off);
        if (u < 0.6) return HP; if (u < 0.66) return HP - Math.abs(Math.sin(u * 200)) * 0.08; if (u < 0.68) return HP * (1 - (u - 0.66) / 0.02); if (u < 0.9) return 0; return HP * (u - 0.9) / 0.1;
      };
      return {
        faces,
        bloque: (t, f, c2) => faces.includes(f) && haut(t) < 1.6 && !(c2.herseLevee && c2.herseLevee(f, t)),
        maj(t, c2) { const h = haut(t); for (const H of hs) H.h.position.y = (c2.herseLevee && c2.herseLevee(H.f, t)) ? Math.max(h, 2.2) : h; },
        danger(t, x, z, r) {
          const u = fr(t, p.periode * ctx.tempo('herse'), p.off); if (u < 0.66 || u > 0.685) return null;
          for (const f of faces) { const [a, d] = faceDepuisLocal(f, x, z); if (Math.abs(a) < PL / 2 && d < 0.75 + r) return 'ecrase'; }
          return null;
        },
        son(t) { const u = fr(t, p.periode * ctx.tempo('herse'), p.off); return u >= 0.66 && u < 0.7 ? 'herse' : u >= 0.6 && u < 0.66 ? 'chaine' : ''; },
      };
    },

    plafond(p, g, ctx) {
      const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      const bloc = groupe(g, cx, HT, cz);
      boite(bloc, w, 1.2, d, mat(0x45403a, { r: 0.95, op: 0.92 }), 0, 0.6, 0);
      for (let i = 0; i < 4; i++) cyl(bloc, 0.1, 0.1, 0.06, 8, M.fer(), (i % 2 ? 1 : -1) * (w / 2 - 0.3), 0.02, (i < 2 ? 1 : -1) * (d / 2 - 0.3));
      const ombre = boite(g, w, 0.01, d, mat(0x000000, { op: 0.0 }), cx, 0.008, cz);
      const haut = t => {
        const u = fr(t, p.periode * ctx.tempo('plafond'), p.off);
        if (u < 0.5) return HT; if (u < 0.62) return HT - 0.15; if (u < 0.72) { const k = (u - 0.62) / 0.1; return (HT - 0.15) * (1 - k * k); } if (u < 0.8) return 0; return HT * (u - 0.8) / 0.2;
      };
      return {
        maj(t) { const h = haut(t); bloc.position.y = h; ombre.material = mat(0x000000, { op: Math.round(clamp(0.75 - h / HT * 0.75, 0, 0.75) * 20) / 20 }); },
        danger(t, x, z, r) { return haut(t) < 1.65 && x > p.x0 - r * 0.5 && x < p.x1 + r * 0.5 && z > p.z0 - r * 0.5 && z < p.z1 + r * 0.5 ? 'ecrase' : null; },
        son(t) { const u = fr(t, p.periode * ctx.tempo('plafond'), p.off); return u >= 0.62 && u < 0.72 ? 'broyeur' : u >= 0.5 && u < 0.62 ? 'grondement' : ''; },
      };
    },

    rouleau(p, g, ctx, idx, rayon) {
      const R = rayon || 0.85, ax = p.axe;
      const rg = groupe(g, 0, R, 0);
      const cy = cyl(rg, R, R, p.larg, 16, mat(0x3a3530, { r: 0.6, m: 0.6 }), 0, 0, 0);
      cy.rotation.z = ax === 'z' ? Math.PI / 2 : 0; if (ax === 'x') cy.rotation.x = Math.PI / 2;
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; const c = cone(cy, 0.1, 0.35, M.acier(), Math.cos(a) * R, (i % 3 - 1) * p.larg * 0.3, Math.sin(a) * R); c.rotation.set(0, -a, -Math.PI / 2); }
      boite(g, ax === 'x' ? DM * 2 : p.larg, 0.02, ax === 'x' ? p.larg : DM * 2, mat(0x0b0a09, { op: 0.6 }), ax === 'x' ? 0 : p.c, 0.01, ax === 'x' ? p.c : 0);
      const pos = t => (tri(fr(t, p.periode * ctx.tempo('rouleau'), p.off)) * 2 - 1) * (DM - R - 0.2);
      return {
        maj(t) { const s = pos(t); if (ax === 'x') { rg.position.set(s, R, p.c); cy.rotation.y = 0; rg.rotation.z = -s / R; } else { rg.position.set(p.c, R, s); rg.rotation.x = s / R; } },
        danger(t, x, z, r) { const s = pos(t), a = ax === 'x' ? x : z, q = ax === 'x' ? z : x; return Math.abs(a - s) < R * 0.9 + r && Math.abs(q - p.c) < p.larg / 2 + r ? 'ecrase' : null; },
        son() { return 'roulement'; },
      };
    },

    engrenages(p, g, ctx) {
      const R = p.rayon, ax = p.axe;
      const rg = groupe(g, 0, R, 0);
      const roue = groupe(rg);
      cyl(roue, R, R, 0.4, 20, mat(0x5a4a2a, { r: 0.4, m: 0.85 }), 0, 0, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; boite(roue, 0.3, 0.36, 0.42, M.bronze(), Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), 0).rotation.z = a; }
      cyl(roue, 0.3, 0.3, 0.5, 10, M.fer(), 0, 0, 0).rotation.x = Math.PI / 2;
      if (ax === 'z') rg.rotation.y = Math.PI / 2;
      boite(g, ax === 'x' ? DM * 2 : 0.5, 0.02, ax === 'x' ? 0.5 : DM * 2, M.noir(), ax === 'x' ? 0 : p.c, 0.01, ax === 'x' ? p.c : 0);
      const pos = t => (tri(fr(t, p.periode * ctx.tempo('rouleau'), p.off)) * 2 - 1) * (DM - R - 0.3);
      return {
        maj(t) { const s = pos(t); if (ax === 'x') rg.position.set(s, R, p.c); else rg.position.set(p.c, R, s); roue.rotation.z = -s / R; },
        danger(t, x, z, r) { const s = pos(t), a = ax === 'x' ? x : z, q = ax === 'x' ? z : x; return Math.abs(a - s) < R * 0.85 + r && Math.abs(q - p.c) < 0.25 + r ? 'broye' : null; },
        son() { return 'engrenage'; },
      };
    },

    plateforme(p, g, ctx) {
      const R = p.rayon;
      const fosse = new THREE.Mesh(geo('fosseRond' + R, () => new THREE.CircleGeometry(R, 40)), M.noir()); fosse.rotation.x = -Math.PI / 2; fosse.position.y = 0.012; g.add(fosse);
      const disque = groupe(g, 0, 0.03, 0);
      const plat = new THREE.Mesh(geo('plat' + R + p.secteur, () => new THREE.CircleGeometry(R - 0.05, 40, p.secteur / 2, TAU - p.secteur)), mat(0x5a4a32, { r: 0.6, m: 0.5, ds: true }));
      plat.rotation.x = -Math.PI / 2; disque.add(plat);
      const anneau = new THREE.Mesh(geo('ann' + R, () => new THREE.RingGeometry(R - 0.12, R, 40)), M.or()); anneau.rotation.x = -Math.PI / 2; anneau.position.y = 0.01; g.add(anneau);
      const ang = t => (t / 1000) * p.vitesse * ctx.tempo('inv') + p.off;
      return {
        maj(t) { disque.rotation.y = ang(t); },
        danger(t, x, z, r) {
          const d = Math.hypot(x, z); if (d > R - 0.15 || d < 0.95) return null;
          // l'ouverture est centrée sur l'angle 0 du disque (repère : x, -z), tournée de ang(t)
          let a = Math.atan2(-z, x) - ang(t); a = Math.atan2(Math.sin(a), Math.cos(a));
          return Math.abs(a) < p.secteur / 2 - 0.08 ? 'chute' : null;
        },
        son() { return 'engrenage'; },
      };
    },

    scie(p, g, ctx) {
      const sc = p.rails.map(rl => {
        boite(g, rl.axe === 'x' ? DM * 2 - 0.5 : 0.18, 0.02, rl.axe === 'x' ? 0.18 : DM * 2 - 0.5, M.noir(), rl.axe === 'x' ? 0 : rl.c, 0.01, rl.axe === 'x' ? rl.c : 0);
        const sg = groupe(g, 0, 0.35, 0);
        const d = cyl(sg, 0.72, 0.72, 0.05, 24, M.acier(), 0, 0, 0); d.rotation.x = Math.PI / 2;
        if (rl.axe === 'z') sg.rotation.y = Math.PI / 2;
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; const c = cone(d, 0.08, 0.16, M.acier(), Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78, 4); c.rotation.z = -Math.PI / 2; c.rotation.y = -a; }
        return { rl, sg, d };
      });
      const pos = (t, S) => (tri(fr(t, S.rl.periode * ctx.tempo('lames'), S.rl.off)) * 2 - 1) * (DM - 1);
      return {
        maj(t) { for (const S of sc) { const s = pos(t, S); if (S.rl.axe === 'x') S.sg.position.set(s, 0.35, S.rl.c); else S.sg.position.set(S.rl.c, 0.35, s); S.d.rotation.y = t * 0.03; } },
        danger(t, x, z, r) { for (const S of sc) { const s = pos(t, S), a = S.rl.axe === 'x' ? x : z, q = S.rl.axe === 'x' ? z : x; if (Math.abs(a - s) < 0.6 + r && Math.abs(q - S.rl.c) < 0.1 + r) return 'scie'; } return null; },
        son() { return 'scie'; },
      };
    },

    statue(p, g, ctx) {
      const st = p.statues.map((s, k) => {
        const sg = groupe(g, s.x, 0, s.z);
        boite(sg, 1.1, 0.5, 1.1, M.pierre(), 0, 0.25, 0);
        const tete = groupe(sg, 0, 1.6, 0);
        boite(sg, 0.7, 1.1, 0.7, mat(0x3f6a5a, { r: 0.5, m: 0.5 }), 0, 1.0, 0);
        boite(tete, 0.75, 0.6, 0.8, mat(0x3f6a5a, { r: 0.5, m: 0.5 }), 0, 0, 0.1);
        boite(tete, 0.5, 0.18, 0.4, M.or(), 0, -0.15, 0.55);
        const yeux = boite(tete, 0.5, 0.08, 0.05, mat(0xff5020, { basic: true, add: true, op: 0.2 }), 0, 0.12, 0.52);
        const jet = groupe(tete, 0, -0.1, 0.7);
        const f1 = cone(jet, 0.75, 1, M.flamme(), 0, 0, 0.5, 10); f1.rotation.x = -Math.PI / 2;
        const f2 = cone(jet, 0.3, 1, M.flammeCoeur(), 0, 0, 0.5, 8); f2.rotation.x = -Math.PI / 2;
        const versCentre = Math.atan2(-s.x, -s.z);
        return { s, k, tete, yeux, jet, versCentre };
      });
      const per = () => p.periode * ctx.tempo('flammes');
      const angleDe = (t, S) => { const n = Math.floor((t + p.off + S.s.dec * per()) / per()); const pas = [-0.55, 0, 0.55, 0][(n + S.s.base) % 4]; return S.versCentre + pas; };
      const feu = (t, S) => { const u = fr(t, per(), p.off + S.s.dec * per()); return u < 0.55 ? 0 : u < 0.68 ? -1 : u < 0.9 ? 1 : 0; };
      return {
        maj(t) { for (const S of st) { S.tete.rotation.y = angleDe(t, S); const f = feu(t, S); S.yeux.material = mat(0xff5020, { basic: true, add: true, op: f === 0 ? 0.15 : 0.9 }); S.jet.visible = f === 1; S.jet.scale.set(1, 1, 7); } },
        obstacles(t, c2, L) { for (const S of st) L.push({ x0: S.s.x - 0.6, x1: S.s.x + 0.6, z0: S.s.z - 0.6, z1: S.s.z + 0.6 }); },
        danger(t, x, z, r) {
          for (const S of st) {
            if (feu(t, S) !== 1) continue;
            const a = angleDe(t, S), dx = x - S.s.x, dz = z - S.s.z;
            const av = dx * Math.sin(a) + dz * Math.cos(a), lat = dx * Math.cos(a) - dz * Math.sin(a);
            if (av > 0.4 && av < 7.6 && Math.abs(lat) < 0.45 + av * 0.07 + r) return 'brule';
          }
          return null;
        },
        son(t) { const f = feu(t, st[0]); return f === 1 ? 'flamme' : f === -1 ? 'sifflement' : ''; },
      };
    },

    coulissant(p, g, ctx) {
      const ms = p.murs.map(w => {
        const mg = groupe(g, 0, 0, 0);
        const m = boite(mg, w.axe === 'x' ? 0.5 : w.long, 3.0, w.axe === 'x' ? w.long : 0.5, mat(teinte(ctx.spec.palette.mur, -0.2), { r: 0.8, map: texMur(ctx.spec.palette).map, bump: texMur(ctx.spec.palette).bump, bs: 0.04 }), 0, 1.5, 0);
        boite(g, w.axe === 'x' ? DM * 2 : 0.12, 0.02, w.axe === 'x' ? 0.12 : DM * 2, M.ferSombre(), w.axe === 'x' ? 0 : w.c, 0.01, w.axe === 'x' ? w.c : 0);
        return { w, mg };
      });
      const lim = DM - 0.25 - 0.25;
      const pos = (t, W) => (tri(fr(t, W.w.periode * ctx.tempo('mur'), W.w.off)) * 2 - 1) * lim;
      return {
        maj(t) { for (const W of ms) { const s = pos(t, W); if (W.w.axe === 'x') W.mg.position.set(s, 0, W.w.c); else W.mg.position.set(W.w.c, 0, s); } },
        obstacles(t, c2, L) {
          for (const W of ms) {
            const s = pos(t, W), h = W.w.long / 2;
            if (W.w.axe === 'x') L.push({ x0: s - 0.25, x1: s + 0.25, z0: W.w.c - h, z1: W.w.c + h, mobile: true });
            else L.push({ z0: s - 0.25, z1: s + 0.25, x0: W.w.c - h, x1: W.w.c + h, mobile: true });
          }
        },
        danger() { return null; },
        son() { return 'frottement'; },
      };
    },

    labyrinthe(p, g, ctx) {
      const mm = mat(teinte(ctx.spec.palette.mur, -0.1), { r: 0.85, map: texMur(ctx.spec.palette).map, bump: texMur(ctx.spec.palette).bump, bs: 0.04 });
      const ws = p.murs.map(w => {
        let x0, x1, z0, z1;
        if (w.v) { const x = -DM + 3 * (w.i + 1); x0 = x - 0.18; x1 = x + 0.18; z0 = -DM + 3 * w.j; z1 = z0 + 3; }
        else { const z = -DM + 3 * (w.j + 1); z0 = z - 0.18; z1 = z + 0.18; x0 = -DM + 3 * w.i; x1 = x0 + 3; }
        const m = boite(g, x1 - x0, 2.8, z1 - z0, mm, (x0 + x1) / 2, 1.4, (z0 + z1) / 2);
        return { w, m, x0, x1, z0, z1 };
      });
      const haut = (t, W) => {
        const per = p.periode * ctx.tempo('mur'), n = Math.floor((t + p.off) / per), u = fr(t, per, p.off);
        const up = k => ((k + W.w.groupe) % 3) !== 0;
        const a = up(n), b = up(n + 1);
        if (u < 0.88 || a === b) return a ? 1 : 0;
        const k = (u - 0.88) / 0.12; return a ? 1 - k : k;
      };
      return {
        maj(t) { for (const W of ws) { const h = haut(t, W); W.m.scale.y = Math.max(0.01, h); W.m.position.y = 1.4 * h; W.m.visible = h > 0.02; } },
        obstacles(t, c2, L) { for (const W of ws) if (haut(t, W) > 0.25) L.push({ x0: W.x0, x1: W.x1, z0: W.z0, z1: W.z1, mobile: true }); },
        danger() { return null; },
        son(t) { const u = fr(t, p.periode * ctx.tempo('mur'), p.off); return u > 0.88 ? 'frottement' : ''; },
      };
    },

    lumiere(p, g, ctx) {
      const fs = p.faisceaux.map(f => {
        const m = boite(g, f.axe === 'x' ? 1.4 : DM * 2, 0.01, f.axe === 'x' ? DM * 2 : 1.4, mat(0xfff1c2, { basic: true, add: true, op: 0.2 }), 0, 0.03, 0);
        const col = boite(g, f.axe === 'x' ? 1.4 : DM * 2, HT, f.axe === 'x' ? DM * 2 : 1.4, mat(0xff8a2a, { basic: true, add: true, op: 0.5 }), 0, HT / 2, 0);
        return { f, m, col };
      });
      const pos = (t, F) => -DM + 0.7 + ((t / 1000 * F.f.vitesse * 10 + F.f.dec * 12) % (DM * 2 - 1.4));
      const etat = t => { const u = fr(t, p.periode * ctx.tempo('flammes'), p.off); return u < 0.68 ? 0 : u < 0.85 ? 1 : u < 0.95 ? 2 : 0; };
      return {
        maj(t) {
          const e = etat(t);
          for (const F of fs) {
            const s = pos(t, F);
            if (F.f.axe === 'x') { F.m.position.x = s; F.col.position.x = s; } else { F.m.position.z = s; F.col.position.z = s; }
            F.m.material = mat(0xfff1c2, { basic: true, add: true, op: e === 1 ? 0.55 : 0.2 }); F.col.visible = e === 2;
          }
        },
        danger(t, x, z, r) { if (etat(t) !== 2) return null; for (const F of fs) { const s = pos(t, F), a = F.f.axe === 'x' ? x : z; if (Math.abs(a - s) < 0.7 + r * 0.5) return 'brule'; } return null; },
        son(t) { const e = etat(t); return e === 2 ? 'flamme' : e === 1 ? 'sifflement' : ''; },
      };
    },

    silence(p, g, ctx, idx) {
      const cloches = [];
      for (let i = 0; i < 4; i++) { const c = groupe(g, (i % 2 ? 1 : -1) * 3.2, HT - 1.2, (i < 2 ? 1 : -1) * 3.2); cyl(c, 0.01, 0.01, 1.2, 4, M.fer(), 0, 0.6, 0); cone(c, 0.3, 0.45, M.bronze(), 0, -0.1, 0, 12); cloches.push(c); }
      const trous = new THREE.InstancedMesh(geo('trou', () => new THREE.CircleGeometry(0.05, 6)), M.noir(), 64);
      const tmp = new THREE.Object3D(); let k = 0;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { tmp.position.set(centreCase(i), 0.008, centreCase(j)); tmp.rotation.set(-Math.PI / 2, 0, 0); tmp.updateMatrix(); trous.setMatrixAt(k++, tmp.matrix); }
      g.add(trous);
      const pics = new THREE.InstancedMesh(gCone(0.08, 1.0, 6), M.acier(), 40); pics.visible = false; g.add(pics);
      const actifs = t => (ctx.declencheurs || []).filter(e => e.piege === idx && t - e.t0 < 2200);
      return {
        bruit: true,
        maj(t) {
          const ev = actifs(t); pics.visible = false;
          for (const c of cloches) c.rotation.z = ev.length ? Math.sin(t * 0.03) * 0.25 : 0;
          if (!ev.length) return;
          let n = 0;
          for (const e of ev) {
            const dt = t - e.t0; if (dt < 600) continue;
            const h = dt < 700 ? (dt - 600) / 100 : dt < 1500 ? 1 : Math.max(0, 1 - (dt - 1500) / 500);
            for (let q = 0; q < 20 && n < 40; q++) { const a = q / 20 * TAU * 3, rr = 0.3 + (q % 7) * 0.32; tmp.position.set(e.x + Math.cos(a) * rr, -0.5 + h, e.z + Math.sin(a) * rr); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); pics.setMatrixAt(n++, tmp.matrix); }
          }
          pics.count = n; pics.instanceMatrix.needsUpdate = true; pics.visible = n > 0;
        },
        danger(t, x, z) { for (const e of actifs(t)) { const dt = t - e.t0; if (dt > 640 && dt < 1500 && Math.hypot(x - e.x, z - e.z) < 2.3) return 'pointes'; } return null; },
        son(t) { return actifs(t).some(e => t - e.t0 < 300) ? 'cloche' : actifs(t).some(e => t - e.t0 > 600 && t - e.t0 < 800) ? 'pointes' : ''; },
      };
    },

    obscurite() { return { obscur: true, maj() {}, danger() { return null; } }; },

    temps(p, g, ctx) {
      const hg = groupe(g, 3.8, 0, -3.8);
      cyl(hg, 0.45, 0.5, 0.3, 14, M.bronze(), 0, 0.15, 0);
      const verre = cyl(hg, 0.32, 0.32, 2.2, 14, mat(0x9fd8e0, { op: 0.25, r: 0.1 }), 0, 1.4, 0);
      const eau = cyl(hg, 0.28, 0.28, 2.0, 14, mat(0x3a7aa0, { e: 0x0a2030, op: 0.8 }), 0, 1.4, 0);
      const ouvert = t => fr(t, p.periode * ctx.tempo('temps'), p.off) < p.ouvert;
      return {
        portesTemporisees: true,
        ouvert,
        maj(t) { const u = fr(t, p.periode * ctx.tempo('temps'), p.off); const k = u < p.ouvert ? 1 - u / p.ouvert : (u - p.ouvert) / (1 - p.ouvert); eau.scale.y = Math.max(0.02, k); eau.position.y = 0.4 + k; },
        obstacles(t, c2, L) { L.push({ x0: 3.3, x1: 4.3, z0: -4.3, z1: -3.3 }); },
        danger(t, x, z, r) {
          const u = fr(t, p.periode * ctx.tempo('temps'), p.off); if (u < p.ouvert || u > p.ouvert + 0.025) return null;
          for (let f = 0; f < 4; f++) if ((ctx.spec.portes >> f) & 1) { const [a, d] = faceDepuisLocal(f, x, z); if (Math.abs(a) < PL / 2 && d < 0.5 + r) return 'ecrase'; }
          return null;
        },
        son(t) { const u = fr(t, p.periode * ctx.tempo('temps'), p.off); return u >= p.ouvert && u < p.ouvert + 0.03 ? 'herse' : u > p.ouvert - 0.08 && u < p.ouvert ? 'cliquetis' : ''; },
      };
    },

    trompeur(p, g, ctx, idx) {
      const faces = [0, 1, 2, 3].filter(f => !((ctx.spec.portes >> f) & 1));
      if (!faces.length) return { maj() {}, danger() { return null; } };
      const f = faces[ctx.spec.id % faces.length];
      const fg = groupe(g); fg.rotation.y = ANGLE_FACE(f);
      const fausse = construirePorteVisuelle(fg, ctx.spec, true);
      const lame = boite(fg, PL, 0.06, 1.3, M.acier(), 0, 1.2, -DM + 0.7); lame.visible = false;
      const actifs = t => (ctx.declencheurs || []).filter(e => e.piege === idx && t - e.t0 < 1600);
      return {
        fausse: { face: f, mortel: p.mortel, visuel: fausse },
        maj(t, c2) { const ev = actifs(t); lame.visible = p.mortel && ev.some(e => t - e.t0 > 250 && t - e.t0 < 900); animerPorte(fausse, c2.proche && c2.proche(f) ? 0.15 : 0); },
        danger(t, x, z, r) {
          if (!p.mortel) return null;
          for (const e of actifs(t)) if (t - e.t0 > 250 && t - e.t0 < 900) { const [a, d] = faceDepuisLocal(f, x, z); if (Math.abs(a) < PL / 2 + 0.3 && d < 1.4 + r) return 'lames'; }
          return null;
        },
        son(t) { return actifs(t).some(e => t - e.t0 > 250 && t - e.t0 < 400) ? 'lame' : ''; },
      };
    },

    chaines(p, g, ctx) {
      const ch = p.chaines.map(c => {
        const cg = groupe(g, c.x, HT, c.z);
        for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(geo('maillon', () => new THREE.TorusGeometry(0.12, 0.035, 5, 10)), M.fer()); m.position.y = -0.27 * i - 0.2; m.rotation.y = i % 2 ? Math.PI / 2 : 0; cg.add(m); }
        cone(cg, 0.25, 0.5, M.fer(), 0, -3.6, 0, 8).rotation.x = Math.PI;
        return { c, cg };
      });
      return {
        chaines: true,
        maj(t) { ch.forEach((C2, i) => { C2.cg.rotation.z = Math.sin(t * 0.0015 + i) * 0.06; C2.cg.rotation.x = Math.cos(t * 0.0012 + i * 2) * 0.05; }); },
        obstacles(t, c2, L) { if (c2.fort) return; for (const C2 of ch) L.push({ x0: C2.c.x - 0.28, x1: C2.c.x + 0.28, z0: C2.c.z - 0.28, z1: C2.c.z + 0.28 }); },
        danger() { return null; },
      };
    },

    instable(p, g, ctx) {
      const ds = p.dalles.map(d => {
        const x = -DM + 1.5 + d.i * 3, z = -DM + 1.5 + d.j * 3;
        const m = boite(g, 2.9, 0.5, 2.9, mat(0x48413a, { r: 0.95 }), x, -0.25, z);
        return { d, x, z, m };
      });
      const etat = (t, D) => {
        const u = fr(t, p.periode * ctx.tempo('sol'), p.off + D.d.dec * p.periode);
        if (u < 0.3) return [0, 0]; if (u < 0.4) return [1.2 * (u - 0.3) / 0.1, 1]; if (u < 0.5) return [1.2, 1]; if (u < 0.6) return [1.2 * (1 - (u - 0.5) / 0.1), 1];
        if (u < 0.68) return [Math.sin(u * 400) * 0.04, 2]; if (u < 0.72) return [-4 * (u - 0.68) / 0.04, 3]; if (u < 0.86) return [-4, 3]; return [-4 * (1 - (u - 0.86) / 0.14), 3];
      };
      return {
        maj(t) { for (const D of ds) { const [h] = etat(t, D); D.m.position.y = -0.25 + h; } },
        obstacles(t, c2, L) { for (const D of ds) { const [h] = etat(t, D); if (h > 0.45) L.push({ x0: D.x - 1.45, x1: D.x + 1.45, z0: D.z - 1.45, z1: D.z + 1.45, mobile: true }); } },
        danger(t, x, z, r) { for (const D of ds) { const [h, e] = etat(t, D); if (e === 3 && h < -0.6 && Math.abs(x - D.x) < 1.45 - r * 0.5 && Math.abs(z - D.z) < 1.45 - r * 0.5) return 'chute'; } return null; },
        son(t) { return ds.some(D => etat(t, D)[1] === 2) ? 'craquement' : ''; },
      };
    },

    escalier(p, g, ctx) {
      const etat = t => { const u = fr(t, p.periode * ctx.tempo('sol'), p.off); return u < 0.72 ? 0 : u < 0.82 ? 1 : 2; };
      return {
        echelle: true,
        etat,
        maj(t, c2) { if (c2.echelle) { const e = etat(t); c2.echelle.rotation.z = e === 1 ? Math.sin(t * 0.06) * 0.03 : e === 2 ? 0.5 : 0; c2.echelle.position.y = e === 2 ? -1.2 : 0; } },
        danger() { return null; },
        son(t) { return etat(t) === 1 ? 'craquement' : ''; },
      };
    },

    condamnee(p, g, ctx) {
      const coins = [[-1, -1], [1, -1], [1, 1], [-1, 1]], [nx, nz] = coins[p.niche];
      const nicheX = nx * (DM - 1.3), nicheZ = nz * (DM - 1.3);
      const lotus = new THREE.Mesh(geo('lotus', () => new THREE.CircleGeometry(1.0, 8)), mat(0xd9a0b0, { r: 0.6, e: 0x2a0a14 })); lotus.rotation.x = -Math.PI / 2; lotus.position.set(nicheX, 0.012, nicheZ); g.add(lotus);
      const dalle = groupe(g, 0, HT, 0);
      const mm = mat(0x3a352f, { r: 0.95, op: 0.9 });
      // dalle complète sauf la niche (2,4 × 2,4 dans un coin)
      boite(dalle, DM * 2, 0.8, DM * 2 - 2.6, mm, 0, 0.4, -nz * 1.3);
      boite(dalle, DM * 2 - 2.6, 0.8, 2.6, mm, -nx * 1.3, 0.4, nz * (DM - 1.3));
      const etat = t => { const u = fr(t, p.periode * ctx.tempo('plafond'), p.off); return u; };
      const haut = t => { const u = etat(t); if (u < 0.6) return HT; if (u < 0.85) return HT * (1 - (u - 0.6) / 0.25) + 0.05; if (u < 0.88) return 0.05; return HT * (u - 0.88) / 0.12; };
      return {
        scelle: t => { const u = etat(t); return u >= 0.55 && u < 0.92; },
        maj(t) { dalle.position.y = haut(t); },
        danger(t, x, z, r) { if (haut(t) > 1.65) return null; return Math.abs(x - nicheX) < 1.3 - r * 0.3 && Math.abs(z - nicheZ) < 1.3 - r * 0.3 ? null : 'ecrase'; },
        son(t) { const u = etat(t); return u >= 0.55 && u < 0.6 ? 'herse' : u >= 0.6 && u < 0.85 ? 'broyeur' : ''; },
      };
    },

    enigme(p, g, ctx) {
      const ab = groupe(g, 0, 0, -3.4);
      boite(ab, 2.4, 1.1, 0.7, M.bois(), 0, 0.55, 0);
      for (let i = 0; i < 3; i++) { const r = cyl(ab, 0.28, 0.28, 0.2, 10, M.bronze(), -0.7 + i * 0.7, 1.25, 0); r.rotation.z = Math.PI / 2; }
      const tab = boite(g, 3.6, 1.4, 0.08, mat(0x1a1410, { r: 0.6, map: texSuite(p) }), 0, 2.3, -DM + EP / 2 + 0.05);
      return {
        enigme: p,
        obstacles(t, c2, L) { L.push({ x0: -1.2, x1: 1.2, z0: -3.75, z1: -3.05 }); },
        maj() {}, danger() { return null; },
      };
    },

    teleport(p, g, ctx) {
      const cercle = new THREE.Mesh(geo('telep', () => new THREE.RingGeometry(0.9, 1.25, 32)), mat(0x8fc7a8, { basic: true, add: true, op: 0.15 }));
      cercle.rotation.x = -Math.PI / 2; cercle.position.set(3.2, 0.015, 3.2); g.add(cercle);
      const sceau = new THREE.Mesh(geo('telep2', () => new THREE.CircleGeometry(0.9, 6)), mat(0x1f3d34, { r: 0.4, m: 0.6 })); sceau.rotation.x = -Math.PI / 2; sceau.position.set(3.2, 0.012, 3.2); g.add(sceau);
      return {
        teleport: { x: 3.2, z: 3.2, p },
        maj(t, c2) { const act = c2.it && ((p.phases >> c2.it.p) & 1); cercle.material = mat(0x8fc7a8, { basic: true, add: true, op: act ? 0.5 + Math.sin(t * 0.01) * 0.2 : 0.12 }); },
        danger() { return null; },
      };
    },
  };

  // tablette de la suite (chiffres en bâtonnets à calculer)
  function texSuite(p) {
    return toile('suite' + p.suite.join('-') + p.trou, 512, 200, (x, w, h) => {
      x.fillStyle = '#1a1410'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#c9a24a'; x.lineWidth = 3; x.strokeRect(8, 8, w - 16, h - 16);
      p.suite.forEach((v, i) => {
        const cx = 56 + i * 100;
        if (i === p.trou) { x.strokeStyle = '#7a1410'; x.lineWidth = 4; x.strokeRect(cx - 34, 50, 68, 100); return; }
        dessinerBatonnets(x, v, cx, 100, 1.0, '#e8d7a8');
      });
    });
  }
  /** Numération à bâtonnets (unités verticales, dizaines horizontales, alternées) */
  function dessinerBatonnets(x, n, cx, cy, ech, coul) {
    const ch = String(Math.max(0, Math.floor(n))).split('').map(Number);
    const L = ch.length, larg = 30 * ech;
    x.strokeStyle = coul; x.lineWidth = 4 * ech; x.lineCap = 'round';
    ch.forEach((d, k) => {
      const pos = L - 1 - k; // rang : 0 unités
      const ox = cx + (k - (L - 1) / 2) * larg;
      const vertical = pos % 2 === 0;
      if (d === 0) { x.beginPath(); x.arc(ox, cy, 8 * ech, 0, TAU); x.stroke(); return; }
      const cinq = d >= 6 ? 1 : 0, u = d >= 6 ? d - 5 : d;
      for (let i = 0; i < u; i++) {
        x.beginPath();
        if (vertical) { const xx = ox - 9 * ech + i * 4.6 * ech; x.moveTo(xx, cy - 16 * ech); x.lineTo(xx, cy + 16 * ech); }
        else { const yy = cy - 9 * ech + i * 4.6 * ech; x.moveTo(ox - 12 * ech, yy); x.lineTo(ox + 12 * ech, yy); }
        x.stroke();
      }
      if (cinq) { x.beginPath(); if (vertical) { x.moveTo(ox - 13 * ech, cy - 22 * ech); x.lineTo(ox + 13 * ech, cy - 22 * ech); } else { x.moveTo(ox - 15 * ech, cy - 18 * ech); x.lineTo(ox - 15 * ech, cy + 14 * ech); } x.stroke(); }
    });
  }

  // =====================================================================
  // PORTES
  // =====================================================================
  function construirePorteVisuelle(fg, spec, fausse) {
    const z = fausse ? -DM + EP / 2 + 0.1 : -DM;
    const mL = mat(teinte(spec.palette.mur, 0.25), { r: 0.3, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 });
    const pG = bloc(fg, PL / 2 - 0.01, HP, 0.16, mL, -PL / 4, HP / 2, z, 0.02);
    const pD = bloc(fg, PL / 2 - 0.01, HP, 0.16, mL, PL / 4, HP / 2, z, 0.02);
    // clous de bronze (5 rangs × 3) et heurtoir à anneau, comme aux portes des palais
    const tmp = new THREE.Object3D();
    for (const [p, s] of [[pG, -1], [pD, 1]]) {
      const mb = mat(spec.palette.acc, { r: 0.3, m: 0.9 });
      bloc(p, PL / 2 - 0.16, 0.05, 0.03, mb, 0, 1.38, 0.085, 0.01); bloc(p, PL / 2 - 0.16, 0.05, 0.03, mb, 0, -1.38, 0.085, 0.01);
      const ann = new THREE.Mesh(geo('heurtoir', () => new THREE.TorusGeometry(0.11, 0.022, 10, 24)), M.or()); ann.position.set(-s * 0.32, 0.05, 0.12); p.add(ann);
      sph(p, 0.075, M.bronze(), -s * 0.32, 0.17, 0.1).scale.set(1, 1, 0.55);
      const cl = new THREE.InstancedMesh(gSph(0.045, 12), M.or(), 15); let q = 0;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { tmp.position.set(-0.36 + j * 0.36, -1.08 + i * 0.54, 0.08); tmp.scale.set(1, 1, 0.6); tmp.updateMatrix(); cl.setMatrixAt(q++, tmp.matrix); }
      p.add(cl);
    }
    // encadrement : poteaux et linteau laqués, chapiteaux dorés
    if (!fausse) {
      const mc = mat(teinte(spec.palette.mur, -0.1), { r: 0.35, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 });
      for (const s of [-1, 1]) { bloc(fg, 0.22, HP + 0.25, EP + 0.16, mc, s * (PL / 2 + 0.11), (HP + 0.25) / 2, z, 0.03); bloc(fg, 0.3, 0.12, EP + 0.22, M.or(), s * (PL / 2 + 0.11), HP + 0.3, z, 0.02); }
      bloc(fg, PL + 0.6, 0.22, EP + 0.18, mc, 0, HP + 0.14, z, 0.03);
    }
    const sceau = boite(fg, PL, 0.08, 0.04, M.rougeSceau(), 0, HP + 0.12, z + EP / 2 + 0.02); sceau.visible = false;
    const barres = groupe(fg, 0, 0, z + 0.25); barres.visible = false;
    for (const s of [-1, 1]) { const b = boite(barres, 0.14, 3.6, 0.1, M.fer(), 0, HP / 2, 0); b.rotation.z = s * 0.72; }
    const fond = boite(fg, PL, HP, 0.05, fausse ? mat(teinte(spec.palette.mur, -0.15), { r: 0.9 }) : mat(0x000000, { basic: true }), 0, HP / 2, fausse ? z - 0.09 : z - EP / 2 - 0.3);
    const lumiere = boite(fg, PL, HP, 0.05, mat(0xfff4d6, { basic: true }), 0, HP / 2, fausse ? z - 0.08 : z - EP / 2 - 0.32); lumiere.visible = false;
    const garde = groupe(fg, 0, 0, z - EP / 2 - 0.15); garde.visible = false;
    for (let i = 0; i < 4; i++) boite(garde, 0.06, HP - 0.4, 0.06, M.fer(), -PL / 2 + 0.3 + i * (PL - 0.6) / 3, (HP - 0.4) / 2, 0);
    boite(garde, PL, 0.07, 0.07, M.fer(), 0, 1.1, 0);
    const pont = groupe(fg, 0, 0, z - 3); pont.visible = false;
    boite(pont, PL, 0.12, 6 - EP, M.bois(), 0, -0.06, 0);
    for (const s of [-1, 1]) { boite(pont, 0.06, 0.06, 6 - EP, M.fer(), s * (PL / 2 - 0.05), 0.9, 0); for (let i = 0; i < 4; i++) boite(pont, 0.06, 0.9, 0.06, M.fer(), s * (PL / 2 - 0.05), 0.45, -2.6 + i * 1.75); }
    return { pG, pD, sceau, barres, fond, lumiere, garde, pont, ouv: 0, fausse: !!fausse };
  }
  function animerPorte(v, cible) {
    v.ouv += (cible - v.ouv) * 0.18;
    v.pG.position.x = -PL / 4 - v.ouv * PL / 2; v.pD.position.x = PL / 4 + v.ouv * PL / 2;
  }

  // =====================================================================
  // DÉCOR : traits distinctifs
  // =====================================================================
  const COINS = [[-4.7, -4.7], [4.7, -4.7], [4.7, 4.7], [-4.7, 4.7]];
  function construireTrait(g, tr, spec, obstacles, interactifs) {
    const [x, z] = COINS[tr.coin];
    const pal = spec.palette;
    const solide = (s) => obstacles.push({ x0: x - s, x1: x + s, z0: z - s, z1: z + s });
    const tg = groupe(g, x, 0, z);
    tg.rotation.y = Math.atan2(-x, -z);
    switch (tr.nom) {
      case 'statue de grue': boite(tg, 0.8, 0.3, 0.8, M.pierre(), 0, 0.15, 0); cyl(tg, 0.03, 0.03, 1.2, 5, M.bronze(), -0.1, 0.9, 0); cyl(tg, 0.03, 0.03, 1.2, 5, M.bronze(), 0.1, 0.9, 0); sph(tg, 0.4, M.bronze(), 0, 1.7, 0).scale.set(0.7, 0.6, 1.2); cyl(tg, 0.05, 0.07, 0.9, 6, M.bronze(), 0, 2.3, 0.3).rotation.x = 0.4; solide(0.45); break;
      case 'lion gardien': boite(tg, 1.0, 0.5, 1.0, M.pierre(), 0, 0.25, 0); boite(tg, 0.7, 0.9, 0.9, mat(0x6f6a60), 0, 0.95, 0); sph(tg, 0.45, mat(0x6f6a60), 0, 1.65, 0.15); sph(tg, 0.18, mat(0x6f6a60), 0.3, 1.0, 0.45); solide(0.55); break;
      case 'dragon peint': { const fg = groupe(g); fg.rotation.y = ANGLE_FACE(tr.mur); const d = boite(fg, 4.5, 2.2, 0.02, mat(0xffffff, { map: texDragon(pal.acc), op: 0.85 }), (tr.var - 0.5) * 3, 3.6, -DM + EP / 2 + 0.02); break; }
      case 'fissure': { const d = new THREE.Mesh(geo('pl3', () => new THREE.PlaneGeometry(3, 3)), new THREE.MeshBasicMaterial({ map: texTache('fiss' + Math.floor(tr.var * 4), x2 => { x2.strokeStyle = 'rgba(0,0,0,0.8)'; x2.lineWidth = 2.5; x2.beginPath(); let px = 10, py = 64; x2.moveTo(px, py); for (let k = 0; k < 9; k++) { px += 13; py += (Math.random() - 0.5) * 30; x2.lineTo(px, py); } x2.stroke(); }), transparent: true, depthWrite: false })); d.rotation.x = -Math.PI / 2; d.rotation.z = tr.var * 6; d.position.set(x * 0.6, 0.011, z * 0.6); g.add(d); break; }
      case 'bannière déchirée': { cyl(tg, 0.04, 0.04, 1.6, 6, M.bois(), 0, 4.6, 0).rotation.z = Math.PI / 2; const b = boite(tg, 1.4, 2.6, 0.02, mat(0x7a1a14, { ds: true, r: 1 }), 0, 3.2, 0); b.rotation.y = 0.2; boite(tg, 0.5, 0.8, 0.03, M.noir(), 0.35, 2.2, 0.01); break; }
      case 'gong': { boite(tg, 0.1, 2.4, 0.1, M.bois(), -0.9, 1.2, 0); boite(tg, 0.1, 2.4, 0.1, M.bois(), 0.9, 1.2, 0); boite(tg, 2.0, 0.12, 0.12, M.bois(), 0, 2.4, 0); cyl(tg, 0.75, 0.75, 0.06, 24, M.bronze(), 0, 1.4, 0).rotation.x = Math.PI / 2; solide(0.5); interactifs.push({ type: 'trait', nom: tr.nom, x, z, r: 1.6 }); break; }
      case 'brasero éteint': cyl(tg, 0.6, 0.35, 0.5, 12, M.fer(), 0, 1.0, 0); for (let i = 0; i < 3; i++) { const l = cyl(tg, 0.04, 0.04, 1.0, 5, M.fer(), Math.cos(i * 2.1) * 0.35, 0.45, Math.sin(i * 2.1) * 0.35); l.rotation.z = 0.25; } cyl(tg, 0.55, 0.55, 0.05, 12, mat(0x1a1a1a), 0, 1.24, 0); solide(0.5); break;
      case 'colonne brisée': cyl(tg, 0.5, 0.55, 2.0, 12, M.pierre(), 0, 1.0, 0); { const c = cyl(g, 0.45, 0.5, 1.6, 12, M.pierre(), x * 0.75, 0.45, z * 0.75); c.rotation.z = Math.PI / 2; c.rotation.y = tr.var * 3; } solide(0.55); break;
      case 'inscription murale': { const fg = groupe(g); fg.rotation.y = ANGLE_FACE(tr.mur); boite(fg, 1.6, 2.4, 0.03, mat(0x1a1410, { map: texGlyphe(spec.glyphe + 20 + tr.coin, '#c9a24a') }), (tr.var - 0.5) * 6, 3.0, -DM + EP / 2 + 0.02); interactifs.push({ type: 'trait', nom: tr.nom, ...(() => { const [lx, lz] = localDepuisFace(tr.mur, (tr.var - 0.5) * 6, 0.9); return { x: lx, z: lz }; })(), r: 1.6 }); break; }
      case 'grand vase': { const pts = []; for (let i = 0; i <= 10; i++) { const k = i / 10; pts.push(new THREE.Vector2(0.15 + Math.sin(k * Math.PI) * 0.45 + (k > 0.85 ? 0.1 : 0), k * 1.6)); } const v = new THREE.Mesh(geo('vase', () => new THREE.LatheGeometry(pts, 14)), mat(0x2a4a7a, { r: 0.25, m: 0.1 })); tg.add(v); solide(0.45); break; }
      case 'miroir de bronze': cyl(tg, 0.6, 0.6, 0.08, 24, mat(0xc9a24a, { r: 0.1, m: 1 }), 0, 1.8, 0).rotation.x = Math.PI / 2; boite(tg, 0.12, 1.2, 0.12, M.bois(), 0, 0.6, 0); boite(tg, 0.8, 0.12, 0.5, M.bois(), 0, 0.06, 0); solide(0.4); interactifs.push({ type: 'trait', nom: tr.nom, x, z, r: 1.5 }); break;
      case 'cloche': cyl(tg, 0.02, 0.02, 2.0, 4, M.fer(), 0, HT - 1.0, 0); cone(tg, 0.6, 0.9, M.bronze(), 0, HT - 2.3, 0, 16); break;
      case 'tablette d’ancêtres': boite(tg, 1.6, 1.0, 0.6, M.bois(), 0, 0.5, 0); for (let i = 0; i < 4; i++) boite(tg, 0.22, 0.6 + (i % 2) * 0.2, 0.06, mat(0x1a1410, { r: 0.5 }), -0.5 + i * 0.33, 1.35, 0); solide(0.6); interactifs.push({ type: 'trait', nom: tr.nom, x, z, r: 1.6 }); break;
      case 'paravent': for (let i = 0; i < 4; i++) { const p = boite(tg, 0.7, 2.0, 0.04, mat(0xd8c9a0, { r: 1, map: texDragon(pal.mur) }), -1.05 + i * 0.7, 1.0, (i % 2) * 0.2); p.rotation.y = (i % 2 ? -1 : 1) * 0.35; } break;
      case 'arbre de bronze': cyl(tg, 0.12, 0.2, 2.4, 8, M.bronze(), 0, 1.2, 0); for (let i = 0; i < 6; i++) { const b = cyl(tg, 0.03, 0.06, 1.0, 5, M.bronze(), Math.cos(i) * 0.3, 1.8 + i * 0.12, Math.sin(i) * 0.3); b.rotation.z = Math.cos(i * 1.7) * 0.9; b.rotation.x = Math.sin(i * 1.7) * 0.9; sph(tg, 0.08, M.jade(), Math.cos(i) * 0.65, 2.1 + i * 0.12, Math.sin(i) * 0.65); } solide(0.35); break;
    }
  }
  function texDragon(c) {
    return toile('dragon' + c, 256, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h); x.strokeStyle = hex(c); x.lineWidth = 7; x.lineCap = 'round';
      x.beginPath(); x.moveTo(20, 70);
      for (let i = 0; i <= 20; i++) x.lineTo(20 + i * 10.5, 64 + Math.sin(i * 0.9) * 28);
      x.stroke(); x.lineWidth = 2.5;
      for (let i = 1; i < 20; i++) { const xx = 20 + i * 10.5, yy = 64 + Math.sin(i * 0.9) * 28; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx - 5, yy - 12); x.stroke(); }
      x.fillStyle = hex(c); x.beginPath(); x.arc(236, 64 + Math.sin(20 * 0.9) * 28, 10, 0, TAU); x.fill();
    });
  }

  // =====================================================================
  // SALLE COMPLÈTE
  // =====================================================================
  /** Segment de mur dont la texture reste continue d'un segment à l'autre (UV calés sur le mur entier). */
  function murSegment(fg, L, w, h, d, mm, x, y, z) {
    const g = gBoite(w, h, d).clone(), pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) if (Math.abs(nor.getZ(i)) > 0.5) uv.setXY(i, (pos.getX(i) + x + L / 2) / L, (pos.getY(i) + y) / HT);
    const e = new THREE.Mesh(g, mm); e.position.set(x, y, z); e.userData.recoit = true; fg.add(e); return e;
  }
  const geoLanterne = () => geo('lanterne2', () => {
    const pts = []; for (let i = 0; i <= 18; i++) { const t = i / 18; pts.push(new THREE.Vector2(0.14 + Math.sin(t * Math.PI) * 0.26, -0.48 + t * 0.96)); }
    return new THREE.LatheGeometry(pts, 32);
  });
  const texLanterne = () => toile('lanterne-papier', 512, 256, (x, w, h) => {
    x.fillStyle = '#c0241a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) { x.fillStyle = 'rgba(60,0,0,0.35)'; x.fillRect(i * w / 32, 0, 3, h); }
    x.fillStyle = '#e0b04a'; x.fillRect(0, 0, w, 14); x.fillRect(0, h - 14, w, 14);
    x.fillStyle = 'rgba(30,10,5,0.85)'; x.font = '700 110px "Shippori Mincho B1", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('福', w * 0.25, h / 2 + 6); x.fillText('福', w * 0.75, h / 2 + 6);
  });
  const cLant = new Map();
  function matLanterne(c) {
    let m = cLant.get(c);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texLanterne(), emissive: c, emissiveMap: texLanterne(), emissiveIntensity: 0.85, roughness: 0.9, side: THREE.DoubleSide }); cLant.set(c, m); }
    return m;
  }
  function construireSalle(monde, id) {
    const spec = C.specSalle(monde, id);
    const pal = spec.palette;
    const g = new THREE.Group(); g.name = 'salle-' + id;
    const obstacles = [], interactifs = [];
    // sol et coque extérieure
    const ts = texSol(pal);
    const sol = boite(g, DM * 2 + EP, 0.3, DM * 2 + EP, mat(0xffffff, { map: ts.map, bump: ts.bump, bs: 0.05, r: 0.78 }), 0, -0.15, 0); sol.userData.recoit = true;
    boite(g, DM * 2 + EP + 0.1, 0.5, DM * 2 + EP + 0.1, mat(teinte(pal.mur, -0.6), { r: 0.9, m: 0.3 }), 0, -0.56, 0).userData.recoit = true;
    // murs (une couleur par face pour l'effet de coupe)
    const murs = [], portes = [];
    const ctxPiege = { spec, tempo: () => 1, declencheurs: [] };
    for (let f = 0; f < 4; f++) {
      const fg = groupe(g); fg.rotation.y = ANGLE_FACE(f);
      const tm = texMur(pal), lisse = STYLE_MUR[pal.nom] === 'laque';
      const mm = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tm.map, bumpMap: tm.bump, bumpScale: 0.04, roughness: lisse ? 0.42 : 0.86, metalness: STYLE_MUR[pal.nom] === 'metal' ? 0.6 : 0.02, transparent: true, opacity: 1 });
      const porte = (spec.portes >> f) & 1;
      const L = DM * 2 + EP;
      if (porte) {
        const lg = (L - PL) / 2;
        murSegment(fg, L, lg, HT, EP, mm, -(PL / 2 + lg / 2), HT / 2, -DM);
        murSegment(fg, L, lg, HT, EP, mm, PL / 2 + lg / 2, HT / 2, -DM);
        murSegment(fg, L, PL, HT - HP, EP, mm, 0, HP + (HT - HP) / 2, -DM);
        const v = construirePorteVisuelle(fg, spec, false);
        // plaque (sceau fixe + cadran mobile) à droite de la porte
        const plaque = bloc(fg, 0.9, 0.62, 0.07, M.bronze(), PL / 2 + 0.75, 1.45, -DM + EP / 2 + 0.035, 0.02);
        const cad = boite(fg, 0.8, 0.575, 0.012, mat(0xffffff, { map: texSceau(spec, f), r: 0.55, m: 0.35 }), PL / 2 + 0.75, 1.45, -DM + EP / 2 + 0.076);
        for (let k = 0; k <= f; k++) sph(fg, 0.05, M.or(), -0.3 * f / 2 + k * 0.3, HP + 0.3, -DM + EP / 2 + 0.04, 6);
        const [px, pz] = localDepuisFace(f, PL / 2 + 0.75, 0.9);
        interactifs.push({ type: 'plaque', face: f, x: px, z: pz, r: 1.25 });
        portes.push({ face: f, v, cadran: cad });
      } else {
        murSegment(fg, L, L, HT, EP, mm, 0, HT / 2, -DM);
      }
      // corniche et plinthe (même matériau que le mur pour s'estomper avec lui)
      const corn = boite(fg, L, 0.25, 0.6, mm, 0, HT, -DM); corn.userData.recoit = true;
      const pl = boite(fg, L, 0.22, 0.08, mm, 0, 0.11, -DM + EP / 2 + 0.04); pl.userData.recoit = true;
      // tout ce qui est accroché à ce mur (porte, encadrement, plaque) s'estompe avec lui
      const annexes = [];
      fg.traverse(o => {
        if (!o.isMesh || o.material === mm) return;
        const m0 = o.material; if (Array.isArray(m0) || m0.blending === THREE.AdditiveBlending) return;
        const m1 = m0.clone(); m1.transparent = true; m1.userData.op0 = m0.opacity; o.material = m1; annexes.push(m1);
      });
      murs.push({ face: f, mat: mm, annexes });
    }
    // grand sceau peint (identité visuelle de la salle)
    { const fg = groupe(g); fg.rotation.y = ANGLE_FACE(spec.glyphe % 4); boite(fg, 1.8, 1.8, 0.02, mat(0xffffff, { map: texGlyphe(spec.glyphe, hex(pal.acc)), op: 0.9 }), -3.4, 4.5, -DM + EP / 2 + 0.02); }
    // dégâts
    for (let i = 0; i < spec.degats; i++) {
      const d = new THREE.Mesh(geo('pl2', () => new THREE.PlaneGeometry(2.2, 2.2)), new THREE.MeshBasicMaterial({ map: texTache('deg' + i, x2 => { x2.strokeStyle = 'rgba(0,0,0,0.75)'; x2.lineWidth = 2; for (let k = 0; k < 5; k++) { x2.beginPath(); x2.moveTo(64, 64); let px = 64, py = 64; for (let q = 0; q < 5; q++) { px += Math.cos(k * 1.3 + i) * 12 + (Math.random() - 0.5) * 10; py += Math.sin(k * 1.3 + i) * 12 + (Math.random() - 0.5) * 10; x2.lineTo(px, py); } x2.stroke(); } }), transparent: true, depthWrite: false }));
      d.rotation.x = -Math.PI / 2; d.position.set(Math.cos(i * 2.4 + spec.id) * 3.4, 0.01, Math.sin(i * 2.4 + spec.id) * 3.4); g.add(d);
    }
    // centre : trappe et échelle
    const aHaut = (spec.portes >> 4) & 1, aBas = (spec.portes >> 5) & 1;
    let echelle = null, trappe = null, ouverturePlafond = null;
    const medaillon = new THREE.Mesh(geo('med', () => new THREE.RingGeometry(0.95, 1.15, 28)), M.or()); medaillon.rotation.x = -Math.PI / 2; medaillon.position.y = 0.012; g.add(medaillon);
    if (aBas) { trappe = groupe(g, 0, 0.02, 0.85); const t2 = cyl(trappe, 0.85, 0.85, 0.06, 24, M.bronze(), 0, 0, -0.85); }
    if (aHaut) {
      echelle = groupe(g, 0, 0, -0.85);
      boite(echelle, 0.06, HT, 0.06, M.bois(), -0.35, HT / 2, 0); boite(echelle, 0.06, HT, 0.06, M.bois(), 0.35, HT / 2, 0);
      for (let i = 0; i < 17; i++) boite(echelle, 0.7, 0.05, 0.06, M.bois(), 0, 0.3 + i * 0.42, 0);
      ouverturePlafond = groupe(g, 0, HT, 0);
      for (const [w, d, x, z] of [[2.2, 0.15, 0, -1.1], [2.2, 0.15, 0, 1.1], [0.15, 2.2, -1.1, 0], [0.15, 2.2, 1.1, 0]]) boite(ouverturePlafond, w, 0.18, d, M.fer(), x, 0, z);
    }
    // le plafond est retiré pour la vue de dessus : seule l'ouverture centrale reste suggérée
    interactifs.push({ type: 'centre', x: 0, z: 0, r: 1.25 });
    // cadran mécanique à douze dents incrusté au sol
    const cadran = groupe(g, -4.1, 0.014, 4.1);
    const dents = [];
    { const fond = new THREE.Mesh(geo('cadf', () => new THREE.CircleGeometry(0.75, 24)), mat(0x15120d, { r: 0.6, m: 0.5 })); fond.rotation.x = -Math.PI / 2; cadran.add(fond);
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; const d = boite(cadran, 0.12, 0.02, 0.22, mat(0x5a4a2a, { r: 0.5, m: 0.8 }), Math.sin(a) * 0.6, 0.01, -Math.cos(a) * 0.6); d.rotation.y = -a; dents.push(d); }
      const roue = cyl(cadran, 0.32, 0.32, 0.03, 10, M.bronze(), 0, 0.01, 0); cadran.userData.roue = roue; }
    // colonnes laquées aux quatre coins, sur des bases de pierre
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const X = cx * (DM - 0.35), Z = cz * (DM - 0.35);
      cyl(g, 0.26, 0.26, HT - 0.4, 28, mat(teinte(pal.mur, 0.15), { r: 0.32, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 }), X, HT / 2 + 0.05, Z);
      cyl(g, 0.38, 0.42, 0.36, 28, M.pierre(), X, 0.18, Z);
      bloc(g, 0.62, 0.2, 0.62, M.or(), X, HT - 0.1, Z, 0.03);
      obstacles.push({ x0: X - 0.4, x1: X + 0.4, z0: Z - 0.4, z1: Z + 0.4 });
    }
    // lanternes de papier
    const lanternes = [];
    for (const [lx, lz] of [[-4.4, -4.4], [4.4, 4.4]]) {
      const lg = groupe(g, lx, HT - 1.6, lz);
      cyl(lg, 0.012, 0.012, 1.4, 6, M.fer(), 0, 0.9, 0);
      const corpsL = new THREE.Mesh(geoLanterne(), matLanterne(spec.lanterne)); corpsL.userData.pasOmbre = true; lg.add(corpsL);
      cyl(lg, 0.16, 0.2, 0.09, 20, M.or(), 0, 0.5, 0); cyl(lg, 0.2, 0.16, 0.09, 20, M.or(), 0, -0.5, 0);
      cyl(lg, 0.035, 0.012, 0.42, 8, mat(0xa3271f, { r: 0.9 }), 0, -0.76, 0);
      halo(lg, spec.lanterne, 2.6, 0, 0, 0, 0.55);
      lanternes.push(lg);
    }
    // traits distinctifs
    for (const tr of spec.traits) construireTrait(g, tr, spec, obstacles, interactifs);
    // fausse sortie
    let fausseSortie = null;
    if (spec.fausseSortie) {
      const fs = spec.fausseSortie, fg = groupe(g); fg.rotation.y = ANGLE_FACE(fs.face);
      const v = construirePorteVisuelle(fg, spec, true);
      if (fs.mode === 'lumiere') { v.lumiere.visible = true; v.fond.visible = false; v.ouv = 1; animerPorte(v, 1); boite(fg, PL, HP, 0.04, mat(0xffe9b0, { basic: true, add: true, op: 0.25 }), 0, HP / 2, -DM + 1.2); }
      fausseSortie = { face: fs.face, mode: fs.mode, v };
    }
    // pièges
    const pieges = spec.pieges.map((p, i) => {
      const pg = groupe(g);
      const fab = FABRIQUES[p.type];
      const inst = fab ? fab(p, pg, ctxPiege, i) : { maj() {}, danger() { return null; } };
      inst.type = p.type; inst.p = p; inst.idx = i; inst.groupe = pg;
      return inst;
    });
    const traits = {
      obscur: pieges.some(p => p.obscur), bruit: pieges.find(p => p.bruit), herse: pieges.find(p => p.faces && p.bloque),
      temps: pieges.find(p => p.portesTemporisees), trompeur: pieges.find(p => p.fausse), escalier: pieges.find(p => p.echelle),
      condamnee: pieges.find(p => p.scelle), enigme: pieges.find(p => p.enigme), teleport: pieges.find(p => p.teleport),
      dalle: pieges.find(p => p.surDalle), chaines: pieges.find(p => p.chaines), fosses: pieges.find(p => p.cases && p.cases[0] && p.cases[0].trou),
    };
    if (traits.enigme) interactifs.push({ type: 'abaque', x: 0, z: -2.7, r: 1.4 });
    // objets au sol (butin d'origine)
    const objets = new Map();
    preparerOmbres(g);
    return {
      id, spec, groupe: g, murs, portes, pieges, obstacles, interactifs, echelle, trappe, ouverturePlafond, cadran, dents, lanternes,
      traits, fausseSortie, ctxPiege, objets, cadavres: new Map(),
    };
  }

  /** Coque d'une salle voisine : on ne voit pas l'intérieur, seulement le couvercle et les flancs. */
  function construireCoque(monde, id) {
    const spec = C.specSalle(monde, id), pal = spec.palette;
    const g = new THREE.Group();
    const L = DM * 2 + EP;
    const tc = texCouvercle(pal);
    boite(g, L, HT, L, mat(0x6a625a, { r: 0.7, m: 0.5, map: tc.map, bump: tc.bump, bs: 0.04 }), 0, HT / 2, 0);
    const cvr = boite(g, L, 0.06, L, mat(0xffffff, { map: tc.map, bump: tc.bump, bs: 0.05, r: 0.55, m: 0.7 }), 0, HT + 0.03, 0);
    const bord = new THREE.LineSegments(geo('aret', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(L, HT, L))), new THREE.LineBasicMaterial({ color: 0x8a6a32, transparent: true, opacity: 0.35 }));
    bord.position.y = HT / 2; g.add(bord);
    return { id, groupe: g, coque: true };
  }

  /** Structure mécanique entre les salles : colonnes, chaînes, rails, engrenages (instanciés : peu d'appels de dessin). */
  function construireStructure() {
    const g = new THREE.Group();
    const roues = [];
    const mCol = mat(0x1c1d20, { r: 0.6, m: 0.7 }), mBr = mat(0x3a2f1c, { r: 0.4, m: 0.85 });
    const tmp = new THREE.Object3D();
    const coins = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) coins.push([(i + 0.5) * CF.ESP_H, (j + 0.5) * CF.ESP_H, i, j]);
    const cols = new THREE.InstancedMesh(gBoite(0.9, CF.ESP_V * 5, 0.9), mCol, coins.length);
    coins.forEach(([x, z], k) => { tmp.position.set(x, 0, z); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); cols.setMatrixAt(k, tmp.matrix); });
    g.add(cols);
    const chaines = groupe(g);
    const maillons = 22, nCh = coins.length * 2;
    const inst = new THREE.InstancedMesh(geo('maillon2', () => new THREE.TorusGeometry(0.16, 0.05, 4, 7)), mat(0x2b2d31, { r: 0.5, m: 0.8 }), nCh * maillons);
    let k = 0;
    coins.forEach(([x, z]) => { for (const dx of [-0.7, 0.7]) for (let q = 0; q < maillons; q++) { tmp.position.set(x + dx, -CF.ESP_V * 1.6 + q * 1.26, z + 0.7); tmp.rotation.set(0, q % 2 ? Math.PI / 2 : 0, 0); tmp.updateMatrix(); inst.setMatrixAt(k++, tmp.matrix); } });
    chaines.add(inst);
    coins.forEach(([x, z, i, j]) => {
      if ((i + j) % 2) return;
      const r = groupe(g, x, -1.5, z + 0.6);
      const d = cyl(r, 1.6, 1.6, 0.25, 10, mBr, 0, 0, 0); d.rotation.x = Math.PI / 2;
      const t = new THREE.Mesh(geo('dents', () => new THREE.TorusGeometry(1.75, 0.18, 4, 10)), mBr); r.add(t);
      roues.push(r);
    });
    for (let i = -2; i <= 2; i++) {
      boite(g, CF.ESP_H * 5, 0.25, 0.35, mat(0x2a2a2c, { r: 0.4, m: 0.8 }), 0, -1.0, (i + 0.5) * CF.ESP_H);
      boite(g, 0.35, 0.25, CF.ESP_H * 5, mat(0x2a2a2c, { r: 0.4, m: 0.8 }), (i + 0.5) * CF.ESP_H, -1.0, 0);
    }
    return { groupe: g, roues, chaines };
  }

  // =====================================================================
  // CINÉMATIQUES : vue d'ensemble du Cube (révélée seulement à la libération)
  // =====================================================================
  function construireVueEnsemble(monde, it) {
    const g = new THREE.Group();
    const n = Math.min(monde.nbSalles, 9000);
    const geom = gBoite(CF.DEMI * 2, HT, CF.DEMI * 2);
    const inst = new THREE.InstancedMesh(geom, mat(0x2a2420, { r: 0.8, m: 0.4, e: 0x070504 }), n);
    const tmp = new THREE.Object3D(); let k = 0;
    for (let id = 1; id <= monde.nbSalles && k < n; id += Math.max(1, Math.floor(monde.nbSalles / n))) {
      const p = C.positionSalle(monde, id, it);
      tmp.position.set(p.x * CF.ESP_H, p.z * CF.ESP_V + HT / 2, p.y * CF.ESP_H); tmp.updateMatrix(); inst.setMatrixAt(k++, tmp.matrix);
    }
    inst.count = k; g.add(inst);
    return g;
  }

  // =====================================================================
  // PORTRAITS 3D (pavillon des captifs)
  // =====================================================================
  let rendPortrait = null, scenePortrait = null;
  const cPortraits = new Map();
  function portrait(look, w, h) {
    const k = JSON.stringify(look) + '|' + w + 'x' + h;
    if (cPortraits.has(k)) return cPortraits.get(k);
    try {
      if (!rendPortrait) {
        rendPortrait = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        rendPortrait.outputEncoding = THREE.sRGBEncoding; rendPortrait.toneMapping = THREE.ACESFilmicToneMapping; rendPortrait.toneMappingExposure = 1.2;
        rendPortrait.setPixelRatio(1);
        scenePortrait = new THREE.Scene(); preparerEnvironnement(rendPortrait, scenePortrait);
        const cle = new THREE.DirectionalLight(0xffe2b8, 1.6); cle.position.set(-2, 3, 4); scenePortrait.add(cle);
        const contre = new THREE.DirectionalLight(0x9ab8ff, 0.9); contre.position.set(3, 2.5, -3); scenePortrait.add(contre);
        scenePortrait.add(new THREE.HemisphereLight(0x8a7a60, 0x120c08, 0.5));
      }
      rendPortrait.setSize(w, h, false);
      const f = creerFigurine(look, {});
      f.racine.rotation.y = -0.35; scenePortrait.add(f.racine);
      const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, 50); cam.position.set(1.0, 2.15, 3.3); cam.lookAt(0, 1.72, 0);
      rendPortrait.render(scenePortrait, cam);
      const url = rendPortrait.domElement.toDataURL('image/png');
      scenePortrait.remove(f.racine);
      cPortraits.set(k, url);
      return url;
    } catch (e) { cPortraits.set(k, null); return null; }
  }

  // =====================================================================
  // SCEAU GRAVÉ EN CARACTÈRES CHINOIS
  // Le signe de la famille de chiffrement (龍 蛇 蓮 鏡 鐘 衛) dans un cachet vermillon, puis trois
  // colonnes lues de droite à gauche : 天 + rune A, 地 + rune B, 人 + région, en chiffres chinois.
  // =====================================================================
  const CHIFFRES_CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SIGNES_CN = ['龍', '蛇', '蓮', '鏡', '鐘', '衛'];
  const POLICE_CN = '"Shippori Mincho B1", "Noto Serif CJK SC", "Noto Serif JP", "Songti SC", "SimSun", "MS Mincho", serif';
  function dessinerSceau(x, w, h, sp, face) {
    x.clearRect(0, 0, w, h);
    const fond = x.createLinearGradient(0, 0, w, h); fond.addColorStop(0, '#3a2a14'); fond.addColorStop(1, '#22180c');
    x.fillStyle = fond; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#c9a24a'; x.lineWidth = Math.max(2, w * 0.01); x.strokeRect(w * 0.02, w * 0.02, w - w * 0.04, h - w * 0.04);
    x.lineWidth = 1; x.strokeRect(w * 0.04, w * 0.04, w - w * 0.08, h - w * 0.08);
    // cachet vermillon à gauche
    const cs = Math.min(h * 0.62, w * 0.36), cx = w * 0.07, cy = (h - cs) / 2 - h * 0.04;
    x.fillStyle = '#a3271f'; x.fillRect(cx, cy, cs, cs);
    x.strokeStyle = '#f2e3c4'; x.lineWidth = cs * 0.05; x.strokeRect(cx + cs * 0.08, cy + cs * 0.08, cs * 0.84, cs * 0.84);
    x.fillStyle = '#f2e3c4'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const signes = sp.chiffres.map(f => SIGNES_CN[f]);
    if (signes.length === 1) { x.font = '800 ' + Math.round(cs * 0.62) + 'px ' + POLICE_CN; x.fillText(signes[0], cx + cs / 2, cy + cs / 2 + cs * 0.02); }
    else { x.font = '800 ' + Math.round(cs * 0.38) + 'px ' + POLICE_CN; x.fillText(signes[0], cx + cs / 2, cy + cs * 0.3); x.fillText(signes[1], cx + cs / 2, cy + cs * 0.72); }
    // trois colonnes verticales, de droite à gauche
    const cols = [['天', sp.runeA], ['地', sp.runeB], ['人', sp.zone]], taille = Math.round(h * 0.2), x0 = cx + cs + (w - cx - cs) * 0.22;
    x.font = '700 ' + taille + 'px ' + POLICE_CN;
    cols.forEach(([t, v], i) => {
      const colX = w - w * 0.1 - i * (w - w * 0.1 - x0) / 2.2;
      x.fillStyle = '#c9a24a'; x.fillText(t, colX, cy + taille * 0.6);
      x.fillStyle = i === 2 ? '#e0a080' : '#f2e3c4'; x.fillText(CHIFFRES_CN[v] || String(v), colX, cy + taille * 1.75);
    });
    // points de la face, sous le cachet
    x.fillStyle = '#c9a24a';
    for (let i = 0; i <= face; i++) { x.beginPath(); x.arc(w / 2 - face * w * 0.03 + i * w * 0.06, h - h * 0.11, Math.max(2, w * 0.016), 0, TAU); x.fill(); }
  }
  const texSceau = (sp, face) => memo('sceau' + sp.id + '-' + face, () => { const c = toileVide(320, 230); dessinerSceau(c.getContext('2d'), 320, 230, sp, face); return versTexture(c, true); });

  /** Prépare en tâche de fond les textures d'une couleur de salle de plus (true tant qu'il en reste). */
  let iPrechauffe = 0;
  function prechauffer() {
    const pals = C.PALETTES;
    while (iPrechauffe < pals.length * 2) {
      const pal = pals[iPrechauffe >> 1], etape = iPrechauffe & 1; iPrechauffe++;
      const k = (etape ? 'mur' + pal.mur : 'sol' + pal.sol) + QUALITE;
      if (cTex.has(k)) continue;
      if (etape) texMur(pal); else texSol(pal);
      return true;
    }
    return false;
  }

  racine.RenduCube = {
    regler, prechauffer, dessinerSceau, preparerEnvironnement, preparerOmbres, portrait, halo, plastique, bloc,
    THREE, mat, boite, cyl, sph, cone, groupe, M, teinte, melange, hex, fr,
    creerFigurine, creerCadavre, creerObjet, construireSalle, construireCoque, construireStructure, construireVueEnsemble,
    animerPorte, localDepuisFace, faceDepuisLocal, ANGLE_FACE, dessinerBatonnets, COUL_RARETE, PEAUX, texGlyphe,
  };
})(typeof window !== 'undefined' ? window : globalThis);
