# CLAUDE.md — Le Cube des Mille Supplices

Jeu indépendant (escape game 3D en Three.js r128). Aucun lien avec Abonator : ne jamais ouvrir ni
modifier `steven30620/abonator-hub`, ni appliquer ses consignes. Voir `README.md` (fichiers) et
`JOURNAL.md` (historique des demandes).

## Langue

Tout en français : réponses, commentaires, commits, textes du jeu.

## Fichiers

- `moteur.js` : moteur déterministe, sans DOM, testable sous Node.
- `rendu.js` (Three.js r128), `jeu.js` (boucle, réseau, interface), `index.html` (page).
- `enigmes.js` est **généré** : ne jamais le modifier à la main. Pour changer les énigmes, modifier le
  document Word puis relancer `python importer-enigmes.py chemin/vers/le-document.docx`
  (le document n'est pas dans le dépôt : le demander).

## Après chaque modification

1. Vérifications :
   - `node -e "console.log(require('./moteur.js').autoTest())"` → `ok: true`
   - `node test-enigmes.js` → « échecs : aucun »
2. Fichier jouable hors ligne :
   `python fichier-unique.py <three.min.js r128> Cube.html`
   (https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js). Ne pas committer `Cube.html`.
3. Envoyer `Cube.html` à l'utilisateur (il le copie dans `D:\jeu\Cube`).
4. Artefact claude.ai : https://claude.ai/artifact/LmagQQPLY3JxFjjkn1fJH9 — le lire d'abord, puis y
   publier les fichiers modifiés (même adresse).

Avant de conclure qu'un piège ou une salle est cassé : le vérifier en jeu (navigateur sans tête).
Mesurer, ne pas supposer.

## Commits et Git

- Titre : « Cube : ce qui change, vu du joueur ». Corps : le pourquoi et la liste des fichiers.
- Ajouter une entrée en bas de `JOURNAL.md` à chaque passe.
- Committer sur la branche de la session et la pousser, puis avancer `main` en avance rapide :
  `git fetch origin main`, vérifier que `origin/main` est un ancêtre de `HEAD`
  (`git merge-base --is-ancestor origin/main HEAD`), puis `git push origin HEAD:main`.
  Jamais de force-push.
- Aucun secret dans le dépôt.
