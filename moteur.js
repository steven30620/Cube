/* =====================================================================
   LE CUBE DES MILLE SUPPLICES — moteur déterministe
   ---------------------------------------------------------------------
   Aucune dépendance, aucun accès au DOM : testable sous Node.
   Même graine + même horloge = même Cube pour tous les joueurs d'une
   instance. Ce fichier contient la vérité du Cube : rien de ce qui est
   calculé ici n'est expliqué au joueur.
   ===================================================================== */
(function (racine) {
  'use strict';

  const CONFIG = {
    LARGEUR: 48,            // X : est/ouest
    PROFONDEUR: 48,         // Y : nord/sud
    ETAGES: 16,             // Z : étages
    PHASE_MS: 24000,        // durée d'une phase de l'horloge (12 phases = un cycle)
    PRE_MS: 2500,           // grondement + verrouillage avant un mouvement
    MOUV_MS: 4500,          // translation ou rotation visible
    RECO_MS: 1000,          // reconnexion avant réouverture des portes
    JOUR_MS: 3600000,       // un jour du calendrier du Cube (réglable)
    DENSITE: 0.58,          // part des emplacements libres occupés par une salle fixe
    P_PORTE_H: 0.62,        // probabilité d'une porte sur chaque face latérale
    P_PORTE_V: 0.3,         // probabilité d'une trappe au plafond / au sol
    TENTATIVES_CIRCUITS: 2600,
    MAX_JOUEURS_INSTANCE: 50,
    MAX_VIVANTS_SALLE: 5,
    // géométrie (unités du rendu)
    DEMI: 6, MUR: 0.4, PORTE: 2.4, HAUT: 7.5, ESP_H: 18, ESP_V: 10,
  };
  CONFIG.VERROU_MS = CONFIG.PRE_MS + CONFIG.MOUV_MS + CONFIG.RECO_MS;

  // Noms internes des phases : jamais affichés au joueur.
  const PHASES = ['Le Silence', "L'Éveil", 'La Première Translation', 'Le Verrouillage', 'La Rotation',
    "L'Ascension", 'La Descente', 'La Permutation', 'La Rupture', 'La Reconnexion', 'Le Jugement', 'Le Retour'];

  // ---------- Hachage et hasard déterministes ----------
  function h32(a, b, c, d) {
    let h = (0x811c9dc5 ^ (a | 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (b | 0) ^ (h >>> 13), 0xc2b2ae35);
    h = Math.imul(h ^ (c | 0) ^ (h >>> 16), 0x27d4eb2f);
    h = Math.imul(h ^ (d | 0) ^ (h >>> 15), 0x165667b1);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function alea(graine) {
    let a = graine >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mod = (a, m) => ((a % m) + m) % m;
  function popc(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    return (((x + (x >> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }
  const entre = (r, a, b) => a + Math.floor(r() * (b - a + 1));
  const choisir = (r, t) => t[Math.floor(r() * t.length)];

  // =====================================================================
  // 1. ARITHMÉTIQUE MODULAIRE DES PORTES (M = 1009, premier)
  // =====================================================================
  const M = 1009;
  function puissance(b, e, m) {
    let r = 1; b = mod(b, m);
    while (e > 0) { if (e & 1) r = (r * b) % m; b = (b * b) % m; e >>= 1; }
    return r;
  }
  const inverse = a => puissance(mod(a, M), M - 2, M);
  const I37 = inverse(37), I53 = inverse(53), I71 = inverse(71), I29 = inverse(29);

  /** Code brut : R destination, F face (0-5), P phase (0-11), K clé de salle, H danger, T mouvement. */
  function encoderBrut(R, F, P, K, H, T) {
    const U = R % M, V = Math.floor(R / M);
    return [
      mod(37 * U + K + 17 * F + 31 * P, M),
      mod(53 * V + 19 * K + 7 * F + 11 * P, M),
      mod(71 * H + 27 * K + 13 * P, M),
      mod(29 * T + 33 * K + 5 * F + 17 * P, M),
      mod(U + 3 * V + 5 * H + 7 * T + 11 * P + K, M),
    ];
  }
  /** Inverse exact de encoderBrut ; `valide` vérifie le groupe de contrôle et les domaines. */
  function decoderBrut(g, F, P, K) {
    const U = mod((g[0] - K - 17 * F - 31 * P) * I37, M);
    const V = mod((g[1] - 19 * K - 7 * F - 11 * P) * I53, M);
    const H = mod((g[2] - 27 * K - 13 * P) * I71, M);
    const T = mod((g[3] - 33 * K - 5 * F - 17 * P) * I29, M);
    const E = mod(U + 3 * V + 5 * H + 7 * T + 11 * P + K, M);
    return { R: U + M * V, H, T, valide: E === g[4] && H <= 103 && T <= 55 };
  }

  // ---------- Signatures de chiffrement (toutes bijectives sur (Z/1009)^5) ----------
  const FAMILLES_CHIFFRE = ['Dragon', 'Serpent', 'Lotus', 'Miroir', 'Horloge', 'Gardien'];
  const FACT = [1, 1, 2, 6, 24, 120];
  function permutationLehmer(n, k) {
    const e = []; for (let i = 0; i < n; i++) e.push(i);
    const res = []; k = mod(k, FACT[n]);
    for (let i = n; i >= 1; i--) { const f = FACT[i - 1]; const j = Math.floor(k / f); k %= f; res.push(e.splice(j, 1)[0]); }
    return res;
  }
  function etapesFamille(fam, K, P) {
    switch (fam) {
      case 0: { // Dragon : affine sur chaque groupe puis échange de deux groupes
        const a = [], b = [];
        for (let i = 0; i < 5; i++) { a.push(2 + mod(K * 7 + i * 31, 1000)); b.push(mod(K * 13 + i * 101, M)); }
        const i0 = K % 5, i1 = (i0 + 1 + ((K >> 3) % 4)) % 5;
        const p = [0, 1, 2, 3, 4]; p[i0] = i1; p[i1] = i0;
        return [{ t: 'affine', a, b }, { t: 'perm', p }];
      }
      case 1: { // Serpent : rotation circulaire des groupes
        const k = 1 + (K % 4); const p = [];
        for (let i = 0; i < 5; i++) p.push((i + k) % 5);
        return [{ t: 'perm', p }];
      }
      case 2: return [{ t: 'perm', p: permutationLehmer(5, K) }]; // Lotus : permutation de blocs
      case 3: return [{ t: 'miroir' }, { t: 'perm', p: [4, 3, 2, 1, 0] }]; // Miroir : symétrie + renversement
      case 4: { // Horloge : décalage dépendant de la phase
        const c = []; const base = 1 + (K % 7);
        for (let i = 0; i < 5; i++) c.push(mod((i + 1) * base * (P + 1), M));
        return [{ t: 'decal', c }];
      }
      case 5: // Gardien : Horloge, puis Lotus, puis Dragon (clé dérivée)
        return etapesFamille(4, K, P).concat(etapesFamille(2, K, P), etapesFamille(0, mod(K * 3 + 1, M), P));
    }
    return [];
  }
  function appliquerEtape(e, v) {
    switch (e.t) {
      case 'affine': return v.map((x, i) => mod(e.a[i] * x + e.b[i], M));
      case 'perm': return e.p.map(j => v[j]);
      case 'miroir': return v.map(x => M - 1 - x);
      case 'decal': return v.map((x, i) => mod(x + e.c[i], M));
    }
    return v;
  }
  function inverserEtape(e, v) {
    switch (e.t) {
      case 'affine': return v.map((y, i) => mod((y - e.b[i]) * inverse(e.a[i]), M));
      case 'perm': { const r = new Array(5); e.p.forEach((j, i) => { r[j] = v[i]; }); return r; }
      case 'miroir': return v.map(x => M - 1 - x);
      case 'decal': return v.map((x, i) => mod(x - e.c[i], M));
    }
    return v;
  }
  function chiffrer(v, familles, K, P) {
    let r = v.slice();
    for (const f of familles) for (const e of etapesFamille(f, K, P)) r = appliquerEtape(e, r);
    return r;
  }
  function dechiffrer(v, familles, K, P) {
    let r = v.slice();
    for (let fi = familles.length - 1; fi >= 0; fi--) {
      const et = etapesFamille(familles[fi], K, P);
      for (let i = et.length - 1; i >= 0; i--) r = inverserEtape(et[i], r);
    }
    return r;
  }
  const cleSalle = (runeA, runeB, zone) => mod(97 * runeA + 13 * runeB + 7 * zone, M);
  const formaterGroupe = n => String(n).padStart(4, '0');

  // =====================================================================
  // 2. FAMILLES DE SALLES ET CATALOGUE
  // =====================================================================
  const FAMILLES_SALLE = ['Cube Vide', 'Cube des Pointes', 'Cube des Lames', 'Cube Broyeur', 'Cube des Flammes',
    'Cube des Flèches', 'Cube des Fosses', 'Cube Rotatif', 'Cube Coulissant', 'Cube Trompeur', 'Cube des Engrenages',
    'Cube des Pendules', 'Cube du Silence', 'Cube de Lumière', 'Cube Obscur', 'Cube du Temps', 'Cube du Labyrinthe',
    'Cube des Énigmes', 'Cube de Téléportation', 'Cube des Statues', 'Cube des Chaînes', 'Cube Instable',
    'Cube du Jugement', 'Cube de la Folie', 'Cube de la Mort', 'Cube de Libération'];
  const RANG_FAMILLE = [0, 0, 1, 4, 2, 1, 0, 2, 2, 1, 3, 1, 1, 2, 1, 2, 1, 1, 3, 3, 3, 4, 5, 5, 6];
  const REGIONS = ['Les Couloirs Oubliés', 'Les Murs Vivants', 'Le Sol des Traîtres', 'La Forêt des Lames',
    'Les Portes de la Folie', 'Le Cœur du Chaos', 'Le Dernier Supplice'];

  const OBJETS = {
    pieces:    { nom: "Bourse de pièces d'or", cat: 'monnaie', monnaie: 'or', valeur: 15, rarete: 'commun', forme: 'bourse' },
    lingot:    { nom: "Lingot d'or", cat: 'monnaie', monnaie: 'or', valeur: 50, rarete: 'rare', forme: 'lingot' },
    jetons:    { nom: 'Jetons de casino', cat: 'monnaie', monnaie: 'jetons', valeur: 20, rarete: 'commun', forme: 'jetons' },
    orNoir:    { nom: "Fiole d'Or Noir", cat: 'monnaie', monnaie: 'orNoir', valeur: 3, rarete: 'epique', forme: 'fiole' },
    encens:    { nom: 'Bâtons d’encens de santal', cat: 'offrande', rarete: 'commun', forme: 'encens' },
    rouleau:   { nom: 'Rouleau de soie brodé', cat: 'document', rarete: 'commun', forme: 'rouleau' },
    cle:       { nom: 'Clé de bronze ouvragée', cat: 'cle', rarete: 'commun', forme: 'cle' },
    jade:      { nom: 'Pierre de jade', cat: 'materiau', rarete: 'rare', forme: 'jade' },
    dao:       { nom: 'Dao de bronze', cat: 'arme', rarete: 'rare', forme: 'lame' },
    bracelet:  { nom: 'Bracelet de jade', cat: 'bijou', rarete: 'rare', forme: 'anneau' },
    miroir:    { nom: 'Miroir de bronze ancien', cat: 'collection', rarete: 'rare', forme: 'disque' },
    armure:    { nom: 'Plastron lamellaire', cat: 'armure', rarete: 'rare', forme: 'plastron' },
    eventail:  { nom: 'Éventail de fer', cat: 'arme', rarete: 'epique', forme: 'eventail' },
    perle:     { nom: 'Perle noire', cat: 'materiau', rarete: 'epique', forme: 'perle' },
    statuette: { nom: 'Statuette de Guanyin', cat: 'offrande', rarete: 'epique', forme: 'statuette' },
    masque:    { nom: 'Masque de démon laqué', cat: 'collection', rarete: 'epique', forme: 'masque' },
    katana:    { nom: 'Katana légendaire', cat: 'arme', rarete: 'legendaire', forme: 'katana' },
    sceau:     { nom: 'Sceau impérial de jade', cat: 'collection', rarete: 'legendaire', forme: 'sceau' },
    plume:     { nom: 'Plume de phénix', cat: 'materiau', rarete: 'legendaire', forme: 'plume' },
  };
  const PAR_RARETE = { commun: [], rare: [], epique: [], legendaire: [] };
  for (const k in OBJETS) PAR_RARETE[OBJETS[k].rarete].push(k);

  const TRAITS = ['statue de grue', 'lion gardien', 'dragon peint', 'fissure', 'bannière déchirée', 'gong',
    'brasero éteint', 'colonne brisée', 'inscription murale', 'grand vase', 'miroir de bronze', 'cloche',
    'tablette d’ancêtres', 'paravent', 'arbre de bronze'];
  const PALETTES = [
    { nom: 'laque rouge', mur: 0x5a1a16, sol: 0x2a1c16, acc: 0xc9a24a },
    { nom: 'bronze', mur: 0x4a3a22, sol: 0x221c14, acc: 0xd8b25a },
    { nom: 'jade', mur: 0x1f3d34, sol: 0x14201c, acc: 0x8fc7a8 },
    { nom: 'pierre grise', mur: 0x3b3a38, sol: 0x1e1d1c, acc: 0xb8b0a0 },
    { nom: 'bois sombre', mur: 0x3a2618, sol: 0x1b130d, acc: 0xc28a4a },
    { nom: 'ocre', mur: 0x6a4a22, sol: 0x2b2016, acc: 0xe0c070 },
    { nom: 'encre', mur: 0x1e1f26, sol: 0x111216, acc: 0x8a93b8 },
  ];

  // =====================================================================
  // 3. LE MONDE : matrice 3D, circuits mécaniques, salles fixes
  // =====================================================================
  /**
   * Les mouvements suivent des CIRCUITS : boucles fermées d'emplacements adjacents contenant
   * exactement un emplacement libre. À chaque pas, la salle située derrière l'emplacement libre
   * y glisse (permutation via emplacement libre) : aucune salle ne traverse jamais une autre.
   * La position de chaque salle à n'importe quel instant se calcule en O(1).
   */
  function anneau(plan, x0, y0, z0, a, b) {
    const pts = [];
    const add = (i, j) => {
      if (plan === 'xy') pts.push([x0 + i, y0 + j, z0]);
      else if (plan === 'xz') pts.push([x0 + i, y0, z0 + j]);
      else pts.push([x0, y0 + i, z0 + j]);
    };
    for (let i = 0; i < a; i++) add(i, 0);
    for (let j = 1; j < b; j++) add(a - 1, j);
    for (let i = a - 2; i >= 0; i--) add(i, b - 1);
    for (let j = b - 2; j >= 1; j--) add(0, j);
    return pts;
  }

  function creerMonde(graine, t0, cfgPartiel) {
    const cfg = Object.assign({}, CONFIG, cfgPartiel || {});
    cfg.VERROU_MS = cfg.PRE_MS + cfg.MOUV_MS + cfg.RECO_MS;
    const W = cfg.LARGEUR, D = cfg.PROFONDEUR, HZ = cfg.ETAGES, N = W * D * HZ;
    const idx = (x, y, z) => x + W * (y + D * z);
    const rng = alea(graine ^ 0x5eed);
    const etat = new Uint8Array(N); // 0 libre, 1 circuit, 2 salle fixe, 3 vide
    const slotFixe = new Int32Array(N);
    const slotCirc = new Int32Array(N).fill(-1);
    const slotCircIdx = new Int16Array(N);
    const circuits = [];
    const decalGM = Math.floor(rng() * 8); // décalage des Grandes Mutations

    const ENTREE = { x: 2, y: 2, z: 0 };
    const zoneEntree = (x, y, z) => x <= 4 && y <= 4 && z <= 1;
    for (let z = 0; z <= 1; z++) for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) etat[idx(x, y, z)] = 2;

    function ajouterCircuit(pts, masque, special) {
      const L = pts.length;
      const c = { id: circuits.length, slots: new Int32Array(L), L, h0: 0, masque, salles: new Int32Array(L), special: !!special };
      pts.forEach((p, i) => { const s = idx(p[0], p[1], p[2]); c.slots[i] = s; etat[s] = 1; slotCirc[s] = c.id; slotCircIdx[s] = i; });
      c.h0 = Math.floor(rng() * L);
      circuits.push(c);
      return c;
    }

    // --- Circuit du Cube de Libération (anneau vertical 3×3 dans le coin opposé à l'entrée)
    const libPts = anneau('xz', W - 3, D - 3, HZ - 3, 3, 3);
    const cLib = ajouterCircuit(libPts, (1 << 2) | (1 << 7), true);
    const SORTIE = { x: W - 1, y: D - 3, z: HZ - 1, dir: 1 }; // alignement : face est, au sommet
    const sortieSlot = idx(SORTIE.x, SORTIE.y, SORTIE.z);
    cLib.h0 = 1; // l'emplacement libre de départ

    // --- Puits mécaniques et secteurs condamnés (vides)
    for (let n = 0; n < 46; n++) {
      const x = entre(rng, 0, W - 1), y = entre(rng, 0, D - 1);
      if (x <= 6 && y <= 6) continue;
      if (x >= W - 4 && y >= D - 5) continue;
      for (let z = 0; z < HZ; z++) { const s = idx(x, y, z); if (etat[s] === 0) etat[s] = 3; }
    }
    for (let n = 0; n < 14; n++) {
      const x0 = entre(rng, 6, W - 8), y0 = entre(rng, 6, D - 8), z0 = entre(rng, 0, HZ - 3);
      for (let z = z0; z < z0 + 2; z++) for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) {
        const s = idx(x, y, z); if (etat[s] === 0) etat[s] = 3;
      }
    }

    // --- Circuits ordinaires
    const PHASES_MOUV = [1, 2, 5, 6, 7, 8, 9, 11];
    for (let n = 0; n < cfg.TENTATIVES_CIRCUITS; n++) {
      const r = rng();
      const plan = r < 0.42 ? 'xy' : (r < 0.71 ? 'xz' : 'yz');
      const a = entre(rng, 2, plan === 'xy' ? 6 : 5);
      const b = entre(rng, 2, plan === 'xy' ? 5 : 4);
      const ex = plan === 'yz' ? 1 : a, ey = plan === 'xy' ? b : (plan === 'yz' ? a : 1), ez = plan === 'xy' ? 1 : b;
      const x0 = entre(rng, 0, W - ex), y0 = entre(rng, 0, D - ey), z0 = entre(rng, 0, HZ - ez);
      const pts = anneau(plan, x0, y0, z0, a, b);
      let ok = true;
      for (const p of pts) { const s = idx(p[0], p[1], p[2]); if (etat[s] !== 0 || zoneEntree(p[0], p[1], p[2])) { ok = false; break; } }
      if (!ok) continue;
      let masque = 0; const nb = 1 + Math.floor(rng() * rng() * 3);
      for (let i = 0; i < nb; i++) masque |= 1 << choisir(rng, PHASES_MOUV);
      if (plan !== 'xy' && rng() < 0.6) masque |= 1 << (rng() < 0.5 ? 5 : 6);
      ajouterCircuit(pts, masque, false);
    }

    // --- Salles fixes
    for (let s = 0; s < N; s++) if (etat[s] === 0) etat[s] = rng() < cfg.DENSITE ? 2 : 3;
    // le centre de l'anneau de libération reste vide (zone technique)
    etat[idx(W - 2, D - 3, HZ - 2)] = 3;

    // --- Identités permanentes
    const liste = []; // [slot, circuit, indice]
    for (let s = 0; s < N; s++) if (etat[s] === 2) liste.push([s, -1, 0]);
    for (const c of circuits) for (let i = 0; i < c.L; i++) if (i !== c.h0) liste.push([c.slots[i], c.id, i]);
    for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = liste[i]; liste[i] = liste[j]; liste[j] = t; }
    const n = liste.length;
    const salleSlot0 = new Int32Array(n + 1), salleCirc = new Int32Array(n + 1), salleP = new Int16Array(n + 1);
    const rotMasque = new Uint16Array(n + 1), rotQ = new Uint8Array(n + 1), o0 = new Uint8Array(n + 1);
    salleCirc[0] = -1;
    for (let i = 0; i < n; i++) {
      const id = i + 1, [s, c, p] = liste[i];
      salleSlot0[id] = s; salleCirc[id] = c; salleP[id] = p;
      if (c < 0) slotFixe[s] = id; else circuits[c].salles[p] = id;
      const hr = h32(graine, id, 11);
      o0[id] = hr & 3;
      const interdit = c >= 0 ? circuits[c].masque : 0;
      if (((hr >>> 4) & 1023) < (c >= 0 ? 90 : 230)) {
        const ph = [4, 8, 3, 10, 0][(hr >>> 14) % 5];
        if (!((interdit >> ph) & 1)) { rotMasque[id] = 1 << ph; rotQ[id] = 1 + ((hr >>> 18) % 3); }
      }
    }
    const idEntree = slotFixe[idx(ENTREE.x, ENTREE.y, ENTREE.z)];
    o0[idEntree] = 0; rotMasque[idEntree] = 0;
    // le Cube de Libération : premier emplacement occupé de son anneau
    const idLib = cLib.salles[(cLib.h0 + 4) % cLib.L];
    o0[idLib] = 1; rotMasque[idLib] = 1 << 4; rotQ[idLib] = 1;

    const monde = {
      cfg, graine, t0, W, D, HZ, N, idx, etat, slotFixe, slotCirc, slotCircIdx, circuits, decalGM,
      nbSalles: n, salleSlot0, salleCirc, salleP, rotMasque, rotQ, o0,
      ENTREE, idEntree, idLib, SORTIE, sortieSlot, cLib,
      _specs: new Map(),
    };
    return monde;
  }

  const slotXYZ = (m, s) => { const x = s % m.W, r = (s - x) / m.W, y = r % m.D, z = (r - y) / m.D; return { x, y, z }; };
  // Directions monde : 0 N (y-1), 1 E (x+1), 2 S (y+1), 3 O (x-1), 4 haut (z+1), 5 bas (z-1)
  const DIRS = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  const OPPOSE = [2, 3, 0, 1, 5, 4];
  function voisinSlot(m, s, d) {
    const p = slotXYZ(m, s), v = DIRS[d];
    const x = p.x + v[0], y = p.y + v[1], z = p.z + v[2];
    if (x < 0 || y < 0 || z < 0 || x >= m.W || y >= m.D || z >= m.HZ) return -1;
    return m.idx(x, y, z);
  }
  function directionEntre(m, a, b) {
    const pa = slotXYZ(m, a), pb = slotXYZ(m, b);
    const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
    for (let d = 0; d < 6; d++) if (DIRS[d][0] === dx && DIRS[d][1] === dy && DIRS[d][2] === dz) return d;
    return -1;
  }

  // =====================================================================
  // 4. HORLOGE MÉCANIQUE, DIRECTEUR DU CHAOS
  // =====================================================================
  function instant(m, t) {
    const e = Math.max(0, t - m.t0);
    const g = Math.floor(e / m.cfg.PHASE_MS), w = e - g * m.cfg.PHASE_MS;
    const k = Math.floor(g / 12), p = g % 12;
    const ev = evenementsCycle(m, k);
    return { t, g, w, k, p, ev, gm: ev.gm, colere: colere(m, k, ev) };
  }
  function evenementsCycle(m, k) {
    const h = h32(m.graine, k, 4242);
    const gm = mod(k + m.decalGM, 8) === 7;
    return {
      gm,                                         // La Grande Mutation
      dragon: !gm && (h % 100) < 11,              // Le Réveil du Dragon
      lames: !gm && ((h >>> 8) % 100) < 11,       // La Chasse des Lames
      fermeture: !gm && ((h >>> 16) % 100) < 9,   // La Fermeture des Portes
      jugement: ((h >>> 24) % 100) < 7,           // Le Jugement Final
    };
  }
  /** Colère du Cube, 0–100 : jamais affichée. Elle change l'activité, jamais la vérité des codes. */
  function colere(m, k, ev) {
    const onde = 0.5 + 0.5 * Math.sin((k + (m.graine % 37)) * 2 * Math.PI / 37);
    let c = 18 + 58 * onde;
    if (ev.gm) c += 22; if (ev.dragon || ev.lames) c += 12; if (ev.jugement) c += 15;
    return Math.max(0, Math.min(100, Math.round(c)));
  }
  const paliersColere = c => (c < 25 ? 0 : c < 50 ? 1 : c < 75 ? 2 : c < 100 ? 3 : 4);

  // Mouvements des circuits : comptage en O(1) sur des blocs de 8 cycles (le 8e est une Grande Mutation)
  function circuitBouge(m, c, g) {
    const k = Math.floor(g / 12);
    if (mod(k + m.decalGM, 8) === 7) return true;
    return ((c.masque >> (g % 12)) & 1) === 1;
  }
  function _F(mask, mm) { // mouvements dans les phases [0, mm) d'un repère aligné sur les blocs
    const pc = popc(mask);
    const bloc = Math.floor(mm / 96), r = mm - bloc * 96;
    const fc = Math.floor(r / 12), rem = r % 12;
    return bloc * (7 * pc + 12) + fc * pc + (fc === 7 ? rem : popc(mask & ((1 << rem) - 1)));
  }
  function compteMouv(m, c, g) { const O = m.decalGM * 12; return _F(c.masque, g + O) - _F(c.masque, O); }
  function _G(mask, mm) {
    const pc = popc(mask);
    const bloc = Math.floor(mm / 96), r = mm - bloc * 96;
    const fc = Math.floor(r / 12), rem = r % 12;
    return bloc * 7 * pc + fc * pc + (fc === 7 ? 0 : popc(mask & ((1 << rem) - 1)));
  }
  function compteRot(m, id, g) { const O = m.decalGM * 12, mk = m.rotMasque[id]; return mk ? _G(mk, g + O) - _G(mk, O) : 0; }
  function tourne(m, id, g) {
    const mk = m.rotMasque[id]; if (!mk) return false;
    if (mod(Math.floor(g / 12) + m.decalGM, 8) === 7) return false;
    return ((mk >> (g % 12)) & 1) === 1;
  }

  /** État d'un circuit à un instant : pas accomplis, glissement en cours. */
  function etatCircuit(m, c, it) {
    const cfg = m.cfg;
    const n = compteMouv(m, c, it.g);
    const bouge = circuitBouge(m, c, it.g);
    let s = n, f = -1;
    if (bouge) {
      if (it.w >= cfg.PRE_MS + cfg.MOUV_MS) s = n + 1;
      else if (it.w >= cfg.PRE_MS) f = (it.w - cfg.PRE_MS) / cfg.MOUV_MS;
    }
    const H = mod(c.h0 - s, c.L);
    return { s, f, H, bouge, de: mod(H - 1, c.L), vers: H };
  }
  function indiceSalleCircuit(c, p0, s) {
    const L = c.L, q = Math.floor(s / (L - 1)), r = s % (L - 1);
    const Hq = mod(c.h0 + q, L);
    const pp = mod(p0 + q, L);
    const d = mod(Hq - pp, L);
    return (d >= 1 && d <= r) ? mod(pp + 1, L) : pp;
  }
  function salleIndiceCircuit(c, k, s) {
    const L = c.L, q = Math.floor(s / (L - 1)), r = s % (L - 1);
    const Hq = mod(c.h0 + q, L);
    if (k === mod(Hq - r, L)) return 0;
    const pp = mod(Hq - k, L) <= r - 1 ? mod(k - 1, L) : k;
    return c.salles[mod(pp - q, L)];
  }
  /** Salle présente à un emplacement (0 = vide). Pendant un glissement, la salle compte à son départ. */
  function salleAuSlot(m, slot, it) {
    if (slot < 0) return 0;
    const ci = m.slotCirc[slot];
    if (ci < 0) return m.slotFixe[slot];
    const c = m.circuits[ci];
    const e = etatCircuit(m, c, it);
    return salleIndiceCircuit(c, m.slotCircIdx[slot], e.s);
  }
  function orientation(m, id, it) {
    const cfg = m.cfg;
    let n = compteRot(m, id, it.g), f = 0;
    if (tourne(m, id, it.g)) {
      if (it.w >= cfg.PRE_MS + cfg.MOUV_MS) n += 1;
      else if (it.w >= cfg.PRE_MS) f = (it.w - cfg.PRE_MS) / cfg.MOUV_MS;
    }
    const q = m.rotQ[id] || 0;
    const o = mod(m.o0[id] + q * n, 4);
    return { o, angle: o + q * lisse(f), tourne: f > 0 };
  }
  const lisse = f => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));
  /** Position réelle d'une salle : emplacement logique + position flottante pour l'animation. */
  function positionSalle(m, id, it) {
    const ci = m.salleCirc[id];
    let slot, x, y, z, glisse = false;
    if (ci < 0) { slot = m.salleSlot0[id]; const p = slotXYZ(m, slot); x = p.x; y = p.y; z = p.z; }
    else {
      const c = m.circuits[ci], e = etatCircuit(m, c, it);
      const k = indiceSalleCircuit(c, m.salleP[id], e.s);
      slot = c.slots[k];
      const p = slotXYZ(m, slot); x = p.x; y = p.y; z = p.z;
      if (e.f >= 0 && k === e.de) {
        const q = slotXYZ(m, c.slots[e.vers]), f = lisse(e.f);
        x += (q.x - x) * f; y += (q.y - y) * f; z += (q.z - z) * f; glisse = true;
      }
    }
    const or = orientation(m, id, it);
    return { slot, x, y, z, o: or.o, angle: or.angle, glisse, tourne: or.tourne };
  }
  /** L'emplacement est-il pris dans une mutation de la phase en cours (portes verrouillées) ? */
  function slotImplique(m, slot, it) {
    if (slot < 0 || it.w >= m.cfg.VERROU_MS) return false;
    const ci = m.slotCirc[slot];
    if (ci >= 0) {
      const c = m.circuits[ci];
      if (circuitBouge(m, c, it.g)) {
        const n = compteMouv(m, c, it.g), H = mod(c.h0 - n, c.L), k = m.slotCircIdx[slot];
        if (k === H || k === mod(H - 1, c.L)) return true;
      }
    }
    const id = salleAuSlot(m, slot, it);
    return id > 0 && tourne(m, id, it.g);
  }

  // =====================================================================
  // 5. PORTES ET CODES
  // =====================================================================
  function portesLocales(m, id) { return specSalle(m, id).portes; }
  function porteMonde(m, id, dir, o) { // la salle possède-t-elle une porte dans cette direction monde ?
    const bits = portesLocales(m, id);
    if (dir >= 4) return ((bits >> dir) & 1) === 1;
    return ((bits >> mod(dir - o, 4)) & 1) === 1;
  }
  const faceVersMonde = (f, o) => (f >= 4 ? f : mod(f + o, 4));
  const mondeVersFace = (d, o) => (d >= 4 ? d : mod(d - o, 4));

  function sortieOuverte(m, it) {
    if (it.p !== 10 || it.gm) return false;
    const pos = positionSalle(m, m.idLib, it);
    if (pos.glisse || pos.tourne || pos.slot !== m.sortieSlot || pos.o !== 0) return false;
    return !slotImplique(m, pos.slot, it);
  }

  /**
   * État d'une porte vue depuis la salle `id`, direction monde `dir`.
   * etat : 'ouverte' | 'mur' | 'verrouillee' | 'vide' | 'bord' | 'condamnee' | 'sortie' | 'aveugle'
   */
  function etatPorte(m, id, dir, it, pos) {
    pos = pos || positionSalle(m, id, it);
    if (!porteMonde(m, id, dir, pos.o)) return { etat: 'mur', voisin: 0 };
    const vs = voisinSlot(m, pos.slot, dir);
    if (pos.glisse || pos.tourne || slotImplique(m, pos.slot, it) || (vs >= 0 && slotImplique(m, vs, it))) {
      return { etat: 'verrouillee', voisin: 0, mutation: true };
    }
    if (vs < 0) {
      if (id === m.idLib && dir === m.SORTIE.dir && sortieOuverte(m, it)) return { etat: 'sortie', voisin: 0 };
      return { etat: 'bord', voisin: 0 };
    }
    const v = salleAuSlot(m, vs, it);
    if (!v) return { etat: 'vide', voisin: 0, slotVoisin: vs };
    const pv = positionSalle(m, v, it);
    if (!porteMonde(m, v, OPPOSE[dir], pv.o)) return { etat: 'aveugle', voisin: v, slotVoisin: vs };
    if (it.ev.fermeture && (h32(m.graine, Math.min(pos.slot, vs), Math.max(pos.slot, vs), it.k) % 5) === 0) {
      return { etat: 'condamnee', voisin: v, slotVoisin: vs };
    }
    return { etat: 'ouverte', voisin: v, slotVoisin: vs };
  }

  function prochainMouvement(m, id, it) {
    const cfg = m.cfg;
    let tType = 0, tDelai = 99;
    const ci = m.salleCirc[id];
    if (ci >= 0) {
      const c = m.circuits[ci], e = etatCircuit(m, c, it);
      const k = indiceSalleCircuit(c, m.salleP[id], e.s);
      const j = mod(e.H - k - 1, c.L); // nombre de pas avant le sien
      let besoin = j + 1;
      for (let d = 0; d <= 6 && besoin > 0; d++) {
        const g = it.g + d;
        const compte = d === 0 ? (circuitBouge(m, c, g) && it.w < cfg.PRE_MS + cfg.MOUV_MS) : circuitBouge(m, c, g);
        if (compte) { besoin--; if (besoin === 0) tDelai = d; }
      }
      const dir = directionEntre(m, c.slots[k], c.slots[mod(k + 1, c.L)]);
      tType = [1, 2, 3, 4, 5, 6][dir];
      if (tDelai > 6) tDelai = 6;
    }
    if (m.rotMasque[id]) {
      for (let d = 0; d <= 6; d++) {
        const g = it.g + d;
        const compte = d === 0 ? (tourne(m, id, g) && it.w < cfg.PRE_MS + cfg.MOUV_MS) : tourne(m, id, g);
        if (compte) { if (d < tDelai || ci < 0) { tType = 7; tDelai = d; } break; }
      }
    }
    if (tType === 0) tDelai = 0;
    if (tDelai > 6) tDelai = 6;
    return { type: tType, delai: tDelai };
  }
  function alerte(m, id, it) {
    const mv = prochainMouvement(m, id, it);
    const pos = positionSalle(m, id, it);
    if (slotImplique(m, pos.slot, it) || (mv.type !== 0 && mv.delai <= 1)) return 3;
    const sp = specSalle(m, id);
    if (sp.famille === 0) return 0;
    if (it.colere >= 50 || it.ev.dragon || it.ev.lames || it.ev.jugement) return 2;
    return 1;
  }
  /** Inscription d'une porte (cadran mobile), calculée depuis l'état réel du Cube. */
  function codePorte(m, id, face, it) {
    const sp = specSalle(m, id), pos = positionSalle(m, id, it);
    const dir = faceVersMonde(face, pos.o);
    const ep = etatPorte(m, id, dir, it, pos);
    let R = 0, H = 0, T = 0;
    if (ep.voisin) {
      R = ep.voisin;
      H = specSalle(m, ep.voisin).famille + 26 * alerte(m, ep.voisin, it);
      const mv = prochainMouvement(m, ep.voisin, it);
      T = mv.type + 8 * mv.delai;
    } else if (ep.etat === 'sortie') {
      H = 25; // état réservé : l'extérieur
    }
    // état réservé documenté : R = 0, H = 0, T = 0 → porte sans destination
    const brut = encoderBrut(R, face, it.p, sp.K, H, T);
    return { groupes: chiffrer(brut, sp.chiffres, sp.K, it.p), R, H, T, etat: ep.etat, brut };
  }

  // =====================================================================
  // 6. SPÉCIFICATION D'UNE SALLE (identité permanente)
  // =====================================================================
  function zoneDe(m, id) {
    const p = slotXYZ(m, m.salleSlot0[id]);
    const d = (p.x / (m.W - 1) + p.y / (m.D - 1) + 1.25 * p.z / (m.HZ - 1)) / 3.25;
    const bruit = ((h32(m.graine, id, 5) % 1000) / 1000 - 0.5) * 0.12;
    return Math.max(0, Math.min(6, Math.floor((d + bruit) * 7)));
  }
  function poidsFamille(z, f) {
    if (f === 0) return Math.max(2, 10 - z * 2); // salles vides : rares, même près de l'entrée
    const r = RANG_FAMILLE[f];
    if (z < r - 1) return 0;
    if (z === r - 1) return 5;
    return z - r >= 3 ? 5 : 10;
  }
  function specSalle(m, id) {
    let sp = m._specs.get(id);
    if (sp) return sp;
    const r = alea(h32(m.graine, id, 77));
    const zone = zoneDe(m, id);
    let famille;
    if (id === m.idLib) famille = 25;
    else if (id === m.idEntree) famille = 0;
    else {
      let tot = 0; const w = [];
      for (let f = 0; f < 25; f++) { const p = poidsFamille(zone, f); w.push(p); tot += p; }
      let x = r() * tot; famille = 0;
      for (let f = 0; f < 25; f++) { x -= w[f]; if (x < 0) { famille = f; break; } }
    }
    // signature mathématique
    const runeA = entre(r, 1, 9), runeB = entre(r, 1, 9);
    const K = cleSalle(runeA, runeB, zone);
    const fams = zone <= 1 ? [1, 3] : zone <= 3 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5];
    const chiffres = [choisir(r, fams)];
    if (zone >= 4 && r() < 0.45) { let f2 = choisir(r, [0, 2, 4]); if (f2 === chiffres[0]) f2 = (f2 + 1) % 6; chiffres.push(f2); }
    // portes (faces locales)
    let portes = 0;
    const p0 = slotXYZ(m, m.salleSlot0[id]);
    const vestibule = p0.x <= 4 && p0.y <= 4 && p0.z <= 1; // salles d'entrée : plus ouvertes
    const pH = vestibule ? 0.9 : m.cfg.P_PORTE_H, pV = vestibule ? 0.5 : m.cfg.P_PORTE_V;
    for (let f = 0; f < 4; f++) if (r() < pH) portes |= 1 << f;
    while (popc(portes & 15) < 2) portes |= 1 << entre(r, 0, 3);
    if (r() < pV) portes |= 1 << 4;
    if (r() < pV) portes |= 1 << 5;
    if (id === m.idEntree) portes = 1 | 2 | 4 | 8 | 16;
    if (id === m.idLib) portes |= 2 | 8;
    // apparence et traits distinctifs
    const palette = choisir(r, PALETTES);
    const nbTraits = entre(r, 1, 3), traits = [];
    for (let i = 0; i < nbTraits; i++) {
      const nom = choisir(r, TRAITS);
      if (traits.some(t => t.nom === nom)) continue;
      traits.push({ nom, coin: entre(r, 0, 3), mur: entre(r, 0, 3), var: r() });
    }
    const degats = r() < 0.5 ? entre(r, 1, 4) : 0;
    const lanterne = choisir(r, [0xffb347, 0xff8a3d, 0xffd27a, 0x9fd8c0, 0xd9a0ff]);
    const glyphe = entre(r, 0, 11);
    // pièges
    const pieges = genererPieges(m, id, famille, zone, r);
    // butin
    const butin = [];
    const pB = id === m.idLib ? 1 : 0.1 + zone * 0.035;
    if (id !== m.idEntree && r() < pB) {
      const nb = r() < 0.3 ? 2 : 1;
      for (let i = 0; i < nb; i++) {
        const x = r() + zone * 0.06;
        const rar = id === m.idLib ? 'legendaire' : x > 1.08 ? 'legendaire' : x > 0.9 ? 'epique' : x > 0.55 ? 'rare' : 'commun';
        const type = choisir(r, PAR_RARETE[rar]);
        let px = (r() * 2 - 1) * 4.2, pz = (r() * 2 - 1) * 4.2;
        if (Math.abs(px) < 1.6 && Math.abs(pz) < 1.6) px += 2.5;
        butin.push({ cle: id + '-' + i, type, qte: OBJETS[type].cat === 'monnaie' ? entre(r, 1, 3) : 1, x: px, z: pz });
      }
    }
    // fausse sortie
    let fausseSortie = null;
    if (zone >= 2 && famille !== 25 && r() < 0.07) {
      const faces = [0, 1, 2, 3].filter(f => !((portes >> f) & 1));
      if (faces.length) fausseSortie = { face: choisir(r, faces), mode: choisir(r, ['lumiere', 'refermante', 'retour']) };
    }
    sp = { id, zone, famille, runeA, runeB, K, chiffres, portes, palette, traits, degats, lanterne, glyphe, pieges, butin, fausseSortie };
    m._specs.set(id, sp);
    return sp;
  }

  // ---------- Paramètres des pièges (données pures, coordonnées locales -6..6) ----------
  const TYPES_PAR_FAMILLE = {
    0: [], 1: ['pointes'], 2: ['lamesMur', 'lamesMur'], 3: ['broyeur'], 4: ['flammes'], 5: ['fleches', 'dalle'],
    6: ['fosses', 'solDerobe'], 7: ['plateforme'], 8: ['coulissant'], 9: ['trompeur', 'fosses'], 10: ['engrenages'],
    11: ['pendule'], 12: ['silence'], 13: ['lumiere'], 14: ['obscurite', 'fosses'], 15: ['temps', 'pointes'],
    16: ['labyrinthe'], 17: ['enigme'], 18: ['teleport'], 19: ['statue'], 20: ['herse', 'chaines'],
    21: ['instable', 'plafond'], 22: null, 23: ['labyrinthe', 'pointes', 'escalier'], 24: null, 25: ['pendule'],
  };
  const MORTELS = ['pointes', 'lamesMur', 'broyeur', 'flammes', 'fleches', 'solDerobe', 'pendule', 'herse', 'plafond',
    'rouleau', 'plateforme', 'scie', 'statue', 'engrenages', 'coulissant'];
  function genererPieges(m, id, famille, zone, r) {
    let types = TYPES_PAR_FAMILLE[famille];
    if (types === null) { // Jugement / Mort : combinaisons
      const nb = famille === 24 ? 4 : 3; types = [];
      while (types.length < nb) { const t = choisir(r, MORTELS); if (!types.includes(t)) types.push(t); }
      if (famille === 24) types.push('condamnee');
    }
    types = types.slice();
    // variantes combinées (Salle du Broyeur, Couloir des Lames, Pont des Damnés, Chambre du Dragon…)
    if (famille === 3 && r() < 0.5) types.push('pointes');
    if (famille === 2 && r() < 0.4) types.push('herse');
    if (famille === 6 && r() < 0.5) types.push('fleches');
    if (famille === 19 && r() < 0.35) types.push('herse');
    if (famille === 11 && r() < 0.4) types.push('scie');
    if (famille === 10 && r() < 0.4) types.push('rouleau');
    if (famille === 21 && r() < 0.3) types.push('escalier');
    if (famille !== 0 && famille !== 17 && famille !== 18 && r() < 0.06 + zone * 0.02) types.push('escalier');
    const sync = famille === 24 || famille === 22;
    const tempo = 1 - zone * 0.045;
    return types.map((type, i) => paramPiege(type, r, zone, tempo, sync, i));
  }
  function paramPiege(type, r, zone, tempo, sync, i) {
    const P = ms => Math.round(ms * tempo);
    const off = sync ? 0 : Math.floor(r() * 20000);
    const axe = r() < 0.5 ? 'x' : 'z';
    const voie = () => [-3.6, -1.2, 1.2, 3.6][entre(r, 0, 3)];
    switch (type) {
      case 'pointes': {
        const c0 = entre(r, -4, 1) * 1.5, larg = entre(r, 2, 4) * 1.5;
        return { type, axe, a0: c0, a1: Math.min(6, c0 + larg), motif: choisir(r, ['vague', 'damier', 'rangs']), periode: P(entre(r, 5000, 8000)), off };
      }
      case 'lamesMur': {
        const n = entre(r, 2, 3), pos = [];
        for (let k = 0; k < n; k++) pos.push(-4 + k * (8 / (n - 1 || 1)) + (r() - 0.5));
        return { type, mur: entre(r, 0, 3), pos, long: 3 + r() * 4.5, periode: P(entre(r, 3500, 6000)), off, dec: 0.18 + r() * 0.2 };
      }
      case 'broyeur': { const c = (r() - 0.5) * 4; return { type, axe, c0: c - 1.9, c1: c + 1.9, periode: P(entre(r, 9000, 12500)), off }; }
      case 'flammes': {
        const n = entre(r, 2, 3), buses = [];
        for (let k = 0; k < n; k++) buses.push({ mur: entre(r, 0, 3), pos: voie() + (r() - 0.5), long: 4 + r() * 6, dec: r() });
        return { type, buses, periode: P(entre(r, 4200, 6500)), off };
      }
      case 'fleches': {
        const n = entre(r, 3, 5), trous = [];
        for (let k = 0; k < n; k++) trous.push(-4.8 + r() * 9.6);
        return { type, mur: entre(r, 0, 3), trous, periode: P(entre(r, 3800, 6000)), off, vitesse: 11 + zone };
      }
      case 'dalle': {
        const n = entre(r, 1, 3), dalles = [];
        for (let k = 0; k < n; k++) dalles.push({ x: (r() * 2 - 1) * 4, z: (r() * 2 - 1) * 4, mur: entre(r, 0, 3) });
        return { type, dalles };
      }
      case 'fosses': {
        const cases = []; const n = entre(r, 3, 7) + zone;
        for (let k = 0; k < n; k++) {
          const ci = entre(r, 0, 7), cj = entre(r, 0, 7);
          if ((ci === 3 || ci === 4) && (cj === 3 || cj === 4)) continue;
          cases.push([ci, cj]);
        }
        return { type, cases };
      }
      case 'solDerobe': {
        const c = voie(); return { type, axe, c0: c - 1.5, c1: c + 1.5, sens: r() < 0.5 ? 1 : -1, periode: P(entre(r, 9000, 12000)), off };
      }
      case 'pendule': {
        const n = entre(r, 2, 3), lignes = [];
        for (let k = 0; k < n; k++) lignes.push({ axe: r() < 0.5 ? 'x' : 'z', c: -3.6 + k * 3.6 + (r() - 0.5), amp: 4.2, periode: P(entre(r, 2600, 3800)), off: Math.floor(r() * 4000) });
        return { type, lignes };
      }
      case 'herse': return { type, periode: P(entre(r, 6000, 9000)), off, faces: [0, 1, 2, 3].filter(() => r() < 0.6) };
      case 'plafond': { const cx = (r() - 0.5) * 5, cz = (r() - 0.5) * 5, s = 1.7 + r() * 0.8; return { type, x0: cx - s, x1: cx + s, z0: cz - s, z1: cz + s, periode: P(entre(r, 8000, 11000)), off }; }
      case 'rouleau': return { type, axe, c: voie(), larg: 3.2, periode: P(entre(r, 5000, 7500)), off };
      case 'engrenages': return { type, axe, c: voie(), periode: P(entre(r, 6000, 8500)), off, rayon: 1.6 };
      case 'plateforme': return { type, rayon: 3.4, vitesse: (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5) / tempo, secteur: 1.1 + r() * 0.5, off };
      case 'scie': {
        const n = entre(r, 1, 3), rails = [];
        for (let k = 0; k < n; k++) rails.push({ axe: r() < 0.5 ? 'x' : 'z', c: voie(), periode: P(entre(r, 3200, 5200)), off: Math.floor(r() * 5000) });
        return { type, rails };
      }
      case 'statue': {
        const n = entre(r, 2, 4), coins = [[-4.8, -4.8], [4.8, -4.8], [4.8, 4.8], [-4.8, 4.8]], st = [];
        for (let k = 0; k < n; k++) st.push({ x: coins[k][0], z: coins[k][1], base: entre(r, 0, 3), dec: r() });
        return { type, statues: st, periode: P(entre(r, 5000, 7000)), off };
      }
      case 'coulissant': {
        const n = entre(r, 1, 2), murs = [];
        for (let k = 0; k < n; k++) murs.push({ axe: r() < 0.5 ? 'x' : 'z', c: voie(), long: 2.2, periode: P(entre(r, 5000, 8000)), off: Math.floor(r() * 6000) });
        return { type, murs };
      }
      case 'labyrinthe': {
        const murs = [];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 4; b++) {
          if (r() < 0.55) murs.push({ v: true, i: a, j: b, groupe: entre(r, 0, 2) });
          if (r() < 0.55) murs.push({ v: false, i: b, j: a, groupe: entre(r, 0, 2) });
        }
        return { type, murs, periode: P(entre(r, 6000, 9000)), off };
      }
      case 'lumiere': {
        const n = entre(r, 2, 3), f = [];
        for (let k = 0; k < n; k++) f.push({ axe: r() < 0.5 ? 'x' : 'z', vitesse: 0.12 + r() * 0.12, dec: r() });
        return { type, faisceaux: f, periode: P(entre(r, 3000, 4500)), off };
      }
      case 'temps': return { type, periode: P(entre(r, 8000, 11000)), ouvert: 0.32, off };
      case 'trompeur': return { type, mortel: r() < 0.55 };
      case 'chaines': {
        const n = entre(r, 4, 8), ch = [];
        for (let k = 0; k < n; k++) ch.push({ x: (r() * 2 - 1) * 4.5, z: (r() * 2 - 1) * 4.5 });
        return { type, chaines: ch };
      }
      case 'instable': {
        const d = []; for (let k = 0; k < 6; k++) d.push({ i: entre(r, 0, 3), j: entre(r, 0, 3), dec: r() });
        return { type, dalles: d, periode: P(entre(r, 5000, 8000)), off };
      }
      case 'escalier': return { type, periode: P(entre(r, 7000, 10000)), off };
      case 'condamnee': return { type, niche: entre(r, 0, 3), periode: P(entre(r, 14000, 18000)), off };
      case 'enigme': {
        const t = entre(r, 0, 3); let suite;
        if (t === 0) { const a = entre(r, 2, 9), d = entre(r, 3, 17); suite = [0, 1, 2, 3, 4].map(k => a + d * k); }
        else if (t === 1) { const a = entre(r, 1, 3), q = entre(r, 2, 3); suite = [0, 1, 2, 3, 4].map(k => a * Math.pow(q, k)); }
        else if (t === 2) { let a = entre(r, 1, 5), b = entre(r, 2, 7); suite = [a, b]; while (suite.length < 5) suite.push(suite[suite.length - 1] + suite[suite.length - 2]); }
        else { const p = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71]; const s = entre(r, 0, 14); suite = p.slice(s, s + 5); }
        const trou = entre(r, 2, 4);
        return { type, suite, trou, reponse: suite[trou] % 1000 };
      }
      case 'teleport': return { type, cible: Math.floor(r() * 1e9), phases: (1 << entre(r, 0, 11)) | (1 << entre(r, 0, 11)) };
      case 'silence': return { type };
      case 'obscurite': return { type };
    }
    return { type };
  }

  // =====================================================================
  // 7. CADAVRES : décomposition sur 60 jours du calendrier du Cube
  // =====================================================================
  const STADES = ['Corps intact', 'Décomposition initiale', 'Décomposition avancée', 'Squelette complet',
    'Squelette se désagrégeant', 'Disparu'];
  function stadeCorps(ageJours) {
    if (ageJours < 7) return { stade: 0, f: ageJours / 7 };
    if (ageJours < 15) return { stade: 1, f: (ageJours - 7) / 8 };
    if (ageJours < 30) return { stade: 2, f: (ageJours - 15) / 15 };
    if (ageJours < 45) return { stade: 3, f: (ageJours - 30) / 15 };
    if (ageJours < 60) return { stade: 4, f: (ageJours - 45) / 15 };
    return { stade: 5, f: 1 };
  }

  // =====================================================================
  // 8. TÉLÉPORTATION CODIFIÉE ET FAUSSES SORTIES
  // =====================================================================
  function cibleTeleport(m, id, it, param) {
    if (!((param.phases >> it.p) & 1)) return 0;
    const h = h32(param.cible, it.k, it.p);
    const pos = positionSalle(m, id, it);
    const p = slotXYZ(m, pos.slot);
    const x = Math.max(0, Math.min(m.W - 1, p.x + (h % 9) - 4));
    const y = Math.max(0, Math.min(m.D - 1, p.y + ((h >>> 4) % 9) - 4));
    const z = Math.max(0, Math.min(m.HZ - 1, p.z + ((h >>> 8) % 3) - 1));
    return salleAuSlot(m, m.idx(x, y, z), it);
  }

  // =====================================================================
  // 8 bis. VERROUS À ÉNIGME DES PORTES
  // Chaque porte (et chaque trappe) a son énigme, la même pour tous les
  // joueurs : elle dépend de la graine, de la salle et de la face. La
  // difficulté suit la région. La réponse est toujours un entier positif.
  // =====================================================================
  const COMPTES = [
    ['les pattes d’une araignée', 8], ['les pattes d’un chien', 4], ['les pattes d’une grue', 2],
    ['les faces d’un cube', 6], ['les arêtes d’un cube', 12], ['les sommets d’un cube', 8],
    ['les saisons', 4], ['les mois de l’année', 12], ['les heures d’une journée', 24],
    ['les doigts de deux mains', 10], ['les animaux du zodiaque chinois', 12], ['les cinq éléments', 5],
    ['les côtés d’un hexagone', 6], ['les jours d’une semaine', 7], ['les pieds d’un tabouret à trois pieds', 3],
    ['les trigrammes du Yi Jing', 8], ['les sabots d’un cheval', 4], ['les points cardinaux', 4],
  ];
  const MOTS_FOIS = ['', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'];
  const LUO_SHU = [[4, 9, 2], [3, 5, 7], [8, 1, 6]];
  function enigmePorte(m, id, face) {
    const sp = specSalle(m, id);
    const r = alea(h32(m.graine, id, face + 1, 9191));
    const z = sp.zone;
    const types = z <= 0 ? ['suite', 'devinette', 'cage', 'balance']
      : z <= 2 ? ['suite', 'devinette', 'cage', 'balance', 'soldats', 'carre']
        : ['suite', 'devinette', 'cage', 'balance', 'soldats', 'carre', 'ages'];
    const type = id === m.idLib ? 'soldats' : choisir(r, types);
    switch (type) {
      case 'suite': {
        const gens = [
          () => { const a = entre(r, 2, 20), d = entre(r, 3, 9 + z * 4); return k => a + d * k; },
          () => { const a = entre(r, 1, 4), q = entre(r, 2, 3); return k => a * Math.pow(q, k); },
          () => { const a = entre(r, 1, 6); return k => (k + a) * (k + a); },
          () => { const f = [entre(r, 1, 5), entre(r, 2, 8)]; for (let i = 2; i < 8; i++) f.push(f[i - 1] + f[i - 2]); return k => f[k]; },
          () => { const a = entre(r, 2, 9), d = entre(r, 1, 4), e = entre(r, 1, 3); return k => a + d * k + e * k * (k - 1); },
          () => { const c = entre(r, 1, 3); return k => Math.pow(2, k + 2) - c; },
          () => { const a = entre(r, 5, 15), b = entre(r, 40, 60), d1 = entre(r, 2, 5), d2 = entre(r, 3, 7); return k => (k % 2 === 0 ? a + d1 * (k / 2) : b - d2 * ((k - 1) / 2)); },
          () => { const p = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]; const st = entre(r, 0, 7); return k => p[st + k]; },
          () => { const a = entre(r, 1, 4); return k => (k + a) * (k + a + 1) / 2; },
        ];
        const g = gens[Math.floor(r() * (z <= 0 ? 4 : z <= 2 ? 7 : gens.length))]();
        const termes = [0, 1, 2, 3, 4, 5].map(g), trou = entre(r, 2, 5);
        const enBatons = z >= 4;
        return {
          type, titre: 'La suite gravée', reponse: termes[trou],
          lignes: [enBatons ? 'Six nombres sont gravés en bâtonnets sur la plaque du verrou. L’un d’eux est caché sous un sceau rouge.' : 'Six nombres sont gravés sur la plaque du verrou. L’un d’eux est caché sous un sceau rouge :',
            enBatons ? '' : termes.map((v, i) => (i === trou ? '?' : String(v))).join('  ·  '),
            'Ils obéissent tous à la même loi. Quel nombre se cache sous le sceau ?'].filter(Boolean),
          figure: enBatons ? { batons: termes, trou } : null,
        };
      }
      case 'devinette': {
        const sac = COMPTES.slice(); const pris = [];
        for (let i = 0; i < 4; i++) pris.push(sac.splice(Math.floor(r() * sac.length), 1)[0]);
        const [A, B, C, Dd] = pris;
        let lignes, reponse;
        if (z <= 1) { reponse = A[1] * B[1] + C[1]; lignes = ['Prends ' + A[0] + '.', 'Multiplie-les par ' + B[0] + '.', 'Ajoute ' + C[0] + '.', 'Quel nombre tiens-tu ?']; }
        else if (z <= 3) {
          const base = A[1] * B[1] + C[1];
          const retirables = sac.concat([Dd]).filter(x => x[1] < base);
          const Rr = retirables.length ? choisir(r, retirables) : ['les pieds d’un tabouret à trois pieds', 3];
          pris[3] = Rr;
          reponse = base - Rr[1];
          lignes = ['Prends ' + A[0] + '.', 'Multiplie-les par ' + B[0] + '.', 'Ajoute ' + C[0] + ', puis retire ' + pris[3][0] + '.', 'Quel nombre tiens-tu ?'];
        } else {
          const d = Dd[1] > 2 ? Dd[1] : 7;
          reponse = (A[1] * B[1] + C[1]) % d;
          if (reponse === 0) reponse = d;
          lignes = ['Prends ' + A[0] + ', multiplie-les par ' + B[0] + ' et ajoute ' + C[0] + '.', 'Range ce total en tas de ' + d + '.', 'Combien en reste-t-il dans le dernier tas, s’il n’est pas complet ? (S’il est complet, réponds ' + d + '.)'];
        }
        return { type, titre: 'L’énigme du gardien', lignes, reponse, figure: null };
      }
      case 'cage': {
        const lap = entre(r, 4, 10 + z * 5), fai = entre(r, 4, 14 + z * 5), arai = z >= 3 ? entre(r, 2, 4) : 0;
        const tetes = lap + fai + arai, pattes = 4 * lap + 2 * fai + 8 * arai;
        const demande = r() < 0.5 ? 'lapins' : 'faisans';
        const lignes = ['Dans une cage du marché, on a enfermé des faisans et des lapins.'];
        if (arai) lignes.push('Au plafond de la cage pendent aussi ' + arai + ' araignées, que l’on a comptées avec le reste.');
        lignes.push('On compte ' + tetes + ' têtes et ' + pattes + ' pattes.', 'Combien y a-t-il de ' + demande + ' ?');
        return { type, titre: 'La cage du marché', lignes, reponse: demande === 'lapins' ? lap : fai, figure: null };
      }
      case 'soldats': {
        const mods = z >= 4 || id === m.idLib ? [3, 5, 7, 11] : [3, 5, 7];
        const prod = mods.reduce((a, b) => a * b, 1);
        const n = entre(r, 10, prod - 1);
        const restes = mods.map(q => n % q);
        const lignes = ['Le général Han Xin fait compter ses soldats.']
          .concat(mods.map((q, i) => 'En rangs de ' + q + ', il en reste ' + restes[i] + '.'))
          .concat(['Combien a-t-il de soldats, au minimum ?']);
        return { type, titre: 'Le compte de Han Xin', lignes, reponse: n, figure: null };
      }
      case 'carre': {
        let g = LUO_SHU.map(l => l.slice());
        const rot = entre(r, 0, 3), miroir = r() < 0.5;
        for (let i = 0; i < rot; i++) g = g[0].map((_, j) => g.map(l => l[j]).reverse());
        if (miroir) g = g.map(l => l.slice().reverse());
        const k = z >= 3 ? entre(r, 2, 3) : 1, c = entre(r, 0, 4 + z * 3);
        g = g.map(l => l.map(v => v * k + c));
        const cases = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) cases.push([i, j]);
        const [ti, tj] = choisir(r, cases);
        const caches = [[ti, tj]];
        const autres = cases.filter(([i, j]) => i !== ti && !(i === ti && j === tj));
        const nb = z >= 3 ? 3 : 1;
        for (let n = 0; n < nb && autres.length; n++) caches.push(autres.splice(Math.floor(r() * autres.length), 1)[0]);
        return {
          type, titre: 'La tortue de Luo', reponse: g[ti][tj],
          lignes: ['Sur la carapace de la tortue sacrée, chaque ligne, chaque colonne et chaque diagonale donnent la même somme.', 'Quel nombre faut-il graver à la place du point d’interrogation ?'],
          figure: { carre: g, caches: caches.map(([i, j]) => i * 3 + j), cible: ti * 3 + tj },
        };
      }
      case 'balance': {
        const x = entre(r, 3, 9 + z * 3), a = entre(r, 3, 7), c = entre(r, 1, a - 1), b = entre(r, 1, 20);
        const d = (a - c) * x + b;
        return {
          type, titre: 'La balance du marchand', reponse: x, figure: null,
          lignes: ['Sur la balance du marchand, ' + a + ' jarres et ' + b + ' poids de bronze font exactement équilibre avec ' + c + ' jarre' + (c > 1 ? 's' : '') + ' et ' + d + ' poids.', 'Toutes les jarres sont identiques. Combien de poids pèse une jarre ?'],
        };
      }
      case 'ages': {
        let d = 0, k = 0, j = 0, n = 0;
        for (let essai = 0; essai < 200; essai++) {
          d = entre(r, 4, 14); k = entre(r, 3, 6); j = entre(r, 2, k - 1);
          const num = d * (k - j), den = j - 1;
          if (num % den === 0 && num / den > 0 && num / den <= 40) { n = num / den; break; }
        }
        if (!n) { d = 5; k = 4; j = 2; n = 10; }
        return {
          type, titre: 'Le maître et le disciple', reponse: d, figure: null,
          lignes: ['Aujourd’hui, le maître a ' + MOTS_FOIS[k] + ' fois l’âge de son disciple.', 'Dans ' + n + ' ans, il n’aura plus que ' + MOTS_FOIS[j] + ' fois son âge.', 'Quel âge a le disciple aujourd’hui ?'],
        };
      }
    }
    return { type: 'suite', titre: 'La suite gravée', lignes: ['1 · 2 · 3 · ?'], reponse: 4, figure: null };
  }

  // =====================================================================
  // 9. AUTO-TEST DU MOTEUR (vecteur de référence fourni)
  // =====================================================================
  function autoTest() {
    const g = encoderBrut(118, 1, 4, 240, 55, 21).map(formaterGroupe).join(' – ');
    const d = decoderBrut(encoderBrut(118, 1, 4, 240, 55, 21), 1, 4, 240);
    return { inscription: g, ok: g === '0711 – 0575 – 0347 – 0530 – 0824' && d.R === 118 && d.H === 55 && d.T === 21 && d.valide };
  }

  const MoteurCube = {
    CONFIG, PHASES, FAMILLES_CHIFFRE, FAMILLES_SALLE, REGIONS, OBJETS, PAR_RARETE, PALETTES, TRAITS, STADES, DIRS, OPPOSE,
    h32, alea, mod, popc, M, encoderBrut, decoderBrut, chiffrer, dechiffrer, etapesFamille, cleSalle, formaterGroupe,
    creerMonde, slotXYZ, voisinSlot, directionEntre, instant, evenementsCycle, paliersColere,
    etatCircuit, compteMouv, circuitBouge, indiceSalleCircuit, salleIndiceCircuit, salleAuSlot, positionSalle, orientation,
    slotImplique, etatPorte, porteMonde, faceVersMonde, mondeVersFace, sortieOuverte, prochainMouvement, alerte, codePorte,
    specSalle, zoneDe, stadeCorps, cibleTeleport, enigmePorte, autoTest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MoteurCube;
  else racine.MoteurCube = MoteurCube;
})(typeof window !== 'undefined' ? window : globalThis);
