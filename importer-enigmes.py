"""Importe les énigmes du document Word dans le Cube (enigmes.js).

Usage : python importer-enigmes.py chemin/vers/200_enigmes_mathematiques_Asie_antique.docx

Le document : séries « 01 | Titre », ligne « Énigmes a à b · Difficulté d/5 », puis pour chaque
énigme « 251. Titre », un ou plusieurs paragraphes d'énoncé et « Réponse : … ».
Le texte des énigmes est repris tel quel. Ce script ajoute seulement, pour chaque énigme, la façon
de taper la réponse dans le verrou (consigne + réponses acceptées). Les réponses à un seul nombre
sont lues automatiquement ; les autres (plusieurs nombres, heures, probabilités, méthodes) sont
décrites dans PRECISIONS ci-dessous : une énigme ajoutée au document avec une réponse de ce genre
arrête l'import tant qu'elle n'y figure pas.
"""
import json
import os
import re
import sys
import zipfile
from html import unescape

ICI = os.path.dirname(os.path.abspath(__file__))


def P(p, q):
    """Probabilité p/q : acceptée en fraction (même non simplifiée), en pourcentage ou en décimal."""
    return {'p': p, 'q': q}


FRACTION = 'Réponds par une fraction (par exemple 3/7) ou par un pourcentage.'
HEURES = 'Réponds en heures et minutes (par exemple : 4 h 20).'
PESEE = 'Pour ouvrir le verrou : combien de {} poses-tu sur chaque plateau lors de la première pesée ?'


def deux(a, b):
    return f'Réponds par deux nombres, dans l’ordre : {a}, puis {b}.'


# n° : (consigne, réponses acceptées, question ajoutée sous l'énoncé ou None)
PRECISIONS = {
    267: (HEURES, [[6, 15], [375]], None),
    271: (deux('le prix d’une lanterne', 'celui d’un bâton d’encens'), [[6, 2]], None),
    272: (deux('le prix d’un rouleau', 'celui d’une jarre'), [[10, 4]], None),
    273: (deux('la plus grande réserve', 'la plus petite'), [[40, 24]], None),
    281: (deux('l’âge du maître', 'celui de l’élève'), [[30, 10]], None),
    282: (deux('les pièces d’or', 'les pièces d’argent'), [[50, 30]], None),
    285: (FRACTION, [[P(2, 5)]], None),
    293: (deux('le plus court (en mètres)', 'le plus long'), [[7, 21]], None),
    299: ('Chaque rangée compte cinq archers de plus que la précédente. Réponds par un nombre.', [[630]], None),
    306: ('Réponds par un nombre.', [[1]], 'Pour ouvrir le verrou : en combien de gestes, au minimum, obtient-il ses sept litres ?'),
    307: (FRACTION, [[P(3, 10)]], None),
    310: ('Réponds par l’heure (par exemple : 01 h 15).', [[0, 36], [36]], None),
    312: (deux('le prix d’une lanterne', 'celui d’un vase'), [[10, 7]], None),
    315: ('Les carrés comptent aussi. Réponds par un nombre.', [[60]], None),
    318: ('Réponds par un nombre.', [[3]], PESEE.format('poids')),
    320: (FRACTION, [[P(9, 10)]], None),
    326: ('Réponds par un nombre.', [[3]], PESEE.format('pièces')),
    328: (FRACTION, [[P(1, 6)]], None),
    332: ('Réponds par trois nombres, dans l’ordre : Wei, Shu, Wu.', [[66, 22, 12]], None),
    333: ('Réponds par oui ou par non.', [['non']], None),
    336: (FRACTION, [[P(3, 13)]], None),
    338: (HEURES, [[2, 40], [160]], None),
    339: (deux('le premier alliage (en kilogrammes)', 'le second'), [[8, 4]], None),
    343: (FRACTION, [[P(3, 8)]], None),
    345: ('Réponds par les trois nombres, du plus petit au plus grand.', [[28, 30, 32]], None),
    369: (deux('le périmètre (en mètres)', 'la superficie (en m²)'), [[100, 576]], None),
    371: (deux('le prix d’un vase', 'celui d’une lanterne'), [[10, 7]], None),
    372: (deux('le thé rouge', 'le thé vert'), [[12, 11]], None),
    373: (deux('l’âge du maître', 'celui du disciple'), [[48, 12]], None),
    374: (deux('le premier grenier', 'le second'), [[112, 144]], None),
    375: (deux('la longueur (en mètres)', 'la largeur'), [[35, 20]], None),
    378: (HEURES, [[7, 12], [432]], None),
    382: ('Réponds par trois nombres, dans l’ordre : Wei, Shu, Wu.', [[240, 120, 60]], None),
    383: ('Réponds par les trois longueurs, de la plus courte à la plus longue.', [[6, 9, 12]], None),
    389: ('Réponds en nombre de pièces de cuivre.', [[10]], None),
    402: (deux('le périmètre (en mètres)', 'la superficie (en m²)'), [[44, 154]], None),
    407: ('Réponds par un nombre.', [[4]], 'Pour ouvrir le verrou : au bout de combien de minutes, depuis le départ, commences-tu à compter les cinq minutes ?'),
    415: (FRACTION, [[P(1, 9)]], None),
    416: (FRACTION, [[P(1, 6)]], None),
    417: (FRACTION, [[P(3, 8)]], None),
    418: (FRACTION, [[P(1, 4)]], None),
    419: (FRACTION, [[P(1, 6)]], None),
    420: (FRACTION, [[P(5, 9)]], None),
    423: ('Deux dignitaires précis doivent être assis côte à côte. Réponds par un nombre.', [[1440]], None),
    425: (FRACTION, [[P(3, 5)]], None),
    426: (FRACTION, [[P(32, 81)]], None),
    427: (FRACTION, [[P(11, 36)]], None),
    430: (FRACTION, [[P(3, 5)]], None),
    431: ('Réponds par un nombre.', [[9]], PESEE.format('poids')),
    433: (deux('les objets à sept pièces', 'les objets à onze pièces'), [[28, 22]], None),
    434: (deux('les poules', 'les lapins'), [[20, 15]], None),
    435: ('Réponds par un nombre.', [[9]], 'Pour ouvrir le verrou : ta pesée indique 541 grammes. Quel est le numéro du sac de fausses pièces ?'),
    443: (deux('les pièces de deux unités', 'celles de cinq unités'), [[8, 5]], None),
    445: ('Réponds par les trois nombres, du plus petit au plus grand.', [[5, 6, 7]], None),
    448: ('Réponds par un nombre.', [[6]], 'Pour ouvrir le verrou : en combien d’opérations au minimum (remplir, vider ou transvaser comptent chacune pour une) ?'),
    449: ('Réponds par un nombre (une perte s’écrit comme un gain négatif).', [[-0.5]], None),
}


