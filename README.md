# Le Cube des Mille Supplices

Escape game multijoueur en 3D, vu de dessus : une matrice de salles mobiles inspirée de l'Asie des
Trois Royaumes, des pièges, des portes fermées par des énigmes, des corps qui restent là où ils sont tombés.
Le jeu tourne comme **artefact Claude** (claude.ai) ou en **fichier unique** jouable hors ligne.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | page du jeu : pavillon des captifs, interface, panneaux |
| `moteur.js` | moteur déterministe (aucun DOM, testable sous Node) : monde, salles, codes, pièges, énigmes |
| `rendu.js` | rendu Three.js r128 : salles, décor, pièges, figurines, cadavres, objets |
| `jeu.js` | boucle de jeu, réseau, interface |
| `enigmes.js` | les 200 énigmes des verrous — **généré**, ne pas modifier à la main |
| `importer-enigmes.py` | `python importer-enigmes.py chemin/vers/200_enigmes_mathematiques_Asie_antique.docx` → `enigmes.js` |
| `fichier-unique.py` | `python fichier-unique.py chemin/vers/three.min.js Cube.html` → un seul fichier jouable hors ligne |
| `test-enigmes.js` | `node test-enigmes.js` : chaque réponse ouvre son verrou, répartition par zone |

three.js r128 : https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js

## Vérifier

```bash
node -e "console.log(require('./moteur.js').autoTest())"
```

```bash
node test-enigmes.js
```

## Historique

Voir `JOURNAL.md`. Le code a d'abord vécu dans un autre dépôt (`outils/cube-artefact/`) : l'historique
des commits a été conservé lors du déménagement.
