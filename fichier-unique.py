"""Assemble le Cube en un seul fichier HTML jouable hors ligne (double-clic).

Usage : python fichier-unique.py chemin/vers/three.min.js (r128) sortie/Cube.html
three.min.js r128 : https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
Sans connexion au Cube partagé, le jeu passe en mode local (tout reste sur l'appareil).
"""
import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))


def lire(chemin, script=True):
    with open(chemin, encoding='utf-8') as f:
        texte = f.read()
    if script and '</script' in texte.lower():
        sys.exit(f'{chemin} contient « </script » : impossible de l\'intégrer tel quel.')
    return texte


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    page = lire(os.path.join(ICI, 'index.html'), script=False)
    remplacements = {
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>':
            '<script>/* three.js r128 — licence MIT */\n' + lire(sys.argv[1]) + '\n</script>',
    }
    for nom in ('enigmes.js', 'moteur.js', 'rendu.js', 'jeu.js'):
        remplacements[f'<script src="{nom}"></script>'] = '<script>\n' + lire(os.path.join(ICI, nom)) + '\n</script>'
    for avant, apres in remplacements.items():
        if avant not in page:
            sys.exit(f'Balise introuvable dans index.html : {avant}')
        page = page.replace(avant, apres)
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        f.write(page)
    print(f'{sys.argv[2]} : {len(page.encode("utf-8")) // 1024} Ko')


if __name__ == '__main__':
    main()
