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
    const k = [c, o.r, o.m, o.e, o.ei, o.op, o.add, o.map && o.map.uuid, o.bump && o.bump.uuid, o.bs, o.ds, o.basic, o.env, o.rm && o.rm.uuid].join('|');
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
        if (o.rm) p.roughnessMap = o.rm;
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
  /** Remplit couleur + relief (+ rugosité si demandée) à partir d'une fonction par pixel :
   *  f(x, y, i) -> [lum, relief, teinteOptionnelle, rugosité 0..1]. */
  function peindre(W, H, base, f, rugueux) {
    const cC = toileVide(W, H), cH = toileVide(W, H), xc = cC.getContext('2d'), xh = cH.getContext('2d');
    const cR = rugueux ? toileVide(W, H) : null, xr = cR ? cR.getContext('2d') : null, ir = xr ? xr.createImageData(W, H) : null;
    const ic = xc.createImageData(W, H), ih = xh.createImageData(W, H), [br, bg, bb] = rgb(base);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, p = i * 4, v = f(x, y, i);
      const t = v[2];
      ic.data[p] = clamp((t ? t[0] : br) * v[0], 0, 255); ic.data[p + 1] = clamp((t ? t[1] : bg) * v[0], 0, 255); ic.data[p + 2] = clamp((t ? t[2] : bb) * v[0], 0, 255); ic.data[p + 3] = 255;
      const hh = clamp(v[1] * 255, 0, 255); ih.data[p] = ih.data[p + 1] = ih.data[p + 2] = hh; ih.data[p + 3] = 255;
      if (ir) { const rr = clamp((v[3] != null ? v[3] : 0.8) * 255, 0, 255); ir.data[p] = ir.data[p + 1] = ir.data[p + 2] = rr; ir.data[p + 3] = 255; }
    }
    xc.putImageData(ic, 0, 0); xh.putImageData(ih, 0, 0); if (xr) xr.putImageData(ir, 0, 0);
    return { cC, cH, xc, xh, cR, xr };
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
    const { cC, cH, xc, xh, cR } = peindre(W, W, base, (x, y, i) => {
      const a = Math.floor(x / s), b = Math.floor(y / s), u = x - a * s, v = y - b * s, e = Math.min(u, s - u, v, s - v);
      const ao = 0.48 + 0.52 * Math.min(1, Math.min(x, W - x, y, W - y) / W / 0.13);
      if (e < gr) return [0.3 * (0.8 + n2[i] * 0.4) * ao, 0.05, null, 1];
      const bev = Math.min(1, (e - gr) / (gr * 2.4)), use = 1 - Math.min(1, Math.hypot(x - W / 2, y - W / 2) / (W * 0.42));
      return [teintes[b * n + a] * (0.7 + 0.46 * n1[i] + 0.16 * (n2[i] - 0.5)) * (0.86 + 0.14 * bev) * ao, 0.35 + 0.45 * bev + 0.2 * n2[i], null, 0.88 - 0.3 * use * n1[i] - 0.08 * bev + 0.1 * (1 - ao)];
    }, true);
    fissures(xc, xh, W, W, 5, r);
    return { map: versTexture(cC, true), bump: versTexture(cH), rough: versTexture(cR) };
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
      const [pr, pgg, pb] = rgb(teinte(pal.mur, 0.2));
      for (const ligne of blocs) for (const b of ligne) { const d = (r() - 0.5) * 0.12; b.push([pr * (1 + d), pgg * (1 + d * 0.6), pb * (1 - d * 0.4)]); } // chaque bloc sa nuance
      res = peindre(W, H, teinte(pal.mur, 0.2), (x, y, i) => {
        const k = Math.min(rangs - 1, Math.floor(y / hR)), v = y - k * hR, bl = blocs[k].find(b => x >= b[0] && x < b[1]) || [0, W, 1, null];
        const e = Math.min(v, hR - v, x - bl[0], bl[1] - x), j = Math.max(2, W * 0.004);
        if (e < j) return [0.3 + n2[i] * 0.1, 0.05, null, 1];
        const bev = Math.min(1, (e - j) / (j * 3)), ao = 0.72 + 0.28 * Math.min(1, (e - j) / (j * 6));
        const eclat = v < j * 3 ? 1.08 : 1; // arête haute qui prend la lumière
        return [bl[2] * (0.68 + 0.5 * n1[i] + 0.15 * (n2[i] - 0.5)) * (0.85 + 0.15 * bev) * ao * eclat, 0.3 + 0.4 * bev + 0.3 * n1[i], bl[3], 0.78 + 0.18 * n2[i]];
      }, true);
      fissures(res.xc, res.xh, W, H, 4, r);
    } else if (style === 'metal') {
      const pw = W / 4, ph = H / 2;
      res = peindre(W, H, teinte(pal.mur, 0.25), (x, y, i) => {
        const u = x % pw, v = y % ph, e = Math.min(u, pw - u, v, ph - v), patine = n1[i] > 0.6 ? Math.min(1, (n1[i] - 0.6) * 4) : 0;
        const t = patine ? [80 + 40 * patine, 120 + 50 * patine, 100 + 40 * patine] : null;
        if (e < 3) return [0.3, 0.05, null, 1];
        return [(0.75 + 0.35 * n2[i] + 0.15 * n1[i]) * (t ? 1 : 1), 0.5 + 0.25 * n2[i] - patine * 0.2, t, 0.32 + 0.5 * patine + 0.1 * n2[i]];
      }, true);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) for (let k = 0; k < 6; k++) {
        const cx = a * pw + 14 + k * (pw - 28) / 5, ys = [b * ph + 14, (b + 1) * ph - 14];
        for (const cy of ys) for (const [x, col] of [[res.xc, 'rgba(255,230,180,0.35)'], [res.xh, '#fff']]) { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, W * 0.005, 0, TAU); x.fill(); }
      }
    } else if (style === 'bois') {
      const pl = W / 14;
      res = peindre(W, H, teinte(pal.mur, 0.3), (x, y, i) => {
        const k = Math.floor(x / pl), u = x - k * pl;
        if (u < 2) return [0.25, 0.02, null, 1];
        const veine = 0.5 + 0.5 * Math.sin((x * 0.9 + n1[i] * 40 + k * 13) * 0.6);
        return [(0.7 + 0.25 * veine + 0.15 * n2[i]) * (0.85 + 0.3 * ((k * 7919) % 13) / 13), 0.45 + 0.3 * veine * 0.5 + 0.2 * n2[i], null, 0.6 + 0.25 * veine];
      }, true);
    } else {
      // laque : soubassement de pierre, poteaux, panneaux laqués à filet doré, treillis en haut
      const dado = H * 0.2, poteau = W / 6;
      res = peindre(W, H, teinte(pal.mur, 0.22), (x, y, i) => {
        const fin = n2[i] > 0.82 ? 0.82 : 1; // craquelures de la laque
        if (y > H - dado) return [0.55 + 0.35 * n1[i], 0.35 + 0.3 * n1[i], [120, 112, 100], 0.85 + 0.1 * n2[i]];
        const u = x % poteau;
        if (u < W * 0.016 || u > poteau - W * 0.016) return [0.62 + 0.15 * n1[i], 0.85, null, 0.45];
        return [(0.8 + 0.3 * n1[i] + 0.08 * (n2[i] - 0.5)) * fin, 0.45 + 0.1 * n2[i] - (fin < 1 ? 0.15 : 0), null, fin < 1 ? 0.7 : 0.26 + 0.2 * n1[i]];
      }, true);
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
    // frise de grecques (回紋) sous la corniche, en couleur d'accent, en relief et plus brillante
    { const y0 = H * 0.02, hb = H * 0.036, [ar, ag, ab] = rgb(pal.acc);
      res.xc.fillStyle = 'rgba(0,0,0,0.45)'; res.xc.fillRect(0, y0 - hb * 0.15, W, hb * 1.3);
      for (const [ctx, col, lw] of [[res.xc, `rgba(${ar},${ag},${ab},0.95)`, hb * 0.11], [res.xh, '#f0f0f0', hb * 0.13], [res.xr, '#505050', hb * 0.13]]) {
        if (!ctx) continue;
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'square';
        ctx.beginPath(); ctx.moveTo(0, y0 + hb); ctx.lineTo(W, y0 + hb); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
        for (let x0 = 0; x0 < W; x0 += hb * 1.25) { ctx.beginPath(); ctx.moveTo(x0, y0 + hb); ctx.lineTo(x0, y0 + hb * 0.15); ctx.lineTo(x0 + hb * 0.85, y0 + hb * 0.15); ctx.lineTo(x0 + hb * 0.85, y0 + hb * 0.7); ctx.lineTo(x0 + hb * 0.35, y0 + hb * 0.7); ctx.lineTo(x0 + hb * 0.35, y0 + hb * 0.42); ctx.lineTo(x0 + hb * 0.6, y0 + hb * 0.42); ctx.stroke(); }
      } }
    // occlusion : plus sombre en bas (contre le sol) et en haut
    const g = res.xc.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(0.12, 'rgba(0,0,0,0)'); g.addColorStop(0.86, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    res.xc.fillStyle = g; res.xc.fillRect(0, 0, W, H);
    return { map: versTexture(res.cC, true), bump: versTexture(res.cH), rough: res.cR ? versTexture(res.cR) : null };
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
        // repère « carré » : 1 unité = 1 px de hauteur, compressé selon le rapport tour de tête / hauteur
        x.save(); x.setTransform((w / h) / (TAU * FIG.teteR / FIG.teteH), 0, 0, 1, cx, 0);
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
  // Recalée ensuite sur le plan coté de la vraie pièce (1 mm = 12,24 unités) : tête 10,2 × 8,5 mm
  // (125 × 104, coins R2), hanches 15,4 mm (190), mains Ø 5,1 mm percées Ø 3,1 mm, tenon creux Ø 4,9 mm.
  // Profil relevé sur la figurine en bois officielle : jambes 172 (au lieu de 153), hanches 25, torse
  // profond de 98, jambe au dos droit, cuisse arrondie autour de l'axe de hanche, tibia en retrait, pied
  // qui dépasse devant ; épaule 12 sous le haut du torse, avant-bras vers l'avant, main devant les hanches.
  // 1 px = K unités ; la figurine est ensuite agrandie de 1,3 (corps.scale).
  // ---------------------------------------------------------------------
  const K = 0.0037;
  const FIG = {
    jambeH: 172 * K, piedH: 28 * K, jambeL: 92 * K, ecart: 6 * K, prof: 97 * K,
    hancheH: 25 * K, largeur: 190 * K,
    torseH: 160 * K, torseHaut: 150 * K,
    couH: 12 * K, couR: 30 * K,
    teteH: 104 * K, teteR: 62.5 * K, teteArrondi: 22 * K,
    tenonH: 23 * K, tenonR: 31 * K,
  };
  FIG.yHanche = FIG.jambeH; FIG.yTorse = FIG.yHanche + FIG.hancheH; FIG.yCou = FIG.yTorse + FIG.torseH; FIG.yTete = FIG.yCou + FIG.couH;
  function geoTorseFig() {
    return geo('torseFig', () => {
      const g = new THREE.BoxGeometry(FIG.largeur, FIG.torseH, FIG.prof * 1.01, 4, 4, 1);
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
  /** Tenon du dessus de la tête : creux, comme sur la vraie pièce (Ø 4,9 mm, trou ≈ Ø 3,2 mm). */
  const geoTenonFig = () => geo('tenonFig2', () => {
    const r = 30 * K, h = FIG.tenonH, b = h * 0.18, ri = r * 0.64, d = h * 0.62;
    return new THREE.LatheGeometry([[0.0001, 0], [r, 0], [r, h - b], [r - b * 0.6, h - b * 0.25], [r - b, h], [ri + b * 0.5, h], [ri, h - b * 0.5], [ri, h - d], [0.0001, h - d]].map(([a, c]) => new THREE.Vector2(a, c)), 36);
  });
  // ---------------------------------------------------------------------
  // Visage imprimé, façon dessin animé de briques : yeux ovales noirs avec un reflet blanc,
  // sourcils épais, bouche expressive. Posé en décalcomanie sur l'avant de la tête (bande
  // cylindrique de 126°, partie droite de la tête) pour rester net même en gros plan.
  // Encre claire sur les têtes sombres, sinon le visage disparaîtrait.
  // ---------------------------------------------------------------------
  // Coordonnées en unités K depuis le centre de la tête (x le long du tour de tête, y vers le haut).
  const VIS_W = 512, VIS_H = 220, VIS_HT = () => FIG.teteH - 2 * FIG.teteArrondi, VIS_U = () => VIS_H / VIS_HT();
  function texVisageImprime(type, clair) {
    return toile('visI' + type + (clair ? 'c' : 'f'), VIS_W, VIS_H, (x, w) => {
      x.clearRect(0, 0, w, VIS_H);
      const u = VIS_U() * K, X = k => w / 2 + k * u, Y = k => VIS_H / 2 - k * u;
      const encre = clair ? '#efeae0' : '#15110d', reflet = clair ? '#1b1b1d' : '#ffffff';
      const peur = type === 'peur';
      x.lineCap = 'round'; x.lineJoin = 'round';
      for (const s of [-1, 1]) {
        // œil : point noir légèrement ovale, à 3,8 mm sous le haut de la tête, reflet blanc comme dans le dessin animé
        const ex = s * 20.5, ey = 5.5, rx = peur ? 6.4 : 5.6, ry = peur ? 7.4 : 6.4;
        x.fillStyle = encre; x.beginPath(); x.ellipse(X(ex), Y(ey), rx * u, ry * u, 0, 0, TAU); x.fill();
        x.fillStyle = reflet; x.beginPath(); x.arc(X(ex - 1.8), Y(ey + 2.3), 1.9 * u, 0, TAU); x.fill();
        if (peur) { // sourcils relevés côté nez
          x.strokeStyle = encre; x.lineWidth = 3.6 * u; x.beginPath();
          x.moveTo(X(s * 9), Y(23)); x.quadraticCurveTo(X(s * 20), Y(23), X(s * 31), Y(16)); x.stroke();
        }
      }
      x.fillStyle = encre; x.strokeStyle = encre;
      if (peur) { // bouche grande ouverte, rangée de dents du haut
        x.beginPath(); x.moveTo(X(-15), Y(-13)); x.quadraticCurveTo(X(0), Y(-10), X(15), Y(-13)); x.quadraticCurveTo(X(17), Y(-28.5), X(0), Y(-29)); x.quadraticCurveTo(X(-17), Y(-28.5), X(-15), Y(-13)); x.fill();
        x.fillStyle = reflet; x.beginPath(); x.moveTo(X(-12.5), Y(-14)); x.quadraticCurveTo(X(0), Y(-11.5), X(12.5), Y(-14)); x.lineTo(X(12.3), Y(-17.5)); x.quadraticCurveTo(X(0), Y(-15.5), X(-12.3), Y(-17.5)); x.closePath(); x.fill();
      } else { // sourire classique, aussi large que l'écart des yeux
        x.lineWidth = 3.4 * u; x.beginPath(); x.moveTo(X(-19), Y(-15)); x.quadraticCurveTo(X(0), Y(-32), X(19), Y(-15)); x.stroke();
      }
    });
  }
  const geoVisage = () => geo('visage', () => {
    const r = FIG.teteR + 0.6 * K, h = VIS_HT(), arc = VIS_W / VIS_H * h / FIG.teteR;
    return new THREE.CylinderGeometry(r, r, h, 40, 1, true, -arc / 2, arc);
  });
  const cVisages = new Map();
  function matVisage(type, clair) {
    const k = type + (clair ? 'c' : 'f');
    let m = cVisages.get(k);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ map: texVisageImprime(type, clair), transparent: true, depthWrite: false, roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.16, envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      cVisages.set(k, m);
    }
    return m;
  }
  /** Luminance relative (linéaire) : sous 0,065, l'encre noire ne se lit plus (noir, marine, bordeaux, chocolat…). */
  const luminance = c => { const l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const [r, g, b] = rgb(c); return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b); };
  /** Main de brique (plan coté) : pince en C Ø 5,1 mm percée Ø 3,1 mm, épaisse d'environ 3 mm, fente
   *  d'environ 85° centrée sur l'axe +x, arêtes bien arrondies. Le biseau élargit le contour :
   *  rayon extérieur réel 31, trou 19 (unités du modèle). */
  const geoMainFig = () => geo('mainFig4', () => {
    const b = 4 * K, Ro = 27 * K, Ri = 23 * K, ouverture = 1.5, a0 = ouverture / 2, a1 = TAU - ouverture / 2;
    const sh = new THREE.Shape();
    sh.absarc(0, 0, Ro, a0, a1, false);
    sh.absarc(0, 0, Ri, a1, a0, true);
    sh.closePath();
    const ep = 38 * K, bz = 6 * K;
    const g = new THREE.ExtrudeGeometry(sh, { depth: ep - 2 * bz, bevelEnabled: true, bevelThickness: bz, bevelSize: b, bevelSegments: 5, curveSegments: 44 });
    g.translate(0, 0, -(ep - 2 * bz) / 2); g.computeVertexNormals();
    return g;
  });
  /** Tube de rayon variable le long d'une courbe (bras moulé d'une seule pièce). */
  function geoTubeVariable(points, rayon, nSeg, nRad) {
    const courbe = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const fr = courbe.computeFrenetFrames(nSeg, false);
    const pos = [], nor = [], idx = [];
    for (let i = 0; i <= nSeg; i++) {
      const P = courbe.getPointAt(i / nSeg), N = fr.normals[i], B = fr.binormals[i], r = rayon(i / nSeg);
      for (let j = 0; j <= nRad; j++) {
        const v = j / nRad * TAU, sn = Math.sin(v), cs = -Math.cos(v);
        const nx = cs * N.x + sn * B.x, ny = cs * N.y + sn * B.y, nz = cs * N.z + sn * B.z;
        pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz); nor.push(nx, ny, nz);
      }
    }
    for (let i = 1; i <= nSeg; i++) for (let j = 1; j <= nRad; j++) {
      const a = (nRad + 1) * (i - 1) + (j - 1), b = (nRad + 1) * i + (j - 1), c = (nRad + 1) * i + j, d = (nRad + 1) * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return { g, courbe };
  }
  /** Main au bout d'un bras : le poignet sort de la manchette dans l'axe de l'avant-bras (dir), la main pend
   *  dessous, le C vu de face (axe vers l'avant, un peu relevé), ouverture vers le bas, à peine vers le corps. */
  function mainFig(parent, s, m, bout, dir) {
    const gp = groupe(parent, bout.x, bout.y, bout.z);
    const g = Math.asin(Math.max(-1, Math.min(1, dir.x)));
    gp.rotation.set(Math.atan2(-dir.z, -dir.y), 0, g);
    cyl(gp, 10 * K, 10 * K, 14 * K, 14, m, 0, -4 * K, 0);
    const main = new THREE.Mesh(geoMainFig(), m);
    main.position.set(0, -34 * K, 0);
    main.rotation.set(0, 0, -Math.PI / 2 - g - s * 0.2);
    gp.add(main);
    return main;
  }
  // Bras moulé d'une seule pièce, comme sur le plan : épaule arrondie au ras du haut du torse, bras qui
  // longe le flanc en s'écartant (un peu en arrière), coude, avant-bras vers l'avant et le bas ; la main
  // finit devant les hanches, comme de profil sur la vraie figurine.
  // Points dans le repère de l'épaule (x vers l'extérieur pour s = 1).
  const BRAS_PTS = [[-5, 0, 0], [4, -32, -5], [15, -64, -8], [24, -92, -4], [29, -110, 10], [32, -123, 27]];
  const BRAS_R = t => (t < 0.45 ? 26 - 2.5 * Math.sin(t / 0.45 * Math.PI / 2) : 23.5 + 1.3 * (t - 0.45) / 0.55) * K; // épaule plus ronde
  function geoBras(s) {
    return geo('bras' + s, () => geoTubeVariable(BRAS_PTS.map(([x, y, z]) => new THREE.Vector3(s * x * K, y * K, z * K)), BRAS_R, 40, 28));
  }
  /** Un bras : pièce courbée, épaule en dôme, manchette creuse, main en C. */
  function brasFig(b, s, m, mMain, mCreux) {
    const { g, courbe } = geoBras(s);
    b.add(new THREE.Mesh(g, m));
    const p0 = courbe.getPointAt(0); sph(b, BRAS_R(0), m, p0.x, p0.y, p0.z, 28);
    // manchette : léger bourrelet et trou sombre où entre le poignet
    const fin = courbe.getPointAt(1), dir = courbe.getTangentAt(1).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const bord = cyl(b, BRAS_R(1) + 0.8 * K, BRAS_R(1) + 0.8 * K, 5 * K, 28, m, fin.x - dir.x * 2.5 * K, fin.y - dir.y * 2.5 * K, fin.z - dir.z * 2.5 * K); bord.quaternion.copy(q);
    const trou = cyl(b, 14 * K, 14 * K, 0.6 * K, 20, mCreux, fin.x, fin.y, fin.z); trou.quaternion.copy(q);
    mainFig(b, s, mMain, fin.clone().addScaledVector(dir, -3 * K), dir);
    return b;
  }
  /** Profil de jambe (repère y vers le haut depuis la semelle, z vers l'avant depuis l'axe du torse),
   *  relevé sur la figurine en bois : dos droit, pied qui avance en biais, marche, tibia en retrait,
   *  cuisse bombée autour de l'axe de hanche. yMax coupe le profil (bande intérieure sous l'encoche en U).
   *  Le biseau (b) élargit le contour : les cotes sont données sans lui. */
  function geoJambe(larg, yMax) {
    const kk = v => v * K;
    return geo('jambe' + (larg / K).toFixed(1) + ',' + (yMax ? (yMax / K).toFixed(1) : 'h'), () => {
      const b = 2.5, H = FIG.jambeH / K, sh = new THREE.Shape(), P = (z, y) => new THREE.Vector2(kk(z), kk(y));
      sh.moveTo(kk(-41 + b), kk(b));
      sh.lineTo(kk(59 - b), kk(b));                 // semelle
      sh.lineTo(kk(57 - b), kk(22));                // pied, avant en biais
      sh.lineTo(kk(47 - b), kk(69 - b));
      sh.lineTo(kk(26 - b), kk(69 - b));            // marche du pied
      const yc = yMax ? yMax / K : null;
      if (yc && yc < 103) { sh.lineTo(kk(26 - b), kk(yc - b)); sh.lineTo(kk(-41 + b), kk(yc - b)); }
      else {
        sh.lineTo(kk(26 - b), kk(103));             // tibia
        sh.quadraticCurveTo(kk(43 - b), kk(112), kk(43 - b), kk(H - 35));   // cuisse bombée
        sh.quadraticCurveTo(kk(43 - b), kk(H - 14), kk(37 - b), kk(H - b));
        sh.lineTo(kk(-41 + b), kk(H - b));
      }
      sh.lineTo(kk(-41 + b), kk(b));
      const g = new THREE.ExtrudeGeometry(sh, { depth: larg - 2 * kk(b), bevelEnabled: true, bevelThickness: kk(b), bevelSize: kk(b), bevelSegments: 3, curveSegments: 20 });
      g.translate(0, 0, -(larg - 2 * kk(b)) / 2); g.rotateY(-Math.PI / 2); g.computeVertexNormals();
      return g;
    });
  }
  /** Pièce centrale des hanches qui descend entre les jambes : bout arrondi (encoche en U vue de face). */
  const geoLanguette = (larg, h, prof) => geo('languette' + (larg / K) + ',' + (h / K), () => {
    const sh = new THREE.Shape(), r = larg / 2;
    sh.moveTo(-r, 0); sh.lineTo(-r, -h + r); sh.absarc(0, -h + r, r, Math.PI, TAU, false); sh.lineTo(r, 0); sh.lineTo(-r, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: prof, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -prof / 2); g.computeVertexNormals();
    return g;
  });
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
    // hanches, languette centrale entre les jambes (encoche en U), jambes de profil (cuisse bombée,
    // tibia en retrait, pied qui avance), creux ronds au dos (vue arrière du brevet)
    const mCreux = plastique(mod(teinte(cJambes, -0.55)), { mat: true }), mDos = plastique(mod(teinte(cJambes, -0.2)), { mat: true });
    const hanche = bloc(corps, FIG.largeur, FIG.hancheH, FIG.prof, mJ, 0, FIG.yHanche + FIG.hancheH / 2, 0, 4 * K);
    const hauteurU = FIG.jambeH * 0.42, largU = 16 * K;
    const lang = new THREE.Mesh(geoLanguette(largU - 2 * K, hauteurU, FIG.prof * 0.7), mJ); lang.position.set(0, FIG.yHanche + 1 * K, -12 * K); corps.add(lang);
    boite(corps, largU - 1 * K, hauteurU, FIG.prof * 0.66, mCreux, 0, FIG.yHanche - hauteurU / 2 + 1 * K, -16 * K); // fond de l'encoche
    const xJ = (FIG.jambeL + FIG.ecart) / 2, retrait = (largU - FIG.ecart) / 2;
    // chaque jambe pivote autour de l'axe de hanche (35 sous le haut de la jambe), comme la vraie pièce
    const AXE = 35 * K;
    const jG = groupe(corps, -xJ, FIG.yHanche - AXE, 0), jD = groupe(corps, xJ, FIG.yHanche - AXE, 0);
    for (const [j, s] of [[jG, -1], [jD, 1]]) {
      const jc = groupe(j, 0, AXE - FIG.jambeH, 0); // repère : semelle en y = 0
      const ext = new THREE.Mesh(geoJambe(FIG.jambeL - retrait), mJ); ext.position.x = s * retrait / 2; jc.add(ext);
      const int = new THREE.Mesh(geoJambe(retrait + 0.5 * K, FIG.jambeH - hauteurU), mJ); int.position.x = -s * (FIG.jambeL - retrait) / 2; jc.add(int);
      // dos de la jambe : deux grands creux ronds, celui du haut entamé par les hanches (vue arrière)
      for (const yC of [35 * K, FIG.jambeH - 12 * K]) {
        const fond = cyl(jc, 30 * K, 30 * K, 0.8 * K, 40, mDos, 0, yC, -41.2 * K); fond.rotation.x = Math.PI / 2;
        const rebord = new THREE.Mesh(geo('rebordDos2', () => new THREE.TorusGeometry(30 * K, 1.4 * K, 8, 56)), mCreux); rebord.position.set(0, yC, -41.4 * K); jc.add(rebord);
      }
    }
    // torse trapézoïdal, cou
    const torse = new THREE.Mesh(geoTorseFig(), mT); torse.position.set(0, FIG.yTorse + FIG.torseH / 2, 0); corps.add(torse);
    const cou = cyl(corps, FIG.couR, FIG.couR, FIG.couH + 0.01, 28, mH, 0, FIG.yCou + FIG.couH / 2, 0);
    // bras, attachés en haut des flancs du torse
    const yEpaule = FIG.yTorse + FIG.torseH - 36 * K, xEpaule = FIG.torseHaut / 2 + 12 * K;
    const bG = groupe(corps, -xEpaule, yEpaule, 0), bD = groupe(corps, xEpaule, yEpaule, 0);
    const mManche = plastique(mod(teinte(cTorse, -0.55)), { mat: true });
    brasFig(bG, -1, mT, mH, mManche); brasFig(bD, 1, mT, mH, mManche);
    // tête lisse et tenon
    const tete = groupe(corps, 0, FIG.yTete + FIG.teteH / 2, 0);
    tete.add(new THREE.Mesh(geoTeteFig(), mH));
    const tenon = new THREE.Mesh(geoTenonFig(), mH); tenon.position.y = FIG.teteH / 2 - 0.004; tete.add(tenon);
    // visage imprimé (encre claire sur une tête sombre)
    const clair = luminance(mod(cTete)) < 0.065;
    const visage = new THREE.Mesh(geoVisage(), matVisage(opts.visage || 'normal', clair)); tete.add(visage);
    if (opts.objetMain) { const l = boite(bD, 0.05, 0.05, 0.9, M.acier(), 0.07, -0.56, 0.4); l.rotation.x = 0.1; }
    corps.scale.setScalar(1.3);
    racineG.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    visage.castShadow = false; visage.userData.pasOmbre = true;
    const f = { racine: racineG, corps, jG, jD, bG, bD, tete, hanche, cou, torse, visage };
    /** Change l'expression imprimée : 'normal' ou 'peur'. */
    f.expression = type => { visage.material = matVisage(type, clair); };
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
    const kJ = FIG.jambeH / (153 * K); // os dessinés pour des jambes de 153, mis à l'échelle
    for (const j of [jG, jD]) {
      const hanche = cyl(j, 24 * K, 24 * K, 66 * K, 20, mO, 0, -10 * K, 0); hanche.rotation.z = Math.PI / 2;
      cyl(j, 17 * K, 19 * K, 50 * K * kJ, 18, mO, 0, -42 * K * kJ, 0);
      const genou = cyl(j, 25 * K, 25 * K, 62 * K, 22, mO, 0, -76 * K * kJ, 4 * K); genou.rotation.z = Math.PI / 2;
      cyl(j, 16 * K, 18 * K, 34 * K * kJ, 18, mO, 0, -104 * K * kJ, 0);
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
      const haut = cyl(b, 20 * K, 22 * K, 80 * K, 18, mO, s * 16 * K, -48 * K, 0); haut.rotation.z = s * 0.33;
      const gc = groupe(b, s * 30 * K, -88 * K, 0);
      sph(gc, 23 * K, mO, 0, 0, 0, 18);
      const avant = cyl(gc, 19 * K, 18 * K, 46 * K, 18, mO, s * 4 * K, -21 * K, 9 * K); avant.rotation.x = -0.35;
      mainFig(gc, s, mO, new THREE.Vector3(s * 4 * K, -42.6 * K, 17 * K), new THREE.Vector3(s * 0.15, -0.93, 0.33).normalize());
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
        const f1 = cone(jet, 0.85, 1, M.flamme(), 0, 0, 0.5, 12); f1.rotation.x = -Math.PI / 2;
        const f2 = cone(jet, 0.4, 1, M.flammeCoeur(), 0, 0, 0.5, 10); f2.rotation.x = -Math.PI / 2;
        const lueur = halo(fg, 0xff8a3a, 3.6, b.pos, 1.0, -DM + EP / 2 + 1.6, 0.7); lueur.visible = false;
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
            if (Math.abs(a - J.b.pos) < 0.8 + r && d < J.b.long * k + 0.4) return 'brule';
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
        const lame = boite(bras, l.axe === 'x' ? 0.08 : 2.6, 0.55, l.axe === 'x' ? 2.6 : 0.08, M.acier(), 0, -Lb, 0);
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
            if (Math.abs(along - sx) < 0.12 + r && Math.abs(perp - P.l.c) < 1.3 + r) return 'lames';
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
      const R = p.rayon || rayon || 0.85, ax = p.axe;
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
      const R = p.rayon, ax = p.axe, ep = p.epais || 0.4;
      const rg = groupe(g, 0, R, 0);
      const roue = groupe(rg);
      cyl(roue, R, R, ep, 28, mat(0x5a4a2a, { r: 0.4, m: 0.85 }), 0, 0, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; boite(roue, 0.3, 0.36, ep + 0.02, M.bronze(), Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), 0).rotation.z = a; }
      cyl(roue, 0.3, 0.3, ep + 0.1, 12, M.fer(), 0, 0, 0).rotation.x = Math.PI / 2;
      if (ax === 'z') rg.rotation.y = Math.PI / 2;
      boite(g, ax === 'x' ? DM * 2 : ep + 0.1, 0.02, ax === 'x' ? ep + 0.1 : DM * 2, M.noir(), ax === 'x' ? 0 : p.c, 0.01, ax === 'x' ? p.c : 0);
      const pos = t => (tri(fr(t, p.periode * ctx.tempo('rouleau'), p.off)) * 2 - 1) * (DM - R - 0.3);
      return {
        maj(t) { const s = pos(t); if (ax === 'x') rg.position.set(s, R, p.c); else rg.position.set(p.c, R, s); roue.rotation.z = -s / R; },
        danger(t, x, z, r) { const s = pos(t), a = ax === 'x' ? x : z, q = ax === 'x' ? z : x; return Math.abs(a - s) < R * 0.85 + r && Math.abs(q - p.c) < ep * 0.6 + r ? 'broye' : null; },
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
        const Rs = p.rayon || 0.72, d = cyl(sg, Rs, Rs, 0.05, 32, M.acier(), 0, 0, 0); d.rotation.x = Math.PI / 2;
        if (rl.axe === 'z') sg.rotation.y = Math.PI / 2;
        for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; const c = cone(d, 0.08, 0.16, M.acier(), Math.cos(a) * (Rs + 0.06), 0, Math.sin(a) * (Rs + 0.06), 4); c.rotation.z = -Math.PI / 2; c.rotation.y = -a; }
        return { rl, sg, d };
      });
      const pos = (t, S) => (tri(fr(t, S.rl.periode * ctx.tempo('lames'), S.rl.off)) * 2 - 1) * (DM - 1);
      return {
        maj(t) { for (const S of sc) { const s = pos(t, S); if (S.rl.axe === 'x') S.sg.position.set(s, 0.35, S.rl.c); else S.sg.position.set(S.rl.c, 0.35, s); S.d.rotation.y = t * 0.03; } },
        danger(t, x, z, r) { const Rs = p.rayon || 0.72; for (const S of sc) { const s = pos(t, S), a = S.rl.axe === 'x' ? x : z, q = S.rl.axe === 'x' ? z : x; if (Math.abs(a - s) < Rs * 0.85 + r && Math.abs(q - S.rl.c) < 0.1 + r) return 'scie'; } return null; },
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
        const f1 = cone(jet, 1.2, 1, M.flamme(), 0, 0, 0.5, 12); f1.rotation.x = -Math.PI / 2;
        const f2 = cone(jet, 0.5, 1, M.flammeCoeur(), 0, 0, 0.5, 10); f2.rotation.x = -Math.PI / 2;
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
            if (av > 0.4 && av < 7.6 && Math.abs(lat) < 0.6 + av * 0.1 + r) return 'brule';
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
      const lb = p.larg || 1.4;
      const fs = p.faisceaux.map(f => {
        const m = boite(g, f.axe === 'x' ? lb : DM * 2, 0.01, f.axe === 'x' ? DM * 2 : lb, mat(0xfff1c2, { basic: true, add: true, op: 0.2 }), 0, 0.03, 0);
        const col = boite(g, f.axe === 'x' ? lb : DM * 2, HT, f.axe === 'x' ? DM * 2 : lb, mat(0xff8a2a, { basic: true, add: true, op: 0.5 }), 0, HT / 2, 0);
        return { f, m, col };
      });
      const pos = (t, F) => -DM + lb / 2 + ((t / 1000 * F.f.vitesse * 10 + F.f.dec * 12) % (DM * 2 - lb));
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
        danger(t, x, z, r) { if (etat(t) !== 2) return null; for (const F of fs) { const s = pos(t, F), a = F.f.axe === 'x' ? x : z; if (Math.abs(a - s) < lb / 2 + r * 0.5) return 'brule'; } return null; },
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
            for (let q = 0; q < 20 && n < 40; q++) { const a = q / 20 * TAU * 3, rr = 0.3 + (q % 7) * 0.47; tmp.position.set(e.x + Math.cos(a) * rr, -0.5 + h, e.z + Math.sin(a) * rr); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); pics.setMatrixAt(n++, tmp.matrix); }
          }
          pics.count = n; pics.instanceMatrix.needsUpdate = true; pics.visible = n > 0;
        },
        danger(t, x, z) { for (const e of actifs(t)) { const dt = t - e.t0; if (dt > 640 && dt < 1500 && Math.hypot(x - e.x, z - e.z) < 3.2) return 'pointes'; } return null; },
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
      case 'statue de grue': { // grue de bronze dressée sur une tortue (longévité)
        bloc(tg, 1.0, 0.22, 1.0, M.pierre(), 0, 0.11, 0, 0.04);
        const mb = M.bronze();
        sph(tg, 0.42, mb, 0, 0.36, 0, 32).scale.set(1, 0.4, 1.25);
        const carapace = new THREE.Mesh(geo('carapace', () => new THREE.TorusGeometry(0.42, 0.04, 8, 40)), mb); carapace.rotation.x = Math.PI / 2; carapace.scale.set(1, 1.25, 1); carapace.position.y = 0.33; tg.add(carapace);
        sph(tg, 0.11, mb, 0, 0.34, 0.6, 18).scale.set(1, 0.85, 1.4);
        for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) sph(tg, 0.12, mb, a * 0.36, 0.24, b * 0.36, 14).scale.set(1.2, 0.55, 1);
        for (const s of [-1, 1]) { cyl(tg, 0.018, 0.022, 0.75, 8, mb, s * 0.08, 0.86, 0); cyl(tg, 0.03, 0.03, 0.05, 8, mb, s * 0.08, 0.5, 0.03); }
        const corps = sph(tg, 0.22, mb, 0, 1.38, -0.02, 28); corps.scale.set(0.8, 0.85, 1.5); corps.rotation.x = 0.25;
        for (const s of [-1, 1]) { const aile = sph(tg, 0.22, mb, s * 0.17, 1.42, -0.08, 20); aile.scale.set(0.3, 0.7, 1.6); aile.rotation.x = 0.35; }
        cone(tg, 0.1, 0.35, mb, 0, 1.3, -0.42, 12).rotation.x = -Math.PI / 2 - 0.5;
        const cou = new THREE.Mesh(geo('cou-grue', () => geoTubeVariable([new THREE.Vector3(0, 1.45, 0.24), new THREE.Vector3(0, 1.75, 0.36), new THREE.Vector3(0, 2.05, 0.18), new THREE.Vector3(0, 2.3, 0.26)], t => 0.06 - 0.025 * t, 24, 12).g), mb); tg.add(cou);
        sph(tg, 0.075, mb, 0, 2.33, 0.28, 16);
        cone(tg, 0.028, 0.3, mb, 0, 2.31, 0.48, 10).rotation.x = Math.PI / 2;
        sph(tg, 0.035, mat(0xa3271f, { r: 0.35 }), 0, 2.4, 0.27, 10);
        solide(0.5); break;
      }
      case 'lion gardien': { // lion de pierre (石獅) : crinière bouclée, gueule ouverte, patte sur la boule
        const mS = M.pierre(), mL = mat(0x9a948a, { r: 0.88, map: T.pierre().map, bump: T.pierre().bump, bs: 0.06 });
        bloc(tg, 1.2, 0.26, 1.2, mS, 0, 0.13, 0, 0.04); bloc(tg, 1.04, 0.34, 1.04, mS, 0, 0.43, 0, 0.05);
        bloc(tg, 1.1, 0.06, 1.1, mL, 0, 0.62, 0, 0.02);
        const l = groupe(tg, 0, 0.62, -0.06);
        sph(l, 0.36, mL, 0, 0.3, -0.2, 26).scale.set(1.15, 0.8, 1.05);
        sph(l, 0.33, mL, 0, 0.62, 0.06, 26).scale.set(1.0, 1.15, 0.85);
        for (const s of [-1, 1]) { cyl(l, 0.09, 0.11, 0.58, 14, mL, s * 0.17, 0.29, 0.24); sph(l, 0.12, mL, s * 0.17, 0.04, 0.32, 14).scale.set(1, 0.6, 1.3); sph(l, 0.13, mL, s * 0.3, 0.12, -0.12, 14).scale.set(0.9, 0.7, 1.4); }
        sph(l, 0.17, mL, 0.24, 0.17, 0.52, 20);
        const t = groupe(l, 0, 1.1, 0.14);
        sph(t, 0.3, mL, 0, 0, 0, 30).scale.set(1.05, 0.95, 0.9);
        const tmp = new THREE.Object3D(), boucles = new THREE.InstancedMesh(gSph(0.07, 12), mL, 34); let q = 0;
        for (let i = 0; i < 34; i++) { const a = (i / 17) * Math.PI - Math.PI / 2, rang = i % 2, rr = 0.32 + rang * 0.04; tmp.position.set(Math.sin(a) * rr, Math.cos(a) * rr * 0.95 - 0.02 + rang * 0.02, -0.06 - rang * 0.06); tmp.updateMatrix(); boucles.setMatrixAt(q++, tmp.matrix); }
        t.add(boucles);
        for (const s of [-1, 1]) { sph(t, 0.075, mL, s * 0.11, 0.07, 0.24, 14); sph(t, 0.035, mat(0x2a2620, { r: 0.6 }), s * 0.11, 0.07, 0.31, 8); bloc(t, 0.16, 0.05, 0.06, mL, s * 0.11, 0.16, 0.24, 0.015).rotation.z = s * 0.25; }
        sph(t, 0.08, mL, 0, -0.03, 0.29, 14).scale.set(1.4, 0.8, 1);
        const gueule = sph(t, 0.12, mat(0x2a2620, { r: 0.8 }), 0, -0.16, 0.22, 14); gueule.scale.set(1.3, 0.55, 0.6);
        for (const s of [-1, 1]) cone(t, 0.02, 0.07, mat(0xd8d2c4, { r: 0.7 }), s * 0.08, -0.12, 0.27, 6).rotation.x = Math.PI;
        const queue = sph(l, 0.16, mL, 0, 0.62, -0.5, 14); queue.scale.set(1.3, 1, 0.5);
        solide(0.62); break;
      }
      case 'dragon peint': { const fg = groupe(g); fg.rotation.y = ANGLE_FACE(tr.mur); const dx = (tr.var - 0.5) * 3; bloc(fg, 4.42, 2.32, 0.05, mat(0x1a0e0a, { r: 0.35, m: 0.05 }), dx, 5.75, -DM + EP / 2 + 0.025, 0.015); boite(fg, 4.3, 2.2, 0.01, mat(0xffffff, { map: texDragonPeint(pal.acc), r: 0.4, m: 0.05 }), dx, 5.75, -DM + EP / 2 + 0.055); break; }
      case 'fissure': { const d = new THREE.Mesh(geo('pl3', () => new THREE.PlaneGeometry(3, 3)), new THREE.MeshBasicMaterial({ map: texTache('fiss' + Math.floor(tr.var * 4), x2 => { x2.strokeStyle = 'rgba(0,0,0,0.8)'; x2.lineWidth = 2.5; x2.beginPath(); let px = 10, py = 64; x2.moveTo(px, py); for (let k = 0; k < 9; k++) { px += 13; py += (Math.random() - 0.5) * 30; x2.lineTo(px, py); } x2.stroke(); }), transparent: true, depthWrite: false })); d.rotation.x = -Math.PI / 2; d.rotation.z = tr.var * 6; d.position.set(x * 0.6, 0.011, z * 0.6); g.add(d); break; }
      case 'bannière déchirée': { // étendard en lambeaux sur sa hampe, dans le coin
        const k = C.h32(spec.id, 33) % 4;
        cyl(tg, 0.04, 0.05, 5.2, 12, M.bois(), 0, 2.6, 0); cone(tg, 0.05, 0.3, M.acier(), 0, 5.35, 0, 8);
        const tr2 = cyl(tg, 0.025, 0.025, 1.3, 10, M.bois(), 0.62, 4.7, 0); tr2.rotation.z = Math.PI / 2;
        const d = new THREE.Mesh(geoDrap(1.15, 3.1, 2.2, 0.08), matTissu(texEtendard(k, ROYAUMES[k].generaux[Math.floor(tr.var * 4)], true))); d.position.set(0.62, 3.1, 0.03); tg.add(d);
        boite(tg, 0.5, 0.06, 0.5, M.pierre(), 0, 0.03, 0); solide(0.3); break;
      }
      case 'gong': { boite(tg, 0.1, 2.4, 0.1, M.bois(), -0.9, 1.2, 0); boite(tg, 0.1, 2.4, 0.1, M.bois(), 0.9, 1.2, 0); boite(tg, 2.0, 0.12, 0.12, M.bois(), 0, 2.4, 0); cyl(tg, 0.75, 0.75, 0.06, 40, M.bronze(), 0, 1.4, 0).rotation.x = Math.PI / 2; const bos = sph(tg, 0.18, M.or(), 0, 1.4, 0.03, 16); bos.scale.set(1, 1, 0.4); for (const s of [-1, 1]) sph(tg, 0.09, M.or(), s * 0.9, 2.48, 0, 12); solide(0.5); interactifs.push({ type: 'trait', nom: tr.nom, x, z, r: 1.6 }); break; }
      case 'brasero éteint': { // tripode de bronze (鼎) plein de cendres froides
        const mb = M.bronze(), ch = new THREE.Mesh(geoChaudron(), mb); ch.position.y = 0.55; tg.add(ch);
        for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5, lx = Math.cos(a) * 0.32, lz = Math.sin(a) * 0.32; const p = cyl(tg, 0.05, 0.07, 0.6, 12, mb, lx, 0.32, lz); p.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); sph(tg, 0.085, mb, lx * 1.12, 0.05, lz * 1.12, 12).scale.set(1, 0.6, 1); }
        for (const s of [-1, 1]) { boite(tg, 0.05, 0.3, 0.05, mb, s * 0.45, 1.25, -0.09); boite(tg, 0.05, 0.3, 0.05, mb, s * 0.45, 1.25, 0.09); boite(tg, 0.05, 0.05, 0.23, mb, s * 0.45, 1.4, 0); }
        const bande = new THREE.Mesh(geo('ding-bande', () => new THREE.TorusGeometry(0.5, 0.025, 8, 48)), mb); bande.rotation.x = Math.PI / 2; bande.position.y = 0.95; tg.add(bande);
        cyl(tg, 0.43, 0.43, 0.02, 32, mat(0x2a2622, { r: 1 }), 0, 1.0, 0);
        for (let i = 0; i < 9; i++) { const c = bloc(tg, 0.09, 0.05, 0.07, mat(0x141210, { r: 0.95 }), Math.cos(i * 2.4) * 0.25 * (i % 3) / 2, 1.025, Math.sin(i * 2.4) * 0.25 * (i % 3) / 2, 0.015); c.rotation.y = i; }
        solide(0.55); break;
      }
      case 'colonne brisée': cyl(tg, 0.5, 0.55, 2.0, 28, M.pierre(), 0, 1.0, 0); { const c = cyl(g, 0.45, 0.5, 1.6, 28, M.pierre(), x * 0.75, 0.45, z * 0.75); c.rotation.z = Math.PI / 2; c.rotation.y = tr.var * 3; } solide(0.55); break;
      case 'inscription murale': { const fg = groupe(g); fg.rotation.y = ANGLE_FACE(tr.mur); const a = xInscription(tr); boite(fg, 1.6, 2.4, 0.03, mat(0x1a1410, { map: texGlyphe(spec.glyphe + 20 + tr.coin, '#c9a24a') }), a, 3.0, -DM + EP / 2 + 0.02); interactifs.push({ type: 'trait', nom: tr.nom, ...(() => { const [lx, lz] = localDepuisFace(tr.mur, a, 0.9); return { x: lx, z: lz }; })(), r: 1.6 }); break; }
      case 'grand vase': { // vase de porcelaine bleu et blanc sur un socle de bois
        const v = new THREE.Mesh(geoVase(), matPorcelaine()); v.position.y = 0.16; tg.add(v);
        cyl(tg, 0.34, 0.3, 0.16, 32, mat(0x2a1810, { r: 0.45, map: T.bois().map, bump: T.bois().bump, bs: 0.01 }), 0, 0.08, 0);
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; sph(tg, 0.05, mat(0x2a1810, { r: 0.45 }), Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3, 10); }
        solide(0.45); break;
      }
      case 'miroir de bronze': cyl(tg, 0.6, 0.6, 0.08, 40, mat(0xc9a24a, { r: 0.1, m: 1 }), 0, 1.8, 0).rotation.x = Math.PI / 2; { const r0 = new THREE.Mesh(geo('miroir-bord', () => new THREE.TorusGeometry(0.6, 0.05, 10, 48)), M.bronze()); r0.position.set(0, 1.8, 0); tg.add(r0); } boite(tg, 0.12, 1.2, 0.12, M.bois(), 0, 0.6, 0); boite(tg, 0.8, 0.12, 0.5, M.bois(), 0, 0.06, 0); solide(0.4); interactifs.push({ type: 'trait', nom: tr.nom, x, z, r: 1.5 }); break;
      case 'cloche': { // cloche de temple à bossettes, pendue à sa chaîne
        cyl(tg, 0.02, 0.02, 1.4, 6, M.fer(), 0, HT - 0.7, 0);
        const cg = groupe(tg, 0, HT - 2.6, 0); cg.scale.setScalar(1.25);
        const mb = M.bronze(); const cl = new THREE.Mesh(geoCloche(), mb); cg.add(cl);
        const anse = new THREE.Mesh(geo('anse-cloche', () => new THREE.TorusGeometry(0.1, 0.03, 8, 20)), mb); anse.position.y = 1.08; cg.add(anse);
        for (const y of [0.3, 0.62]) { const b = new THREE.Mesh(geo('cl-bande' + y, () => new THREE.TorusGeometry(y < 0.5 ? 0.385 : 0.355, 0.016, 6, 48)), mb); b.rotation.x = Math.PI / 2; b.position.y = y; cg.add(b); }
        const tmp = new THREE.Object3D(), bos = new THREE.InstancedMesh(gSph(0.026, 8), mb, 36); let q = 0;
        for (let p = 0; p < 4; p++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const a = p / 4 * TAU + (j - 1) * 0.16, y = 0.72 + i * 0.08, rr = 0.345 - i * 0.012; tmp.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr); tmp.updateMatrix(); bos.setMatrixAt(q++, tmp.matrix); }
        cg.add(bos); break;
      }
      case 'tablette d’ancêtres': boite(tg, 1.6, 1.0, 0.6, M.bois(), 0, 0.5, 0); for (let i = 0; i < 4; i++) { bloc(tg, 0.22, 0.6 + (i % 2) * 0.2, 0.06, mat(0x1a1410, { r: 0.5 }), -0.5 + i * 0.33, 1.35 + (i % 2) * 0.1, 0, 0.02); boite(tg, 0.06, 0.4, 0.005, M.or(), -0.5 + i * 0.33, 1.35 + (i % 2) * 0.1, 0.034); } solide(0.6); interactifs.push({ type: 'trait', nom: tr.nom, x, z, r: 1.6 }); break;
      case 'paravent': { // paravent à quatre feuilles laquées, peintes de paysages
        const mc = mat(0x1a0e0a, { r: 0.3, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 });
        for (let i = 0; i < 4; i++) {
          const pg = groupe(tg, -1.05 + i * 0.7, 0, (i % 2) * 0.22); pg.rotation.y = (i % 2 ? -1 : 1) * 0.35;
          boite(pg, 0.62, 1.82, 0.02, mat(0xffffff, { r: 0.85, map: texPaysage(10 + i + Math.floor(tr.var * 4) * 4, 160, 470, true) }), 0, 1.12, 0);
          for (const [w2, h2, dx, dy] of [[0.7, 0.05, 0, 2.06], [0.7, 0.05, 0, 0.19], [0.04, 1.92, -0.33, 1.12], [0.04, 1.92, 0.33, 1.12]]) bloc(pg, w2, h2, 0.05, mc, dx, dy, 0, 0.01);
          for (const s of [-1, 1]) bloc(pg, 0.08, 0.17, 0.12, mc, s * 0.3, 0.085, 0, 0.01);
        }
        break;
      }
      case 'arbre de bronze': cyl(tg, 0.12, 0.2, 2.4, 16, M.bronze(), 0, 1.2, 0); for (let i = 0; i < 6; i++) { const b = cyl(tg, 0.03, 0.06, 1.0, 10, M.bronze(), Math.cos(i) * 0.3, 1.8 + i * 0.12, Math.sin(i) * 0.3); b.rotation.z = Math.cos(i * 1.7) * 0.9; b.rotation.x = Math.sin(i * 1.7) * 0.9; sph(tg, 0.08, M.jade(), Math.cos(i) * 0.65, 2.1 + i * 0.12, Math.sin(i) * 0.65, 14); } solide(0.35); break;
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
  // DÉCOR DES TROIS ROYAUMES : étendards, rouleaux, peintures, carte, trophées, fenêtres, plaques.
  // Tout est accroché au-dessus de 2,3 m : les fentes, buses et trous des pièges muraux (sous 1,6 m)
  // restent visibles. Chaque salle appartient à un royaume (couleur de ses étendards).
  // =====================================================================
  const ROYAUMES = [
    { car: '魏', fond: 0x1d3566, bord: 0xd9dde6, generaux: ['曹操', '夏侯惇', '張遼', '司馬懿'] },
    { car: '蜀', fond: 0x245a33, bord: 0xd8b25a, generaux: ['劉備', '關羽', '張飛', '趙雲'] },
    { car: '吳', fond: 0x8e1d17, bord: 0xd8b25a, generaux: ['孫權', '周瑜', '呂蒙', '陸遜'] },
    { car: '漢', fond: 0xa87a1c, bord: 0x6a120e, generaux: ['呂布', '董卓', '袁紹', '馬騰'] },
  ];
  const LIEUX = ['忠義堂', '聚義廳', '天下三分', '臥龍崗', '長坂坡', '赤壁', '銅雀臺', '白帝城', '五丈原', '虎牢關', '定軍山', '華容道', '桃園', '街亭', '漢中', '荊州'];
  const MAXIMES = ['忠義', '天命', '仁義禮智', '兵者詭道', '三顧茅廬', '桃園結義', '義薄雲天', '臥龍', '知彼知己', '鞠躬盡瘁', '赤壁', '天下歸心'];
  const zMur = -DM + EP / 2;
  const ech = n => Math.round(n * (QUALITE === 'basse' ? 0.5 : QUALITE === 'normale' ? 0.75 : 1));
  const cssCoul = (c, a) => { const [r, g, b] = rgb(c); return a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`; };

  /** Caractère au pinceau : encre qui bave un peu, trait sec par endroits. */
  function pinceau(x, txt, cx, cy, taille, couleur, sec) {
    x.save();
    x.font = '700 ' + taille + 'px ' + POLICE_CN; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = couleur;
    x.filter = 'blur(' + Math.max(0.6, taille * 0.014).toFixed(1) + 'px)'; x.globalAlpha = 0.5; x.fillText(txt, cx + taille * 0.012, cy + taille * 0.01);
    x.filter = 'none'; x.globalAlpha = 0.96; x.fillText(txt, cx, cy);
    if (sec) { // brosse sèche : filaments clairs dans les traits
      x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 0.35;
      for (let i = 0; i < taille * 0.5; i++) { const yy = cy - taille / 2 + Math.random() * taille; x.fillRect(cx - taille / 2 + Math.random() * taille * 0.3, yy, taille * (0.2 + Math.random() * 0.5), Math.max(1, taille * 0.008)); }
    }
    x.restore();
  }
  /** Fibres et rousseurs d'un papier ou d'une soie ancienne. */
  function vieillir(x, x0, y0, w, h, force) {
    for (let i = 0; i < w * h / 900 * force; i++) { x.strokeStyle = `rgba(${Math.random() < 0.5 ? '90,70,40' : '255,250,235'},${0.04 + Math.random() * 0.06})`; x.lineWidth = 0.6 + Math.random(); const a = x0 + Math.random() * w, b = y0 + Math.random() * h; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (Math.random() - 0.5) * 18, b + (Math.random() - 0.5) * 6); x.stroke(); }
    for (let i = 0; i < 6 * force; i++) { const a = x0 + Math.random() * w, b = y0 + Math.random() * h, r = 6 + Math.random() * w * 0.08, g = x.createRadialGradient(a, b, 0, a, b, r); g.addColorStop(0, 'rgba(120,80,30,0.12)'); g.addColorStop(1, 'rgba(120,80,30,0)'); x.fillStyle = g; x.fillRect(a - r, b - r, r * 2, r * 2); }
    const g = x.createRadialGradient(x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.3, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(60,40,15,0)'); g.addColorStop(1, `rgba(60,40,15,${0.28 * force})`); x.fillStyle = g; x.fillRect(x0, y0, w, h);
  }
  function cachetRouge(x, cx, cy, s, txt, plein) {
    x.save(); x.fillStyle = '#b3261c'; x.strokeStyle = '#b3261c'; x.lineWidth = s * 0.08;
    if (plein) x.fillRect(cx - s / 2, cy - s / 2, s, s); else x.strokeRect(cx - s / 2, cy - s / 2, s, s);
    x.font = '700 ' + (s * 0.42) + 'px ' + POLICE_CN; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = plein ? '#f3e6d0' : '#b3261c';
    const c = [...txt]; c.slice(0, 4).forEach((ch, i) => x.fillText(ch, cx + (i < 2 ? s * 0.22 : -s * 0.22), cy + (i % 2 ? s * 0.22 : -s * 0.22)));
    x.restore();
  }

  // ---------- étendard (牙旗) : soie à la couleur du royaume, bas en dents de flamme ----------
  const texEtendard = (k, nom, dechire) => toile('etendard' + k + nom + (dechire ? 'd' : '') + QUALITE, ech(256), ech(768), (x, w, h) => {
    const R = ROYAUMES[k], hd = h * 0.12, dents = 4;
    x.clearRect(0, 0, w, h);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h - hd);
    for (let i = 1; i <= dents * 2; i++) x.lineTo(w - i * w / (dents * 2), i % 2 ? h - 3 : h - hd);
    x.closePath(); x.save(); x.clip();
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, cssCoul(teinte(R.fond, 0.12))); g.addColorStop(1, cssCoul(teinte(R.fond, -0.3)));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < h; i += 2) { x.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.04})`; x.fillRect(0, i, w, 1); } // trame de la soie
    const b = w * 0.075; x.fillStyle = cssCoul(R.bord); x.fillRect(0, 0, b, h); x.fillRect(w - b, 0, b, h); x.fillRect(0, 0, w, b * 1.3);
    x.fillStyle = cssCoul(R.fond); for (let y = b * 2; y < h - hd; y += b * 1.6) { x.save(); x.translate(b / 2, y); x.rotate(Math.PI / 4); x.fillRect(-b * 0.22, -b * 0.22, b * 0.44, b * 0.44); x.restore(); x.save(); x.translate(w - b / 2, y); x.rotate(Math.PI / 4); x.fillRect(-b * 0.22, -b * 0.22, b * 0.44, b * 0.44); x.restore(); }
    // disque central et caractère du royaume
    const cx = w / 2, cy = h * 0.3, r = w * 0.36;
    x.fillStyle = '#efe6d2'; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    x.strokeStyle = cssCoul(R.bord); x.lineWidth = w * 0.025; x.beginPath(); x.arc(cx, cy, r * 0.92, 0, TAU); x.stroke();
    pinceau(x, R.car, cx, cy + w * 0.01, w * 0.5, '#15100c', false);
    // nom du général, en colonne
    [...nom].forEach((ch, i) => pinceau(x, ch, cx, h * 0.52 + i * w * 0.27, w * 0.24, cssCoul(R.bord), false));
    // plis : bandes d'ombre verticales
    for (let i = 0; i < 5; i++) { const xx = w * (0.1 + 0.2 * i + Math.random() * 0.08), gg = x.createLinearGradient(xx - w * 0.06, 0, xx + w * 0.06, 0); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.5, 'rgba(0,0,0,0.22)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gg; x.fillRect(xx - w * 0.06, 0, w * 0.12, h); }
    x.restore();
    if (dechire) { // accrocs et brûlures
      x.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 7; i++) { const a = Math.random() * w, c = h * (0.35 + Math.random() * 0.6), r2 = w * (0.04 + Math.random() * 0.12); x.beginPath(); for (let q = 0; q < 9; q++) { const an = q / 9 * TAU, rr = r2 * (0.5 + Math.random() * 0.7); x.lineTo(a + Math.cos(an) * rr, c + Math.sin(an) * rr); } x.fill(); }
      x.globalCompositeOperation = 'source-atop'; x.strokeStyle = 'rgba(20,10,5,0.7)'; x.lineWidth = 3; x.strokeRect(0, 0, w, h);
      x.globalCompositeOperation = 'source-over';
    }
  });
  const cTissu = new Map();
  function matTissu(tex, o) {
    o = o || {};
    const k = tex.uuid + '|' + (o.e || 0);
    let m = cTissu.get(k);
    if (!m) { m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: o.r != null ? o.r : 0.82, metalness: 0, emissive: new THREE.Color(o.e || 0), emissiveMap: o.e ? tex : null, emissiveIntensity: o.ei || 0 }); cTissu.set(k, m); }
    return m;
  }
  /** Tissu suspendu : plis verticaux, le bas s'écarte un peu du mur. */
  const geoDrap = (L, H, plis, ecart) => geo('drap' + [L, H, plis, ecart].join(','), () => {
    const g = new THREE.PlaneGeometry(L, H, 14, 26), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), t = (H / 2 - p.getY(i)) / H; p.setZ(i, Math.sin(x / L * TAU * plis + 0.8) * 0.04 * (0.3 + t) + t * t * ecart); }
    g.computeVertexNormals(); return g;
  });
  function etendard(fg, x, yHaut, k, nom, dechire) {
    const L = 1.15, H = 3.3, z = zMur + 0.16;
    const d = new THREE.Mesh(geoDrap(L, H, 2.5, 0.14), matTissu(texEtendard(k, nom, dechire))); d.position.set(x, yHaut - H / 2 - 0.05, z); fg.add(d);
    const hampe = cyl(fg, 0.032, 0.032, L + 0.36, 14, M.bois(), x, yHaut, z); hampe.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      sph(fg, 0.055, M.or(), x + s * (L / 2 + 0.2), yHaut, z, 12);
      cone(fg, 0.035, 0.16, M.or(), x + s * (L / 2 + 0.31), yHaut, z, 10).rotation.z = -s * Math.PI / 2;
      boite(fg, 0.05, 0.05, 0.16, M.bronze(), x + s * (L / 2 + 0.05), yHaut, zMur + 0.08);
      // cordon et gland rouges
      cyl(fg, 0.008, 0.008, 0.5, 5, mat(0x9a1a12, { r: 0.9 }), x + s * (L / 2 + 0.12), yHaut - 0.25, z + 0.02);
      cone(fg, 0.045, 0.22, mat(0xa3271f, { r: 0.95 }), x + s * (L / 2 + 0.12), yHaut - 0.58, z + 0.02, 10).rotation.x = Math.PI;
    }
  }

  // ---------- rouleaux suspendus (掛軸) : calligraphie ou paysage à l'encre ----------
  function montage(x, w, h, coul) { // brocart du montage + deux bandes « hirondelles » en haut
    x.fillStyle = coul; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,240,200,0.10)'; for (let yy = 6; yy < h; yy += 14) for (let xx = (yy / 14 % 2) * 7; xx < w; xx += 14) { x.beginPath(); x.arc(xx, yy, 2.2, 0, TAU); x.fill(); }
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(w * 0.3, 0, w * 0.05, h * 0.16); x.fillRect(w * 0.65, 0, w * 0.05, h * 0.16);
  }
  const texCalligraphie = (texte, v) => toile('kakejiku' + texte + v + QUALITE, ech(256), ech(768), (x, w, h) => {
    montage(x, w, h, ['#3d4a52', '#5a4a32', '#40503e', '#5b3a34'][v % 4]);
    const px = w * 0.12, py = h * 0.16, pw = w * 0.76, ph = h * 0.74;
    x.fillStyle = '#e9dfc6'; x.fillRect(px, py, pw, ph); vieillir(x, px, py, pw, ph, 1);
    const ch = [...texte], t = Math.min(pw * 0.78, ph * 0.86 / ch.length);
    ch.forEach((c, i) => pinceau(x, c, px + pw * 0.55, py + ph * 0.07 + t * (i + 0.5), t * 0.95, '#141110', true));
    // signature et cachets
    ['臥', '龍', '書'].forEach((c, i) => pinceau(x, c, px + pw * 0.16, py + ph * 0.62 + i * pw * 0.13, pw * 0.11, '#2a2420', false));
    cachetRouge(x, px + pw * 0.16, py + ph * 0.86, pw * 0.15, '諸葛', true); cachetRouge(x, px + pw * 0.16, py + ph * 0.95, pw * 0.13, '孔明', false);
  });
  /** Paysage de montagnes à l'encre (山水) : plans successifs dans la brume, pins, pavillon, barque. */
  function peindrePaysage(x, x0, y0, w, h, graine) {
    const r = C.alea(graine);
    x.save(); x.beginPath(); x.rect(x0, y0, w, h); x.clip();
    x.fillStyle = '#e8dec4'; x.fillRect(x0, y0, w, h);
    if (r() < 0.5) { x.fillStyle = 'rgba(190,60,40,0.55)'; x.beginPath(); x.arc(x0 + w * (0.2 + r() * 0.5), y0 + h * 0.12, w * 0.06, 0, TAU); x.fill(); }
    const plans = 5;
    for (let L = 0; L < plans; L++) {
      const base = y0 + h * (0.28 + L * 0.15), amp = h * (0.16 - L * 0.012), pics = [];
      for (let i = 0; i < 3; i++) pics.push([x0 + w * r(), amp * (0.5 + r() * 0.6), w * (0.12 + r() * 0.2)]);
      const haut = xx => { let v = 0; for (const [c, a, s] of pics) v = Math.max(v, a * Math.exp(-((xx - c) * (xx - c)) / (2 * s * s))); return v + amp * 0.12 * Math.sin(xx * 0.05 + L) + amp * 0.05 * Math.sin(xx * 0.23 + L * 3); };
      const encre = 0.18 + L * 0.16;
      x.beginPath(); x.moveTo(x0, base + h * 0.2);
      for (let xx = x0; xx <= x0 + w; xx += 3) x.lineTo(xx, base - haut(xx));
      x.lineTo(x0 + w, base + h * 0.2); x.closePath();
      const g = x.createLinearGradient(0, base - amp, 0, base + h * 0.12); g.addColorStop(0, `rgba(25,22,20,${encre})`); g.addColorStop(0.55, `rgba(25,22,20,${encre * 0.45})`); g.addColorStop(1, 'rgba(25,22,20,0)');
      x.fillStyle = g; x.fill();
      // rides de texture (皴) le long des crêtes
      x.strokeStyle = `rgba(20,18,16,${0.12 + L * 0.08})`; x.lineWidth = 1;
      for (let i = 0; i < 40; i++) { const xx = x0 + r() * w, yy = base - haut(xx); x.beginPath(); x.moveTo(xx, yy + 2); x.lineTo(xx + (r() - 0.5) * 8, yy + 10 + r() * h * 0.05); x.stroke(); }
      // brume entre deux plans
      const gm = x.createLinearGradient(0, base - h * 0.02, 0, base + h * 0.08); gm.addColorStop(0, 'rgba(232,222,196,0)'); gm.addColorStop(0.5, 'rgba(232,222,196,0.75)'); gm.addColorStop(1, 'rgba(232,222,196,0)');
      x.fillStyle = gm; x.fillRect(x0, base - h * 0.02, w, h * 0.1);
      if (L === plans - 2) for (let i = 0; i < 3; i++) { // pins sur le plan proche
        const tx = x0 + w * (0.15 + r() * 0.7), ty = base - haut(tx) + 4, th = h * (0.08 + r() * 0.05);
        x.strokeStyle = 'rgba(25,20,18,0.85)'; x.lineWidth = 2; x.beginPath(); x.moveTo(tx, ty); x.quadraticCurveTo(tx + (r() - 0.5) * 10, ty - th / 2, tx + (r() - 0.5) * 6, ty - th); x.stroke();
        x.fillStyle = 'rgba(25,30,25,0.8)'; for (let q = 0; q < 5; q++) { x.beginPath(); x.ellipse(tx + (r() - 0.5) * th * 0.5, ty - th * (0.4 + q * 0.13), th * (0.28 - q * 0.04), th * 0.06, (r() - 0.5) * 0.4, 0, TAU); x.fill(); }
      }
      if (L === 2 && r() < 0.8) { // petit pavillon sur une crête
        const tx = pics[0][0], ty = base - haut(tx), s = w * 0.035;
        x.fillStyle = 'rgba(20,16,14,0.8)'; x.fillRect(tx - s * 0.6, ty - s * 0.9, s * 1.2, s * 0.8);
        x.beginPath(); x.moveTo(tx - s * 1.2, ty - s * 0.85); x.quadraticCurveTo(tx, ty - s * 1.5, tx + s * 1.2, ty - s * 0.85); x.lineTo(tx, ty - s * 1.25); x.fill();
      }
    }
    // eau et barque
    x.strokeStyle = 'rgba(30,28,26,0.25)'; x.lineWidth = 1; for (let i = 0; i < 8; i++) { const yy = y0 + h * (0.9 + r() * 0.08), xx = x0 + r() * w; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + w * 0.12, yy); x.stroke(); }
    { const bx = x0 + w * (0.3 + r() * 0.4), by = y0 + h * 0.93, s = w * 0.05; x.fillStyle = 'rgba(20,16,14,0.85)'; x.beginPath(); x.moveTo(bx - s, by); x.quadraticCurveTo(bx, by + s * 0.5, bx + s, by); x.closePath(); x.fill(); x.fillRect(bx - s * 0.1, by - s * 0.5, s * 0.15, s * 0.5); }
    x.restore();
  }
  const texPaysage = (v, l, h0, nu) => toile('shanshui' + v + l + 'x' + h0 + (nu ? 'n' : '') + QUALITE, ech(l), ech(h0), (x, w, h) => {
    if (h > w && !nu) {
      montage(x, w, h, ['#3d4a52', '#5a4a32', '#40503e', '#4b3d48'][v % 4]);
      const px = w * 0.12, py = h * 0.16, pw = w * 0.76, ph = h * 0.74;
      peindrePaysage(x, px, py, pw, ph, 5000 + v); vieillir(x, px, py, pw, ph, 0.8);
      ['青', '山', '依', '舊', '在'].forEach((c, i) => pinceau(x, c, px + pw * 0.86, py + ph * 0.06 + i * pw * 0.11, pw * 0.09, '#201a16', false));
      cachetRouge(x, px + pw * 0.86, py + ph * 0.06 + 5.4 * pw * 0.11, pw * 0.1, '山人', true);
    } else { peindrePaysage(x, 0, 0, w, h, 5000 + v); vieillir(x, 0, 0, w, h, 0.6); }
  });
  /** Rouleau vertical : tissu peint, baguette du haut, rouleau du bas à embouts, cordon et clou. */
  function rouleau(fg, x, yHaut, tex) {
    const L = 0.9, H = 2.7, z = zMur + 0.035;
    const p = new THREE.Mesh(geoDrap(L, H, 1.2, 0.02), matTissu(tex, { r: 0.9 })); p.position.set(x, yHaut - H / 2, z); fg.add(p);
    const b = cyl(fg, 0.022, 0.022, L + 0.04, 10, M.bois(), x, yHaut, z + 0.01); b.rotation.z = Math.PI / 2;
    const r2 = cyl(fg, 0.045, 0.045, L + 0.06, 16, M.bois(), x, yHaut - H, z + 0.05); r2.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) { const e = cyl(fg, 0.05, 0.04, 0.09, 14, mat(0x2a1a10, { r: 0.4, m: 0.2 }), x + s * (L / 2 + 0.07), yHaut - H, z + 0.05); e.rotation.z = Math.PI / 2; }
    for (const s of [-1, 1]) { const c = cyl(fg, 0.006, 0.006, 0.42, 4, mat(0x3a2a1a, { r: 0.9 }), x + s * 0.19, yHaut + 0.17, z + 0.01); c.rotation.z = s * 1.05; }
    sph(fg, 0.025, M.bronze(), x, yHaut + 0.36, zMur + 0.01, 8);
  }

  // ---------- carte du partage de l'empire (天下三分之圖) ----------
  const texCarte = () => toile('carte3r' + QUALITE, ech(1024), ech(640), (x, w, h) => {
    const S = w / 1024; x.save(); x.scale(S, S); const W = 1024, H = 640;
    x.fillStyle = '#dccba2'; x.fillRect(0, 0, W, H); vieillir(x, 0, 0, W, H, 1.6);
    // mer de l'Est
    x.fillStyle = 'rgba(70,90,95,0.25)'; x.beginPath(); x.moveTo(1024, 0); x.lineTo(900, 0); x.bezierCurveTo(950, 160, 880, 260, 930, 330); x.bezierCurveTo(960, 420, 870, 520, 900, 640); x.lineTo(1024, 640); x.fill();
    for (let i = 0; i < 30; i++) { x.strokeStyle = 'rgba(40,60,70,0.35)'; x.lineWidth = 1.2; const yy = 20 + i * 21, xx = 960 + (i % 3) * 18; x.beginPath(); x.arc(xx, yy, 7, Math.PI, TAU); x.stroke(); }
    // royaumes teintés et frontières
    const zone = (pts, col) => { x.fillStyle = col; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fill(); };
    zone([[60, 40], [900, 20], [930, 330], [700, 380], [520, 390], [360, 330], [250, 300], [60, 280]], 'rgba(40,70,140,0.16)');
    zone([[60, 280], [250, 300], [360, 330], [430, 420], [400, 620], [60, 620]], 'rgba(40,120,60,0.16)');
    zone([[360, 330], [520, 390], [700, 380], [930, 330], [900, 640], [400, 620], [430, 420]], 'rgba(160,40,30,0.16)');
    x.setLineDash([10, 7]); x.strokeStyle = 'rgba(120,20,15,0.7)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(60, 280); x.lineTo(250, 300); x.lineTo(360, 330); x.lineTo(520, 390); x.lineTo(700, 380); x.lineTo(930, 330); x.stroke();
    x.beginPath(); x.moveTo(360, 330); x.lineTo(430, 420); x.lineTo(400, 620); x.stroke(); x.setLineDash([]);
    // fleuve Jaune et fleuve Bleu
    const fleuve = (pts, l) => { x.strokeStyle = 'rgba(40,70,90,0.75)'; x.lineWidth = l; x.lineCap = 'round'; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i += 2) x.quadraticCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); x.stroke(); };
    fleuve([[80, 250], [200, 120], [330, 90], [430, 40], [470, 130], [500, 230], [620, 220], [760, 200], [930, 240]], 5);
    fleuve([[70, 470], [200, 430], [330, 470], [420, 500], [520, 450], [600, 470], [700, 440], [820, 420], [920, 430]], 6);
    // montagnes
    x.strokeStyle = 'rgba(60,45,30,0.7)'; x.lineWidth = 2;
    for (const [mx, my, n] of [[150, 350, 6], [250, 540, 5], [560, 130, 4], [330, 230, 4], [640, 560, 5], [180, 80, 4]]) for (let i = 0; i < n; i++) { const a = mx + i * 26 + (i % 2) * 8, b = my + (i % 2) * 12; x.beginPath(); x.moveTo(a - 14, b + 12); x.lineTo(a, b - 12); x.lineTo(a + 14, b + 12); x.stroke(); x.beginPath(); x.moveTo(a - 4, b - 2); x.lineTo(a + 4, b + 10); x.stroke(); }
    // villes
    const ville = (a, b, nom, rouge) => { x.fillStyle = rouge ? '#a3271f' : '#2a2018'; x.beginPath(); x.arc(a, b, 7, 0, TAU); x.fill(); x.font = '700 22px ' + POLICE_CN; x.fillStyle = '#2a2018'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(nom, a + 12, b); };
    ville(560, 210, '洛陽', true); ville(640, 260, '許昌'); ville(330, 170, '長安'); ville(170, 500, '成都', true); ville(770, 460, '建業', true); ville(510, 405, '荊州'); ville(300, 300, '漢中'); ville(720, 120, '鄴');
    // Chibi : sabres croisés
    x.strokeStyle = '#a3271f'; x.lineWidth = 4; x.beginPath(); x.moveTo(565, 440); x.lineTo(595, 470); x.moveTo(595, 440); x.lineTo(565, 470); x.stroke(); x.font = '700 22px ' + POLICE_CN; x.fillStyle = '#a3271f'; x.fillText('赤壁', 600, 455);
    // grands caractères des royaumes, rose des vents, titre
    pinceau(x, '魏', 470, 300, 120, 'rgba(25,40,90,0.75)'); pinceau(x, '蜀', 200, 400, 110, 'rgba(20,70,35,0.75)'); pinceau(x, '吳', 680, 540, 110, 'rgba(110,25,18,0.75)');
    x.strokeStyle = '#2a2018'; x.lineWidth = 2; x.beginPath(); x.arc(90, 560, 40, 0, TAU); x.stroke(); x.beginPath(); x.moveTo(90, 520); x.lineTo(80, 560); x.lineTo(100, 560); x.closePath(); x.fillStyle = '#a3271f'; x.fill(); pinceau(x, '北', 90, 500, 26, '#2a2018');
    [...'天下三分之圖'].forEach((c, i) => pinceau(x, c, 860, 40 + i * 44, 38, '#1c1612'));
    cachetRouge(x, 860, 40 + 6 * 44 + 10, 42, '丞相', true);
    x.strokeStyle = 'rgba(60,40,20,0.8)'; x.lineWidth = 6; x.strokeRect(10, 10, W - 20, H - 20); x.lineWidth = 1.5; x.strokeRect(22, 22, W - 44, H - 44);
    x.restore();
  });
  function carte(fg, x, yC) {
    const L = 2.9, H = 1.81, z = zMur + 0.04;
    const p = new THREE.Mesh(geoDrap(L, H, 1.6, 0.0), matTissu(texCarte(), { r: 0.88 })); p.position.set(x, yC, z); fg.add(p);
    for (const [y, r] of [[yC + H / 2, 0.035], [yC - H / 2, 0.05]]) { const b = cyl(fg, r, r, L + 0.1, 16, M.bois(), x, y, z + 0.02); b.rotation.z = Math.PI / 2; for (const s of [-1, 1]) { const e = cyl(fg, r + 0.012, r + 0.005, 0.07, 14, M.or(), x + s * (L / 2 + 0.08), y, z + 0.02); e.rotation.z = Math.PI / 2; } }
    for (const s of [-1, 1]) { const c = cyl(fg, 0.007, 0.007, 0.9, 4, mat(0x3a2a1a, { r: 0.9 }), x + s * 0.7, yC + H / 2 + 0.24, z + 0.01); c.rotation.z = s * 1.2; }
    sph(fg, 0.03, M.bronze(), x, yC + H / 2 + 0.42, zMur + 0.01, 8);
  }

  // ---------- armes d'hast : hallebarde (戟), guandao (偃月刀), lance-serpent (蛇矛) ----------
  const geoLame = (nom, f, ep) => geo('lame-' + nom, () => {
    const sh = new THREE.Shape(); f(sh);
    const g = new THREE.ExtrudeGeometry(sh, { depth: ep || 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
    g.translate(0, 0, -(ep || 0.012) / 2); g.computeVertexNormals(); return g;
  });
  const mAcierPoli = () => mat(0xd8dde4, { r: 0.18, m: 1 });
  function arme(type, L) {
    const g = new THREE.Group();
    const mh = type === 'guandao' ? mat(0x4a1a12, { r: 0.45, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 }) : M.bois();
    cyl(g, 0.022, 0.024, L, 12, mh, 0, 0, 0);
    cone(g, 0.026, 0.12, M.bronze(), 0, -L / 2 - 0.05, 0, 10).rotation.x = Math.PI; // talon
    const yT = L / 2;
    cyl(g, 0.032, 0.026, 0.1, 12, M.bronze(), 0, yT - 0.02, 0);
    if (type === 'ji') {
      const pointe = new THREE.Mesh(geoLame('ji-pointe', sh => { sh.moveTo(0, 0); sh.quadraticCurveTo(0.075, 0.14, 0, 0.42); sh.quadraticCurveTo(-0.075, 0.14, 0, 0); }), mAcierPoli()); pointe.position.y = yT + 0.03; g.add(pointe);
      const croissant = new THREE.Mesh(geoLame('ji-croissant', sh => { sh.moveTo(0, 0.02); sh.quadraticCurveTo(0.22, 0.04, 0.3, 0.2); sh.quadraticCurveTo(0.2, 0.12, 0.02, 0.12); sh.lineTo(0, 0.02); }), mAcierPoli()); croissant.position.set(0.02, yT - 0.12, 0); g.add(croissant);
      const contre = new THREE.Mesh(geoLame('ji-contre', sh => { sh.moveTo(0, 0.02); sh.lineTo(-0.16, 0.06); sh.lineTo(-0.02, 0.11); }), mAcierPoli()); contre.position.set(-0.01, yT - 0.12, 0); g.add(contre);
    } else if (type === 'guandao') {
      const lame = new THREE.Mesh(geoLame('guandao', sh => { sh.moveTo(-0.03, 0); sh.lineTo(-0.03, 0.62); sh.quadraticCurveTo(0.02, 0.78, 0.16, 0.86); sh.quadraticCurveTo(0.2, 0.5, 0.13, 0.22); sh.lineTo(0.17, 0.16); sh.lineTo(0.1, 0.12); sh.quadraticCurveTo(0.06, 0.02, -0.03, 0); }, 0.016), mAcierPoli()); lame.position.y = yT + 0.02; g.add(lame);
      const garde = new THREE.Mesh(geo('garde-guandao', () => new THREE.TorusGeometry(0.06, 0.016, 8, 20)), M.or()); garde.rotation.x = Math.PI / 2; garde.position.y = yT + 0.02; g.add(garde);
      sph(g, 0.045, M.or(), 0.02, yT + 0.08, 0, 12).scale.set(1.3, 1, 0.8); // tête de dragon stylisée
    } else {
      const lame = new THREE.Mesh(geoLame('shemao', sh => { sh.moveTo(0, 0); const n = 6; for (let i = 0; i <= n; i++) sh.lineTo(0.035 + Math.sin(i * 1.4) * 0.03, i * 0.075); sh.lineTo(0, 0.56); for (let i = n; i >= 0; i--) sh.lineTo(-0.035 + Math.sin(i * 1.4) * 0.03, i * 0.075); }), mAcierPoli()); lame.position.y = yT + 0.02; g.add(lame);
    }
    if (type !== 'guandao') cone(g, 0.06, 0.2, mat(0xa3271f, { r: 0.95 }), 0, yT - 0.15, 0, 10).rotation.x = Math.PI; // pompon rouge
    return g;
  }
  // ---------- bouclier à tête de tigre (虎頭牌) ou aux armes du royaume ----------
  const texBouclier = (k, tigre) => toile('bouclier' + k + (tigre ? 't' : 'r') + QUALITE, ech(512), ech(512), (x, w, h) => {
    const c = w / 2, R = ROYAUMES[k], S = w / 512;
    if (tigre) {
      const g = x.createRadialGradient(c, c * 0.9, 0, c, c, c); g.addColorStop(0, '#e8a83a'); g.addColorStop(1, '#a8601a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1a120c'; for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; x.save(); x.translate(c, c); x.rotate(a); x.beginPath(); x.moveTo(c * 0.55, -8 * S); x.quadraticCurveTo(c * 0.8, 0, c * 0.98, -18 * S); x.lineTo(c * 0.98, 14 * S); x.quadraticCurveTo(c * 0.8, 10 * S, c * 0.55, 8 * S); x.fill(); x.restore(); }
      for (const s of [-1, 1]) { // yeux furieux
        x.fillStyle = '#f2ead6'; x.beginPath(); x.ellipse(c + s * 95 * S, c - 40 * S, 52 * S, 34 * S, s * 0.35, 0, TAU); x.fill();
        x.fillStyle = '#2a7a3a'; x.beginPath(); x.arc(c + s * 90 * S, c - 38 * S, 22 * S, 0, TAU); x.fill(); x.fillStyle = '#000'; x.beginPath(); x.arc(c + s * 90 * S, c - 38 * S, 11 * S, 0, TAU); x.fill();
        x.fillStyle = '#1a120c'; x.beginPath(); x.moveTo(c + s * 40 * S, c - 70 * S); x.lineTo(c + s * 150 * S, c - 105 * S); x.lineTo(c + s * 150 * S, c - 80 * S); x.closePath(); x.fill();
      }
      pinceau(x, '王', c, c - 150 * S, 90 * S, '#1a120c');
      x.fillStyle = '#5a1a10'; x.beginPath(); x.ellipse(c, c + 25 * S, 34 * S, 24 * S, 0, 0, TAU); x.fill(); // museau
      x.fillStyle = '#3a0c08'; x.beginPath(); x.moveTo(c - 130 * S, c + 80 * S); x.quadraticCurveTo(c, c + 210 * S, c + 130 * S, c + 80 * S); x.quadraticCurveTo(c, c + 120 * S, c - 130 * S, c + 80 * S); x.fill();
      x.fillStyle = '#f2ead6'; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(c + s * 80 * S, c + 92 * S); x.lineTo(c + s * 62 * S, c + 160 * S); x.lineTo(c + s * 48 * S, c + 98 * S); x.fill(); }
    } else {
      x.fillStyle = '#16100c'; x.fillRect(0, 0, w, h);
      const g = x.createRadialGradient(c * 0.7, c * 0.6, 0, c, c, c); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.3)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = cssCoul(R.bord); x.lineWidth = 14 * S; x.beginPath(); x.arc(c, c, c * 0.78, 0, TAU); x.stroke(); x.lineWidth = 4 * S; x.beginPath(); x.arc(c, c, c * 0.68, 0, TAU); x.stroke();
      x.fillStyle = cssCoul(R.fond); x.beginPath(); x.arc(c, c, c * 0.6, 0, TAU); x.fill();
      pinceau(x, R.car, c, c + 6 * S, 260 * S, cssCoul(R.bord));
    }
  });
  const geoBouclier = () => geo('bouclier', () => {
    const R2 = 1.25, th = 0.48, g = new THREE.SphereGeometry(R2, 48, 12, 0, TAU, 0, th), p = g.attributes.position, uv = g.attributes.uv, Rc = R2 * Math.sin(th);
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * Rc), 0.5 - p.getZ(i) / (2 * Rc));
    g.rotateX(Math.PI / 2); g.translate(0, 0, -R2 * Math.cos(th)); return g;
  });
  function trophee(fg, x, yC, k, tigre, r) {
    const z = zMur + 0.1, armes = r() < 0.5 ? ['ji', 'guandao'] : ['shemao', 'ji'];
    armes.forEach((t, i) => { const a = arme(t, 2.5); a.position.set(x, yC, zMur + 0.06 + i * 0.03); a.rotation.z = (i ? -1 : 1) * 0.62; fg.add(a); });
    for (const s of [-1, 1]) cyl(fg, 0.025, 0.025, 0.14, 8, M.bronze(), x + s * 0.55, yC - 0.38, zMur + 0.06).rotation.x = Math.PI / 2;
    const b = new THREE.Mesh(geoBouclier(), mat(0xffffff, { r: 0.38, m: 0.1, map: texBouclier(k, tigre) })); b.position.set(x, yC, z); fg.add(b);
    const bord = new THREE.Mesh(geo('bord-bouclier', () => new THREE.TorusGeometry(0.585, 0.035, 10, 48)), M.bronze()); bord.position.set(x, yC, z + 0.01); fg.add(bord);
    const tmp = new THREE.Object3D(), clous = new THREE.InstancedMesh(gSph(0.026, 8), M.or(), 16);
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; tmp.position.set(x + Math.cos(a) * 0.585, yC + Math.sin(a) * 0.585, z + 0.04); tmp.updateMatrix(); clous.setMatrixAt(i, tmp.matrix); }
    fg.add(clous);
  }
  function ratelier(fg, x, yC) {
    const L = 3.0;
    bloc(fg, L + 0.3, 2.0, 0.05, mat(0x2a1a10, { r: 0.55, map: T.bois().map, bump: T.bois().bump, bs: 0.02 }), x, yC, zMur + 0.025, 0.02);
    for (const yy of [yC + 0.88, yC - 0.88]) bloc(fg, L + 0.4, 0.09, 0.08, M.or(), x, yy, zMur + 0.05, 0.015);
    ['guandao', 'ji', 'shemao'].forEach((t, i) => {
      const y = yC + 0.55 - i * 0.55, a = arme(t, 2.7); a.rotation.z = -Math.PI / 2; a.position.set(x, y, zMur + 0.2); fg.add(a);
      for (const s of [-1, 1]) { const p = cyl(fg, 0.022, 0.022, 0.2, 8, M.bronze(), x + s * 0.95, y - 0.05, zMur + 0.12); p.rotation.x = Math.PI / 2; }
    });
  }
  // ---------- fenêtre-lune à claire-voie, papier éclairé par derrière ----------
  function fenetreLune(fg, x, yC) {
    const R = 0.82, z = zMur + 0.03, mb = mat(0x24160e, { r: 0.6, map: T.bois().map, bump: T.bois().bump, bs: 0.01 });
    const papier = new THREE.Mesh(geo('papier-lune', () => new THREE.CircleGeometry(R, 40)), mat(0xf0d8a8, { e: 0xffb050, ei: 0.75, r: 0.95 })); papier.position.set(x, yC, z); fg.add(papier);
    const anneau = new THREE.Mesh(geo('anneau-lune', () => new THREE.TorusGeometry(R + 0.04, 0.08, 12, 56)), mb); anneau.position.set(x, yC, z + 0.03); fg.add(anneau);
    const pas = 0.21, barres = [];
    for (let k = -3; k <= 3; k++) { const o = k * pas, l = 2 * Math.sqrt(Math.max(0, R * R - o * o)); if (l > 0.05) { barres.push([0, o, l, true]); barres.push([o, 0, l, false]); } }
    const tmp = new THREE.Object3D(), inst = new THREE.InstancedMesh(gBoite(1, 0.03, 0.03), mb, barres.length);
    barres.forEach(([bx, by, l, h], i) => { tmp.position.set(x + bx, yC + by, z + 0.02); tmp.rotation.set(0, 0, h ? 0 : Math.PI / 2); tmp.scale.set(l, 1, 1); tmp.updateMatrix(); inst.setMatrixAt(i, tmp.matrix); });
    fg.add(inst);
    // motif « 回 » central
    for (const s of [0.36, 0.2]) for (const [w, h, dx, dy] of [[s * 2, 0.04, 0, s], [s * 2, 0.04, 0, -s], [0.04, s * 2, s, 0], [0.04, s * 2, -s, 0]]) boite(fg, w, h, 0.04, mb, x + dx, yC + dy, z + 0.035);
  }
  // ---------- plaque horizontale au-dessus des portes (匾額), lue de droite à gauche ----------
  const texPlaque = nom => toile('plaque' + nom + QUALITE, ech(512), ech(160), (x, w, h) => {
    x.fillStyle = '#120c08'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 3) { x.fillStyle = `rgba(80,50,30,${Math.random() * 0.12})`; x.fillRect(i, 0, 2, h); }
    x.strokeStyle = '#c9a24a'; x.lineWidth = h * 0.03; x.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
    const ch = [...nom], pasX = (w * 0.86) / ch.length, t = Math.min(h * 0.62, pasX * 0.9);
    ch.forEach((c, i) => {
      const cx = w * 0.93 - pasX * (i + 0.5), cy = h * 0.52;
      x.save(); x.font = '700 ' + t + 'px ' + POLICE_CN; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgba(0,0,0,0.8)'; x.fillText(c, cx + t * 0.03, cy + t * 0.04);
      const g = x.createLinearGradient(0, cy - t / 2, 0, cy + t / 2); g.addColorStop(0, '#f6e2a0'); g.addColorStop(0.5, '#c99a3a'); g.addColorStop(1, '#8a6420');
      x.fillStyle = g; x.fillText(c, cx, cy); x.restore();
    });
  });
  function plaqueLinteau(fg, nom) {
    const L = 2.5, H = 0.78, y = HP + 1.05, z = zMur + 0.09, pg = groupe(fg, 0, y, z); pg.rotation.x = 0.1; // penchée vers l'avant, comme au-dessus des portes de palais
    bloc(pg, L + 0.22, H + 0.22, 0.09, mat(0x6a140e, { r: 0.35, m: 0.05, map: T.laque().map, bump: T.laque().bump, bs: 0.01 }), 0, 0, -0.03, 0.03);
    boite(pg, L, H, 0.01, mat(0xffffff, { r: 0.4, m: 0.2, map: texPlaque(nom) }), 0, 0, 0.022);
    for (const [w, h, dx, dy] of [[L + 0.22, 0.05, 0, H / 2 + 0.085], [L + 0.22, 0.05, 0, -H / 2 - 0.085], [0.05, H + 0.22, L / 2 + 0.085, 0], [0.05, H + 0.22, -L / 2 - 0.085, 0]]) bloc(pg, w, h, 0.03, M.or(), dx, dy, 0.025, 0.01);
    for (const s of [-1, 1]) cyl(fg, 0.012, 0.012, 0.3, 4, M.fer(), s * 0.9, y + H / 2 + 0.2, zMur + 0.05);
  }

  // ---------- objets des coins, resculptés ----------
  const xInscription = t => (t.var < 0.5 ? -1 : 1) * (2.4 + (t.var % 0.5) * 4); // jamais devant la porte
  const texDragonPeint = c => toile('dragon2-' + c + QUALITE, ech(1024), ech(512), (x, w) => {
    const S = w / 1024; x.save(); x.scale(S, S);
    const fond = x.createLinearGradient(0, 0, 0, 512); fond.addColorStop(0, '#24130d'); fond.addColorStop(1, '#0e0705'); x.fillStyle = fond; x.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(255,220,180,${Math.random() * 0.03})`; x.fillRect(Math.random() * 1024, Math.random() * 512, 30 + Math.random() * 60, 1); }
    x.strokeStyle = '#c9a24a'; x.lineWidth = 10; x.strokeRect(10, 10, 1004, 492); x.lineWidth = 2.5; x.strokeRect(26, 26, 972, 460);
    const or = cssCoul(c), sombre = cssCoul(teinte(c, -0.6)), clair = cssCoul(teinte(c, 0.4));
    const nuage = (cx, cy, s) => { x.strokeStyle = 'rgba(232,222,200,0.6)'; x.lineWidth = 5; x.lineCap = 'round'; for (let i = 0; i < 3; i++) { const yy = cy - (i % 2) * s * 0.3; x.beginPath(); x.arc(cx + i * s * 0.9, yy, s * 0.5, Math.PI * 0.9, Math.PI * 2.6); x.stroke(); x.beginPath(); x.arc(cx + i * s * 0.9, yy, s * 0.22, Math.PI, Math.PI * 2.4); x.stroke(); } x.beginPath(); x.moveTo(cx - s * 0.5, cy + s * 0.4); x.lineTo(cx + s * 2.6, cy + s * 0.4); x.stroke(); };
    [[110, 440, 40], [520, 80, 34], [770, 450, 44], [880, 140, 30], [340, 320, 26]].forEach(a => nuage(...a));
    const P = t => [190 + t * 760, 265 + Math.sin(t * TAU * 1.15 + 0.4) * 115 * (1 - 0.25 * t)];
    const Rr = t => 50 * (1 - 0.8 * t) + 5, N = 140, dos = [], ventre = [];
    for (let i = 0; i <= N; i++) { const t = i / N, [a, b] = P(t), [a2, b2] = P(Math.min(1, t + 0.004)), l = Math.hypot(a2 - a, b2 - b) || 1, nx = -(b2 - b) / l, ny = (a2 - a) / l, r = Rr(t); dos.push([a + nx * r, b + ny * r]); ventre.push([a - nx * r, b - ny * r]); }
    x.fillStyle = '#9a1a12';
    for (let i = 4; i < N - 3; i += 4) { const [a, b] = dos[i], [a2, b2] = dos[i + 2], [cx, cy] = P(i / N), ox = a - cx, oy = b - cy, l = Math.hypot(ox, oy) || 1, k2 = 18 * (1 - 0.6 * i / N); x.beginPath(); x.moveTo(a, b); x.lineTo((a + a2) / 2 + ox / l * k2, (b + b2) / 2 + oy / l * k2); x.lineTo(a2, b2); x.fill(); }
    for (const t of [0.13, 0.3, 0.55, 0.73]) {
      const [a, b] = ventre[Math.round(t * N)], r = Rr(t), fx = a + 26, fy = b + 48;
      x.strokeStyle = or; x.lineWidth = r * 0.6; x.lineCap = 'round'; x.beginPath(); x.moveTo(a, b); x.quadraticCurveTo(a - 12, b + 30, fx, fy); x.stroke();
      x.strokeStyle = sombre; x.lineWidth = 3.5; for (let q = -1; q <= 2; q++) { x.beginPath(); x.moveTo(fx, fy); x.quadraticCurveTo(fx + 10 + q * 7, fy + 4, fx + 13 + q * 11, fy + 15 - Math.abs(q) * 3); x.stroke(); }
    }
    x.beginPath(); dos.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); for (let i = ventre.length - 1; i >= 0; i--) x.lineTo(ventre[i][0], ventre[i][1]); x.closePath();
    const gr = x.createLinearGradient(0, 130, 0, 400); gr.addColorStop(0, clair); gr.addColorStop(0.5, or); gr.addColorStop(1, sombre); x.fillStyle = gr; x.fill();
    x.save(); x.clip(); x.strokeStyle = 'rgba(50,25,5,0.5)'; x.lineWidth = 1.6;
    for (let i = 2; i < N; i += 2) { const [a, b] = P(i / N), r = Rr(i / N); for (let q = -2; q <= 2; q++) { x.beginPath(); x.arc(a, b + q * r * 0.42, r * 0.3, 0.25, Math.PI - 0.25); x.stroke(); } }
    x.fillStyle = 'rgba(255,240,200,0.25)'; ventre.forEach(([a, b], i) => { if (i % 3 === 0) { x.fillRect(a - 2, b - 6, 4, 6); } });
    x.restore(); x.strokeStyle = sombre; x.lineWidth = 3; x.stroke();
    // tête : crinière, cornes, museau, gueule, œil, moustaches
    const [hx, hy] = P(0);
    x.strokeStyle = '#9a1a12'; x.lineWidth = 5; for (let i = 0; i < 9; i++) { const a = -0.6 + i * 0.25; x.beginPath(); x.moveTo(hx + 10, hy - 10); x.quadraticCurveTo(hx + 40 + Math.cos(a) * 30, hy - 20 + Math.sin(a) * 40, hx + 70 + Math.cos(a) * 40, hy + Math.sin(a) * 60); x.stroke(); }
    x.strokeStyle = clair; x.lineWidth = 6; for (const d of [0, 14]) { x.beginPath(); x.moveTo(hx - 10 + d, hy - 30); x.quadraticCurveTo(hx + 20 + d, hy - 80, hx + 60 + d, hy - 95); x.stroke(); x.beginPath(); x.moveTo(hx + 25 + d, hy - 62); x.lineTo(hx + 38 + d, hy - 50); x.stroke(); }
    x.fillStyle = or; x.strokeStyle = sombre; x.lineWidth = 3;
    x.beginPath(); x.ellipse(hx - 22, hy - 4, 58, 38, -0.15, 0, TAU); x.fill(); x.stroke();
    x.beginPath(); x.ellipse(hx - 85, hy - 14, 42, 20, -0.1, 0, TAU); x.fill(); x.stroke();
    x.fillStyle = '#4a0a06'; x.beginPath(); x.moveTo(hx - 45, hy + 10); x.lineTo(hx - 125, hy + 6); x.quadraticCurveTo(hx - 110, hy + 40, hx - 55, hy + 34); x.closePath(); x.fill();
    x.fillStyle = '#f4ead0'; for (const [a, b] of [[-118, 8], [-100, 8], [-82, 10], [-110, 32], [-90, 32]]) { x.beginPath(); x.moveTo(hx + a, hy + b); x.lineTo(hx + a + 6, hy + b + (b < 20 ? 10 : -10)); x.lineTo(hx + a + 12, hy + b); x.fill(); }
    x.fillStyle = '#f4ead0'; x.beginPath(); x.ellipse(hx - 40, hy - 20, 13, 9, -0.2, 0, TAU); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(hx - 44, hy - 20, 5, 0, TAU); x.fill();
    x.strokeStyle = clair; x.lineWidth = 2.5; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(hx - 118, hy - 18); x.bezierCurveTo(hx - 170, hy - 30 + s * 30, hx - 150, hy + 60 + s * 30, hx - 200, hy + 40 + s * 50); x.stroke(); }
    // perle flamboyante
    const px = 70, py = 150;
    x.fillStyle = 'rgba(220,80,30,0.85)'; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; x.beginPath(); x.moveTo(px + Math.cos(a) * 18, py + Math.sin(a) * 18); x.quadraticCurveTo(px + Math.cos(a + 0.3) * 40, py + Math.sin(a + 0.3) * 40, px + Math.cos(a + 0.15) * 48, py + Math.sin(a + 0.15) * 48); x.lineTo(px + Math.cos(a + 0.5) * 18, py + Math.sin(a + 0.5) * 18); x.fill(); }
    const pg = x.createRadialGradient(px - 6, py - 6, 2, px, py, 22); pg.addColorStop(0, '#fff8e0'); pg.addColorStop(1, '#e0b050'); x.fillStyle = pg; x.beginPath(); x.arc(px, py, 22, 0, TAU); x.fill();
    x.restore();
  });
  /** Porcelaine bleu et blanc (青花) : pétales de lotus, rinceaux fleuris, têtes de ruyi, feuilles de bananier. */
  const texPorcelaine = () => toile('porcelaine' + QUALITE, ech(1024), ech(512), (x, w, h) => {
    const S = w / 1024; x.save(); x.scale(S, S); const W = 1024, H = 512;
    x.fillStyle = '#f2f1ea'; x.fillRect(0, 0, W, H);
    const bleu = a => `rgba(32,58,140,${a})`, Y = v => H * (1 - v);
    const filet = v => { x.strokeStyle = bleu(0.9); x.lineWidth = 3; x.beginPath(); x.moveTo(0, Y(v)); x.lineTo(W, Y(v)); x.stroke(); };
    [0.05, 0.07, 0.23, 0.25, 0.66, 0.68, 0.8, 0.82, 0.96].forEach(filet);
    x.fillStyle = bleu(0.75); x.fillRect(0, Y(0.04), W, H * 0.04);
    for (let i = 0; i < 16; i++) { const cx = (i + 0.5) * W / 16, b = Y(0.075), t = Y(0.22); x.strokeStyle = bleu(0.95); x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx - 26, b); x.quadraticCurveTo(cx - 28, (b + t) / 2, cx, t); x.quadraticCurveTo(cx + 28, (b + t) / 2, cx + 26, b); x.stroke(); x.fillStyle = bleu(0.35); x.fill(); }
    // rinceaux : tige ondulante, fleurs de lotus, feuilles
    x.strokeStyle = bleu(0.95); x.lineWidth = 4; x.beginPath(); for (let xx = 0; xx <= W; xx += 4) { const yy = Y(0.45) + Math.sin(xx / W * TAU * 4) * H * 0.1; xx ? x.lineTo(xx, yy) : x.moveTo(xx, yy); } x.stroke();
    for (let i = 0; i < 8; i++) {
      const fx = (i + 0.25) * W / 8, fy = Y(0.45) + Math.sin(fx / W * TAU * 4) * H * 0.1 + (i % 2 ? 50 : -50);
      x.fillStyle = bleu(0.85); for (let q = 0; q < 6; q++) { const a = q / 6 * TAU; x.beginPath(); x.ellipse(fx + Math.cos(a) * 14, fy + Math.sin(a) * 14, 16, 8, a, 0, TAU); x.fill(); }
      x.fillStyle = '#f2f1ea'; x.beginPath(); x.arc(fx, fy, 7, 0, TAU); x.fill(); x.fillStyle = bleu(0.9); x.beginPath(); x.arc(fx, fy, 3.5, 0, TAU); x.fill();
      x.fillStyle = bleu(0.6); for (const s of [-1, 1]) { x.beginPath(); x.ellipse(fx + s * 34, fy + 18, 16, 6, s * 0.7, 0, TAU); x.fill(); }
    }
    for (let i = 0; i < 12; i++) { const cx = (i + 0.5) * W / 12, cy = Y(0.74); x.strokeStyle = bleu(0.95); x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 36, Y(0.68)); x.quadraticCurveTo(cx - 40, cy - 30, cx, cy - 22); x.quadraticCurveTo(cx + 40, cy - 30, cx + 36, Y(0.68)); x.stroke(); x.beginPath(); x.arc(cx, cy - 8, 9, 0, TAU); x.stroke(); }
    for (let i = 0; i < 14; i++) { const cx = (i + 0.5) * W / 14; x.fillStyle = bleu(0.45); x.beginPath(); x.moveTo(cx - 24, Y(0.82)); x.lineTo(cx, Y(0.95)); x.lineTo(cx + 24, Y(0.82)); x.fill(); x.strokeStyle = bleu(0.9); x.lineWidth = 2; x.beginPath(); x.moveTo(cx, Y(0.82)); x.lineTo(cx, Y(0.94)); x.stroke(); }
    x.restore();
  });
  const cPhys = new Map();
  function matPorcelaine() {
    let m = cPhys.get('porcelaine');
    if (!m) { m = new THREE.MeshPhysicalMaterial({ map: texPorcelaine(), roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }); cPhys.set('porcelaine', m); }
    return m;
  }
  const geoVase = () => geo('vase2', () => {
    const prof = [[0.2, 0], [0.24, 0.02], [0.22, 0.06], [0.26, 0.1], [0.38, 0.3], [0.47, 0.55], [0.5, 0.8], [0.48, 1.0], [0.4, 1.18], [0.26, 1.32], [0.17, 1.42], [0.16, 1.55], [0.19, 1.68], [0.24, 1.76], [0.235, 1.79], [0.2, 1.78]];
    const c = new THREE.SplineCurve(prof.map(([a, b]) => new THREE.Vector2(a, b)));
    return new THREE.LatheGeometry(c.getPoints(70), 64);
  });
  const geoCloche = () => geo('cloche2', () => {
    const prof = [[0.001, 1.0], [0.16, 0.99], [0.27, 0.95], [0.33, 0.85], [0.35, 0.65], [0.37, 0.42], [0.41, 0.2], [0.47, 0.05], [0.5, 0.0], [0.47, 0.0], [0.43, 0.08]];
    return new THREE.LatheGeometry(new THREE.SplineCurve(prof.map(([a, b]) => new THREE.Vector2(a, b))).getPoints(50), 56);
  });
  const geoChaudron = () => geo('ding', () => {
    const prof = [[0.001, 0.0], [0.2, 0.01], [0.38, 0.08], [0.47, 0.22], [0.5, 0.38], [0.49, 0.5], [0.52, 0.53], [0.52, 0.56], [0.46, 0.55], [0.44, 0.45], [0.42, 0.3]];
    return new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 48);
  });
  /** Décore un mur (repère de face) : plaque au-dessus de la porte, puis une à trois pièces murales. */
  function decorerMur(fg, f, spec, monde, porte) {
    const r = C.alea(C.h32(monde.graine, spec.id, 340 + f));
    const k = C.h32(monde.graine, spec.id, 33) % 4, R = ROYAUMES[k];
    if (porte) plaqueLinteau(fg, LIEUX[C.h32(monde.graine, spec.id, 341 + f) % LIEUX.length]);
    // zones déjà prises : grand sceau peint, dragon peint, inscription murale
    if (spec.traits.some(t => t.nom === 'dragon peint' && t.mur === f)) return;
    const pris = [];
    if (spec.glyphe % 4 === f) pris.push(-3.4);
    for (const t of spec.traits) if (t.nom === 'inscription murale' && t.mur === f) pris.push(xInscription(t));
    const libre = xc => pris.every(p => Math.abs(p - xc) > 1.7);
    const places = porte ? [-3.6, 3.6] : [-3.5, 0, 3.5];
    const max = QUALITE === 'basse' ? 1 : places.length, avant = fg.children.length;
    let n = 0;
    const etroits = ['etendard', 'etendard', 'calligraphie', 'paysage', 'trophee', 'lune'];
    for (const xc of places) {
      if (n >= max || !libre(xc)) continue;
      let type = xc === 0 ? ['carte', 'ratelier', 'lune', 'trophee'][Math.floor(r() * 4)] : etroits[Math.floor(r() * etroits.length)];
      if (r() < 0.12) continue; // un pan de mur nu de temps en temps
      n++;
      switch (type) {
        case 'etendard': etendard(fg, xc, 6.6, k, R.generaux[Math.floor(r() * 4)], r() < 0.15); break;
        case 'calligraphie': rouleau(fg, xc, 6.2, texCalligraphie(MAXIMES[Math.floor(r() * MAXIMES.length)], Math.floor(r() * 4))); break;
        case 'paysage': rouleau(fg, xc, 6.2, texPaysage(Math.floor(r() * 6), 256, 768)); break;
        case 'trophee': trophee(fg, xc, 4.6, k, r() < 0.55, r); break;
        case 'lune': fenetreLune(fg, xc, 4.4); break;
        case 'carte': carte(fg, xc, 4.5); break;
        case 'ratelier': ratelier(fg, xc, 4.2); break;
      }
    }
    // les petites pièces (cordons, pitons, glands, clous) ne projettent pas d'ombre : moins de travail pour le téléphone
    fg.children.slice(avant).forEach(o => o.traverse(m => {
      if (!m.isMesh || m.isInstancedMesh) { if (m.isInstancedMesh) m.userData.pasOmbre = true; return; }
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      if (m.geometry.boundingSphere.radius * Math.max(m.scale.x, m.scale.y, m.scale.z) < 0.3) m.userData.pasOmbre = true;
    }));
  }
  /** Poussière en suspension dans la lumière des lanternes. */
  function poussiere(g) {
    if (QUALITE === 'basse') return null;
    const n = 70, base = new Float32Array(n * 3), pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { base[i * 3] = (Math.random() * 2 - 1) * (DM - 0.8); base[i * 3 + 1] = 0.6 + Math.random() * 5.5; base[i * 3 + 2] = (Math.random() * 2 - 1) * (DM - 0.8); ph[i] = Math.random() * 100; }
    const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geom, new THREE.PointsMaterial({ map: texHalo(), color: 0xffd9a0, size: 0.07, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    p.frustumCulled = false;
    p.onBeforeRender = () => {
      const t = performance.now() / 1000;
      for (let i = 0; i < n; i++) { const q = ph[i]; pos[i * 3] = base[i * 3] + Math.sin(t * 0.11 + q) * 0.35; pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.07 + q * 1.7) * 0.25; pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.09 + q) * 0.35; }
      geom.attributes.position.needsUpdate = true;
    };
    g.add(p); return p;
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
    const sol = boite(g, DM * 2 + EP, 0.3, DM * 2 + EP, mat(0xffffff, { map: ts.map, bump: ts.bump, bs: 0.05, r: 1, rm: ts.rough }), 0, -0.15, 0); sol.userData.recoit = true;
    boite(g, DM * 2 + EP + 0.1, 0.5, DM * 2 + EP + 0.1, mat(teinte(pal.mur, -0.6), { r: 0.9, m: 0.3 }), 0, -0.56, 0).userData.recoit = true;
    // murs (une couleur par face pour l'effet de coupe)
    const murs = [], portes = [];
    const ctxPiege = { spec, tempo: () => 1, declencheurs: [] };
    for (let f = 0; f < 4; f++) {
      const fg = groupe(g); fg.rotation.y = ANGLE_FACE(f);
      const tm = texMur(pal), lisse = STYLE_MUR[pal.nom] === 'laque';
      const mm = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tm.map, bumpMap: tm.bump, bumpScale: 0.04, roughness: tm.rough ? 1 : lisse ? 0.42 : 0.86, roughnessMap: tm.rough || null, metalness: STYLE_MUR[pal.nom] === 'metal' ? 0.6 : 0.02, transparent: true, opacity: 1 });
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
      // décor des Trois Royaumes (accroché au mur : il s'estompe avec lui)
      decorerMur(fg, f, spec, monde, porte);
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
      for (const y of [0.62, HT - 0.75]) cyl(g, 0.285, 0.285, 0.07, 28, M.or(), X, y, Z);
      obstacles.push({ x0: X - 0.4, x1: X + 0.4, z0: Z - 0.4, z1: Z + 0.4 });
    }
    poussiere(g);
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
