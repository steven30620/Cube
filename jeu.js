/* =====================================================================
   LE CUBE DES MILLE SUPPLICES — jeu, réseau, interface
   ===================================================================== */
(function () {
  'use strict';
  const C = window.MoteurCube, R = window.RenduCube, THREE = R.THREE, CF = C.CONFIG;
  const DM = CF.DEMI, PL = CF.PORTE, EP = CF.MUR, HT = CF.HAUT, TAU = Math.PI * 2;
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const avecDelai = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('délai')), ms))]);
  const ONGLET = Math.random().toString(36).slice(2, 10);
  const journal = (txt, t0) => { try { console.info('[Cube] ' + txt + ' — ' + Math.round(performance.now() - t0) + ' ms'); } catch (e) { /* */ } };
  const INSTANCES = ['cube-01', 'cube-02', 'cube-03', 'cube-04', 'cube-05', 'cube-06', 'cube-07', 'cube-08', 'cube-09'];
  const NOMS_STATS = { force: 'Force', agilite: 'Agilité', intelligence: 'Intelligence', discipline: 'Discipline', sangFroid: 'Sang-froid' };
  const STATUTS = { captif: 'Captif', cube: 'Dans le Cube', mort: 'Mort dans le Cube', evade: 'Évadé' };
  const MONNAIES = { or: 'Or', orNoir: 'Or Noir', jetons: 'Jetons de casino' };
  const CATEGORIES = { arme: 'Armes', armure: 'Armures', bijou: 'Bijoux', offrande: 'Offrandes', materiau: 'Matériaux', document: 'Documents', cle: 'Clés', collection: 'Collection' };

  // =====================================================================
  // RÉSEAU : db (persistant partagé), room (temps réel), user (identité)
  // =====================================================================
  const N = {
    db: null, room: null, user: null, uid: null, salon: null, decalage: 0, ecoutes: [], peutEcrire: true,
    get peers() { try { return this.salon ? (this.salon.peers() || []) : []; } catch (e) { return []; } },
    maintenant() { return Date.now() + this.decalage; },
    async init() {
      for (let i = 0; i < 20 && !(window.claude && window.claude.use); i++) await dormir(100);
      if (!(window.claude && window.claude.use)) return;
      const t0 = performance.now();
      const prendre = n => avecDelai(window.claude.use(n), 11000).catch(() => null);
      // la salle temps réel ne bloque pas le chargement du pavillon
      this.pRoom = prendre('room').then(r => { this.room = r; journal('room ' + (r ? 'prête' : 'absente'), t0); return r; });
      const [u, d] = await Promise.all([prendre('user'), prendre('db')]);
      this.user = u; this.db = d;
      journal('user ' + (u ? 'ok' : 'absent') + ', db ' + (d ? 'ok' : 'absente'), t0);
      if (u) {
        for (let essai = 0; essai < 3 && !this.uid; essai++) {
          try { this.uid = await avecDelai(Promise.resolve(u.id()), 4000); } catch (e) { this.uid = null; }
          if (!this.uid) await dormir(700);
        }
        journal('identité ' + (this.uid ? 'reçue' : 'non reçue'), t0);
        Promise.resolve(u.can('data.write')).then(c => { if (c === false) this.peutEcrire = false; }).catch(() => {});
      }
      if (this.db && this.uid) this.synchroniserHorloge();
    },
    async synchroniserHorloge() {
      try {
        const ref = this.db.doc('data/users/' + this.uid + '/horloge');
        const t0 = Date.now();
        const r = await avecDelai(ref.acquire({ holder: ONGLET, ttlMs: 1000 }), 5000);
        const t1 = Date.now();
        if (r && r.expiresAt) { const serveur = Date.parse(r.expiresAt) - 1000; this.decalage = Math.round(serveur - (t0 + t1) / 2); if (Math.abs(this.decalage) > 6 * 3600e3) this.decalage = 0; }
      } catch (e) { /* horloge locale */ }
    },
    async rejoindre(nom) {
      if (!this.room && this.pRoom) await avecDelai(this.pRoom, 4000).catch(() => null);
      if (!this.room) return null;
      try {
        this.quitterSalon();
        const s = await avecDelai(Promise.resolve(this.room.join(nom)), 6000);
        this.salon = s;
        s.onPeers(() => {}, () => {});
        s.on('piege', m => { if (m && !m.sameTab) J.recevoirPiege(m.data, m); }, () => {});
        s.on('mort', m => { if (m && !m.sameTab) J.recevoirMort(m.data, m); }, () => {});
        s.on('chat', m => { if (m && !m.sameTab) J.recevoirChat(m.data, m); }, () => {});
        return s;
      } catch (e) { this.salon = null; return null; }
    },
    quitterSalon() { if (this.salon) { try { this.salon.leave().catch(() => {}); } catch (e) { /* */ } this.salon = null; } },
    presence(p) { if (this.salon) try { this.salon.presence(p).catch(() => {}); } catch (e) { /* */ } },
    emettre(topic, d) { if (this.salon) try { this.salon.emit(topic, d).catch(() => {}); } catch (e) { /* */ } },
  };
  const lirePeer = p => (p && p.presence) || {};
  const idPeer = p => (p && p.peer) || '';
  const estMoi = p => !!(p && p.sameTab);

  // ---------- écritures sérialisées par document ----------
  const files = new Map();
  function ecrireDoc(chemin, data) {
    let f = files.get(chemin);
    if (!f) { f = { enCours: null, attente: null }; files.set(chemin, f); }
    f.attente = data;
    if (f.enCours) return f.enCours;
    f.enCours = (async () => {
      while (f.attente) {
        const d = f.attente; f.attente = null;
        if (N.db && N.uid) { try { await N.db.doc(chemin).set(d); } catch (e) { if (e && e.code === 'invalid_argument') N.peutEcrire = false; } }
        else Local.ecrire(chemin, d);
      }
      f.enCours = null;
    })();
    return f.enCours;
  }
  async function lireDoc(chemin) {
    if (N.db && N.uid) { try { const s = await avecDelai(N.db.doc(chemin).get(), 7000); return s.exists ? s.data() : null; } catch (e) { return null; } }
    return Local.lire(chemin);
  }
  const Local = {
    memo: {},
    charger() { try { this.memo = JSON.parse(localStorage.getItem('cube-mille-supplices') || '{}'); } catch (e) { this.memo = {}; } },
    sauver() { try { localStorage.setItem('cube-mille-supplices', JSON.stringify(this.memo)); } catch (e) { /* mémoire seule */ } },
    lire(k) { return this.memo[k] ? JSON.parse(JSON.stringify(this.memo[k])) : null; },
    ecrire(k, v) { this.memo[k] = JSON.parse(JSON.stringify(v)); this.sauver(); },
  };
  Local.charger();
  const idDoc = () => String(N.uid || 'local').replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 24) + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const cheminJoueur = k => (N.db && N.uid ? 'data/users/' + N.uid + '/' + k : 'local/' + k);

  // =====================================================================
  // DONNÉES DU JOUEUR
  // =====================================================================
  const D = { coffre: null, persos: null, tentative: null, reglages: null, carnets: {} };
  const coffreVide = () => ({ monnaies: { or: 0, orNoir: 0, jetons: 0 }, objets: {}, journal: [] });
  async function chargerJoueur() {
    // les quatre lectures partent en même temps
    const [co, p, te, re] = await Promise.all(['coffre', 'personnages', 'tentative', 'reglages'].map(k => lireDoc(cheminJoueur(k))));
    D.coffre = co || coffreVide();
    D.coffre.monnaies = Object.assign({ or: 0, orNoir: 0, jetons: 0 }, D.coffre.monnaies || {});
    D.coffre.objets = D.coffre.objets || {}; D.coffre.journal = D.coffre.journal || [];
    D.persos = (p && p.liste) || [];
    D.tentative = te && te.perso ? te : null;
    D.reglages = Object.assign({ bloques: [], chatMasque: false, son: true }, re || {});
    // crédits en attente (si une écriture du Coffre a échoué)
    try { const att = JSON.parse(localStorage.getItem('cube-credits-attente') || '[]'); if (att.length) { att.forEach(a => appliquerCredit(a)); localStorage.removeItem('cube-credits-attente'); sauverCoffre(); } } catch (e) { /* */ }
    if (!D.persos.length) { D.persos.push(nouveauPerso('Akira')); sauverPersos(); }
  }
  const sauverCoffre = () => ecrireDoc(cheminJoueur('coffre'), D.coffre);
  const sauverPersos = () => ecrireDoc(cheminJoueur('personnages'), { liste: D.persos });
  const sauverTentative = () => (D.tentative ? ecrireDoc(cheminJoueur('tentative'), D.tentative) : ecrireDoc(cheminJoueur('tentative'), { perso: null }));
  const sauverReglages = () => ecrireDoc(cheminJoueur('reglages'), D.reglages);
  function appliquerCredit(c) {
    const def = C.OBJETS[c.type]; if (!def) return;
    if (def.cat === 'monnaie') D.coffre.monnaies[def.monnaie] = (D.coffre.monnaies[def.monnaie] || 0) + def.valeur * (c.qte || 1);
    else D.coffre.objets[c.type] = (D.coffre.objets[c.type] || 0) + (c.qte || 1);
    D.coffre.journal.unshift({ t: c.t, type: c.type, qte: c.qte || 1, perso: c.perso || '', nom: c.nom || def.nom });
    if (D.coffre.journal.length > 150) D.coffre.journal.length = 150;
  }
  async function crediterCoffre(c) {
    appliquerCredit(c);
    try { await sauverCoffre(); } catch (e) {
      try { const att = JSON.parse(localStorage.getItem('cube-credits-attente') || '[]'); att.push(c); localStorage.setItem('cube-credits-attente', JSON.stringify(att)); } catch (e2) { /* */ }
    }
    window.dispatchEvent(new CustomEvent('cube:gain', { detail: c }));
  }

  const PRENOMS = ['Akira', 'Mei', 'Ren', 'Lian', 'Hoshi', 'Wen', 'Sora', 'Jin', 'Yuki', 'Bao', 'Kaito', 'Lan', 'Hana', 'Tao'];
  const COULEURS = [0xa3271f, 0x1f3d6a, 0x2f5a3a, 0x6a4a1a, 0x3a2a4a, 0x1a1a1e, 0x8a6a32, 0x5a1a3a, 0xd8c9a0];
  const COIFFES = ['kasa', 'chignon', 'casque', 'bandeau', 'voile', 'nu'];
  const EQUIPEMENT = [['dao', 'rouleau'], ['cle', 'encens'], ['bracelet', 'rouleau'], ['dao', 'encens'], ['armure', 'cle']];
  function nouveauPerso(nom, look, stats) {
    const r = Math.random;
    const pick = t => t[Math.floor(r() * t.length)];
    if (!stats) { stats = {}; let reste = 250; const ks = Object.keys(NOMS_STATS); ks.forEach((k, i) => { const v = i === ks.length - 1 ? clamp(reste, 10, 90) : clamp(Math.round(30 + r() * 40), 10, 90); stats[k] = v; reste -= v; }); }
    return {
      id: 'p' + Date.now().toString(36) + Math.floor(r() * 1e6).toString(36),
      nom: nom || pick(PRENOMS),
      look: look || { tunique: pick(COULEURS), pantalon: pick(COULEURS), ceinture: 0xc9a24a, peau: pick(['jaune', 'jaune', 'clair', 'mat', 'brun']), coiffe: pick(COIFFES) },
      stats, equipement: pick(EQUIPEMENT).map(type => ({ type })), statut: 'captif', tentatives: [], cree: Date.now(),
    };
  }

  // =====================================================================
  // DONNÉES PARTAGÉES DE L'INSTANCE
  // =====================================================================
  const I = { id: null, graine: 0, t0: 0, corps: new Map(), sol: new Map(), butinPris: new Set(), desabonner: [] };
  async function ouvrirInstance(nom) {
    I.id = nom; I.corps.clear(); I.sol.clear(); I.butinPris.clear();
    I.desabonner.forEach(f => { try { f(); } catch (e) { /* */ } }); I.desabonner = [];
    if (N.db) {
      const ref = N.db.doc('instances/' + nom);
      let d = null;
      try { const s = await avecDelai(ref.get(), 10000); d = s.exists ? s.data() : null; } catch (e) { d = null; }
      if (!d || !d.graine) {
        try {
          const l = await avecDelai(ref.acquire({ holder: (N.uid || 'x') + ONGLET, ttlMs: 4000 }), 6000);
          const s = await avecDelai(ref.get(), 7000); d = s.exists ? s.data() : null;
          if ((!d || !d.graine) && l && l.acquired) { d = { graine: (Math.random() * 2 ** 31) >>> 0, t0: N.maintenant(), nom, cree: new Date(N.maintenant()).toISOString() }; await avecDelai(ref.set(d), 7000); }
          else if (!d || !d.graine) { await dormir(1500); const s2 = await avecDelai(ref.get(), 7000); d = s2.exists ? s2.data() : null; }
        } catch (e) { /* repli local */ }
      }
      if (d && d.graine) {
        I.graine = d.graine; I.t0 = d.t0;
        const err = () => {};
        I.desabonner.push(N.db.collection('instances/' + nom + '/corps').onSnapshot(s => { I.corps.clear(); s.docs.forEach(x => I.corps.set(x.id, Object.assign({ id: x.id }, x.data()))); J.donneesChangees = true; }, err));
        I.desabonner.push(N.db.collection('instances/' + nom + '/sol').onSnapshot(s => { I.sol.clear(); s.docs.forEach(x => { const v = x.data(); if (!v.prisPar) I.sol.set(x.id, Object.assign({ id: x.id }, v)); }); J.donneesChangees = true; }, err));
        I.desabonner.push(N.db.collection('instances/' + nom + '/butin').onSnapshot(s => { I.butinPris.clear(); s.docs.forEach(x => { const p = (x.data() || {}).pris || {}; Object.keys(p).forEach(k => I.butinPris.add(k)); }); J.donneesChangees = true; }, err));
        menageInstance(nom);
        return true;
      }
    }
    // repli : instance locale (une seule personne, même appareil)
    const loc = Local.lire('instance/' + nom) || { graine: (Math.random() * 2 ** 31) >>> 0, t0: Date.now(), corps: [], sol: [], pris: [] };
    Local.ecrire('instance/' + nom, loc);
    I.graine = loc.graine; I.t0 = loc.t0;
    (loc.corps || []).forEach(c => I.corps.set(c.id, c)); (loc.sol || []).forEach(s => I.sol.set(s.id, s)); (loc.pris || []).forEach(k => I.butinPris.add(k));
    return true;
  }
  function sauverInstanceLocale() {
    if (N.db) return;
    const loc = Local.lire('instance/' + I.id) || {};
    loc.corps = [...I.corps.values()]; loc.sol = [...I.sol.values()]; loc.pris = [...I.butinPris];
    Local.ecrire('instance/' + I.id, loc);
  }
  /** Les corps de plus de 60 jours disparaissent ; leur mort reste dans l'historique. */
  async function menageInstance(nom) {
    try {
      const ref = N.db.doc('instances/' + nom + '/verrous/menage');
      const l = await ref.acquire({ holder: (N.uid || '') + ONGLET, ttlMs: 20000 });
      if (!l.acquired) return;
      const s = await N.db.collection('instances/' + nom + '/corps').get();
      const limite = N.maintenant() - 60 * CF.JOUR_MS;
      const vieux = s.docs.filter(x => (x.data().t || 0) < limite);
      if (!vieux.length) return;
      const aRef = N.db.doc('instances/' + nom + '/archives/morts');
      const a = await aRef.get(); const liste = (a.exists && a.data().liste) || [];
      vieux.forEach(x => { const v = x.data(); liste.push({ cube: v.cube, cause: v.cause, t: v.t, nom: v.nom }); });
      await aRef.set({ liste: liste.slice(-800) });
      for (const x of vieux) { try { await N.db.doc('instances/' + nom + '/corps/' + x.id).delete(); } catch (e) { /* */ } }
    } catch (e) { /* plus tard */ }
  }
  /** claimCubeReward(playerId, characterId, itemId, cubeInstanceId) : transfert atomique au Coffre. */
  async function claimCubeReward(playerId, characterId, objet, cubeInstanceId) {
    if (!J.joueur || !J.joueur.vivant) return { ok: false, raison: 'mort' };
    if (Math.hypot(J.joueur.x - objet.x, J.joueur.z - objet.z) > 1.8 || J.cube !== objet.cube) return { ok: false, raison: 'portee' };
    if (objet.kind === 'butin' && I.butinPris.has(objet.cle)) return { ok: false, raison: 'pris' };
    if (!N.db) { // local
      if (objet.kind === 'butin') I.butinPris.add(objet.cle); else I.sol.delete(objet.docId);
      sauverInstanceLocale(); return { ok: true };
    }
    const chemin = objet.kind === 'butin' ? 'instances/' + cubeInstanceId + '/butin/s' + Math.floor(objet.cube / 64) : 'instances/' + cubeInstanceId + '/sol/' + objet.docId;
    const ref = N.db.doc(chemin);
    for (let essai = 0; essai < 6; essai++) {
      let l = null;
      try { l = await avecDelai(ref.acquire({ holder: playerId + ':' + ONGLET, ttlMs: 3000 }), 6000); } catch (e) { return { ok: false, raison: 'reseau' }; }
      if (l && l.acquired) {
        try {
          const s = await ref.get(); const d = s.exists ? (s.data() || {}) : null;
          if (!J.joueur.vivant) return { ok: false, raison: 'mort' };
          if (objet.kind === 'butin') {
            if (d && d.pris && d.pris[objet.cle]) return { ok: false, raison: 'pris' };
            const marque = { par: playerId, p: characterId, t: N.maintenant() };
            if (d) await ref.update({ pris: { [objet.cle]: marque } }); else await ref.set({ pris: { [objet.cle]: marque } });
            I.butinPris.add(objet.cle);
          } else {
            if (!d || d.prisPar || !d.type) return { ok: false, raison: 'pris' };
            await ref.update({ prisPar: playerId, prisT: N.maintenant() });
            I.sol.delete(objet.docId);
            ref.delete().catch(() => {});
          }
          return { ok: true };
        } catch (e) { return { ok: false, raison: 'reseau' }; }
      }
      await dormir(220 + Math.random() * 380);
    }
    return { ok: false, raison: 'occupe' };
  }
  window.claimCubeReward = claimCubeReward;

  // =====================================================================
  // AUDIO (synthèse, aucun fichier)
  // =====================================================================
  const A = {
    ctx: null, maitre: null, ambiance: null,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
        this.ctx = new Ctx(); this.maitre = this.ctx.createGain(); this.maitre.gain.value = D.reglages && D.reglages.son === false ? 0 : 0.7; this.maitre.connect(this.ctx.destination);
        const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate), d = b.getChannelData(0);
        let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        this.brun = b;
        const bb = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate), db = bb.getChannelData(0);
        for (let i = 0; i < db.length; i++) db[i] = Math.random() * 2 - 1;
        this.blanc = bb;
        this.lancerAmbiance();
      } catch (e) { this.ctx = null; }
    },
    volume(on) { if (this.maitre) this.maitre.gain.value = on ? 0.7 : 0; },
    lancerAmbiance() {
      const c = this.ctx, g = c.createGain(); g.gain.value = 0.05; g.connect(this.maitre);
      [43.6, 65.4, 87.3].forEach((f, i) => { const o = c.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 1) * 7; const og = c.createGain(); og.gain.value = 0.5 / (i + 1); o.connect(og); og.connect(g); o.start(); });
      const n = c.createBufferSource(); n.buffer = this.brun; n.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; const ng = c.createGain(); ng.gain.value = 0.35; n.connect(f); f.connect(ng); ng.connect(g); n.start();
      this.ambiance = g;
    },
    bruit(type, duree, freq, q, vol, glisse) {
      if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
      const s = c.createBufferSource(); s.buffer = type === 'brun' ? this.brun : this.blanc; s.loop = true;
      const f = c.createBiquadFilter(); f.type = q > 0 ? 'bandpass' : 'lowpass'; f.frequency.setValueAtTime(freq, t); if (q > 0) f.Q.value = q; if (glisse) f.frequency.exponentialRampToValueAtTime(glisse, t + duree);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, duree / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      s.connect(f); f.connect(g); g.connect(this.maitre); s.start(t); s.stop(t + duree + 0.05);
    },
    ton(type, f0, f1, duree, vol, delai) {
      if (!this.ctx) return; const c = this.ctx, t = c.currentTime + (delai || 0);
      const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + duree);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(g); g.connect(this.maitre); o.start(t); o.stop(t + duree + 0.05);
    },
    jouer(nom, fort) {
      if (!this.ctx) return; const k = fort == null ? 1 : fort;
      switch (nom) {
        case 'grondement': this.bruit('brun', 3.2, 90, 0, 0.9 * k); this.ton('sine', 38, 30, 3, 0.25 * k); break;
        case 'cliquetis': for (let i = 0; i < 5; i++) this.ton('square', 2400 + i * 60, 0, 0.02, 0.05 * k, i * 0.07); break;
        case 'lame': this.bruit('blanc', 0.35, 3000, 2, 0.35 * k, 800); this.ton('triangle', 1800, 900, 0.3, 0.06 * k); break;
        case 'flamme': this.bruit('blanc', 0.9, 700, 0.8, 0.4 * k, 300); break;
        case 'sifflement': this.bruit('blanc', 0.4, 5000, 4, 0.08 * k); break;
        case 'fleches': for (let i = 0; i < 3; i++) this.ton('sine', 1500, 500, 0.25, 0.08 * k, i * 0.06); break;
        case 'broyeur': this.bruit('brun', 1.4, 220, 0, 0.7 * k); this.ton('sawtooth', 55, 40, 1.4, 0.06 * k); break;
        case 'herse': this.bruit('blanc', 0.3, 900, 3, 0.5 * k); this.ton('square', 140, 70, 0.4, 0.12 * k); break;
        case 'chaine': for (let i = 0; i < 6; i++) this.bruit('blanc', 0.06, 2500 + i * 200, 6, 0.12 * k); break;
        case 'craquement': for (let i = 0; i < 4; i++) this.ton('square', 300 + Math.random() * 400, 0, 0.03, 0.06 * k, i * 0.09); break;
        case 'cloche': [520, 1290, 1870].forEach((f, i) => this.ton('sine', f, 0, 2.5 - i * 0.6, 0.12 * k / (i + 1))); break;
        case 'pointes': this.bruit('blanc', 0.2, 2200, 1.5, 0.35 * k); this.ton('triangle', 900, 1400, 0.12, 0.06 * k); break;
        case 'porte': this.bruit('blanc', 0.5, 400, 1.2, 0.2 * k, 1200); break;
        case 'verrou': this.ton('square', 220, 110, 0.15, 0.1 * k); this.bruit('blanc', 0.1, 1800, 4, 0.15 * k); break;
        case 'mort': this.ton('sawtooth', 110, 41, 2.2, 0.18 * k); this.bruit('brun', 2.5, 140, 0, 0.6 * k); break;
        case 'ramasser': [880, 1320, 1760].forEach((f, i) => this.ton('sine', f, 0, 0.5, 0.06 * k, i * 0.06)); break;
        case 'pas': this.bruit('brun', 0.09, 300, 0, 0.12 * k); break;
        case 'souffle': this.bruit('blanc', 0.35, 1200, 1, 0.15 * k, 400); break;
        case 'engrenage': case 'roulement': this.bruit('brun', 0.5, 160, 0, 0.12 * k); break;
        case 'scie': this.bruit('blanc', 0.4, 4200, 5, 0.06 * k); break;
        case 'frottement': this.bruit('brun', 0.6, 260, 0, 0.18 * k); break;
        case 'ralenti': for (let i = 0; i < 6; i++) { this.ton('sine', 52, 38, 0.35, 0.22 * k, i * 1.05); this.ton('sine', 48, 36, 0.3, 0.16 * k, i * 1.05 + 0.28); } this.bruit('brun', 6.5, 120, 0, 0.25 * k); break;
        case 'liberte': [523, 659, 784, 1046].forEach((f, i) => this.ton('sine', f, 0, 3.5, 0.08, i * 0.35)); break;
      }
    },
  };

  // =====================================================================
  // ÉTAT DU JEU
  // =====================================================================
  const J = {
    mode: 'menu', monde: null, cube: 0, perso: null, joueur: null, salle: null, coques: new Map(), structure: null,
    declencheurs: [], fossesOuvertes: new Set(), herseLevee: null, enigmes: new Map(), salves: [],
    distants: new Map(), chat: [], croix: { haut: false, bas: false, gauche: false, droite: false }, memoire: null, gains: [], deso: 0, touches: {}, zoom: 1, secousse: 0,
    dernierEtatSon: new Map(), derniereG: -1, donneesChangees: true, interaction: null, panneau: null, bulles: new Map(),
    recevoirPiege(d, de) {
      if (!d || typeof d.c !== 'number' || typeof d.piege !== 'number' || typeof d.t0 !== 'number') return;
      if (Math.abs(d.t0 - N.maintenant()) > 8000) return;
      J.declencheurs.push({ c: d.c, piege: d.piege, sub: d.sub | 0, t0: d.t0, x: +d.x || 0, z: +d.z || 0 });
    },
    recevoirMort(d) { if (d && d.c === J.cube && J.mode === 'jeu') { A.jouer('mort', 0.6); message('Un cri bref, puis le silence.'); } },
    recevoirChat(d, de) {
      if (!d || typeof d.txt !== 'string' || J.mode !== 'jeu') return;
      const uid = (de && de.by) || String(d.uid || '');
      if (D.reglages.bloques.includes(uid)) return;
      if (d.c !== J.cube) return;
      ajouterChat({ n: String(d.n || '?').slice(0, 24), txt: d.txt.slice(0, 200), uid, t: Date.now() });
    },
  };

  // =====================================================================
  // RENDU
  // =====================================================================
  let renderer, scene, camera, hemi, lumJoueur, lumSortie, cible = new THREE.Vector3();
  function initRendu() {
    if (renderer) return;
    const cv = $('#scene');
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.4;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = false;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050403); scene.fog = new THREE.FogExp2(0x060403, 0.022);
    R.preparerEnvironnement(renderer, scene);
    camera = new THREE.PerspectiveCamera(46, 1, 0.5, 600);
    hemi = new THREE.HemisphereLight(0x9a8a70, 0x0a0806, 0.2); scene.add(hemi);
    appliquerQualite();
    lumJoueur = new THREE.PointLight(0xffd9a0, 0.55, 8, 2); scene.add(lumJoueur);
    lumSortie = new THREE.PointLight(0xffffff, 0, 40, 1.5); scene.add(lumSortie);
    J.structure = R.construireStructure(); scene.add(J.structure.groupe);
    redimensionner(); window.addEventListener('resize', redimensionner);
  }
  function qualite() {
    const q = D.reglages && D.reglages.qualite;
    if (q === 'haute' || q === 'normale' || q === 'basse') return q;
    const modeste = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 900;
    return modeste ? 'normale' : 'haute';
  }
  function appliquerQualite() {
    const q = qualite();
    R.regler(q);
    if (renderer) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'haute' ? 1.75 : q === 'normale' ? 1.25 : 1)); redimensionner(); }
    const b = document.getElementById('btn-qualite'); if (b) b.textContent = 'Qualité : ' + q;
  }
  function redimensionner() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const posMonde = p => new THREE.Vector3(p.x * CF.ESP_H, p.z * CF.ESP_V, p.y * CF.ESP_H);

  function placerGroupe(g, id, it) {
    const p = C.positionSalle(J.monde, id, it);
    g.position.copy(posMonde(p)); g.rotation.y = -p.angle * Math.PI / 2;
    return p;
  }
  function libererGroupe(g) {
    g.traverse(o => { if (o.material && o.material.map && o.material.map.isCanvasTexture === undefined) { /* textures partagées en cache */ } });
    if (g.parent) g.parent.remove(g);
  }

  // =====================================================================
  // ENTRÉE DANS LE CUBE
  // =====================================================================
  async function entrer(persoId) {
    A.init();
    const perso = D.persos.find(p => p.id === persoId);
    if (!perso) return;
    cacherNotification();
    afficherChargement('Le mécanisme s’ouvre…');
    initRendu();
    let reprise = D.tentative && D.tentative.perso === persoId ? D.tentative : null;
    let inst = reprise ? reprise.inst : null;
    const t0 = performance.now();
    if (!inst) {
      afficherChargement('Connexion au Cube…');
      for (const nom of INSTANCES) {
        const s = await N.rejoindre(nom);
        if (!s) { inst = nom; break; }
        await dormir(700); // les présents se signalent en moins d'une seconde
        const n = N.peers.filter(p => !estMoi(p) && lirePeer(p).v === 1).length;
        if (n < CF.MAX_JOUEURS_INSTANCE) { inst = nom; break; }
      }
      inst = inst || INSTANCES[INSTANCES.length - 1];
    } else await N.rejoindre(inst);
    journal('salle temps réel ' + (N.salon ? 'rejointe' : 'indisponible'), t0);
    afficherChargement('Le mécanisme s’ouvre…');
    await ouvrirInstance(inst);
    journal('instance ' + inst + ' ouverte', t0);
    if (!N.salon) N.rejoindre(inst); // nouvel essai en arrière-plan, sans faire attendre
    J.monde = C.creerMonde(I.graine, I.t0);
    J.perso = perso;
    J.memoire = { salles: new Map() };
    J.gains = []; J.deso = 0; J.chat = []; J.declencheurs = []; J.enigmes.clear(); J.fossesOuvertes.clear();
    J.verrous = new Set(reprise && Array.isArray(reprise.ouvertes) ? reprise.ouvertes : []); J.verrouGrippe = 0;
    J.decal = new Map(reprise && Array.isArray(reprise.decal) ? reprise.decal : []); J.pivot = null; J.retourInterdit = null;
    J.monde.decalVue = id => J.decal.get(id) || 0;
    J.couleur = await choisirCouleur(reprise ? reprise.couleur : null);
    rendreChat();
    let cube = J.monde.idEntree, x = 0, z = 3.2;
    if (reprise && reprise.cube && reprise.cube <= J.monde.nbSalles) { cube = reprise.cube; x = clamp(+reprise.x || 0, -5, 5); z = clamp(+reprise.z || 0, -5, 5); }
    else {
      // la salle d'entrée accueille au plus cinq vivants
      for (;;) {
        const n = vivantsDans(cube);
        if (n < CF.MAX_VIVANTS_SALLE) break;
        afficherChargement('La salle d’entrée est occupée. Le mécanisme attend…');
        await dormir(3000);
      }
      D.tentative = { perso: perso.id, inst, cube, x, z, debut: N.maintenant(), ouvertes: [], decal: [], couleur: J.couleur };
      perso.statut = 'cube';
      perso.tentatives.unshift({ debut: N.maintenant(), inst, issue: 'en cours', objets: [] });
      if (perso.tentatives.length > 30) perso.tentatives.length = 30;
      sauverPersos(); sauverTentative();
    }
    J.cube = cube; J.trace = []; J.ralenti = null;
    J.joueur = { x, z, aMonde: Math.PI, vivant: true, pas: 0, vitesse: 0, traversee: null, montee: null, attente: false, sur: {} };
    construireSalleCourante(true);
    // le carnet se charge en arrière-plan : on n'attend pas pour entrer
    J.carnet = { entrees: [], notes: '' }; $('#carnet-notes').value = '';
    lireDoc(cheminJoueur('carnet-' + perso.id)).then(c => {
      if (!c || !J.perso || J.perso.id !== perso.id) return;
      J.carnet = { entrees: J.carnet.entrees.concat(c.entrees || []).slice(0, 300), notes: c.notes || '' };
      if (J.panneau !== 'carnet') $('#carnet-notes').value = J.carnet.notes;
    });
    journal('première salle prête', t0);
    // les textures des autres salles se préparent en tâche de fond, une à une
    clearInterval(J.minuteurPrechauffe);
    J.minuteurPrechauffe = setInterval(() => { if (J.mode !== 'jeu' || !R.prechauffer()) { if (J.mode !== 'jeu') return; clearInterval(J.minuteurPrechauffe); } }, 900);
    noterSalle();
    J.mode = 'jeu';
    document.body.dataset.ecran = 'jeu';
    cacherChargement();
    $('#hud-nom').textContent = perso.nom + ' · ' + C.COULEURS_CUBE[J.couleur][0];
    dessinerPortrait($('#hud-portrait'), lookCube());
    message(reprise ? 'Tu rouvres les yeux. La pierre est froide.' : 'La trappe se referme au-dessus de toi.');
    publierPresence(true);
  }
  const lookCube = () => ({ unie: C.COULEURS_CUBE[J.couleur != null ? J.couleur : 0][1] });
  /** Une couleur unie libre dans ce Cube : aucun autre captif présent ne la porte (50 couleurs). */
  async function choisirCouleur(pref) {
    if (N.db && N.salon) {
      try {
        for (let i = 0; i < 4; i++) {
          const v = await avecDelai(N.db.doc('instances/' + I.id + '/verrous/couleurs').acquire({ holder: (N.uid || '') + ONGLET, ttlMs: 3000 }), 4000);
          if (v && v.acquired) break; await dormir(600);
        }
      } catch (e) { /* sans verrou */ }
      await dormir(400);
    }
    const prises = new Set(N.peers.filter(p => !estMoi(p)).map(lirePeer).filter(d => d.v === 1 && d.i === I.id && typeof d.k === 'number').map(d => d.k));
    let k = typeof pref === 'number' && pref >= 0 && pref < C.COULEURS_CUBE.length && !prises.has(pref) ? pref : -1;
    if (k < 0) { const libres = []; for (let i = 0; i < C.COULEURS_CUBE.length; i++) if (!prises.has(i)) libres.push(i); k = libres.length ? libres[Math.floor(Math.random() * libres.length)] : Math.floor(Math.random() * C.COULEURS_CUBE.length); }
    N.presence({ v: 1, i: I.id, k }); // réserve la couleur tout de suite
    return k;
  }
  function vivantsDans(cube) {
    return N.peers.filter(p => { const d = lirePeer(p); return !estMoi(p) && d.v === 1 && d.c === cube && !d.mort; }).length;
  }

  function construireSalleCourante(premiere) {
    if (J.salle) { libererGroupe(J.salle.groupe); J.salle = null; }
    J.salle = R.construireSalle(J.monde, J.cube);
    scene.add(J.salle.groupe);
    // lumières de salle
    const sp = J.salle.spec;
    J.salle.lumieres = J.salle.lanternes.map(lg => { const l = new THREE.PointLight(sp.lanterne, 0.95, 16, 2); lg.add(l); return l; });
    const spot = new THREE.SpotLight(0xffe4c4, 1.7, 36, 0.92, 0.6, 1.3);
    spot.position.set(1.2, CF.HAUT + 7, 2.2); spot.target.position.set(0, 0, 0);
    J.salle.groupe.add(spot); J.salle.groupe.add(spot.target);
    const q = qualite();
    spot.castShadow = q !== 'basse';
    spot.shadow.mapSize.set(q === 'haute' ? 2048 : 1024, q === 'haute' ? 2048 : 1024);
    spot.shadow.camera.near = 3; spot.shadow.camera.far = 30; spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.025; spot.shadow.radius = 4;
    J.salle.spot = spot;
    // joueur
    if (!J.figJoueur || premiere) {
      if (J.figJoueur && J.figJoueur.racine.parent) J.figJoueur.racine.parent.remove(J.figJoueur.racine);
      J.figJoueur = R.creerFigurine(lookCube(), {});
      const anneau = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 28), R.mat(0xc9a24a, { basic: true, add: true, op: 0.45 }));
      anneau.rotation.x = -Math.PI / 2; anneau.position.y = 0.03; J.figJoueur.racine.add(anneau); J.figJoueur.anneau = anneau;
    }
    J.salle.groupe.add(J.figJoueur.racine);
    J.figJoueur.racine.visible = true;
    J.salle.objetsMesh = new Map(); J.salle.corpsMesh = new Map();
    J.donneesChangees = true;
    J.dernierEtatSon.clear();
    J.distants.forEach(d => { if (d.fig.racine.parent) d.fig.racine.parent.remove(d.fig.racine); });
    J.distants.clear();
    const it = C.instant(J.monde, N.maintenant());
    const p = C.positionSalle(J.monde, J.cube, it);
    J.slotStructure = -1;
    const m = J.memoire.salles.get(J.cube);
    if (m && m.slot !== p.slot) J.deso = Math.min(100, J.deso + 10);
    J.memoire.salles.set(J.cube, { vu: (m ? m.vu : 0) + 1, slot: p.slot, t: Date.now() });
    J.enigmeMesh = null;
  }

  // =====================================================================
  // BOUCLE
  // =====================================================================
  let tPrec = performance.now();
  function boucle() {
    requestAnimationFrame(boucle);
    const tr = performance.now(), dt = Math.min(0.05, (tr - tPrec) / 1000); tPrec = tr;
    if (J.mode !== 'jeu' && J.mode !== 'cinematique') return;
    if (J.mode === 'jeu') lireManette();
    const t = N.maintenant();
    const it = C.instant(J.monde, t);
    J.it = it;
    if (J.mode === 'jeu') majJeu(t, it, dt);
    else majCinematique(t, it, dt);
    renderer.render(scene, camera);
  }

  function ctxPour(salle, t, it) {
    const pal = C.paliersColere(it.colere);
    const base = [1.15, 1, 0.9, 0.8, 0.72][pal];
    const c = salle.ctxPiege;
    c.tempo = k => {
      let f = base;
      if (it.ev.dragon && (k === 'flammes')) f *= 0.7;
      if (it.ev.lames && (k === 'lames' || k === 'rouleau')) f *= 0.75;
      if (it.ev.jugement && salle.spec.zone >= 4) f *= 0.85;
      return k === 'inv' ? 1 / f : f;
    };
    c.declencheurs = J.declencheurs.filter(d => d.c === salle.id);
    c.fossesOuvertes = J.fossesOuvertes;
    c.ouvrirFosse = k => J.fossesOuvertes.add(k);
    c.herseLevee = (f, tt) => !!(J.herseLevee && J.herseLevee.f === f && tt < J.herseLevee.fin);
    c.proche = f => { const [a, d] = R.faceDepuisLocal(f, J.joueur.x, J.joueur.z); return Math.abs(a) < 2.4 && d < 2.6; };
    c.echelle = salle.echelle; c.fort = J.perso.stats.force >= 45; c.it = it;
    return c;
  }

  function etatsPortes(t, it, pos) {
    const s = J.salle, sp = s.spec, res = [];
    const enigmeOk = s.traits.enigme ? J.enigmes.get(s.id) === it.k : true;
    for (let f = 0; f < 6; f++) {
      if (!((sp.portes >> f) & 1)) { res.push(null); continue; }
      const dir = C.faceVersMonde(f, pos.o);
      const ep = C.etatPorte(J.monde, s.id, dir, it, pos);
      let bloque = '';
      if (f < 4) {
        if (s.traits.herse && s.traits.herse.bloque(t, f, s.ctxPiege)) bloque = 'herse';
        if (s.traits.temps && !s.traits.temps.ouvert(t)) bloque = 'temps';
        if (s.traits.condamnee && s.traits.condamnee.scelle(t)) bloque = 'scelle';
        if (!enigmeOk) bloque = 'enigme';
        if (!J.verrous.has(s.id + ':' + f)) bloque = 'verrou';
        if (J.retourInterdit && J.retourInterdit.cube === s.id && ep.voisin && ep.voisin === J.retourInterdit.vers) bloque = 'retour';
        if (J.pivot && J.pivot.id === s.id) bloque = 'pivot';
      } else if (f === 4 && s.traits.escalier && s.traits.escalier.etat(t) === 2) bloque = 'echelle';
      if (f >= 4 && !J.verrous.has(s.id + ':' + f)) bloque = 'verrou';
      if (f >= 4 && J.retourInterdit && J.retourInterdit.cube === s.id && ep.voisin && ep.voisin === J.retourInterdit.vers) bloque = 'retour';
      if (f >= 4 && J.pivot && J.pivot.id === s.id) bloque = 'pivot';
      res.push({ f, dir, ep, bloque, passable: (ep.etat === 'ouverte' || ep.etat === 'sortie') && !bloque });
    }
    return res;
  }

  function majJeu(t, it, dt) {
    const s = J.salle, jo = J.joueur;
    // --- la salle courante suit son emplacement réel
    const pos = placerGroupe(s.groupe, s.id, it);
    if (J.pivot && J.pivot.id === s.id) {
      const k = clamp((performance.now() - J.pivot.debut) / J.pivot.duree, 0, 1), l = k * k * (3 - 2 * k);
      if (k < 1) s.groupe.rotation.y = -(pos.angle - (1 - l) * J.pivot.delta) * Math.PI / 2; else J.pivot = null;
    }
    const rotY = s.groupe.rotation.y;
    // --- mutation : grondement, verrouillage
    if (it.g !== J.derniereG) {
      if (J.derniereG >= 0) {
        const implique = C.slotImplique(J.monde, pos.slot, C.instant(J.monde, t + 50));
        A.jouer('grondement', implique ? 1 : 0.35);
        if (implique) { J.secousse = 1.6; message(['Un grondement monte des profondeurs.', 'Le sol tremble. Des verrous claquent.', 'Les murs vibrent. Quelque chose de gigantesque se met en marche.'][it.g % 3]); }
        if (it.gm && it.p === 0) message('Toute la structure gémit, très loin, partout à la fois.');
      }
      J.derniereG = it.g;
    }
    if (pos.glisse || pos.tourne) { J.secousse = Math.max(J.secousse, 0.6); J.deso = Math.min(100, J.deso + dt * (pos.tourne ? 2.5 : 1.6)); }
    J.secousse = Math.max(0, J.secousse - dt * 0.5);
    // --- structure mécanique (fixe) et coques voisines
    if (J.slotStructure !== pos.slot && !pos.glisse) {
      const q = C.slotXYZ(J.monde, pos.slot);
      J.structure.groupe.position.copy(posMonde(q)); J.slotStructure = pos.slot;
    }
    const enMouvement = it.w >= CF.PRE_MS && it.w < CF.PRE_MS + CF.MOUV_MS;
    if (enMouvement) { J.structure.roues.forEach((r, i) => { r.rotation.z += dt * (i % 2 ? 1.2 : -1.2); }); J.structure.chaines.position.y = (t * 0.0016) % 2.52; }
    majCoques(it, pos);
    // --- portes
    const ctx = ctxPour(s, t, it);
    const portes = etatsPortes(t, it, pos);
    J.portes = portes;
    majVisuelsPortes(portes, t);
    // --- lumière
    const obscur = s.traits.obscur;
    s.lumieres.forEach((l, i) => { l.intensity = obscur ? 0 : 1.05 + Math.sin(t * 0.004 + i * 2) * 0.08 + (Math.random() < 0.01 ? -0.4 : 0); });
    hemi.intensity = obscur ? 0.03 : 0.2;
    if (s.spot) s.spot.intensity = obscur ? 0 : 1.7;
    lumJoueur.intensity = obscur ? 1.2 : 0.5; lumJoueur.distance = obscur ? 5.5 : 8;
    const sortie = portes.find(p => p && p.ep.etat === 'sortie');
    if (sortie) { const [lx, lz] = R.localDepuisFace(sortie.f, 0, -2); const v = new THREE.Vector3(lx, 2, lz); s.groupe.localToWorld(v); lumSortie.position.copy(v); lumSortie.intensity = 3.5; } else lumSortie.intensity = 0;
    // --- cadran au sol
    s.dents.forEach((d, i) => { d.material = i === it.p ? R.mat(0xffd27a, { e: 0xffb347, ei: 1.6 }) : i === 0 ? R.mat(0xc9a24a, { r: 0.4, m: 0.9 }) : R.mat(0x4a3a20, { r: 0.5, m: 0.8 }); });
    if (s.cadran.userData.roue) s.cadran.userData.roue.rotation.y = t * 0.0004;
    // --- pièges
    for (const p of s.pieges) { try { p.maj(t, ctx); } catch (e) { /* robustesse */ } }
    majSonsPieges(t);
    majSalves(t);
    // --- données partagées (cadavres, objets)
    if (J.donneesChangees) { J.donneesChangees = false; rafraichirObjetsCorps(t); }
    s.objetsMesh.forEach(o => o.mesh.userData.anim && o.mesh.userData.anim(t));
    if (Math.floor(t / 60000) !== J.minuteCorps) { J.minuteCorps = Math.floor(t / 60000); rafraichirObjetsCorps(t, true); }
    // --- joueur
    if (jo.vivant) {
      if (jo.traversee) majTraversee(t, dt);
      else if (jo.montee) majMontee(t, dt);
      else if (!J.panneau) deplacer(t, it, dt, portes, ctx, rotY);
      if (jo.vivant && !jo.traversee && !jo.montee) {
        const r = 0.31 - J.perso.stats.agilite * 0.0008;
        let cause = null;
        let piege = null;
        for (const p of s.pieges) { cause = p.danger(t, jo.x, jo.z, r, ctx); if (cause) { piege = p.type; break; } }
        if (!cause) { cause = dangerSalves(t, jo.x, jo.z, r); if (cause) piege = 'salve'; }
        if (cause) mourir(cause, t, piege);
        else declencheursLocaux(t, ctx);
      }
    } else if (J.mortAnim) {
      const k = clamp((t - J.mortAnim) / 600, 0, 1);
      J.figJoueur.racine.rotation.x = -k * Math.PI / 2; J.figJoueur.racine.position.y = 0.2 * k;
    }
    // figurine
    if (!jo.traversee && !jo.montee && J.figJoueur.racine.parent === s.groupe) {
      J.figJoueur.racine.position.x = jo.x; J.figJoueur.racine.position.z = jo.z;
      if (jo.vivant) J.figJoueur.racine.rotation.y = jo.aMonde - rotY;
    }
    if (jo.vivant) J.figJoueur.animer(jo.pas, jo.vitesse);
    // trace des 4 dernières secondes (pour le ralenti de la mort)
    if (jo.vivant && !jo.traversee && !jo.montee) {
      const tr = J.trace || (J.trace = []);
      tr.push({ t, x: jo.x, z: jo.z, a: jo.aMonde - rotY, pas: jo.pas, v: jo.vitesse, c: J.cube });
      while (tr.length && t - tr[0].t > 4000) tr.shift();
    }
    // --- autres joueurs
    majDistants(t, dt);
    // --- caméra
    const wp = new THREE.Vector3(); J.figJoueur.racine.getWorldPosition(wp);
    lumJoueur.position.set(wp.x, wp.y + 2.4, wp.z);
    cible.lerp(wp.clone().add(new THREE.Vector3(0, 1, 0)), jo.traversee || jo.montee ? 0.2 : 0.35);
    const z = J.zoom, sec = J.secousse * (1 - J.perso.stats.sangFroid * 0.006) * (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.2 : 1);
    camera.position.set(cible.x + (Math.random() - 0.5) * sec * 0.25, cible.y + 20 * z, cible.z + 11.5 * z + (Math.random() - 0.5) * sec * 0.25);
    camera.lookAt(cible);
    camera.rotation.z += Math.sin(t * 0.0007) * J.deso * 0.00012;
    // murs entre la caméra et le personnage : estompés
    s.murs.forEach(m => {
      const ang = -m.face * Math.PI / 2 + rotY; const nz = -Math.cos(ang); // normale extérieure de la face, composante sud
      const op = nz > 0.35 ? 0.16 : 1;
      m.mat.opacity += (op - m.mat.opacity) * 0.2; m.mat.depthWrite = m.mat.opacity > 0.9;
      if (m.annexes) for (const a of m.annexes) { a.opacity = a.userData.op0 * Math.max(m.mat.opacity, 0.12); a.depthWrite = m.mat.depthWrite; }
    });
    // --- interface
    majInteraction(t, it, portes);
    majVignette();
    J.deso = Math.max(0, J.deso - dt * 0.15);
    publierPresence(false);
  }

  // ---------- coques des salles voisines ----------
  function majCoques(it, pos) {
    const m = J.monde, q = C.slotXYZ(m, pos.slot), voulus = new Set();
    for (let dz = -1; dz <= 0; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dz === -1 && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) continue;
      const x = q.x + dx, y = q.y + dy, z = q.z + dz;
      if (x < 0 || y < 0 || z < 0 || x >= m.W || y >= m.D || z >= m.HZ) continue;
      const id = C.salleAuSlot(m, m.idx(x, y, z), it);
      if (id && id !== J.cube) voulus.add(id);
    }
    J.coques.forEach((c, id) => { if (!voulus.has(id)) { libererGroupe(c.groupe); J.coques.delete(id); } });
    voulus.forEach(id => {
      let c = J.coques.get(id);
      if (!c) { c = R.construireCoque(m, id); J.coques.set(id, c); scene.add(c.groupe); }
      placerGroupe(c.groupe, id, it);
    });
  }

  // ---------- portes : visuels ----------
  function majVisuelsPortes(portes, t) {
    const s = J.salle, jo = J.joueur;
    for (const P of s.portes) {
      const e = portes[P.face]; if (!e) continue;
      const v = P.v, et = e.ep.etat;
      const [a, d] = R.faceDepuisLocal(P.face, jo.x, jo.z);
      const pres = Math.abs(a) < 2.6 && d < 2.8 && jo.vivant;
      const ouvrable = (et === 'ouverte' || et === 'sortie' || et === 'vide' || et === 'aveugle' || et === 'bord') && !e.bloque;
      const avant = v.ouv;
      R.animerPorte(v, ouvrable && (pres || (jo.traversee && jo.traversee.face === P.face)) ? 1 : 0);
      if (avant < 0.05 && v.ouv >= 0.05) A.jouer('porte', 0.7);
      v.sceau.visible = et === 'verrouillee' || !!e.bloque;
      v.barres.visible = et === 'condamnee';
      v.pont.visible = et === 'ouverte' || et === 'verrouillee' && e.ep.voisin;
      v.garde.visible = et === 'vide' || et === 'bord';
      v.lumiere.visible = et === 'sortie';
      v.fond.visible = et === 'aveugle' || et === 'bord' || et === 'mur';
      v.fond.material = et === 'aveugle' ? R.mat(0x2a2622, { r: 0.95 }) : R.mat(0x000000, { basic: true });
    }
    // trappes
    const haut = portes[4], bas = portes[5];
    if (s.ouverturePlafond) s.ouverturePlafond.children.forEach(c => { c.material = haut && haut.passable ? R.mat(0x8a6a32, { r: 0.4, m: 0.85 }) : R.M.fer(); });
    if (s.trappe) { const pres = Math.hypot(jo.x, jo.z) < 1.8; s.trappe.rotation.x += (((bas && bas.passable && pres) ? -1.4 : 0) - s.trappe.rotation.x) * 0.15; }
    // fausse sortie
    if (s.fausseSortie && s.fausseSortie.mode !== 'lumiere') {
      const [a, d] = R.faceDepuisLocal(s.fausseSortie.face, jo.x, jo.z);
      const pres = Math.abs(a) < 2.6 && d < 3.2;
      const ferme = s.fausseSortie.mode === 'refermante' ? d < 2.0 : false;
      R.animerPorte(s.fausseSortie.v, pres && !ferme ? 1 : 0);
      if (s.fausseSortie.mode === 'refermante' && ferme && !s.fausseSortie.claque) { s.fausseSortie.claque = true; A.jouer('herse', 0.6); }
      if (!ferme) s.fausseSortie.claque = false;
      s.fausseSortie.v.fond.material = s.fausseSortie.mode === 'retour' ? R.mat(0x000000, { basic: true }) : R.mat(R.teinte(s.spec.palette.mur, -0.15), { r: 0.9 });
    }
  }

  // ---------- déplacement et collisions ----------
  function deplacer(t, it, dt, portes, ctx, rotY) {
    const jo = J.joueur, k = J.touches;
    if (jo.attente) { jo.vitesse *= 0.8; return; }
    let ix = 0, iz = 0;
    if (k.KeyW || k.KeyZ || k.ArrowUp) iz -= 1;
    if (k.KeyS || k.ArrowDown) iz += 1;
    if (k.KeyA || k.KeyQ || k.ArrowLeft) ix -= 1;
    if (k.KeyD || k.ArrowRight) ix += 1;
    for (const cr of [J.croix, J.manette]) {
      if (!cr) continue;
      if (cr.haut) iz -= 1; if (cr.bas) iz += 1; if (cr.gauche) ix -= 1; if (cr.droite) ix += 1;
    }
    const n = Math.hypot(ix, iz);
    const court = (k.ShiftLeft || k.ShiftRight || J.courirB) && n > 0;
    const v = (3.4 + J.perso.stats.agilite * 0.022) * (court ? 1.6 : 1) * (J.salle.traits.chaines && ctx.fort ? 0.85 : 1);
    if (n < 0.05) { jo.vitesse *= 0.8; return; }
    ix /= Math.max(1, n); iz /= Math.max(1, n);
    jo.aMonde = Math.atan2(ix, iz);
    // monde → local (inverse de la rotation de la salle)
    const c = Math.cos(-rotY), s = Math.sin(-rotY);
    const lx = ix * c + iz * s, lz = -ix * s + iz * c;
    const r = 0.32;
    let nx = jo.x + lx * v * dt, nz = jo.z + lz * v * dt;
    jo.pas += dt * v * 2.6; jo.vitesse = Math.min(1, n);
    if (Math.floor(jo.pas / Math.PI) !== Math.floor((jo.pas - dt * v * 2.6) / Math.PI)) A.jouer('pas', court ? 0.5 : 0.25);
    if (court && J.salle.traits.bruit) J.bruitCourse = t;
    // obstacles
    const obs = J.salle.obstacles.slice();
    for (const p of J.salle.pieges) if (p.obstacles) { const n0 = obs.length; p.obstacles(t, ctx, obs); for (let i = n0; i < obs.length; i++) obs[i].piege = p.type; }
    // limites et portes
    const B = DM - EP / 2 - r;
    const lim = (val, axeX) => {
      if (Math.abs(val) <= B) return val;
      const face = axeX ? (val > 0 ? 1 : 3) : (val > 0 ? 2 : 0);
      const [a] = R.faceDepuisLocal(face, axeX ? val : nx, axeX ? nz : val);
      const e = portes[face];
      const fauxRetour = J.salle.fausseSortie && J.salle.fausseSortie.mode === 'retour' && J.salle.fausseSortie.face === face;
      if ((e && e.passable || fauxRetour) && Math.abs(a) < PL / 2 - r - 0.02) {
        if (Math.abs(val) > DM + 0.05) { franchir(face, e, t, fauxRetour); return Math.sign(val) * (DM + 0.05); }
        return val;
      }
      if (e && !e.passable && Math.abs(a) < PL / 2) heurterPorte(e, t);
      if (J.salle.traits.trompeur && J.salle.traits.trompeur.fausse.face === face && Math.abs(a) < PL / 2) toucherFausse(t);
      if (J.salle.fausseSortie && J.salle.fausseSortie.face === face && Math.abs(a) < PL / 2) toucherFausseSortie(t);
      return Math.sign(val) * B;
    };
    // dans l'embrasure, on reste dans le couloir de la porte
    const dansEmbrasure = Math.abs(jo.x) > B || Math.abs(jo.z) > B;
    nx = lim(nx, true); if (jo.traversee) return;
    nz = lim(nz, false); if (jo.traversee) return;
    if (dansEmbrasure) {
      if (Math.abs(jo.x) > B) nz = clamp(nz, -(PL / 2 - r), PL / 2 - r);
      if (Math.abs(jo.z) > B) nx = clamp(nx, -(PL / 2 - r), PL / 2 - r);
    }
    for (const o of obs) {
      const cx = clamp(nx, o.x0, o.x1), cz = clamp(nz, o.z0, o.z1);
      const dx = nx - cx, dz = nz - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2); nx = cx + dx / d * r; nz = cz + dz / d * r; }
        else { // centre dans la boîte : sortie par le côté le plus proche
          const opts = [[o.x0 - r - nx, 0], [o.x1 + r - nx, 0], [0, o.z0 - r - nz], [0, o.z1 + r - nz]];
          opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1])); nx += opts[0][0]; nz += opts[0][1];
        }
        if (o.mobile || o.pousse) { const bx = clamp(nx, -B, B), bz = clamp(nz, -B, B); if ((Math.abs(bx - nx) > 0.05 || Math.abs(bz - nz) > 0.05) && !dansEmbrasure) { nx = bx; nz = bz; const cx2 = clamp(nx, o.x0, o.x1), cz2 = clamp(nz, o.z0, o.z1); if (Math.hypot(nx - cx2, nz - cz2) < r * 0.6) { mourir('ecrase', t, o.piege); return; } } }
      }
    }
    jo.x = nx; jo.z = nz;
  }
  // obstacles mobiles même quand le joueur ne bouge pas
  function pousserImmobile(t, ctx) {
    const jo = J.joueur, obs = [], r = 0.32, B = DM - EP / 2 - r;
    for (const p of J.salle.pieges) if (p.obstacles) { const n0 = obs.length; p.obstacles(t, ctx, obs); for (let i = n0; i < obs.length; i++) obs[i].piege = p.type; }
    for (const o of obs) {
      if (!o.mobile && !o.pousse) continue;
      const cx = clamp(jo.x, o.x0, o.x1), cz = clamp(jo.z, o.z0, o.z1);
      const dx = jo.x - cx, dz = jo.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2); jo.x = cx + dx / d * r; jo.z = cz + dz / d * r; }
        else { const opts = [[o.x0 - r - jo.x, 0], [o.x1 + r - jo.x, 0], [0, o.z0 - r - jo.z], [0, o.z1 + r - jo.z]]; opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1])); jo.x += opts[0][0]; jo.z += opts[0][1]; }
        const bx = clamp(jo.x, -B, B), bz = clamp(jo.z, -B, B);
        if (Math.abs(bx - jo.x) > 0.05 || Math.abs(bz - jo.z) > 0.05) { jo.x = bx; jo.z = bz; const c2x = clamp(jo.x, o.x0, o.x1), c2z = clamp(jo.z, o.z0, o.z1); if (Math.hypot(jo.x - c2x, jo.z - c2z) < r * 0.6) { mourir('ecrase', t, o.piege); return; } }
      }
    }
  }
  let dernierHeurt = 0;
  function heurterPorte(e, t) {
    if (t - dernierHeurt < 1600) return; dernierHeurt = t;
    const et = e.ep.etat, b = e.bloque;
    const txt = b === 'retour' ? 'Ce passage s’est scellé derrière toi. Impossible de revenir sur tes pas.' : b === 'pivot' ? 'La salle tourne encore sur elle-même.' : b === 'verrou' ? 'Un verrou à énigme retient les battants. Examine la plaque de bronze (A ou E).' : b === 'herse' ? 'Une herse barre le passage.' : b === 'temps' ? 'Les battants sont clos. L’eau coule dans la colonne de verre.' : b === 'scelle' ? 'Les portes se sont scellées.' : b === 'enigme' ? 'La porte ne cède pas. Le boulier semble relié au verrou.'
      : et === 'verrouillee' ? 'Un verrou de bronze est enclenché. Le sol vibre.' : et === 'vide' ? 'Derrière les barreaux, le vide. Un courant d’air glacé.' : et === 'aveugle' ? 'Les battants s’ouvrent sur une paroi.'
      : et === 'bord' ? 'Derrière les barreaux, une pierre épaisse et noire.' : et === 'condamnee' ? 'Des barres de fer condamnent le passage.' : 'La porte reste close.';
    message(txt); A.jouer('verrou', 0.5);
  }
  let dernierFaux = 0;
  function toucherFausse(t) {
    if (t - dernierFaux < 2500) return; dernierFaux = t;
    const tp = J.salle.traits.trompeur;
    if (tp.fausse.mortel) { const d = { c: J.cube, piege: tp.idx, sub: 0, t0: t, x: 0, z: 0 }; J.declencheurs.push(d); N.emettre('piege', d); A.jouer('cliquetis'); }
    else { message('Ce n’est qu’un panneau peint sur la pierre.'); J.deso = Math.min(100, J.deso + 4); }
  }
  function toucherFausseSortie(t) {
    if (t - dernierFaux < 2500) return; dernierFaux = t;
    const m = J.salle.fausseSortie.mode;
    message(m === 'lumiere' ? 'Du métal poli. La lumière n’était que la tienne, renvoyée.' : 'Les battants se referment devant toi.');
    J.deso = Math.min(100, J.deso + 6);
  }

  // ---------- franchir une porte (le serveur de sièges limite à 5 vivants) ----------
  async function franchir(face, e, t, fauxRetour) {
    const jo = J.joueur;
    if (jo.traversee || jo.attente) return;
    if (e && e.ep.etat === 'sortie') { liberation(face); return; }
    const vers = fauxRetour ? J.monde.idEntree : e.ep.voisin;
    jo.attente = true;
    const admis = await demanderPlace(vers);
    jo.attente = false;
    if (!J.joueur || !J.joueur.vivant || J.mode !== 'jeu') return;
    if (!admis) {
      const [lx, lz] = R.localDepuisFace(face, 0, 0.8); jo.x = lx; jo.z = lz;
      message('La porte résiste. De l’autre côté, un mécanisme cliquette.'); A.jouer('verrou'); return;
    }
    // revérifie l'état réel : la porte a pu se verrouiller pendant l'attente
    const it = C.instant(J.monde, N.maintenant());
    const pos = C.positionSalle(J.monde, J.cube, it);
    if (!fauxRetour) {
      const ep = C.etatPorte(J.monde, J.cube, C.faceVersMonde(face, pos.o), it, pos);
      if (ep.etat !== 'ouverte' || ep.voisin !== vers) { const [lx, lz] = R.localDepuisFace(face, 0, 0.8); jo.x = lx; jo.z = lz; heurterPorte({ ep, bloque: '' }, N.maintenant()); return; }
    }
    const dep = new THREE.Vector3(); J.figJoueur.racine.getWorldPosition(dep);
    let arr;
    if (fauxRetour) arr = null;
    else {
      const dir = C.faceVersMonde(face, pos.o), pv = C.positionSalle(J.monde, vers, it);
      const fv = C.mondeVersFace(C.OPPOSE[dir], pv.o);
      const [ax, az] = R.localDepuisFace(fv, 0, 0.9);
      const g = new THREE.Group(); g.position.copy(posMonde(pv)); g.rotation.y = -pv.angle * Math.PI / 2; g.updateMatrixWorld();
      arr = { x: ax, z: az, w: new THREE.Vector3(ax, 0, az).applyMatrix4(g.matrixWorld) };
    }
    scene.attach(J.figJoueur.racine);
    jo.traversee = { face, vers, debut: performance.now(), duree: fauxRetour ? 900 : 720, dep, arr, fauxRetour };
    if (fauxRetour) { $('#fondu').classList.add('actif'); }
  }
  function majTraversee(t, dt) {
    const jo = J.joueur, tr = jo.traversee;
    const k = clamp((performance.now() - tr.debut) / tr.duree, 0, 1);
    if (tr.arr) { J.figJoueur.racine.position.lerpVectors(tr.dep, tr.arr.w, k); jo.pas += dt * 9; jo.vitesse = 1; }
    if (k >= 1) {
      const ancien = J.cube;
      J.cube = tr.vers;
      jo.traversee = null;
      if (tr.arr) { jo.x = tr.arr.x; jo.z = tr.arr.z; } else { jo.x = 0; jo.z = 3.2; $('#fondu').classList.remove('actif'); J.deso = Math.min(100, J.deso + 12); }
      construireSalleCourante(false);
      pivoterEntree(ancien);
      apresChangement(ancien);
    }
  }
  async function demanderPlace(vers) {
    if (!N.salon) return true;
    let verrou = null;
    if (N.db) { try { verrou = await avecDelai(N.db.doc('instances/' + I.id + '/verrous/v' + (vers % 32)).acquire({ holder: (N.uid || '') + ONGLET, ttlMs: 1800 }), 3000); } catch (e) { verrou = null; } }
    if (verrou && !verrou.acquired) { await dormir(700); try { verrou = await N.db.doc('instances/' + I.id + '/verrous/v' + (vers % 32)).acquire({ holder: (N.uid || '') + ONGLET, ttlMs: 1800 }); } catch (e) { verrou = null; } if (verrou && !verrou.acquired) return false; }
    if (vivantsDans(vers) >= CF.MAX_VIVANTS_SALLE) return false;
    N.presence(presenceObjet(vers));
    return true;
  }
  /** En entrant, la salle pivote d'un, deux ou trois quarts de tour (pour ce joueur) : aucune porte ne
   *  ramène alors à la salle d'où il vient, et le passage par lequel il est arrivé se scelle derrière lui. */
  function pivoterEntree(ancien) {
    const m = J.monde, id = J.cube;
    J.retourInterdit = { cube: id, vers: ancien };
    if (id === m.idLib || !ancien) return; // la salle de la sortie garde son orientation
    const it = C.instant(m, N.maintenant()), d0 = J.decal.get(id) || 0;
    const ordre = [1, 2, 3].sort(() => Math.random() - 0.5);
    let q = ordre[0];
    for (const c of ordre) {
      J.decal.set(id, (d0 + c) % 4);
      const pos = C.positionSalle(m, id, it); let ramene = false;
      for (let d = 0; d < 4; d++) if (C.etatPorte(m, id, d, it, pos).voisin === ancien) ramene = true;
      if (!ramene) { q = c; break; }
    }
    J.decal.set(id, (d0 + q) % 4);
    J.pivot = { id, debut: performance.now(), duree: 1500, delta: q };
    A.jouer('grondement', 0.8); A.jouer('engrenage', 1);
    J.secousse = Math.max(J.secousse, 0.9); J.deso = Math.min(100, J.deso + 6);
  }
  function apresChangement(ancien) {
    const it = C.instant(J.monde, N.maintenant());
    const a = C.positionSalle(J.monde, ancien, it), b = C.positionSalle(J.monde, J.cube, it);
    if (C.slotXYZ(J.monde, a.slot).z !== C.slotXYZ(J.monde, b.slot).z) J.deso = Math.min(100, J.deso + 5);
    noterSalle();
    D.tentative = Object.assign(D.tentative || {}, { cube: J.cube, x: J.joueur.x, z: J.joueur.z, ouvertes: [...J.verrous].slice(-500), decal: [...J.decal].slice(-300), couleur: J.couleur });
    sauverTentative();
    publierPresence(true);
  }

  // ---------- monter / descendre ----------
  function utiliserTrappe(haut) {
    const jo = J.joueur, f = haut ? 4 : 5, e = J.portes[f];
    if (!e) return;
    if (e.bloque === 'verrou') { ouvrirPlaque(f); return; }
    if (!e.passable) { heurterPorte(e, N.maintenant()); return; }
    if (haut && J.salle.traits.escalier && J.salle.traits.escalier.etat(N.maintenant()) >= 1) {
      jo.montee = { haut, vers: 0, debut: performance.now(), duree: 900, chute: true };
      return;
    }
    jo.attente = true;
    demanderPlace(e.ep.voisin).then(ok => {
      jo.attente = false;
      if (!ok) { message('La trappe résiste. On entend du mouvement de l’autre côté.'); A.jouer('verrou'); return; }
      jo.montee = { haut, vers: e.ep.voisin, debut: performance.now(), duree: 1300 };
      jo.x = 0; jo.z = haut ? -0.55 : 0; A.jouer('porte', 0.6);
    });
  }
  function majMontee(t, dt) {
    const jo = J.joueur, m = jo.montee, k = clamp((performance.now() - m.debut) / m.duree, 0, 1);
    const fig = J.figJoueur.racine;
    if (m.chute) { fig.position.y = k < 0.5 ? k * 3 : 1.5 - (k - 0.5) * 6; if (k >= 1) { jo.montee = null; mourir('chute', t, 'escalier'); } return; }
    fig.position.set(jo.x, (m.haut ? 1 : -1) * k * (CF.ESP_V * 0.6), jo.z);
    if (m.haut) { J.figJoueur.bG.rotation.x = -2.6 + Math.sin(k * 20) * 0.3; J.figJoueur.bD.rotation.x = -2.6 - Math.sin(k * 20) * 0.3; }
    if (k >= 1) {
      // revérifie : la trappe doit toujours mener à la même salle
      const it = C.instant(J.monde, N.maintenant()), pos = C.positionSalle(J.monde, J.cube, it);
      const ep = C.etatPorte(J.monde, J.cube, m.haut ? 4 : 5, it, pos);
      if (ep.etat !== 'ouverte' || ep.voisin !== m.vers) { jo.montee = null; fig.position.y = 0; message('La trappe s’est refermée d’un coup sec.'); return; }
      const ancien = J.cube; J.cube = m.vers; jo.montee = null; jo.x = 0; jo.z = m.haut ? 0.6 : -0.6;
      construireSalleCourante(false); J.figJoueur.racine.position.y = 0;
      pivoterEntree(ancien);
      apresChangement(ancien);
    }
  }

  // ---------- déclencheurs liés au joueur (dalles, bruit) ----------
  function declencheursLocaux(t, ctx) {
    const s = J.salle, jo = J.joueur;
    if (s.traits.dalle) {
      const k = s.traits.dalle.surDalle(jo.x, jo.z);
      if (k >= 0 && jo.sur.dalle !== k) { const d = { c: J.cube, piege: s.traits.dalle.idx, sub: k, t0: t, x: 0, z: 0 }; J.declencheurs.push(d); N.emettre('piege', d); A.jouer('cliquetis'); }
      jo.sur.dalle = k;
    }
    if (s.traits.bruit && J.bruitCourse && t - J.bruitCourse < 100 && t - (J.dernierBruit || 0) > 2600) faireDuBruit(t);
    if (s.traits.teleport && jo.vivant) {
      const tp = s.traits.teleport.teleport;
      if (Math.hypot(jo.x - tp.x, jo.z - tp.z) < 0.9 && ((tp.p.phases >> J.it.p) & 1)) {
        if (!jo.sur.tele) jo.sur.tele = t;
        else if (t - jo.sur.tele > 1300) { jo.sur.tele = 0; teleporter(C.cibleTeleport(J.monde, J.cube, J.it, tp.p)); }
      } else jo.sur.tele = 0;
    }
    pousserImmobile(t, ctx);
    J.declencheurs = J.declencheurs.filter(d => t - d.t0 < 6000);
  }
  function faireDuBruit(t) {
    const s = J.salle; if (!s.traits.bruit) return;
    J.dernierBruit = t;
    const d = { c: J.cube, piege: s.traits.bruit.idx, sub: 0, t0: t, x: J.joueur.x, z: J.joueur.z };
    J.declencheurs.push(d); N.emettre('piege', d);
  }
  async function teleporter(vers) {
    if (!vers || vers === J.cube) { A.jouer('souffle', 0.4); return; }
    const ok = await demanderPlace(vers); if (!ok || !J.joueur.vivant) return;
    $('#fondu').classList.add('actif', 'clair'); A.jouer('cloche', 0.8);
    await dormir(450);
    const ancien = J.cube; J.cube = vers; J.joueur.x = 0; J.joueur.z = 1.6;
    construireSalleCourante(false); pivoterEntree(ancien); apresChangement(ancien); J.deso = Math.min(100, J.deso + 15);
    await dormir(300); $('#fondu').classList.remove('actif', 'clair');
  }

  // ---------- salves (boulier mal réglé) ----------
  function salve(t, x) {
    const g = R.groupe(J.salle.groupe, 0, 0, 0), fl = [];
    for (let i = 0; i < 4; i++) { const f = R.groupe(g, x - 0.75 + i * 0.5, 1.0, -DM); const c = R.cyl(f, 0.025, 0.025, 0.75, 5, R.M.bois(), 0, 0, 0); c.rotation.x = Math.PI / 2; fl.push(f); }
    J.salves.push({ t0: t + 450, x, g, fl, salle: J.cube }); A.jouer('cliquetis');
  }
  function majSalves(t) {
    J.salves = J.salves.filter(s => { if (s.salle !== J.cube || t - s.t0 > 1500) { if (s.g.parent) s.g.parent.remove(s.g); return false; } return true; });
    for (const s of J.salves) { const d = Math.max(0, (t - s.t0) / 1000 * 14); s.fl.forEach(f => { f.position.z = -DM + d; f.visible = t >= s.t0 && d < DM * 2; }); if (t >= s.t0 && !s.son) { s.son = true; A.jouer('fleches'); } }
  }
  function dangerSalves(t, x, z, r) {
    for (const s of J.salves) { if (t < s.t0) continue; const d = (t - s.t0) / 1000 * 14 - DM; if (Math.abs(z - d) < 0.45 + r && x > s.x - 1.0 - r && x < s.x + 1.0 + r) return 'fleches'; }
    return null;
  }

  // ---------- sons des pièges ----------
  function majSonsPieges(t) {
    for (const p of J.salle.pieges) {
      if (!p.son) continue;
      let e = ''; try { e = p.son(t) || ''; } catch (er) { e = ''; }
      const prev = J.dernierEtatSon.get(p.idx) || '';
      if (e && e !== prev) A.jouer(e, 0.8);
      J.dernierEtatSon.set(p.idx, e);
    }
  }

  // ---------- cadavres et objets au sol ----------
  function rafraichirObjetsCorps(t, seulementCorps) {
    const s = J.salle; if (!s) return;
    // corps
    const vus = new Set();
    I.corps.forEach(c => {
      if (c.cube !== s.id || (c.t || 0) > t) return;
      const age = (t - c.t) / CF.JOUR_MS;
      const st = C.stadeCorps(age).stade;
      if (st >= 5) return;
      vus.add(c.id);
      const ex = s.corpsMesh.get(c.id);
      if (ex && ex.stade === st) return;
      if (ex) s.groupe.remove(ex.mesh);
      const m = R.creerCadavre(c, age); if (!m) return;
      m.position.set(c.x, 0, c.z); m.rotation.y = c.a || 0;
      if (c.cause === 'chute') J.fossesOuvertes.add(cleFosse(c.x, c.z));
      s.groupe.add(m); s.corpsMesh.set(c.id, { mesh: m, stade: st, data: c });
    });
    s.corpsMesh.forEach((v, id) => { if (!vus.has(id)) { s.groupe.remove(v.mesh); s.corpsMesh.delete(id); } });
    if (seulementCorps) return;
    // objets : butin d'origine + équipement tombé
    const voulus = new Map();
    s.spec.butin.forEach(b => { if (!I.butinPris.has(I.id + ':' + b.cle) && !I.butinPris.has(b.cle)) voulus.set('b:' + b.cle, { kind: 'butin', cle: b.cle, type: b.type, qte: b.qte, x: b.x, z: b.z, cube: s.id }); });
    if (s.traits.enigme && J.enigmes.get(s.id) != null) {
      const cle = s.id + '-e'; if (!I.butinPris.has(cle)) voulus.set('b:' + cle, { kind: 'butin', cle, type: ['jade', 'miroir', 'bracelet', 'perle', 'statuette'][s.id % 5], qte: 1, x: 1.6, z: -2.4, cube: s.id });
    }
    I.sol.forEach(o => { if (o.cube === s.id && !o.prisPar) voulus.set('s:' + o.id, { kind: 'sol', docId: o.id, type: o.type, qte: o.qte || 1, x: o.x, z: o.z, cube: s.id, nom: o.nom }); });
    s.objetsMesh.forEach((v, k) => { if (!voulus.has(k)) { s.groupe.remove(v.mesh); s.objetsMesh.delete(k); } });
    // piles de butin : les objets proches sont regroupés visuellement, leurs données restent distinctes
    let n = 0;
    voulus.forEach((o, k) => {
      if (s.objetsMesh.has(k)) return;
      const m = R.creerObjet(o.type);
      const decal = (n++ % 5) * 0.18;
      m.position.set(o.x + decal * 0.5, decal * 0.3, o.z); s.groupe.add(m);
      s.objetsMesh.set(k, { mesh: m, obj: o });
    });
  }
  const cleFosse = (x, z) => { const i = clamp(Math.floor((x + DM) / 1.5), 0, 7), j = clamp(Math.floor((z + DM) / 1.5), 0, 7); return (-DM + 1.5 * (i + 0.5)) + ',' + (-DM + 1.5 * (j + 0.5)); };

  // ---------- autres joueurs ----------
  const LOOK_DEF = { tunique: 0x444444, pantalon: 0x222222, ceinture: 0xc9a24a, peau: 'jaune', coiffe: 'nu' };
  function majDistants(t, dt) {
    const vus = new Set();
    for (const p of N.peers) {
      if (estMoi(p)) continue;
      const d = lirePeer(p), id = idPeer(p) || d.u, auteur = p.by || d.u;
      if (!id || d.v !== 1 || d.c !== J.cube || d.i !== I.id) continue;
      if (D.reglages.bloques.includes(auteur)) continue;
      vus.add(id);
      let o = J.distants.get(id);
      if (!o) {
        const look = Object.assign({}, LOOK_DEF, typeof d.l === 'object' && d.l ? d.l : {});
        o = { fig: R.creerFigurine(look, {}), x: +d.x || 0, z: +d.z || 0, a: +d.a || 0, mort: false, pas: 0 };
        o.etiquette = etiquette(String(d.n || '?').slice(0, 20));
        o.fig.racine.add(o.etiquette);
        J.salle.groupe.add(o.fig.racine); J.distants.set(id, o);
      }
      const tx = clamp(+d.x || 0, -DM - 1, DM + 1), tz = clamp(+d.z || 0, -DM - 1, DM + 1);
      const dist = Math.hypot(tx - o.x, tz - o.z);
      o.x += (tx - o.x) * Math.min(1, dt * 10); o.z += (tz - o.z) * Math.min(1, dt * 10);
      o.fig.racine.position.set(o.x, 0, o.z); o.fig.racine.rotation.y = +d.a || 0;
      if (d.mort) { o.fig.racine.rotation.x = -Math.PI / 2; o.fig.racine.position.y = 0.2; }
      else { o.pas += dist * 3; o.fig.animer(o.pas, Math.min(1, dist * 8)); }
      const b = J.bulles.get(auteur); if (b && Date.now() - b.t < 6000) { if (!o.bulle || o.bulleTxt !== b.txt) { if (o.bulle) o.fig.racine.remove(o.bulle); o.bulle = etiquette(b.txt, true); o.bulleTxt = b.txt; o.fig.racine.add(o.bulle); } } else if (o.bulle) { o.fig.racine.remove(o.bulle); o.bulle = null; }
    }
    J.distants.forEach((o, id) => { if (!vus.has(id)) { if (o.fig.racine.parent) o.fig.racine.parent.remove(o.fig.racine); J.distants.delete(id); } });
  }
  function etiquette(txt, bulle) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d'); x.font = (bulle ? '30px ' : '600 32px ') + '"Zen Kaku Gothic New", sans-serif';
    const w = Math.min(500, x.measureText(txt).width + 32);
    x.fillStyle = bulle ? 'rgba(232,215,168,0.92)' : 'rgba(8,8,10,0.75)'; x.fillRect((512 - w) / 2, 18, w, 58);
    x.fillStyle = bulle ? '#1a1410' : '#e8d7a8'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt.length > 30 ? txt.slice(0, 29) + '…' : txt, 256, 48);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(3.4, 0.64, 1); s.position.y = bulle ? 3.0 : 2.3; s.renderOrder = 10;
    return s;
  }
  let dernierePres = 0, presPrec = '';
  function presenceObjet(cube) {
    const jo = J.joueur;
    return { v: 1, i: I.id, c: cube || J.cube, x: Math.round(jo.x * 100) / 100, z: Math.round(jo.z * 100) / 100, a: Math.round((jo.aMonde - (J.salle ? J.salle.groupe.rotation.y : 0)) * 100) / 100, mort: jo.vivant ? 0 : 1, n: J.perso.nom, u: N.uid || ONGLET, k: J.couleur, l: lookCube() };
  }
  function publierPresence(force) {
    if (!N.salon || !J.joueur) return;
    const now = performance.now();
    if (!force && now - dernierePres < 140) return;
    const p = presenceObjet(); const s = JSON.stringify(p);
    if (!force && s === presPrec) return;
    dernierePres = now; presPrec = s; N.presence(p);
  }

  // =====================================================================
  // INTERACTIONS (E, clic)
  // =====================================================================
  function interactifsProches() {
    const s = J.salle, jo = J.joueur, res = [];
    for (const i of s.interactifs) { const d = Math.hypot(jo.x - i.x, jo.z - i.z); if (d < i.r) res.push({ d, i }); }
    s.objetsMesh.forEach(v => { const d = Math.hypot(jo.x - v.obj.x, jo.z - v.obj.z); if (d < 1.4) res.push({ d: d - 0.5, i: { type: 'objet', obj: v.obj } }); });
    s.corpsMesh.forEach(v => { const d = Math.hypot(jo.x - v.data.x, jo.z - (v.data.z + 0.6)); if (d < 1.7) res.push({ d: d - 0.2, i: { type: 'corps', data: v.data } }); });
    if (s.traits.herse && J.perso.stats.force >= 50) {
      for (const f of s.traits.herse.faces) { const [a, d] = R.faceDepuisLocal(f, jo.x, jo.z); if (Math.abs(a) < PL && d < 1.6 && s.traits.herse.bloque(N.maintenant(), f, s.ctxPiege)) res.push({ d: d - 0.6, i: { type: 'herse', face: f } }); }
    }
    res.sort((a, b) => a.d - b.d);
    return res;
  }
  function libelle(i) {
    switch (i.type) {
      case 'plaque': return 'Examiner la plaque de la porte';
      case 'centre': { const h = J.portes[4], b = J.portes[5]; if (h && b) return 'Monter (A) · Descendre (B)'; if (h) return 'Monter à l’échelle'; if (b) return 'Descendre par la trappe'; return 'Examiner le médaillon'; }
      case 'objet': return 'Ramasser : ' + (i.obj.nom || C.OBJETS[i.obj.type].nom);
      case 'corps': return 'Examiner le corps';
      case 'trait': return 'Examiner : ' + i.nom;
      case 'abaque': return 'Manipuler le boulier';
      case 'herse': return 'Soulever la herse (maintenir E)';
    }
    return '';
  }
  function majInteraction(t, it, portes) {
    if (!J.joueur.vivant || J.joueur.traversee || J.joueur.montee) { $('#invite').hidden = true; return; }
    const l = interactifsProches(); J.interaction = l.length ? l[0].i : null;
    // Discipline : les inscriptions croisées sont recopiées d'elles-mêmes
    if (J.perso.stats.discipline >= 60) for (const x of l) if (x.i.type === 'plaque') copierPlaque(x.i.face, true);
    if (J.interaction) { $('#invite-txt').textContent = libelle(J.interaction); $('#invite').hidden = false; } else $('#invite').hidden = true;
    if (J.herseMaintien && J.touches.KeyE && J.interaction && J.interaction.type === 'herse') {
      if (t - J.herseMaintien > 1500) { J.herseLevee = { f: J.interaction.face, fin: t + 1800 }; J.herseMaintien = 0; A.jouer('chaine'); message('Tu soulèves la herse à bout de bras.'); }
    }
  }
  function interagir(secondaire) {
    if (J.mode !== 'jeu' || !J.joueur.vivant || J.panneau) return;
    const i = J.interaction; if (!i) return;
    switch (i.type) {
      case 'plaque': ouvrirPlaque(i.face); break;
      case 'centre': { const h = J.portes[4], b = J.portes[5]; if (secondaire) { if (b) utiliserTrappe(false); } else if (h) utiliserTrappe(true); else if (b) utiliserTrappe(false); else message('Un médaillon de bronze, poli par des milliers de pas.'); break; }
      case 'objet': ramasser(i.obj); break;
      case 'corps': examinerCorps(i.data); break;
      case 'trait': examinerTrait(i.nom); break;
      case 'abaque': ouvrirAbaque(); break;
      case 'herse': J.herseMaintien = N.maintenant(); break;
    }
  }
  async function ramasser(o) {
    const cle = o.kind === 'butin' ? o.cle : o.docId;
    if (J.reclamation === cle) return; J.reclamation = cle;
    const res = await claimCubeReward(N.uid || 'local', J.perso.id, o, I.id);
    J.reclamation = null;
    if (res.ok) {
      const def = C.OBJETS[o.type];
      await crediterCoffre({ type: o.type, qte: o.qte || 1, t: N.maintenant(), perso: J.perso.nom, nom: o.nom || def.nom });
      J.gains.push({ type: o.type, qte: o.qte || 1, nom: o.nom || def.nom });
      const tent = J.perso.tentatives[0]; if (tent) { tent.objets.push(o.nom || def.nom); sauverPersos(); }
      A.jouer('ramasser');
      message('Ajouté à ton Coffre : ' + (o.nom || def.nom) + (def.cat === 'monnaie' ? ' (+' + def.valeur * (o.qte || 1) + ' ' + MONNAIES[def.monnaie] + ')' : ''));
      J.donneesChangees = true;
      if (J.salle.traits.bruit) faireDuBruit(N.maintenant());
    } else message(res.raison === 'pris' || res.raison === 'occupe' ? 'Quelqu’un a été plus rapide.' : res.raison === 'portee' ? 'Trop loin.' : 'L’objet t’échappe. Réessaie.');
  }

  // ---------- plaque : sceau fixe + cadran mobile ----------
  const vuesPlaques = new Map();
  function copierPlaque(face, auto) {
    const it = J.it, code = C.codePorte(J.monde, J.cube, face, it);
    const cle = J.cube + ':' + face, val = code.groupes.join('-');
    if (vuesPlaques.get(cle) === val + ':' + it.p) return code;
    vuesPlaques.set(cle, val + ':' + it.p);
    const sp = J.salle.spec;
    J.carnet.entrees.unshift({ t: N.maintenant(), type: 'plaque', salle: decrireSalle(sp), points: face + 1, groupes: code.groupes.map(C.formaterGroupe), dent: it.p, auto: !!auto });
    if (J.carnet.entrees.length > 300) J.carnet.entrees.length = 300;
    J.carnetModifie = true;
    return code;
  }
  function ouvrirPlaque(face) {
    const sp = J.salle.spec;
    J.panneau = 'plaque';
    const p = $('#panneau-plaque'); p.hidden = false;
    afficherVerrou(face);
    // les trappes n'ont pas de plaque : seulement le verrou
    $('#plaque-grille').hidden = face >= 4;
    $('#plaque-titre').textContent = face >= 4 ? (face === 4 ? 'Verrou de la trappe du plafond' : 'Verrou de la trappe du sol') : 'Plaque de bronze';
    if (face >= 4) return;
    const code = copierPlaque(face, false);
    dessinerSceau($('#sceau'), sp, face);
    const cad = $('#cadran'); cad.innerHTML = '';
    code.groupes.forEach((g, i) => {
      const grp = document.createElement('div'); grp.className = 'groupe';
      C.formaterGroupe(g).split('').forEach(ch => { const r = document.createElement('span'); r.className = 'roue'; const b = document.createElement('span'); b.className = 'bande'; b.textContent = '0123456789'; b.style.transform = 'translateY(' + (-1.15 * +ch) + 'em)'; r.appendChild(b); grp.appendChild(r); });
      cad.appendChild(grp); if (i < 4) { const s = document.createElement('span'); s.className = 'tiret'; s.textContent = '–'; cad.appendChild(s); }
    });
    J.plaqueOuverte = { face, val: code.groupes.join('-') };
    const et = code.etat;
    $('#plaque-etat').textContent = et === 'ouverte' ? 'Les battants coulissent sans résistance.' : et === 'verrouillee' ? 'Un verrou de bronze est enclenché. Le sol vibre.' : et === 'vide' ? 'Un courant d’air glacé passe sous la porte.' : et === 'aveugle' ? 'Quelque chose de plein se trouve juste derrière.' : et === 'bord' ? 'La porte ne bouge pas. La pierre derrière semble très épaisse.' : et === 'condamnee' ? 'Des barres de fer condamnent le passage.' : et === 'sortie' ? 'Une lumière blanche filtre par les interstices.' : '';
    let obs = 'Recopié dans ton carnet.';
    if (J.perso.stats.intelligence >= 70 && !J.memoire.batons) { obs += ' Les traits gravés du sceau ont la régularité d’un compte.'; J.memoire.batons = true; }
    $('#plaque-obs').textContent = obs;
    clearInterval(J.minuteurPlaque);
    J.minuteurPlaque = setInterval(() => {
      if (J.panneau !== 'plaque') { clearInterval(J.minuteurPlaque); return; }
      const c2 = C.codePorte(J.monde, J.cube, face, C.instant(J.monde, N.maintenant()));
      const v = c2.groupes.join('-');
      if (v !== J.plaqueOuverte.val) {
        J.plaqueOuverte.val = v; A.jouer('cliquetis', 0.5);
        const roues = cad.querySelectorAll('.bande');
        c2.groupes.map(C.formaterGroupe).join('').split('').forEach((ch, i) => { if (roues[i]) roues[i].style.transform = 'translateY(' + (-1.15 * +ch) + 'em)'; });
        copierPlaque(face, false);
      }
    }, 400);
  }
  // ---------- verrous à énigme ----------
  function afficherVerrou(face) {
    const cle = J.cube + ':' + face, ouvert = J.verrous.has(cle);
    const e = C.enigmePorte(J.monde, J.cube, face);
    J.verrouOuvert = { face, e, cle };
    $('#verrou-titre').textContent = e.titre;
    $('#verrou-texte').textContent = e.lignes.join('\n');
    const fig = $('#verrou-figure');
    fig.hidden = !e.figure;
    if (e.figure) dessinerFigure(fig, e.figure);
    $('#verrou-form').hidden = ouvert;
    $('#verrou-etat').textContent = ouvert ? 'Le verrou est ouvert. Les battants sont libres.' : 'La réponse est un nombre entier.';
    $('#verrou-etat').className = ouvert ? 'ouvert' : '';
    $('#verrou-reponse').value = '';
    if (!ouvert) {
      const sp = J.salle.spec, deja = J.carnet.entrees.some(x => x.type === 'enigme' && x.cle === cle);
      if (!deja) { J.carnet.entrees.unshift({ t: N.maintenant(), type: 'enigme', cle, salle: decrireSalle(sp), points: face + 1, titre: e.titre, texte: e.lignes.join(' '), dent: J.it.p }); J.carnetModifie = true; }
      setTimeout(() => { if (J.panneau === 'plaque') $('#verrou-reponse').focus({ preventScroll: true }); }, 60);
    }
  }
  function essayerVerrou() {
    const v = J.verrouOuvert; if (!v || !J.joueur || !J.joueur.vivant) return;
    const t = N.maintenant();
    if (t < J.verrouGrippe) { $('#verrou-etat').textContent = 'Le mécanisme est encore grippé. Attends un instant.'; return; }
    const brut = $('#verrou-reponse').value.replace(/[\s.]/g, '');
    const n = /^\d{1,7}$/.test(brut) ? parseInt(brut, 10) : NaN;
    if (Number.isNaN(n)) { $('#verrou-etat').textContent = 'Écris un nombre entier, en chiffres.'; return; }
    if (n === v.e.reponse) {
      J.verrous.add(v.cle);
      D.tentative = Object.assign(D.tentative || {}, { ouvertes: [...J.verrous].slice(-500) }); sauverTentative();
      A.jouer('cloche', 0.6); A.jouer('porte', 0.8);
      $('#verrou-form').hidden = true; $('#verrou-etat').textContent = 'Un déclic. Le verrou est ouvert.'; $('#verrou-etat').className = 'ouvert';
      message('Le verrou cède dans un déclic.');
    } else {
      J.verrouGrippe = t + 4000;
      A.jouer('verrou', 0.8);
      $('#verrou-etat').textContent = 'Le verrou grince et se grippe. Ce n’est pas le bon nombre.'; $('#verrou-etat').className = 'faux';
    }
  }
  function dessinerFigure(cv, f) {
    const x = cv.getContext('2d');
    if (f.carre) {
      cv.width = 300; cv.height = 300;
      x.fillStyle = '#1a1410'; x.fillRect(0, 0, 300, 300);
      x.strokeStyle = '#c9a24a'; x.lineWidth = 3;
      for (let i = 0; i <= 3; i++) { x.beginPath(); x.moveTo(15 + i * 90, 15); x.lineTo(15 + i * 90, 285); x.stroke(); x.beginPath(); x.moveTo(15, 15 + i * 90); x.lineTo(285, 15 + i * 90); x.stroke(); }
      x.font = '700 38px "Shippori Mincho B1", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let k = 0; k < 9; k++) {
        const i = Math.floor(k / 3), j = k % 3, cx = 60 + j * 90, cy = 60 + i * 90;
        if (k === f.cible) { x.fillStyle = '#a3271f'; x.fillText('?', cx, cy); }
        else if (f.caches.includes(k)) { x.fillStyle = '#4a3a20'; x.beginPath(); x.arc(cx, cy, 16, 0, Math.PI * 2); x.fill(); }
        else { x.fillStyle = '#e8d7a8'; x.fillText(String(f.carre[i][j]), cx, cy); }
      }
    } else if (f.batons) {
      cv.width = 560; cv.height = 130;
      x.fillStyle = '#1a1410'; x.fillRect(0, 0, 560, 130);
      x.strokeStyle = '#c9a24a'; x.lineWidth = 3; x.strokeRect(4, 4, 552, 122);
      f.batons.forEach((v, i) => {
        const cx = 52 + i * 91;
        if (i === f.trou) { x.fillStyle = '#a3271f'; x.fillRect(cx - 26, 38, 52, 52); return; }
        R.dessinerBatonnets(x, v, cx, 65, 0.85, '#e8d7a8');
      });
    }
  }
  function dessinerSceau(cv, sp, face) {
    R.dessinerSceau(cv.getContext('2d'), cv.width, cv.height, sp, face);
  }
  function dessinerSceauAncien(cv, sp, face) {
    const x = cv.getContext('2d'), w = cv.width, h = cv.height;
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#2a2014'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#c9a24a'; x.lineWidth = 3; x.strokeRect(6, 6, w - 12, h - 12);
    sp.chiffres.forEach((f, i) => embleme(x, f, 70 + i * 92, 70, 34));
    R.dessinerBatonnets(x, sp.runeA, 70, 170, 1.2, '#e8d7a8');
    R.dessinerBatonnets(x, sp.runeB, 160, 170, 1.2, '#e8d7a8');
    R.dessinerBatonnets(x, sp.zone, 250, 170, 1.2, '#c97a5a');
    x.fillStyle = '#c9a24a'; for (let i = 0; i <= face; i++) { x.beginPath(); x.arc(w / 2 - face * 9 + i * 18, h - 26, 5, 0, TAU); x.fill(); }
  }
  function embleme(x, f, cx, cy, r) {
    x.save(); x.translate(cx, cy); x.strokeStyle = '#e8d7a8'; x.fillStyle = '#e8d7a8'; x.lineWidth = 3;
    x.beginPath(); x.arc(0, 0, r + 6, 0, TAU); x.stroke();
    switch (f) {
      case 0: x.beginPath(); for (let i = 0; i <= 24; i++) { const k = i / 24; const px = -r + k * 2 * r, py = Math.sin(k * 3 * Math.PI) * r * 0.45; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); for (let i = 1; i < 6; i++) { const k = i / 6; const px = -r + k * 2 * r, py = Math.sin(k * 3 * Math.PI) * r * 0.45; x.beginPath(); x.moveTo(px, py); x.lineTo(px - 4, py - 10); x.stroke(); } break;
      case 1: x.beginPath(); for (let i = 0; i < 60; i++) { const a = i * 0.32, rr = 2 + i * 0.5; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); break;
      case 2: for (let i = 0; i < 8; i++) { x.save(); x.rotate(i / 8 * TAU); x.beginPath(); x.ellipse(0, -r * 0.5, r * 0.18, r * 0.5, 0, 0, TAU); x.stroke(); x.restore(); } break;
      case 3: x.beginPath(); x.arc(0, 0, r * 0.75, Math.PI / 2, Math.PI * 1.5); x.fill(); x.beginPath(); x.arc(0, 0, r * 0.75, 0, TAU); x.stroke(); x.beginPath(); x.moveTo(0, -r); x.lineTo(0, r); x.stroke(); break;
      case 4: for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; x.beginPath(); x.moveTo(Math.sin(a) * r * 0.6, -Math.cos(a) * r * 0.6); x.lineTo(Math.sin(a) * r * 0.85, -Math.cos(a) * r * 0.85); x.stroke(); } x.beginPath(); x.moveTo(0, 0); x.lineTo(r * 0.3, -r * 0.45); x.stroke(); break;
      case 5: x.beginPath(); x.moveTo(-r * 0.6, -r * 0.6); x.lineTo(r * 0.6, -r * 0.6); x.lineTo(r * 0.6, r * 0.1); x.quadraticCurveTo(0, r * 0.9, -r * 0.6, r * 0.1); x.closePath(); x.stroke(); x.beginPath(); x.moveTo(0, -r * 0.5); x.lineTo(0, r * 0.5); x.moveTo(-r * 0.4, -r * 0.1); x.lineTo(r * 0.4, -r * 0.1); x.stroke(); break;
    }
    x.restore();
  }

  // ---------- examens ----------
  function examinerCorps(c) {
    const age = (N.maintenant() - c.t) / CF.JOUR_MS, st = C.stadeCorps(age).stade;
    const base = ['Un corps repose, encore vêtu. La peau n’a pas changé de couleur.', 'La chair a pris une teinte verdâtre. L’odeur est forte.', 'Il ne reste presque que des os sous les vêtements affaissés.', 'Un squelette complet, blanchi, aux articulations encore jointes.', 'Des os friables, à moitié réduits en poussière.'][st];
    const lieu = Math.max(Math.abs(c.x), Math.abs(c.z)) > 4.4 ? (Math.abs(Math.abs(c.x) - Math.abs(c.z)) < 1.5 ? ' Il est tassé dans un angle.' : ' Il gît près d’un mur.') : (Math.hypot(c.x, c.z) < 1.6 ? ' Il est étendu près du centre.' : '');
    const porte = J.salle.interactifs.some(i => i.type === 'plaque' && Math.hypot(i.x - c.x, i.z - c.z) < 2.2) ? ' Une porte se trouve à deux pas.' : '';
    const marques = { brule: ' Les tissus sont noircis ; une auréole de suie entoure le corps.', lames: ' Des entailles profondes et nettes traversent le sol.', tranche: ' Des entailles profondes et nettes traversent le sol.', ecrase: ' Le corps est étrangement aplati. La pierre autour est fissurée.', fleches: ' Des tiges de bois brisées sont éparpillées autour.', pointes: ' Le sol, dessous, est criblé de petits trous réguliers.', chute: ' Le corps gît au fond d’une ouverture dans le dallage.', scie: ' Une rainure étroite court dans le sol, bordée d’éclats de métal.', broye: ' La pierre porte l’empreinte de grosses dents de bronze.', epuisement: ' Recroquevillé, sans blessure apparente.' }[c.cause] || '';
    const n = [...J.salle.corpsMesh.values()].filter(v => Math.hypot(v.data.x - c.x, v.data.z - c.z) < 2.5).length;
    const plus = n > 1 ? ' D’autres restes sont tout proches.' : '';
    const nom = st <= 3 && c.nom ? ' Un nom est brodé sur le col : « ' + String(c.nom).slice(0, 24) + ' ».' : '';
    let detail = '';
    if (J.perso.stats.intelligence >= 55 && marques) detail = c.cause === 'lames' || c.cause === 'tranche' ? ' Les entailles sont à hauteur de genou, toutes parallèles.' : c.cause === 'fleches' ? ' Les tiges sont toutes orientées dans le même sens.' : c.cause === 'brule' ? ' La suie s’étire en longueur, comme projetée.' : '';
    ouvrirTexte('Un corps', base + lieu + porte + marques + detail + plus + nom);
    J.carnet.entrees.unshift({ t: N.maintenant(), type: 'corps', salle: decrireSalle(J.salle.spec), texte: base + marques, dent: J.it.p }); J.carnetModifie = true;
  }
  function examinerTrait(nom) {
    const txt = {
      gong: 'Un gong de bronze, voilé de poussière. Le frapper résonnerait loin.', 'inscription murale': 'Des signes peints à l’or, presque effacés. Les traits s’organisent en colonnes régulières.',
      'miroir de bronze': 'Ton visage, déformé par le métal. Derrière toi, la salle paraît plus profonde qu’elle ne l’est.', 'tablette d’ancêtres': 'Des tablettes de bois noir. Les noms ont été grattés au couteau.',
    }[nom] || 'Rien de plus que ce que tu vois.';
    ouvrirTexte(nom.charAt(0).toUpperCase() + nom.slice(1), txt);
    if (nom === 'gong' && J.salle.traits.bruit) faireDuBruit(N.maintenant());
  }
  function ouvrirTexte(titre, txt) {
    J.panneau = 'texte';
    $('#panneau-texte-titre').textContent = titre; $('#panneau-texte-corps').textContent = txt;
    $('#panneau-texte').hidden = false;
  }
  function ouvrirAbaque() {
    const e = J.salle.traits.enigme.enigme;
    J.panneau = 'abaque';
    $('#panneau-abaque').hidden = false;
    const cv = $('#abaque-tablette'), x = cv.getContext('2d');
    x.fillStyle = '#1a1410'; x.fillRect(0, 0, cv.width, cv.height); x.strokeStyle = '#c9a24a'; x.lineWidth = 3; x.strokeRect(5, 5, cv.width - 10, cv.height - 10);
    e.suite.forEach((v, i) => { const cx = 50 + i * 90; if (i === e.trou) { x.strokeStyle = '#a3271f'; x.strokeRect(cx - 30, 30, 60, 80); x.strokeStyle = '#c9a24a'; return; } R.dessinerBatonnets(x, v, cx, 70, 0.95, '#e8d7a8'); });
    J.abaque = [0, 0, 0]; rendreAbaque();
  }
  function rendreAbaque() { document.querySelectorAll('#abaque-roues .roue-ab').forEach((r, i) => { r.querySelector('canvas') || r.prepend(document.createElement('canvas')); const cv = r.querySelector('canvas'); cv.width = 80; cv.height = 90; const x = cv.getContext('2d'); x.fillStyle = '#2a2014'; x.fillRect(0, 0, 80, 90); R.dessinerBatonnets(x, J.abaque[i], 40, 45, 1.1, '#e8d7a8'); }); }
  function validerAbaque() {
    const e = J.salle.traits.enigme.enigme, v = J.abaque[0] * 100 + J.abaque[1] * 10 + J.abaque[2];
    fermerPanneaux();
    if (v === e.reponse) { J.enigmes.set(J.salle.id, J.it.k); A.jouer('cloche'); message('Un déclic profond. Les verrous des portes glissent.'); J.donneesChangees = true; }
    else { salve(N.maintenant(), 0); message('Le levier claque. Quelque chose s’arme dans le mur.'); }
  }
  function fermerPanneaux() {
    ['#panneau-plaque', '#panneau-texte', '#panneau-abaque', '#panneau-carnet', '#panneau-coffre', '#panneau-aide'].forEach(s => { $(s).hidden = true; });
    if (J.panneau === 'carnet') { J.carnet.notes = $('#carnet-notes').value.slice(0, 20000); J.carnetModifie = true; }
    J.panneau = null; clearInterval(J.minuteurPlaque);
    if (J.carnetModifie && J.perso) { J.carnetModifie = false; ecrireDoc(cheminJoueur('carnet-' + J.perso.id), J.carnet); }
  }

  // ---------- carnet et description des salles ----------
  function decrireSalle(sp) {
    const coul = { 0xffb347: 'ambrées', 0xff8a3d: 'orangées', 0xffd27a: 'dorées', 0x9fd8c0: 'vert pâle', 0xd9a0ff: 'mauves' }[sp.lanterne] || 'pâles';
    const t = sp.traits.map(x => x.nom).join(', ');
    const murs = { 'laque rouge': 'de laque rouge', bronze: 'de bronze', jade: 'de jade', 'pierre grise': 'de pierre grise', 'bois sombre': 'de bois sombre', ocre: 'd’ocre', encre: 'couleur d’encre' }[sp.palette.nom] || '';
    return 'Murs ' + murs + (t ? ' · ' + t : '') + ' · lanternes ' + coul + (sp.degats ? ' · sol fendu' : '');
  }
  function noterSalle() {
    const sp = J.salle.spec, d = decrireSalle(sp);
    if (J.carnet.entrees[0] && J.carnet.entrees[0].type === 'salle' && J.carnet.entrees[0].salle === d) return;
    J.carnet.entrees.unshift({ t: N.maintenant(), type: 'salle', salle: d, dent: (J.it || C.instant(J.monde, N.maintenant())).p });
    if (J.carnet.entrees.length > 300) J.carnet.entrees.length = 300;
    J.carnetModifie = true;
    if (J.carnet.entrees.length % 6 === 0) { J.carnetModifie = false; ecrireDoc(cheminJoueur('carnet-' + J.perso.id), J.carnet); }
  }
  function ouvrirCarnet() {
    J.panneau = 'carnet'; $('#panneau-carnet').hidden = false;
    const l = $('#carnet-liste'); l.innerHTML = '';
    if (!J.carnet.entrees.length) { const p = document.createElement('p'); p.className = 'vide'; p.textContent = 'Pages blanches. Ce que tu observes s’inscrira ici.'; l.appendChild(p); }
    J.carnet.entrees.slice(0, 120).forEach(e => {
      const li = document.createElement('li'); li.className = 'entree ' + e.type;
      const h = document.createElement('div'); h.className = 'meta'; h.textContent = new Date(e.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' · dent ' + (e.dent + 1) + ' du cadran · ' + e.salle;
      li.appendChild(h);
      const b = document.createElement('div'); b.className = 'corps';
      if (e.type === 'plaque') b.textContent = '•'.repeat(e.points) + '   ' + e.groupes.join(' – ');
      else if (e.type === 'enigme') b.textContent = (e.points <= 4 ? '•'.repeat(e.points) + '   ' : '') + e.titre + ' — ' + e.texte;
      else if (e.type === 'corps') b.textContent = e.texte;
      else b.textContent = 'Entrée dans une salle.';
      li.appendChild(b); l.appendChild(li);
    });
  }
  function ouvrirCoffreJeu() {
    J.panneau = 'coffre'; $('#panneau-coffre').hidden = false; rendreCoffre($('#coffre-jeu'));
  }

  // =====================================================================
  // MORT ET LIBÉRATION
  // =====================================================================
  function mourir(cause, t, piege) {
    const jo = J.joueur; if (!jo.vivant) return;
    jo.vivant = false; J.mortAnim = t; J.causeMort = cause; J.piegeMort = piege || null;
    preparerRalenti(t);
    A.jouer('mort');
    $('#invite').hidden = true; fermerPanneaux();
    publierPresence(true);
    N.emettre('mort', { c: J.cube, x: jo.x, z: jo.z, n: J.perso.nom });
    const corps = { cube: J.cube, x: Math.round(jo.x * 100) / 100, z: Math.round(jo.z * 100) / 100, a: Math.round((jo.aMonde - J.salle.groupe.rotation.y) * 100) / 100, cause, t: N.maintenant(), look: lookCube(), nom: J.perso.nom, perso: J.perso.id };
    const id = idDoc();
    const tombes = (J.perso.equipement || []).map((e, i) => ({ cube: J.cube, x: clamp(jo.x + Math.cos(i * 2.3) * 0.7, -5.4, 5.4), z: clamp(jo.z + Math.sin(i * 2.3) * 0.7, -5.4, 5.4), type: e.type, qte: 1, nom: C.OBJETS[e.type].nom + ' de ' + J.perso.nom, t: N.maintenant(), source: 'corps' }));
    if (N.db) {
      N.db.doc('instances/' + I.id + '/corps/' + id).set(corps).catch(() => {});
      tombes.forEach(o => N.db.collection('instances/' + I.id + '/sol').add(o).catch(() => {}));
    } else { I.corps.set(id, Object.assign({ id }, corps)); tombes.forEach((o, i) => I.sol.set(id + '-' + i, Object.assign({ id: id + '-' + i }, o))); sauverInstanceLocale(); }
    J.perso.equipement = [];
    J.perso.statut = 'mort';
    const tent = J.perso.tentatives[0]; if (tent) { tent.fin = N.maintenant(); tent.issue = 'mort'; tent.cause = cause; tent.piege = piege || null; }
    sauverPersos(); D.tentative = null; sauverTentative();
    if (J.carnetModifie) { J.carnetModifie = false; ecrireDoc(cheminJoueur('carnet-' + J.perso.id), J.carnet); }
    setTimeout(() => cinematique('mort'), 900);
  }
  function liberation(face) {
    const jo = J.joueur; jo.vivant = true; jo.libre = true;
    J.perso.statut = 'evade';
    const tent = J.perso.tentatives[0]; if (tent) { tent.fin = N.maintenant(); tent.issue = 'evade'; }
    sauverPersos(); D.tentative = null; sauverTentative();
    J.faceSortie = face;
    cinematique('liberte');
  }
  const CIN_MS = 10000;
  function cinematique(type) {
    J.mode = 'cinematique'; J.cin = { type, debut: performance.now(), depCam: camera.position.clone(), cible: cible.clone() };
    document.documentElement.style.setProperty('--k', '0');
    document.body.dataset.cinematique = type;
    if (J.figJoueur && J.figJoueur.anneau) J.figJoueur.anneau.visible = false;
    $('#cinematique').hidden = false;
    $('#cin-titre').textContent = type === 'mort' ? '' : 'LIBRE';
    $('#cin-l1').textContent = type === 'mort' ? J.perso.nom + ' ne quittera pas le Cube.' : J.perso.nom + ' a franchi la dernière porte.';
    const ex = type === 'mort' && J.piegeMort && EXPLICATIONS[J.piegeMort];
    $('#cin-l2').textContent = type === 'mort' ? (ex ? 'Tué par : ' + ex.nom + '.' : 'Son corps restera là où il est tombé.') : 'Derrière, la structure continue de tourner, sans lui.';
    $('#cin-l3').textContent = J.gains.length ? 'Ce que tes mains ont pris t’appartient : ' + J.gains.map(g => g.nom).join(', ') + '.' : (type === 'mort' ? 'Ses mains sont vides.' : 'Il ne rapporte que sa vie.');
    if (type === 'liberte') {
      A.jouer('liberte');
      J.vueEnsemble = R.construireVueEnsemble(J.monde, J.it); scene.add(J.vueEnsemble);
      scene.fog.density = 0.0035;
      scene.attach(J.figJoueur.racine);
    }
    N.presence({ v: 0 });
  }
  function majCinematique(t, it, dt) {
    const c = J.cin, k = clamp((performance.now() - c.debut) / CIN_MS, 0, 1);
    if (J.salle) placerGroupe(J.salle.groupe, J.salle.id, it);
    if (c.type === 'mort') {
      const ecoule = performance.now() - c.debut, rp = J.ralenti;
      if (rp && ecoule < rp.dureeReelle) { majRalenti(rp, ecoule); document.documentElement.style.setProperty('--k', '0'); return; }
      if (rp && !rp.fini) finirRalenti(rp);
      const k2 = rp ? clamp((ecoule - rp.dureeReelle) / (CIN_MS - rp.dureeReelle), 0, 1) : k;
      const wp = new THREE.Vector3(); J.figJoueur.racine.getWorldPosition(wp);
      const a = k2 * 0.9, dist = 5.5 - k2 * 2;
      camera.position.set(wp.x + Math.sin(a) * dist, wp.y + 11 - k2 * 4, wp.z + Math.cos(a) * dist); camera.lookAt(wp);
      for (const p of J.salle.pieges) { try { p.maj(t, ctxPour(J.salle, t, it)); } catch (e) { /* */ } }
      document.documentElement.style.setProperty('--k', k2.toFixed(3));
      if (k >= 1) finTentative();
      return;
    } else {
      const fig = J.figJoueur;
      const dir = new THREE.Vector3(); const [lx, lz] = R.localDepuisFace(J.faceSortie, 0, -1); dir.set(lx, 0, lz).applyQuaternion(J.salle.groupe.quaternion).normalize();
      if (k < 0.35) { fig.racine.position.addScaledVector(dir, dt * 3.2); fig.animer(t * 0.012, 1); fig.racine.rotation.y = Math.atan2(dir.x, dir.z); }
      const wp = fig.racine.position;
      const ext = new THREE.Vector3(J.monde.W * CF.ESP_H * 0.5, J.monde.HZ * CF.ESP_V * 0.5, J.monde.D * CF.ESP_H * 0.5);
      const e = k < 0.3 ? 0 : (k - 0.3) / 0.7, ee = e * e * (3 - 2 * e);
      const loin = wp.clone().add(dir.clone().multiplyScalar(260)).add(new THREE.Vector3(0, 180, 0));
      camera.position.lerpVectors(wp.clone().add(new THREE.Vector3(0, 14, 12)), loin, ee);
      const regard = new THREE.Vector3().lerpVectors(wp, ext, ee); camera.lookAt(regard);
      lumSortie.intensity = 4 + ee * 6; lumSortie.position.copy(wp).add(new THREE.Vector3(0, 6, 0)); hemi.intensity = 0.42 + ee * 0.8;
    }
    document.documentElement.style.setProperty('--k', k.toFixed(3));
    if (k >= 1) finTentative();
  }
  // ---------- ralenti de la mort, sous un autre angle ----------
  // Les pièges suivent l'horloge du Cube : on rejoue fidèlement les 2 dernières secondes.
  const RALENTI_VITESSE = 0.37, RALENTI_AVANT = 2000, RALENTI_APRES = 450;
  function preparerRalenti(tMort) {
    const tr = (J.trace || []).filter(e => e.c === J.cube);
    const jo = J.joueur;
    // mort juste en arrivant : on rejoue quand même, le personnage reste à sa place
    if (!tr.length) tr.push({ t: tMort, x: jo.x, z: jo.z, a: jo.aMonde - (J.salle ? J.salle.groupe.rotation.y : 0), pas: jo.pas, v: 0, c: J.cube });
    const tDebut = tMort - RALENTI_AVANT;
    const der = tr[tr.length - 1];
    J.ralenti = {
      buffer: tr.slice(), tDebut, tFin: tMort, dureeReelle: Math.min(7000, (tMort + RALENTI_APRES - tDebut) / RALENTI_VITESSE),
      a0: der.a + 0.75, mort: { x: der.x, z: der.z, a: der.a }, sonMort: false,
    };
  }
  function echantillon(buf, t) {
    if (t <= buf[0].t) return buf[0];
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i], b = buf[i + 1];
      if (t >= a.t && t <= b.t) {
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        let da = b.a - a.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, a: a.a + da * k, pas: a.pas + (b.pas - a.pas) * k, v: a.v + (b.v - a.v) * k };
      }
    }
    return buf[buf.length - 1];
  }
  function majRalenti(rp, ecoule) {
    if (!rp.demarre) { rp.demarre = true; document.body.dataset.ralenti = '1'; A.jouer('ralenti'); }
    const tr = Math.min(rp.tFin + RALENTI_APRES, rp.tDebut + ecoule * RALENTI_VITESSE);
    const itr = C.instant(J.monde, tr);
    const s = J.salle;
    placerGroupe(s.groupe, s.id, itr);
    const ctx = ctxPour(s, tr, itr);
    for (const p of s.pieges) { try { p.maj(tr, ctx); } catch (e) { /* */ } }
    const fig = J.figJoueur;
    if (fig.racine.parent !== s.groupe) s.groupe.add(fig.racine);
    const e = echantillon(rp.buffer, Math.min(tr, rp.tFin));
    const chute = clamp((tr - rp.tFin) / 300, 0, 1);
    fig.racine.position.set(e.x, 0.2 * chute, e.z);
    fig.racine.rotation.set(-chute * Math.PI / 2, e.a, 0);
    if (tr < rp.tFin) fig.animer(e.pas, e.v); else fig.animer(0, 0);
    if (tr >= rp.tFin && !rp.sonMort) { rp.sonMort = true; A.jouer('mort', 0.6); }
    // caméra basse qui tourne lentement autour du personnage, gardée dans la salle
    const th = rp.a0 + ecoule / 1000 * 0.16, d = 5.6;
    const lx = clamp(e.x + Math.sin(th) * d, -DM + 0.6, DM - 0.6), lz = clamp(e.z + Math.cos(th) * d, -DM + 0.6, DM - 0.6);
    const cam = s.groupe.localToWorld(new THREE.Vector3(lx, 3.1, lz));
    const vise = s.groupe.localToWorld(new THREE.Vector3(e.x, 0.8, e.z));
    if (camera.fov !== 56) { camera.fov = 56; camera.updateProjectionMatrix(); }
    camera.position.copy(cam); camera.lookAt(vise);
    lumJoueur.position.copy(vise).add(new THREE.Vector3(0, 2.2, 0));
    s.murs.forEach(m => { m.mat.opacity = 1; m.mat.depthWrite = true; if (m.annexes) for (const a of m.annexes) { a.opacity = a.userData.op0; a.depthWrite = true; } });
  }
  function finirRalenti(rp) {
    rp.fini = true; delete document.body.dataset.ralenti;
    camera.fov = 46; camera.updateProjectionMatrix();
    const fig = J.figJoueur;
    fig.racine.position.set(rp.mort.x, 0.2, rp.mort.z);
    fig.racine.rotation.set(-Math.PI / 2, rp.mort.a, 0);
  }
  function nettoyerJeu() {
    delete document.body.dataset.ralenti;
    if (camera && camera.fov !== 46) { camera.fov = 46; camera.updateProjectionMatrix(); }
    J.mode = 'menu'; delete document.body.dataset.cinematique; document.body.dataset.ecran = 'menu';
    $('#cinematique').hidden = true;
    if (J.vueEnsemble) { scene.remove(J.vueEnsemble); J.vueEnsemble = null; scene.fog.density = 0.024; }
    if (J.salle) { libererGroupe(J.salle.groupe); J.salle = null; }
    J.coques.forEach(c => libererGroupe(c.groupe)); J.coques.clear();
    if (J.figJoueur && J.figJoueur.racine.parent) J.figJoueur.racine.parent.remove(J.figJoueur.racine); J.figJoueur = null;
    if (lumSortie) lumSortie.intensity = 0;
    J.mortAnim = 0;
    N.quitterSalon();
  }
  function finTentative() {
    const mort = J.cin && J.cin.type === 'mort', piege = J.piegeMort;
    nettoyerJeu(); rendreMenu();
    if (mort) expliquerMort(piege, J.causeMort);
  }
  /** Après une mort : ce qui l'a tué, comment ça marche, le signe annonciateur, comment l'éviter. */
  function expliquerMort(piege, cause) {
    const ex = EXPLICATIONS[piege];
    if (!ex) { ouvrirTexteMenu('Ce qui s’est passé', 'Cause de la mort : ' + causeTexte(cause || 'inconnu') + '.'); return; }
    ouvrirTexteMenu('Tué par : ' + ex.nom, ex.comment + '\n\nLe signe : ' + ex.signe + '\n\nPour passer : ' + ex.conseil);
  }
  /** Débogage : le captif redevient captif et repart aussitôt de la première salle (sans laisser de corps). */
  async function relancerEvasion(persoId) {
    const perso = D.persos.find(p => p.id === persoId);
    if (!perso || !J.debug || J.relance) return;
    J.relance = true;
    try {
      if (J.mode === 'jeu' || J.mode === 'cinematique') { fermerPanneaux(); relacherCroix(); N.presence({ v: 0 }); nettoyerJeu(); }
      perso.statut = 'captif';
      if (!perso.equipement || !perso.equipement.length) perso.equipement = EQUIPEMENT[0].map(type => ({ type }));
      const t = perso.tentatives && perso.tentatives[0];
      if (t && t.issue === 'en cours') { t.issue = 'abandon'; t.fin = N.maintenant(); }
      D.tentative = null; sauverTentative(); sauverPersos();
      cacherNotification(); rendreMenu();
      await entrer(perso.id);
    } finally { J.relance = false; }
  }
  function quitter() {
    if (J.mode !== 'jeu') return;
    fermerPanneaux(); relacherCroix();
    if (J.joueur.vivant) { D.tentative = Object.assign(D.tentative || {}, { cube: J.cube, x: J.joueur.x, z: J.joueur.z }); sauverTentative(); }
    N.presence({ v: 0 });
    J.mode = 'menu'; document.body.dataset.ecran = 'menu';
    if (J.salle) { libererGroupe(J.salle.groupe); J.salle = null; }
    J.coques.forEach(c => libererGroupe(c.groupe)); J.coques.clear();
    if (J.figJoueur && J.figJoueur.racine.parent) J.figJoueur.racine.parent.remove(J.figJoueur.racine); J.figJoueur = null;
    N.quitterSalon();
    rendreMenu();
    if (D.tentative) setTimeout(() => notifierEvasion(D.persos.find(p => p.id === D.tentative.perso)), 600);
  }

  // =====================================================================
  // ÉGARÉ AUTONOME (personnage non contrôlé)
  // =====================================================================
  async function egareAutonome(persoId) {
    if (!J.pret) return;
    const perso = D.persos.find(p => p.id === persoId); if (!perso || perso.statut !== 'captif') return;
    cacherNotification();
    afficherChargement(perso.nom + ' s’avance seul dans le noir…');
    await ouvrirInstance(INSTANCES[0]);
    const m = C.creerMonde(I.graine, I.t0), st = perso.stats;
    let t = N.maintenant(), cube = m.idEntree, salles = 0, mort = null, piegeEgare = null;
    const vus = new Map(), journal = [], gains = [];
    const pLire = 0.12 + st.intelligence * 0.006;
    const finMax = t + 2.5 * 3600e3;
    perso.statut = 'cube'; perso.tentatives.unshift({ debut: t, inst: I.id, issue: 'en cours', objets: [], autonome: true });
    while (!mort && t < finMax) {
      const it = C.instant(m, t), pos = C.positionSalle(m, cube, it);
      vus.set(cube, (vus.get(cube) || 0) + 1);
      if (cube === m.idLib) for (let d = 0; d < 4; d++) if (C.etatPorte(m, cube, d, it, pos).etat === 'sortie') { journal.push('Une lumière blanche. Il a couru vers elle.'); mort = 'evade'; break; }
      if (mort) break;
      const sp = C.specSalle(m, cube);
      // butin : ramassé si le personnage le remarque
      for (const b of sp.butin) if (!I.butinPris.has(b.cle) && Math.random() < 0.55 + st.discipline * 0.003) gains.push({ b, cube });
      const options = [];
      for (let d = 0; d < 6; d++) { const e = C.etatPorte(m, cube, d, it, pos); if (e.etat === 'ouverte') options.push({ d, v: e.voisin }); }
      if (!options.length) { t += CF.PHASE_MS; continue; }
      options.forEach(o => {
        const vsp = C.specSalle(m, o.v);
        let s = 1 / (1 + (vus.get(o.v) || 0) * (0.5 + st.discipline * 0.02));
        if (Math.random() < pLire) s *= vsp.famille === 0 ? 1.6 : 1 / (1 + vsp.zone * 0.25 + (vsp.famille >= 22 ? 1.5 : 0));
        if (o.d === 4 || o.d === 1 || o.d === 2) s *= 1.25;
        o.s = s * (0.6 + Math.random() * 0.8);
      });
      options.sort((a, b) => b.s - a.s);
      const choix = options[0];
      const vsp = C.specSalle(m, choix.v);
      const danger = vsp.pieges.length ? (0.006 + vsp.zone * 0.006 + (vsp.famille >= 22 ? 0.05 : 0)) * vsp.pieges.length : 0.001;
      const p = danger * (1 + it.colere / 150) * (1 - st.agilite * 0.005) * (1 - st.sangFroid * 0.003);
      t += 6000 + Math.random() * 9000 * (1 - st.agilite * 0.004);
      t += 20000 + Math.random() * 70000 * (1 - st.intelligence * 0.008); // le verrou à énigme
      cube = choix.v; salles++;
      if (Math.random() < p) {
        const types = vsp.pieges.map(x => x.type);
        const carte = { pointes: 'pointes', lamesMur: 'lames', pendule: 'lames', broyeur: 'ecrase', plafond: 'ecrase', flammes: 'brule', statue: 'brule', lumiere: 'brule', fleches: 'fleches', dalle: 'fleches', fosses: 'chute', solDerobe: 'chute', plateforme: 'chute', scie: 'scie', engrenages: 'broye', rouleau: 'ecrase', herse: 'ecrase' };
        const k = types.find(x => carte[x]); mort = k ? carte[k] : 'chute'; piegeEgare = k || null;
      }
      if (salles === 15) journal.push('Il a perdu le compte des salles. Les murs se ressemblent.');
    }
    if (!mort) { mort = 'epuisement'; journal.push('La soif, puis le sommeil.'); }
    // réclamations (atomiques, même règle que pour un joueur)
    const gardes = [];
    for (const g of gains) {
      J.joueur = { vivant: true, x: g.b.x, z: g.b.z }; J.cube = g.cube;
      const r = await claimCubeReward(N.uid || 'local', perso.id, { kind: 'butin', cle: g.b.cle, type: g.b.type, qte: g.b.qte, x: g.b.x, z: g.b.z, cube: g.cube }, I.id);
      if (r.ok) { const def = C.OBJETS[g.b.type]; await crediterCoffre({ type: g.b.type, qte: g.b.qte, t: N.maintenant(), perso: perso.nom, nom: def.nom }); gardes.push(def.nom); }
    }
    J.joueur = null; J.cube = 0;
    const tent = perso.tentatives[0]; tent.fin = t; tent.objets = gardes;
    if (mort === 'evade') { perso.statut = 'evade'; tent.issue = 'evade'; }
    else {
      perso.statut = 'mort'; tent.issue = 'mort'; tent.cause = mort; tent.piege = piegeEgare;
      const corps = { cube, x: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6, a: Math.random() * TAU, cause: mort, t, look: { unie: C.COULEURS_CUBE[Math.floor(Math.random() * C.COULEURS_CUBE.length)][1] }, nom: perso.nom, perso: perso.id };
      const id = idDoc();
      if (N.db) N.db.doc('instances/' + I.id + '/corps/' + id).set(corps).catch(() => {}); else { I.corps.set(id, Object.assign({ id }, corps)); sauverInstanceLocale(); }
    }
    tent.journal = ['Il a traversé ' + salles + ' salle' + (salles > 1 ? 's' : '') + '.'].concat(journal.slice(0, 4));
    perso.equipement = mort === 'evade' ? perso.equipement : [];
    sauverPersos();
    cacherChargement(); rendreMenu();
    const dur = Math.round((t - tent.debut) / 60000);
    ouvrirTexteMenu(mort === 'evade' ? perso.nom + ' est sorti' : perso.nom + ' n’est pas revenu',
      (mort === 'evade' ? 'Après ' + dur + ' minutes, il a trouvé la lumière.' : 'Après ' + dur + ' minutes d’errance, plus rien.') + ' ' + tent.journal.join(' ') + (gardes.length ? ' Rapporté dans ton Coffre : ' + gardes.join(', ') + '.' : ' Aucun objet rapporté.')
      + (piegeEgare && EXPLICATIONS[piegeEgare] ? '\n\nTué par : ' + EXPLICATIONS[piegeEgare].nom + '. ' + EXPLICATIONS[piegeEgare].comment : ''));
  }

  // =====================================================================
  // INTERFACE : menu, Coffre, notification
  // =====================================================================
  function dessinerPortrait(cv, look) {
    dessinerPortrait2D(cv, look);
    if (!R.portrait) return;
    setTimeout(() => {
      const url = R.portrait(look, cv.width * 2, cv.height * 2);
      if (!url) return;
      const img = new Image();
      img.onload = () => { const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height); };
      img.src = url;
    }, 0);
  }
  function dessinerPortrait2D(cv, look) {
    if (look && look.unie != null) look = { tunique: look.unie, pantalon: look.unie, peau: null, unie: look.unie, coiffe: 'nu' };
    const x = cv.getContext('2d'), w = cv.width, h = cv.height;
    x.clearRect(0, 0, w, h);
    const peau = R.hex(look.unie != null ? look.unie : (R.PEAUX[look.peau] || R.PEAUX.jaune)), tun = R.hex(look.tunique), pan = R.hex(look.pantalon);
    x.fillStyle = tun; x.beginPath(); x.moveTo(w * 0.28, h * 0.62); x.lineTo(w * 0.72, h * 0.62); x.lineTo(w * 0.8, h); x.lineTo(w * 0.2, h); x.closePath(); x.fill();
    x.fillStyle = '#c9a24a'; x.fillRect(w * 0.2, h * 0.94, w * 0.6, h * 0.04);
    x.fillStyle = peau; x.fillRect(w * 0.43, h * 0.55, w * 0.14, h * 0.08);
    x.beginPath(); x.roundRect ? x.roundRect(w * 0.3, h * 0.24, w * 0.4, h * 0.34, w * 0.06) : x.rect(w * 0.3, h * 0.24, w * 0.4, h * 0.34); x.fill();
    x.fillRect(w * 0.42, h * 0.18, w * 0.16, h * 0.07);
    x.fillStyle = '#1b1610'; x.fillRect(w * 0.41, h * 0.36, w * 0.04, h * 0.07); x.fillRect(w * 0.55, h * 0.36, w * 0.04, h * 0.07);
    x.strokeStyle = '#1b1610'; x.lineWidth = 2; x.beginPath(); x.arc(w * 0.5, h * 0.44, w * 0.07, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
    x.fillStyle = look.coiffe === 'kasa' ? '#c7a35a' : look.coiffe === 'casque' ? '#6b5a30' : look.coiffe === 'bandeau' ? '#a3271f' : look.coiffe === 'voile' ? '#2d2a3a' : '#141010';
    if (look.coiffe === 'kasa') { x.beginPath(); x.moveTo(w * 0.1, h * 0.27); x.lineTo(w * 0.5, h * 0.06); x.lineTo(w * 0.9, h * 0.27); x.closePath(); x.fill(); }
    else if (look.coiffe === 'chignon') { x.fillRect(w * 0.3, h * 0.2, w * 0.4, h * 0.08); x.beginPath(); x.arc(w * 0.5, h * 0.14, w * 0.08, 0, TAU); x.fill(); }
    else if (look.coiffe === 'casque') { x.beginPath(); x.arc(w * 0.5, h * 0.3, w * 0.23, Math.PI, 0); x.fill(); x.fillStyle = '#a3271f'; x.fillRect(w * 0.48, h * 0.02, w * 0.04, h * 0.08); }
    else if (look.coiffe === 'voile') { x.beginPath(); x.arc(w * 0.5, h * 0.34, w * 0.25, Math.PI, 0); x.fill(); x.fillRect(w * 0.25, h * 0.34, w * 0.06, h * 0.25); x.fillRect(w * 0.69, h * 0.34, w * 0.06, h * 0.25); }
    else { x.fillRect(w * 0.3, h * 0.22, w * 0.4, h * 0.07); if (look.coiffe === 'bandeau') { x.fillStyle = '#a3271f'; x.fillRect(w * 0.3, h * 0.27, w * 0.4, h * 0.04); } }
  }
  function rendreMenu() {
    const l = $('#liste-persos'); l.innerHTML = '';
    D.persos.forEach(p => {
      const li = document.createElement('li'); li.className = 'perso statut-' + p.statut;
      const cv = document.createElement('canvas'); cv.width = 84; cv.height = 96; cv.className = 'portrait'; dessinerPortrait(cv, p.look); li.appendChild(cv);
      const info = document.createElement('div'); info.className = 'info';
      const h = document.createElement('h3'); h.textContent = p.nom; info.appendChild(h);
      const chip = document.createElement('span'); chip.className = 'puce ' + p.statut; chip.textContent = STATUTS[p.statut] || p.statut; info.appendChild(chip);
      const st = document.createElement('dl'); st.className = 'stats';
      Object.keys(NOMS_STATS).forEach(k => { const dt = document.createElement('dt'); dt.textContent = NOMS_STATS[k]; const dd = document.createElement('dd'); const b = document.createElement('i'); b.style.width = p.stats[k] + '%'; dd.appendChild(b); const n = document.createElement('span'); n.textContent = p.stats[k]; dd.appendChild(n); st.appendChild(dt); st.appendChild(dd); });
      info.appendChild(st);
      const eq = document.createElement('p'); eq.className = 'equip'; eq.textContent = p.equipement && p.equipement.length ? 'Porte sur lui : ' + p.equipement.map(e => C.OBJETS[e.type].nom).join(', ') : 'Ne porte rien.'; info.appendChild(eq);
      const act = document.createElement('div'); act.className = 'actions';
      if (p.statut === 'captif') {
        const b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'btn or'; b1.textContent = 'Tenter l’évasion'; b1.addEventListener('click', () => notifierEvasion(p)); act.appendChild(b1);
        const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'btn'; b2.textContent = 'Le laisser tenter seul'; b2.addEventListener('click', () => egareAutonome(p.id)); act.appendChild(b2);
      } else if (p.statut === 'cube' && D.tentative && D.tentative.perso === p.id) {
        const b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'btn or'; b1.textContent = 'Reprendre la tentative'; b1.addEventListener('click', () => notifierEvasion(p)); act.appendChild(b1);
      }
      if (J.debug && p.statut !== 'captif') {
        const bd = document.createElement('button'); bd.type = 'button'; bd.className = 'btn debug'; bd.textContent = 'Relancer l’évasion (debug)'; bd.addEventListener('click', () => relancerEvasion(p.id)); act.appendChild(bd);
      }
      info.appendChild(act);
      const ts = (p.tentatives || []).filter(x => x.issue !== 'en cours').slice(0, 3);
      if (ts.length) {
        const hi = document.createElement('ul'); hi.className = 'histo';
        ts.forEach(x => { const li2 = document.createElement('li'); const d = new Date(x.debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); li2.textContent = d + ' — ' + (x.issue === 'evade' ? 'évadé' : x.issue === 'abandon' ? 'relancé (debug)' : 'mort' + (x.piege && EXPLICATIONS[x.piege] ? ' (' + EXPLICATIONS[x.piege].nom.toLowerCase() + ')' : x.cause ? ' (' + causeTexte(x.cause) + ')' : '')) + (x.objets && x.objets.length ? ' · ' + x.objets.length + ' objet' + (x.objets.length > 1 ? 's' : '') + ' rapporté' + (x.objets.length > 1 ? 's' : '') : '') + (x.autonome ? ' · seul' : ''); hi.appendChild(li2); });
        info.appendChild(hi);
      }
      li.appendChild(info); l.appendChild(li);
    });
    rendreCoffre($('#coffre-menu'));
    $('#mode-reseau').textContent = N.db && !N.uid ? 'Identité non reçue : ton Coffre et tes captifs restent sur cet appareil. Recharge la page pour réessayer.' : N.db && N.uid ? (N.peutEcrire ? 'Cube partagé : les corps, objets et rencontres sont communs à tous les visiteurs de cette page.' : 'Lecture seule : demande un accès Contributeur pour laisser une trace dans le Cube.') : 'Hors ligne : le Cube et ton Coffre sont enregistrés sur cet appareil seulement.';
  }
  const EXPLICATIONS = {
    pointes: { nom: 'Dalles à pointes', comment: 'Des groupes de dalles se hérissent de pointes d’acier, en vagues, en damier ou par rangées, à un rythme régulier.', signe: 'juste avant, les pointes affleurent à peine et un cliquetis se fait entendre.', conseil: 'observe le rythme depuis une dalle lisse, puis traverse juste après que ta rangée est redescendue.' },
    lamesMur: { nom: 'Lames murales', comment: 'Des lames jaillissent à l’horizontale des fentes noires d’un mur, frappent puis se retirent.', signe: 'les fentes rougeoient pendant une seconde avant la frappe.', conseil: 'ne t’arrête jamais face à une fente ; passe juste après le retrait de la lame.' },
    broyeur: { nom: 'Murs broyeurs', comment: 'Deux murs hérissés de pointes se referment l’un vers l’autre sur une bande de la salle, puis s’écartent.', signe: 'un grondement, les deux murs tremblent puis avancent ; des rails au sol marquent la bande.', conseil: 'quitte la bande dès le grondement, en sortant par les côtés : les murs te poussent vers le centre.' },
    flammes: { nom: 'Jets de flammes', comment: 'Des buses de bronze dans les murs crachent un long jet de feu en ligne droite.', signe: 'un sifflement et une petite flamme au bout de la buse juste avant le jet.', conseil: 'repère la ligne de chaque buse et traverse entre deux jets.' },
    fleches: { nom: 'Lanceurs de flèches', comment: 'Les petits trous d’un mur tirent des salves de flèches qui traversent toute la salle.', signe: 'un cliquetis de mécanisme juste avant la salve.', conseil: 'les flèches suivent la ligne de chaque trou : reste entre deux lignes, ou traverse juste après une salve.' },
    dalle: { nom: 'Dalle de pression', comment: 'Une dalle légèrement surélevée déclenche une salve de flèches tirée depuis un mur, droit sur elle.', signe: 'la dalle est un peu plus sombre et plus haute que les autres ; elle s’enfonce avec un clic.', conseil: 'contourne les dalles en relief, ou quitte leur ligne immédiatement après avoir marché dessus.' },
    fosses: { nom: 'Fosse dissimulée', comment: 'Une dalle identique aux autres cache un puits ; elle cède dès qu’on se tient dessus.', signe: 'une fine fente sombre longe le bord de la dalle piégée.', conseil: 'regarde les joints du sol avant de poser le pied ; une fosse où quelqu’un est tombé reste ouverte.' },
    solDerobe: { nom: 'Sol qui se dérobe', comment: 'Une bande de dalles tombe dans le vide, une rangée après l’autre, d’un bout à l’autre, puis remonte.', signe: 'les dalles tremblent juste avant de tomber.', conseil: 'traverse en devançant l’effondrement, ou attends que toute la bande soit remontée.' },
    pendule: { nom: 'Pendules tranchants', comment: 'De grandes lames suspendues au plafond balancent d’un mur à l’autre, au ras du sol au milieu de leur course.', signe: 'un souffle quand la lame passe au plus bas ; une rainure au sol marque sa trajectoire.', conseil: 'traverse la rainure juste après le passage de la lame.' },
    herse: { nom: 'Herse tombante', comment: 'Une grille de fer tombe d’un coup dans l’embrasure de la porte et la bloque un moment.', signe: 'les chaînes cliquettent juste avant la chute.', conseil: 'ne reste jamais sous une porte quand les chaînes s’agitent. Un captif costaud (Force 50 ou plus) peut la soulever en maintenant A ou E.' },
    plafond: { nom: 'Plafond descendant', comment: 'Un bloc de pierre descend du plafond jusqu’au sol sur une zone carrée, puis remonte.', signe: 'l’ombre au sol s’assombrit et un grondement se fait entendre.', conseil: 'quitte toute zone dont l’ombre s’assombrit.' },
    rouleau: { nom: 'Rouleau à pointes', comment: 'Un cylindre hérissé roule d’un mur à l’autre le long d’une voie sombre.', signe: 'la bande sombre au sol est sa voie ; on l’entend rouler.', conseil: 'traverse la voie juste derrière lui.' },
    engrenages: { nom: 'Roue dentée', comment: 'Une énorme roue de bronze roule le long d’un rail et broie ce qui se trouve sur son passage.', signe: 'le rail noir au sol et le grincement des dents.', conseil: 'franchis le rail quand la roue s’éloigne.' },
    plateforme: { nom: 'Plateforme rotative', comment: 'Le grand disque central tourne ; une part du disque manque et laisse voir le vide.', signe: 'la zone noire qui tourne avec le disque.', conseil: 'reste sur le bronze en suivant la rotation, ou sors du disque.' },
    scie: { nom: 'Lame circulaire', comment: 'Une scie circulaire parcourt une rainure du sol d’un bout à l’autre, en aller-retour.', signe: 'les fines rainures noires du sol sont ses rails.', conseil: 'franchis une rainure quand la scie est à l’autre bout.' },
    statue: { nom: 'Statues cracheuses de feu', comment: 'Les statues de dragon tournent la tête et crachent un long jet de feu là où elles regardent.', signe: 'leurs yeux s’allument en rouge avant de cracher.', conseil: 'ne reste jamais dans le regard d’une statue aux yeux allumés.' },
    coulissant: { nom: 'Murs coulissants', comment: 'Des pans de mur glissent d’un côté à l’autre de la salle et écrasent ce qu’ils coincent contre un mur.', signe: 'un frottement de pierre ; une rainure au sol marque leur trajet.', conseil: 'ne te laisse pas acculer contre un mur sur la trajectoire d’un pan mobile.' },
    labyrinthe: { nom: 'Murs mobiles', comment: 'Des murs sortent du sol et y rentrent tour à tour, changeant les passages de la salle.', signe: 'un frottement juste avant que les murs bougent.', conseil: 'ne reste pas collé à un mur bas : il peut te coincer en remontant.' },
    lumiere: { nom: 'Faisceaux de feu', comment: 'Des bandes de lumière balaient le sol ; au signal, une colonne de feu tombe sur chacune d’elles.', signe: 'la lumière devient soudain plus vive.', conseil: 'sors de la bande dès qu’elle s’intensifie.' },
    silence: { nom: 'Salle du silence', comment: 'Le bruit réveille la salle : courir, ramasser un objet ou frapper le gong fait jaillir des pointes autour de l’endroit où tu étais.', signe: 'les cloches suspendues tintent.', conseil: 'marche sans courir (pas de Maj ni de B) ; si les cloches sonnent, éloigne-toi tout de suite.' },
    temps: { nom: 'Portes temporisées', comment: 'Les portes ne s’ouvrent qu’une partie du temps et claquent violemment en se refermant.', signe: 'la colonne d’eau se vide : quand elle est vide, les portes claquent.', conseil: 'franchis la porte pendant que la colonne est encore pleine.' },
    trompeur: { nom: 'Fausse porte', comment: 'Une porte peinte sur le mur ; la toucher déclenche une lame cachée dans l’encadrement.', signe: 'elle n’a pas de plaque de bronze à côté.', conseil: 'une vraie porte a toujours sa plaque : ne touche pas les autres.' },
    escalier: { nom: 'Échelle effondrable', comment: 'L’échelle qui mène au plafond cède régulièrement sous le poids.', signe: 'elle tremble et grince avant de céder.', conseil: 'ne monte que quand elle est parfaitement immobile.' },
    condamnee: { nom: 'Chambre condamnée', comment: 'Les portes se scellent et tout le plafond descend, sauf au-dessus du lotus peint dans un coin.', signe: 'les portes claquent et le plafond gronde.', conseil: 'cours te mettre sur le lotus, ou fuis par la trappe du sol.' },
    instable: { nom: 'Sol instable', comment: 'De grandes dalles montent, redescendent, puis s’enfoncent dans le vide.', signe: 'elles tremblent avant de s’enfoncer.', conseil: 'quitte une grande dalle dès qu’elle tremble.' },
    salve: { nom: 'Salve du boulier', comment: 'Une mauvaise réponse au boulier déclenche une salve de flèches tirée du mur du fond, droit sur le boulier.', signe: 'le levier claque et un mécanisme s’arme dans le mur.', conseil: 'après avoir tiré le levier, écarte-toi aussitôt de l’axe du boulier.' },
  };
  const causeTexte = c => ({ pointes: 'transpercé', lames: 'tranché', tranche: 'tranché', ecrase: 'écrasé', brule: 'brûlé', fleches: 'flèches', chute: 'chute', scie: 'lame circulaire', broye: 'broyé', epuisement: 'épuisement' }[c] || c);
  function rendreCoffre(cont) {
    cont.innerHTML = '';
    const m = document.createElement('div'); m.className = 'monnaies';
    Object.keys(MONNAIES).forEach(k => { const d = document.createElement('div'); d.className = 'monnaie ' + k; const v = document.createElement('strong'); v.textContent = (D.coffre.monnaies[k] || 0).toLocaleString('fr-FR'); const n = document.createElement('span'); n.textContent = MONNAIES[k]; d.appendChild(v); d.appendChild(n); m.appendChild(d); });
    cont.appendChild(m);
    const parCat = {};
    Object.keys(D.coffre.objets).forEach(t => { const def = C.OBJETS[t]; if (!def || !D.coffre.objets[t]) return; (parCat[def.cat] = parCat[def.cat] || []).push([t, D.coffre.objets[t]]); });
    const cats = Object.keys(parCat);
    if (!cats.length) { const p = document.createElement('p'); p.className = 'vide'; p.textContent = 'Le Coffre est vide. Tout objet ramassé dans le Cube y arrive aussitôt, même si le personnage meurt ensuite.'; cont.appendChild(p); }
    cats.forEach(c => {
      const h = document.createElement('h4'); h.textContent = CATEGORIES[c] || c; cont.appendChild(h);
      const ul = document.createElement('ul'); ul.className = 'objets';
      parCat[c].forEach(([t, q]) => { const def = C.OBJETS[t]; const li = document.createElement('li'); li.className = 'rarete-' + def.rarete; const n = document.createElement('span'); n.textContent = def.nom; const qq = document.createElement('b'); qq.textContent = '×' + q; li.appendChild(n); li.appendChild(qq); ul.appendChild(li); });
      cont.appendChild(ul);
    });
    if (D.coffre.journal.length) {
      const h = document.createElement('h4'); h.textContent = 'Derniers gains'; cont.appendChild(h);
      const ul = document.createElement('ul'); ul.className = 'journal';
      D.coffre.journal.slice(0, 6).forEach(j => { const li = document.createElement('li'); li.textContent = j.nom + (j.qte > 1 ? ' ×' + j.qte : '') + (j.perso ? ' — par ' + j.perso : ''); ul.appendChild(li); });
      cont.appendChild(ul);
    }
  }
  function notifierEvasion(perso) {
    if (!perso || J.mode !== 'menu' || !J.pret) return;
    if (perso.statut !== 'captif' && !(perso.statut === 'cube' && D.tentative && D.tentative.perso === perso.id)) return;
    const n = $('#notif'); n.dataset.perso = perso.id; n.hidden = false;
    requestAnimationFrame(() => n.classList.add('visible'));
  }
  function cacherNotification() { const n = $('#notif'); n.classList.remove('visible'); n.hidden = true; }
  function afficherChargement(t) { $('#chargement-txt').textContent = t; $('#chargement').hidden = false; }
  function cacherChargement() { $('#chargement').hidden = true; }
  function ouvrirTexteMenu(titre, txt) { $('#dialogue-titre').textContent = titre; $('#dialogue-corps').textContent = txt; $('#dialogue').hidden = false; }
  let minuteurMsg = 0;
  function message(t) {
    const m = $('#message'); m.textContent = t; m.classList.add('visible');
    clearTimeout(minuteurMsg); minuteurMsg = setTimeout(() => m.classList.remove('visible'), 3800);
  }
  function majVignette() { document.documentElement.style.setProperty('--deso', (J.deso / 100).toFixed(3)); }

  // ---------- chat de proximité ----------
  function ajouterChat(m) { J.chat.push(m); if (J.chat.length > 40) J.chat.shift(); J.bulles.set(m.uid, { txt: m.txt, t: Date.now() }); rendreChat(); }
  function rendreChat() {
    const l = $('#chat-liste'); l.innerHTML = '';
    $('#chat').classList.toggle('masque', !!D.reglages.chatMasque);
    J.chat.slice(-12).forEach(m => {
      const li = document.createElement('li');
      const n = document.createElement('b'); n.textContent = m.n; li.appendChild(n);
      const t = document.createElement('span'); t.textContent = ' ' + m.txt; li.appendChild(t);
      if (m.uid && m.uid !== N.uid && m.uid !== ONGLET) {
        const bb = document.createElement('button'); bb.type = 'button'; bb.className = 'mini'; bb.textContent = 'Bloquer'; bb.title = 'Ne plus voir ce joueur ni ses messages';
        bb.addEventListener('click', () => { D.reglages.bloques.push(m.uid); sauverReglages(); J.chat = J.chat.filter(x => x.uid !== m.uid); rendreChat(); message('Joueur bloqué.'); });
        const bs = document.createElement('button'); bs.type = 'button'; bs.className = 'mini'; bs.textContent = 'Signaler';
        bs.addEventListener('click', () => signaler(m));
        li.appendChild(bb); li.appendChild(bs);
      }
      l.appendChild(li);
    });
    l.scrollTop = l.scrollHeight;
  }
  async function signaler(m) {
    if (!N.db || !N.uid) { message('Signalement impossible hors ligne.'); return; }
    try {
      const ref = N.db.doc('signalements/' + N.uid);
      const s = await ref.get(); const liste = (s.exists && s.data().liste) || [];
      liste.push({ t: N.maintenant(), cible: m.uid, nom: m.n, texte: m.txt, inst: I.id });
      await ref.set({ liste: liste.slice(-100) });
      message('Signalement envoyé au propriétaire du Cube.');
    } catch (e) { message('Le signalement n’a pas pu être envoyé.'); }
  }
  function envoyerChat(txt) {
    txt = txt.trim().slice(0, 200); if (!txt || !J.joueur || J.mode !== 'jeu') return;
    const d = { c: J.cube, txt, n: J.perso.nom, uid: N.uid || ONGLET };
    N.emettre('chat', d); ajouterChat({ n: J.perso.nom, txt, uid: d.uid, t: Date.now() });
  }

  // =====================================================================
  // ENTRÉES
  // =====================================================================
  function brancherEntrees() {
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') e.target.blur();
        if (e.key === 'Enter' && e.target.id === 'chat-saisie') { envoyerChat(e.target.value); e.target.value = ''; e.target.blur(); }
        return;
      }
      if (e.code === 'F9' && J.debug && J.perso && (J.mode === 'jeu' || J.mode === 'cinematique')) { e.preventDefault(); relancerEvasion(J.perso.id); return; }
      if (J.mode !== 'jeu') return;
      J.touches[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'Escape') { if (J.panneau) fermerPanneaux(); else ouvrirAide(); }
      else if (e.code === 'KeyE') { if (J.panneau === 'texte' || J.panneau === 'plaque') fermerPanneaux(); else interagir(false); }
      else if (e.code === 'KeyF') interagir(true);
      else if (e.code === 'KeyN' || e.code === 'Tab') { if (J.panneau === 'carnet') fermerPanneaux(); else { fermerPanneaux(); ouvrirCarnet(); } }
      else if (e.code === 'KeyI') { if (J.panneau === 'coffre') fermerPanneaux(); else { fermerPanneaux(); ouvrirCoffreJeu(); } }
      else if (e.code === 'Enter') { e.preventDefault(); $('#chat-saisie').focus(); }
      else if (e.code === 'KeyH') { if (J.panneau === 'aide') fermerPanneaux(); else ouvrirAide(); }
    });
    window.addEventListener('keyup', e => { J.touches[e.code] = false; if (e.code === 'KeyE') J.herseMaintien = 0; });
    window.addEventListener('blur', () => { J.touches = {}; relacherCroix(); });
    // manette de direction : on maintient un bouton (souris ou doigt) pour avancer
    document.querySelectorAll('#croix .dir').forEach(b => {
      const d = b.dataset.dir;
      const appui = e => { e.preventDefault(); J.croix[d] = true; b.classList.add('actif'); A.init(); try { b.setPointerCapture(e.pointerId); } catch (er) { /* */ } };
      const fin = () => { J.croix[d] = false; b.classList.remove('actif'); };
      b.addEventListener('pointerdown', appui);
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, fin));
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    $('#scene').addEventListener('wheel', e => { if (J.mode !== 'jeu') return; e.preventDefault(); J.zoom = clamp(J.zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.55, 1.7); }, { passive: false });
    // clic : examiner ce qui est sous la souris, si c'est à portée
    const ray = new THREE.Raycaster(), souris = new THREE.Vector2();
    $('#scene').addEventListener('click', e => {
      if (J.mode !== 'jeu' || !J.salle || J.panneau) return;
      souris.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(souris, camera);
      const sol = new THREE.Plane(new THREE.Vector3(0, 1, 0), -J.salle.groupe.position.y);
      const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(sol, p)) return;
      J.salle.groupe.worldToLocal(p);
      const l = interactifsProches();
      const cible2 = l.find(x => { const ix = x.i.x != null ? x.i.x : (x.i.obj ? x.i.obj.x : x.i.data ? x.i.data.x : 99); const iz = x.i.z != null ? x.i.z : (x.i.obj ? x.i.obj.z : x.i.data ? x.i.data.z : 99); return Math.hypot(ix - p.x, iz - p.z) < 1.6; });
      if (cible2) { J.interaction = cible2.i; interagir(false); }
    });
    // boutons
    $('#notif-entrer').addEventListener('click', () => { const id = $('#notif').dataset.perso; entrer(id); });
    document.querySelectorAll('[data-fermer]').forEach(b => b.addEventListener('click', fermerPanneaux));
    $('#btn-carnet').addEventListener('click', () => { if (J.panneau === 'carnet') fermerPanneaux(); else { fermerPanneaux(); ouvrirCarnet(); } });
    $('#btn-coffre').addEventListener('click', () => { if (J.panneau === 'coffre') fermerPanneaux(); else { fermerPanneaux(); ouvrirCoffreJeu(); } });
    $('#btn-aide').addEventListener('click', () => { if (J.panneau === 'aide') fermerPanneaux(); else ouvrirAide(); });
    $('#btn-quitter').addEventListener('click', quitter);
    $('#btn-debug').addEventListener('click', () => { if (J.perso) relancerEvasion(J.perso.id); });
    $('#btn-qualite').addEventListener('click', () => {
      const ordre = ['haute', 'normale', 'basse'], q = ordre[(ordre.indexOf(qualite()) + 1) % 3];
      D.reglages.qualite = q; sauverReglages(); appliquerQualite();
      if (J.mode === 'jeu') construireSalleCourante(false);
      message(q === 'haute' ? 'Qualité haute : ombres fines, textures détaillées.' : q === 'normale' ? 'Qualité normale : plus fluide sur tablette et téléphone.' : 'Qualité basse : sans ombres, pour les appareils modestes.');
    });
    $('#btn-son').addEventListener('click', () => { D.reglages.son = !D.reglages.son; A.init(); A.volume(D.reglages.son); $('#btn-son').textContent = D.reglages.son ? 'Son : oui' : 'Son : non'; sauverReglages(); });
    $('#btn-chat').addEventListener('click', () => { D.reglages.chatMasque = !D.reglages.chatMasque; sauverReglages(); rendreChat(); });
    $('#abaque-valider').addEventListener('click', validerAbaque);
    $('#verrou-form').addEventListener('submit', e => { e.preventDefault(); essayerVerrou(); });
    document.querySelectorAll('#abaque-roues .roue-ab').forEach((r, i) => {
      r.querySelector('.plus').addEventListener('click', () => { J.abaque[i] = (J.abaque[i] + 1) % 10; rendreAbaque(); A.jouer('cliquetis', 0.3); });
      r.querySelector('.moins').addEventListener('click', () => { J.abaque[i] = (J.abaque[i] + 9) % 10; rendreAbaque(); A.jouer('cliquetis', 0.3); });
    });
    $('#dialogue-ok').addEventListener('click', () => { $('#dialogue').hidden = true; });
    $('#form-recrue').addEventListener('submit', e => {
      e.preventDefault();
      const nom = $('#recrue-nom').value.trim().slice(0, 24) || null;
      const look = { tunique: parseInt($('#recrue-tunique').value.slice(1), 16), pantalon: parseInt($('#recrue-pantalon').value.slice(1), 16), ceinture: 0xc9a24a, peau: $('#recrue-peau').value, coiffe: 'nu' };
      const stats = {}; let tot = 0; Object.keys(NOMS_STATS).forEach(k => { stats[k] = clamp(+$('#recrue-' + k).value || 50, 10, 90); tot += stats[k]; });
      if (tot > 250) { $('#recrue-reste').textContent = 'Trop de points : ' + tot + ' / 250.'; return; }
      D.persos.unshift(nouveauPerso(nom, look, stats)); sauverPersos(); rendreMenu();
      $('#recrue-nom').value = ''; $('#form-recrue').closest('details').open = false;
    });
    document.querySelectorAll('#form-recrue input[type=range]').forEach(r => r.addEventListener('input', majReste));
    $('#btn-hasard').addEventListener('click', () => { const p = nouveauPerso(); $('#recrue-nom').value = p.nom; Object.keys(NOMS_STATS).forEach(k => { $('#recrue-' + k).value = p.stats[k]; }); $('#recrue-tunique').value = R.hex(p.look.tunique); $('#recrue-pantalon').value = R.hex(p.look.pantalon); $('#recrue-peau').value = p.look.peau; majReste(); });
    $('#btn-copier-coffre').addEventListener('click', async () => {
      const txt = JSON.stringify({ source: 'cube-des-mille-supplices', monnaies: D.coffre.monnaies, objets: Object.keys(D.coffre.objets).map(t => ({ type: t, nom: C.OBJETS[t].nom, categorie: C.OBJETS[t].cat, rarete: C.OBJETS[t].rarete, quantite: D.coffre.objets[t] })) }, null, 2);
      try { await navigator.clipboard.writeText(txt); $('#btn-copier-coffre').textContent = 'Copié'; } catch (e) { $('#btn-copier-coffre').textContent = 'Copie refusée'; }
      setTimeout(() => { $('#btn-copier-coffre').textContent = 'Copier le Coffre (JSON)'; }, 1800);
    });
    // boutons A et B à l'écran (souris ou doigt)
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('tactile');
    [['#btn-a', boutonA], ['#btn-b', boutonB]].forEach(([sel, f]) => {
      const b = $(sel);
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('actif'); A.init(); try { b.setPointerCapture(e.pointerId); } catch (er) { /* */ } f(true); });
      const fin = () => { if (!b.classList.contains('actif')) return; b.classList.remove('actif'); f(false); };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, fin));
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
  }
  // A : comme E (interagir ; maintenu, il soulève une herse)
  function boutonA(appui) {
    if (J.mode !== 'jeu') return;
    J.touches.KeyE = appui;
    if (!appui) { J.herseMaintien = 0; return; }
    if (J.panneau === 'texte' || J.panneau === 'plaque') fermerPanneaux(); else interagir(false);
  }
  // B : fermer un panneau ; sur le médaillon, descendre ; ailleurs, courir tant qu'il est maintenu
  function boutonB(appui) {
    if (J.mode !== 'jeu') return;
    if (!appui) { J.courirB = false; return; }
    if (J.panneau) { fermerPanneaux(); return; }
    if (J.interaction && J.interaction.type === 'centre' && J.portes && J.portes[5]) { interagir(true); return; }
    J.courirB = true;
  }
  // manette de jeu branchée (API Gamepad) : croix ou stick gauche, A (0) et B (1)
  function lireManette() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { J.manette = null; return; }
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed), ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    J.manette = { haut: b(12) || ay < -0.45, bas: b(13) || ay > 0.45, gauche: b(14) || ax < -0.45, droite: b(15) || ax > 0.45 };
    const a = b(0), bb = b(1);
    if (a !== !!J.manA) { J.manA = a; boutonA(a); }
    if (bb !== !!J.manB) { J.manB = bb; boutonB(bb); }
  }
  function relacherCroix() { J.courirB = false; Object.keys(J.croix).forEach(k => { J.croix[k] = false; }); document.querySelectorAll('#croix .dir').forEach(b => b.classList.remove('actif')); }
  function majReste() { let tot = 0; Object.keys(NOMS_STATS).forEach(k => { const v = +$('#recrue-' + k).value; tot += v; $('#recrue-' + k + '-v').textContent = v; }); $('#recrue-reste').textContent = tot <= 250 ? 'Points restants : ' + (250 - tot) : 'Trop de points : ' + tot + ' / 250.'; }
  function ouvrirAide() { fermerPanneaux(); J.panneau = 'aide'; $('#panneau-aide').hidden = false; }

  // =====================================================================
  // INTÉGRATION AU JEU PRINCIPAL
  // =====================================================================
  window.CubeMilleSupplices = {
    notifierEvasion: p => { if (p && p.id && !D.persos.find(x => x.id === p.id)) { D.persos.unshift(Object.assign(nouveauPerso(p.nom, p.look, p.stats), { id: p.id })); sauverPersos(); rendreMenu(); } notifierEvasion(D.persos.find(x => x.id === (p && p.id)) || D.persos.find(x => x.statut === 'captif')); },
    coffre: () => JSON.parse(JSON.stringify(D.coffre)),
    moteur: C,
  };
  window.addEventListener('message', e => { if (e.data && e.data.type === 'cube:evasion') window.CubeMilleSupplices.notifierEvasion(e.data.personnage); });

  // =====================================================================
  // DÉMARRAGE
  // =====================================================================
  async function demarrer() {
    brancherEntrees();
    D.coffre = coffreVide(); D.persos = [nouveauPerso('Akira')]; D.reglages = { bloques: [], chatMasque: false, son: true };
    rendreMenu(); majReste();
    const test = C.autoTest(); if (!test.ok) console.warn('Moteur du Cube : vecteur de référence incorrect', test);
    await N.init();
    await chargerJoueur();
    J.pret = true;
    try { J.debug = N.user ? !!(await Promise.resolve(N.user.isOwner())) : true; } catch (e) { J.debug = !N.user; }
    document.body.classList.toggle('debug', !!J.debug);
    rendreMenu();
    $('#btn-son').textContent = D.reglages.son ? 'Son : oui' : 'Son : non';
    appliquerQualite();
    requestAnimationFrame(boucle);
    // un prisonnier tente de s'évader : la salle est disponible
    setTimeout(() => {
      const enCours = D.tentative && D.persos.find(p => p.id === D.tentative.perso && p.statut === 'cube');
      notifierEvasion(enCours || D.persos.find(p => p.statut === 'captif'));
    }, 900);
    if (window.claude && window.claude.hot) try { window.claude.hot.snapshot(() => ({ ecran: J.mode })); } catch (e) { /* */ }
  }
  window.addEventListener('beforeunload', () => {
    if (J.mode === 'jeu' && J.joueur && J.joueur.vivant && D.tentative) { D.tentative.cube = J.cube; D.tentative.x = J.joueur.x; D.tentative.z = J.joueur.z; sauverTentative(); }
    if (J.carnetModifie && J.perso) ecrireDoc(cheminJoueur('carnet-' + J.perso.id), J.carnet);
  });
  const go = () => demarrer().catch(e => { console.error(e); });
  if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(go); else go();
})();
