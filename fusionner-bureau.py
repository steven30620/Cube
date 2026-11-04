"""Intègre le Cube au Bureau : Hôtel du Serpent, 9e étage (Evergreen Private Assistance), rubrique
« Le Cube des Mille Supplices » entre « Gestion des chambres » et « Personnel & finances ».

Usage : python fusionner-bureau.py bureau.html Cube.html sortie.html
(Cube.html : le fichier unique produit par fichier-unique.py.)

L'hôtel est rangé dans le Bureau compressé (gzip + base64, balise #hotel-serpent-gz) : le script le
décompresse, y ajoute la rubrique et une copie de Cube.html, puis le recompresse. Relancé sur un Bureau
déjà fusionné, il remplace seulement la copie du Cube (nouvelle version du jeu).
"""
import base64
import gzip
import json
import re
import sys

BALISE_HOTEL = re.compile(r'(<script type="application/octet-stream" id="hotel-serpent-gz">)(.*?)(</script>)', re.S)
BALISE_CUBE = re.compile(r'<script type="application/json" id="cube-source">.*?</script>', re.S)

SECTION_AVANT = """    html += '<section class="eg-page-section"><h3 class="eg-page-title">Gestion des chambres</h3>' + renderEvergreenRoomsSection() + '</section>';
"""
SECTION_CUBE = """    html += '<section class="eg-page-section"><h3 class="eg-page-title">Le Cube des Mille Supplices</h3>' + renderEvergreenCubeSection() + '</section>';   // (Cube) rubrique ajoutée par fusionner-bureau.py
"""

FONCTIONS_AVANT = "  function renderEvergreenContractsSection() {\n"
FONCTIONS_CUBE = """  // ---- Le Cube des Mille Supplices (ajouté par fusionner-bureau.py) : le jeu s'ouvre en plein écran par-dessus
  // l'hôtel ; sa copie est rangée dans #cube-source. Le Cube garde ses propres sauvegardes (localStorage).
  function renderEvergreenCubeSection() {
    return '<p class="registry-empty">Une matrice de salles mobiles, des pièges, des portes fermées par des énigmes : les captifs y tentent leur évasion.</p>'
      + '<div class="kitchen-services"><button type="button" class="security-action-btn recommended" data-action="open-cube">Entrer dans le Cube</button></div>';
  }
  function openCube() {
    if (document.getElementById('cube-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'cube-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;flex-direction:column;';
    ov.innerHTML = '<div style="flex:none;padding:6px 10px;background:#0b0b0d;border-bottom:1px solid #3a2f1a;">'
      + '<button type="button" class="security-action-btn" data-cube="fermer">← Retour à Evergreen</button></div>'
      + '<iframe title="Le Cube des Mille Supplices" style="flex:1;width:100%;border:0;display:block;"></iframe>';
    ov.querySelector('[data-cube="fermer"]').addEventListener('click', closeCube);
    var fr = ov.querySelector('iframe');
    fr.srcdoc = JSON.parse(document.getElementById('cube-source').textContent);
    document.body.appendChild(ov);
    fr.focus();
  }
  function closeCube() {
    var ov = document.getElementById('cube-overlay');
    if (!ov) return;
    // retirer l'iframe ne déclenche pas « beforeunload » : on l'envoie pour que le Cube sauvegarde la tentative en cours
    try { ov.querySelector('iframe').contentWindow.dispatchEvent(new Event('beforeunload')); } catch (e) {}
    ov.remove();
  }
"""

ACTION_AVANT = "    if (action === 'open-obinfo') { evergreenObInfoOpen = true; render(); return; }\n"
ACTION_CUBE = "    if (action === 'open-cube') { openCube(); return; }   // (Cube)\n"


def inserer(texte, avant, ajout, apres=True):
    if texte.count(avant) != 1:
        sys.exit(f'Repère introuvable ou ambigu dans l\'hôtel : {avant.strip()[:90]}')
    return texte.replace(avant, avant + ajout if apres else ajout + avant)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding='utf-8', newline='') as f:
        bureau = f.read()
    with open(sys.argv[2], encoding='utf-8', newline='') as f:
        cube = f.read()
    m = BALISE_HOTEL.search(bureau)
    if not m:
        sys.exit('Balise #hotel-serpent-gz introuvable dans le Bureau.')
    hotel = gzip.decompress(base64.b64decode(m.group(2).strip())).decode('utf-8')

    # copie du Cube : chaîne JSON, « < » échappé pour ne jamais fermer la balise
    bloc = '<script type="application/json" id="cube-source">' + json.dumps(cube, ensure_ascii=False).replace('<', '\\u003c') + '</script>'
    if 'function renderEvergreenCubeSection' in hotel:
        hotel, n = BALISE_CUBE.subn(lambda _: bloc, hotel)
        if n != 1:
            sys.exit('Bureau déjà fusionné, mais la copie du Cube est introuvable.')
        print('Bureau déjà fusionné : copie du Cube remplacée.')
    else:
        hotel = inserer(hotel, SECTION_AVANT, SECTION_CUBE)
        hotel = inserer(hotel, FONCTIONS_AVANT, FONCTIONS_CUBE, apres=False)
        hotel = inserer(hotel, ACTION_AVANT, ACTION_CUBE)
        fin = hotel.rfind('</body>')
        if fin < 0:
            sys.exit('</body> introuvable dans l\'hôtel.')
        hotel = hotel[:fin] + bloc + '\n' + hotel[fin:]

    gz = base64.b64encode(gzip.compress(hotel.encode('utf-8'), 9, mtime=0)).decode('ascii')
    bureau = bureau[:m.start(2)] + gz + bureau[m.end(2):]
    with open(sys.argv[3], 'w', encoding='utf-8', newline='') as f:
        f.write(bureau)
    print(f'{sys.argv[3]} : {len(bureau.encode("utf-8")) // 1024} Ko')


if __name__ == '__main__':
    main()
