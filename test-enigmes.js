/* Vérifie les verrous à énigme : node test-enigmes.js
   (à relancer après chaque import du document avec importer-enigmes.py). */
const C = require('./moteur.js');
const E = C.ENIGMES;
let ko = [];
const essai = (e, brut, attendu) => { const r = C.verifierReponse(e, brut); if (r !== attendu) ko.push(e.n + ' « ' + brut + ' » → ' + r + ' (attendu ' + attendu + ')'); };
// 1) la réponse du document, telle qu'écrite, ouvre le verrou (sauf méthodes, à question ajoutée)
const methodes = new Set([443, 306, 318, 326, 333, 407, 431, 435, 448, 449]);
for (const e of E) {
  if (methodes.has(e.n)) continue;
  const premiere = e.solution.split(/\.(?:\s|$)|\(|, soit/)[0];
  essai(e, premiere, true);
}
const n = k => E.find(e => e.n === k);
// 2) formes de saisie
essai(n(288), '1080', true); essai(n(288), '1 080', true); essai(n(288), '1 080 pièces', true); essai(n(288), '108', false);
essai(n(267), '6 h 15', true); essai(n(267), '6h15', true); essai(n(267), '375', true); essai(n(267), '6', false);
essai(n(310), '00 h 36', true); essai(n(310), '0h36', true);
essai(n(285), '2/5', true); essai(n(285), '4/10', true); essai(n(285), '40 %', true); essai(n(285), '0,4', true); essai(n(285), '1/5', false);
essai(n(328), '16,67', true); essai(n(328), '17%', true); essai(n(328), '1/6', true); essai(n(328), '16', false);
essai(n(345), '28-30-32', true); essai(n(345), '28, 30 et 32', true); essai(n(345), '30 28 32', false);
essai(n(333), 'Non', true); essai(n(333), 'oui', false);
essai(n(449), '-0,5', true); essai(n(449), '0.5', true); essai(n(449), '3,5', false);
essai(n(369), '100 m et 576 m2', true); essai(n(369), "100 576 m²", true); essai(n(374), "112 144", true); essai(n(382), "240 120 60", true); essai(n(402), "44 154", true); essai(n(443), "8 et 5", true);
essai(n(448), '6', true); essai(n(435), '9', true); essai(n(318), '3', true); essai(n(306), '1', true);
essai(n(251), '', false); essai(n(251), 'quarante-trois', false);
// 3) répartition dans un monde : chaque porte a une énigme, 6 énigmes différentes par salle, niveaux par zone
const m = C.creerMonde(12345);
const stats = {}; let doublons = 0, salles = 0;
for (let id = 0; id < m.N && salles < 3000; id += 7) {
  if (id === m.idLib) continue; salles++;
  const sp = C.specSalle(m, id), vus = new Set();
  for (let f = 0; f < 6; f++) { const e = C.enigmePorte(m, id, f); if (e.type !== 'document') throw new Error('pas du document'); if (vus.has(e.n)) doublons++; vus.add(e.n); const k = sp.zone + '→' + e.niveau; stats[k] = (stats[k] || 0) + 1; }
}
const lib = C.enigmePorte(m, m.idLib, 0);
console.log('échecs :', ko.length ? '\n' + ko.join('\n') : 'aucun');
console.log('salles testées', salles, '· doublons dans une salle', doublons, '· Libération :', lib.type, lib.reponse);
console.log(Object.entries(stats).sort().map(([k, v]) => k + ' ' + v).join(' | '));
console.log(C.autoTest());
if (ko.length || doublons) process.exit(1);