def paragraphes(docx):
    with zipfile.ZipFile(docx) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    out = []
    for p in re.findall(r'<w:p[ >].*?</w:p>', xml, flags=re.S):
        t = unescape(''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, flags=re.S)))
        t = re.sub(r'\s+', ' ', t).strip()
        if t:
            out.append(t)
    return out


def nombres(texte):
    """Nombres d'une phrase, espaces des milliers compris (« 1 080 » → 1080)."""
    return [float(n.replace(' ', '').replace(',', '.')) for n in re.findall(r'\d{1,3}(?: \d{3})+(?!\d)|\d+(?:,\d+)?', texte)]


def lire(docx):
    serie, niveau, enigmes, cur = None, None, [], None
    for t in paragraphes(docx):
        t = t.split('##')[0].strip()  # titres de niveau collés à la dernière réponse d'une série
        if not t:
            continue
        m = re.match(r'^(\d\d)\s*\|\s*(.+)$', t)
        if m:
            serie = m.group(2).strip()
            continue
        m = re.search(r'Difficulté\s*(\d)\s*/\s*5', t, flags=re.I)
        if m and t.startswith('Énigmes'):
            niveau = int(m.group(1))
            continue
        m = re.match(r'^(\d{3})\.\s+(.+)$', t)
        if m:
            cur = {'n': int(m.group(1)), 'niveau': niveau, 'serie': serie, 'titre': m.group(2).strip(), 'lignes': [], 'solution': None}
            enigmes.append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r'^Réponse\s*:\s*(.+)$', t)
        if m:
            cur['solution'] = m.group(1).strip()
        elif cur['solution'] is None:
            cur['lignes'].append(t)
    return enigmes


def completer(e):
    if e['n'] in PRECISIONS:
        consigne, attendu, question = PRECISIONS[e['n']]
        if question:
            e['lignes'].append(question)
    else:
        premiere = re.split(r'\.(?:\s|$)|\(', e['solution'])[0]
        ns = nombres(premiere)
        if len(ns) != 1 or '/' in premiere or '%' in premiere:
            sys.exit(f'Énigme {e["n"]} : réponse « {e["solution"]} » à décrire dans PRECISIONS.')
        v = ns[0]
        consigne, attendu = 'Réponds par un nombre.', [[int(v) if v == int(v) else v]]
    e['consigne'], e['attendu'] = consigne, attendu
    return e


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    enigmes = [completer(e) for e in lire(sys.argv[1])]
    nums = [e['n'] for e in enigmes]
    if len(set(nums)) != len(nums):
        sys.exit('Numéros en double dans le document.')
    for e in enigmes:
        if not (e['niveau'] and e['serie'] and e['lignes'] and e['solution']):
            sys.exit(f'Énigme {e["n"]} incomplète : {e}')
    par = {k: sum(1 for e in enigmes if e['niveau'] == k) for k in range(1, 6)}
    if min(par.values()) < 6:
        sys.exit(f'Trop peu d’énigmes pour un niveau (il en faut au moins 6, une par porte) : {par}')
    corps = json.dumps(enigmes, ensure_ascii=False, indent=0, separators=(',', ':'))
    js = ('/* Énigmes des verrous du Cube. Généré par importer-enigmes.py depuis le document Word :\n'
          '   ne pas modifier à la main, relancer l\'import. */\n'
          '(function (racine) {\n  \'use strict\';\n  const ENIGMES = ' + corps + ';\n'
          '  if (typeof module !== \'undefined\' && module.exports) module.exports = ENIGMES;\n'
          '  else racine.ENIGMES_CUBE = ENIGMES;\n'
          '})(typeof window !== \'undefined\' ? window : globalThis);\n')
    with open(os.path.join(ICI, 'enigmes.js'), 'w', encoding='utf-8') as f:
        f.write(js)
    print(f'enigmes.js : {len(enigmes)} énigmes, par niveau {par}')


if __name__ == '__main__':
    main()
