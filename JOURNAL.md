# Journal — Le Cube des Mille Supplices

Historique des demandes et de ce qui a été fait (31/10 – 04/11/2026), de la plus ancienne à la plus récente.

## Création (31/10/2026)

Demande : « créer moi un nouveau artefact qu'on va appeler Cube » (prompt maître du mini-jeu, reçu
tronqué au §41 « Actions »). Le jeu d'Asie antique visé par le prompt n'est pas dans ce dépôt :
le Cube est un artefact autonome (captifs, Coffre Or / Or Noir / Jetons, export JSON,
`window.CubeMilleSupplices` pour une intégration future).

- [x] **Artefact publié** : https://claude.ai/artifact/LmagQQPLY3JxFjjkn1fJH9 (privé, à partager en
  Contributeur pour que les amis laissent des traces). Capacités : `db` (instances, corps, objets au
  sol, butin pris, Coffre privé par joueur), `user`, `room` (présence, sujets `chat`, `piege`, `mort`).
- [x] **Sources** à la racine de ce dépôt : `moteur.js`
  (moteur déterministe, testable sous Node), `rendu.js` (Three.js r128 : salles, pièges, figurines,
  cadavres), `jeu.js` (boucle, réseau, interface), `index.html`.
- [x] Moteur : matrice 48 × 48 × 16, ~23 500 salles ; déplacements par circuits à un emplacement
  libre (position de chaque salle en O(1), aucune collision) ; codes M = 1009 + 6 familles réversibles.
- [x] Choix à faire valider : 1 jour du Cube = 1 h réelle (`JOUR_MS`) ; pas de serveur dédié
  (autorité = moteur déterministe + baux atomiques pour le butin et les 5 vivants par salle).
- Tests : vecteur de référence `0711 – 0575 – 0347 – 0530 – 0824` ; chiffrements réversibles sur
  3 000 tirages ; unicité des positions ; sortie ~9 fois/jour, atteignable en 3–4 h au mieux ;
  navigateur sans tête (porte, mort par piège, carnet, deux cinématiques). Non testé : partie à
  deux, fluidité sur téléphone et tablette.

- [x] Suites du même jour : chargement raccourci (« c'est normal que c'est aussi long ? ») ; manette
  de direction en bas au milieu ; boutons A et B + manette de jeu branchée ; plus de pièges près de
  l'entrée (« c'est normal qu'il y a 0 piège ? » : 16 salles vides sur 42 autour de l'entrée,
  13 autres aux pièges invisibles → 6 vides, 29 avec un piège visible) ; `Cube.html` en un seul
  fichier pour jouer hors ligne (`fichier-unique.py`) ; touche debug F9 ; verrou à énigme sur chaque
  porte et chaque trappe (7 familles d'énigmes, difficulté selon la région) ; après une mort, fiche
  « Tué par » expliquant le piège, son signe annonciateur et comment le passer ; ralenti de la mort
  sous un autre angle (les 2 dernières secondes rejouées à ×0,37, caméra basse qui tourne).
- [x] Rendu plus réaliste (« améliore la qualité des formes et des images ») : ombres douces, reflets
  d'environnement, textures en relief (dalles, laque à treillis, pierre, bronze patiné, bois),
  figurines en plastique vernis, portes de palais cloutées, colonnes, lanternes de papier, halos ;
  portraits 3D au pavillon ; bouton « Qualité » (haute, normale, basse).
- [x] Figurine de brique classique (modèle fourni) et squelette (modèle fourni) ; dans le Cube, chaque
  captif porte une couleur unie parmi 50, jamais deux fois la même en même temps ; la salle pivote
  d'un à trois quarts de tour à l'entrée et le passage vers la salle précédente se scelle ; sceau gravé
  en caractères chinois (龍 蛇 蓮 鏡 鐘 衛, 天 地 人 et chiffres chinois).
- [x] Figurine recalée (01/11, « prend exemple sur la vidéo », plans du brevet de 1979 et plan coté,
  « corrige les bras et les jambes ») : tête 10,2 × 8,5 mm aux coins R2 (elle était ~13 % trop
  large), tenon creux ; visage imprimé classique (deux yeux avec reflet, sourire), encre claire sur
  les 8 couleurs sombres, expression de peur (sourcils levés, bouche ouverte) à la mort, dans le
  ralenti et sur les morts des autres ; mains Ø 5,1 mm percées Ø 3,1 mm, ouverture vers le bas, à
  côté des hanches ; bras moulés d'une seule pièce (épaule en dôme, coude léger, manchette creuse) ;
  jambes à cuisse arrondie, encoche en U entre les jambes, ligne du pied, creux ronds au dos.
- [x] Silhouette (01/11, photos de profil et de dos de la figurine en bois officielle) : jambes 172 au
  lieu de 153 (hanches 25), profil relevé point par point (dos droit, cuisse bombée, tibia en retrait,
  pied qui avance en biais), pivot de marche sur l'axe de hanche ; torse profond de 98 ; épaule plus
  ronde, 12 sous le haut du torse, avant-bras vers l'avant, main devant les hanches ; quatre creux
  ronds sculptés au dos des jambes ; os du squelette mis à l'échelle.
- [x] Verrous (01/11, « la liste des énigmes pour l'accès aux autres pièces, avec niveau de
  difficulté », document de 200 énigmes n° 251–450, 40 par niveau) : chaque porte pose une énigme du
  document, six différentes par salle ; niveau selon la zone (1 près de l'entrée → 5 au fond, à un cran
  près une fois sur trois) ; la Libération garde le compte de Han Xin. Panneau : difficulté ●●○○○ et
  série, consigne de saisie, solution du document une fois ouvert. Réponses souples : « 1 080 »,
  « 6 h 15 » ou 375, « 2/5 », « 40 % » ou « 0,4 », plusieurs nombres dans l'ordre, oui / non.
  Les 200 réponses vérifiées (deux agents + calcul) : aucune erreur. Précisions ajoutées au verrou
  pour 4 énoncés à double lecture (299, 315, 389, 423) ; question chiffrée ajoutée pour les 7 énigmes
  « Comment… ? » (pesées, sabliers, récipients, sacs). Import : `importer-enigmes.py` → `enigmes.js` ;
  test : `node test-enigmes.js`.
- [x] Décor (01/11, « améliore la qualité des formes et des images, fais en plus réel pour tout,
  rajoute de la décoration sur les murs qui font penser à l'Asie 3 royaumes ») : chaque salle a son
  royaume (魏 Wei bleu, 蜀 Shu vert, 吳 Wu rouge, 漢 Han or). Sur les murs, au-dessus de 2,3 m pour ne
  jamais masquer les fentes et trous des pièges : étendards à dents de flamme au nom d'un général,
  rouleaux de calligraphie (仁義禮智, 三顧茅廬…) et paysages à l'encre, carte « 天下三分之圖 »,
  bouclier à tête de tigre ou aux armes du royaume sur hallebarde et guandao croisés, râtelier
  d'armes, fenêtre-lune éclairée par derrière, plaque gravée au-dessus de chaque porte (赤壁, 五丈原…).
  Objets des coins resculptés : lion de pierre, vase bleu et blanc, tripode de bronze, grue sur tortue,
  cloche à bossettes, paravent peint, dragon sur panneau laqué, étendard en lambeaux. Matières : sol et
  murs à brillance variable, pierre nuancée bloc par bloc, frise de grecques, bagues dorées des
  colonnes, poussière en suspension. Coût : 213 → 342 objets par salle (299 en qualité basse).
- [x] Pièges (01/11, « les pièges fonctionnent plus ? », « rajoute plus de piège dans les salles
  piégées », « qu'un même piège recouvre une plus grande surface ») : ils fonctionnaient (vérifié type
  par type), mais ne couvraient que 5,7 % du sol à un instant donné. Désormais : 1 piège mortel de plus
  dans chaque salle piégée, 2 une fois sur trois près de l'entrée et presque toujours au fond (salles
  vides, départ, Jugement, Mort et Libération inchangés) ; chaque piège plus étendu (pointes sur 6 à
  9 m, 4 à 6 lames et 4 à 6 jets de flammes plus larges et plus longs, 7 à 11 trous à flèches, murs
  broyeurs sur 5 à 6 m, plafond de 5 à 7 m, rocher de 5 m, roue dentée épaisse, 3 à 5 scies plus
  grandes, 3 à 4 statues au souffle plus large, faisceaux de feu de 2,4 m, deux fois plus de fosses,
  sol qui se dérobe sur 5 m, pendules à lame de 2,6 m…). Résultat : 3,2 pièges par salle piégée au
  lieu de 1,7 et 21,7 % du sol mortel en moyenne (31 % au fond). Équité : plus de fosse cachée devant
  une porte ; un joueur parfait franchit 143 salles testées sur 144 (139 avant).

## Consignes de travail (04/11/2026)

- [x] `CLAUDE.md` (« s'il n'y a pas de CLAUDE.md, rédige-en un court ») : projet sans lien avec
  Abonator, tout en français, `enigmes.js` généré depuis le document Word, vérifications, fichier
  unique `Cube.html` et artefact après chaque modification, format des commits, avance rapide de
  `main` sans force-push. Rien ne change en jeu.
- [x] Fusion dans le Bureau (« fusionne cube dans Evergreen Private Assistance, 9e étage juste entre
  Gestion des chambres et Personnel & finances », fichier `bureau_guest1-473.html`) : nouvelle rubrique
  « Le Cube des Mille Supplices » à cet endroit, bouton « Entrer dans le Cube » qui ouvre le jeu en
  plein écran par-dessus l'hôtel, « ← Retour à Evergreen » pour revenir (la tentative en cours est
  sauvegardée). L'hôtel est compressé dans le Bureau : `fusionner-bureau.py` le décompresse, ajoute la
  rubrique et une copie de `Cube.html`, puis le recompresse ; le reste du Bureau est inchangé octet pour
  octet. Le Cube garde ses propres sauvegardes et monnaies (pas encore reliées aux PON ni aux détenus
  d'Evergreen). Vérifié en Chrome sans tête : ordre des rubriques, démarrage, partie lancée (rendu 3D),
  retour, sauvegarde, réouverture ; aucune erreur JavaScript. Bureau : 28,1 → 28,5 Mo.
