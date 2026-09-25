"""Tests of tts/fr_normalize.py. Run: .venv/bin/python -m unittest tts/test_fr_normalize.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fr_normalize import normalize, supertonic_respell  # noqa: E402

CASES = [
    # heures
    ("Il est 18h45.", "Il est dix-huit heures quarante-cinq."),
    ("Rendez-vous à 14 h 30.", "Rendez-vous à quatorze heures trente."),
    ("Départ à 1h05.", "Départ à une heure cinq."),
    ("À 21h, puis 8h.", "À vingt et une heures, puis huit heures."),
    ("À 14:30 précises.", "À quatorze heures trente précises."),
    ("Durée 01:02:03.", "Durée une heure deux minutes trois secondes."),
    ("Minuit : 0h15.", "Minuit : zéro heure quinze."),
    # dates
    ("Le 3 mars 2027.", "Le trois mars deux mille vingt-sept."),
    ("Le 1er mars.", "Le premier mars."),
    ("Le 1 avril.", "Le premier avril."),
    ("Le 21/09/2026.", "Le vingt et un septembre deux mille vingt-six."),
    ("Le 24/09 à 9h.", "Le vingt-quatre septembre à neuf heures."),
    ("Publié le 2026-09-24.", "Publié le vingt-quatre septembre deux mille vingt-six."),
    # argent
    ("Prévoyez 50 €.", "Prévoyez cinquante euros."),
    ("Ça coûte 12,50 €.", "Ça coûte douze euros cinquante."),
    ("Seulement 0,99 €.", "Seulement quatre-vingt-dix-neuf centimes."),
    ("Un seul 1 €.", "Un seul un euro."),
    ("Budget de 3 k€.", "Budget de trois mille euros."),
    ("Levée de 1,5 M€.", "Levée de un virgule cinq million d'euros."),
    ("Levée de 2 M$.", "Levée de deux millions de dollars."),
    ("Total 1 234 567 €.", "Total un million deux cent trente-quatre mille cinq cent soixante-sept euros."),
    ("Prix : 20$.", "Prix : vingt dollars."),
    # pourcentages, décimales, signes
    ("Hausse de 15%.", "Hausse de quinze pour cent."),
    ("Taux de 3,5 %.", "Taux de trois virgule cinq pour cent."),
    ("Pi vaut 3.14.", "Pi vaut trois virgule quatorze."),
    ("Écart de 2,05.", "Écart de deux virgule zéro cinq."),
    ("Il fera -5 °C.", "Il fera moins cinq degrés."),
    ("Il fait 22°C.", "Il fait vingt-deux degrés."),
    # unités, féminin
    ("Il reste 21 minutes.", "Il reste vingt et une minutes."),
    ("Encore 1 heure.", "Encore une heure."),
    ("J'ai 21 cartes et 1 tâche.", "J'ai vingt et une cartes et une tâche."),
    ("Latence de 200 ms.", "Latence de deux cents millisecondes."),
    ("Il y a 11,4 Go de RAM.", "Il y a onze virgule quatre gigaoctets de RAM."),
    ("Roulez à 50 km/h sur 5 km.", "Roulez à cinquante kilomètres heure sur cinq kilomètres."),
    ("Vent 15 kt, QNH 1013 hPa.", "Vent quinze nœuds, QNH mille treize hectopascals."),
    ("Monter à 2 500 ft.", "Monter à deux mille cinq cents pieds."),
    ("Croisière au FL350.", "Croisière au niveau trois cent cinquante."),
    # ordinaux, siècles
    ("La 2e fois.", "La deuxième fois."),
    ("La 1re étape.", "La première étape."),
    ("Le XXIe siècle.", "Le vingt et unième siècle."),
    ("Au 3ème étage.", "Au troisième étage."),
    # téléphones, codes, versions
    ("Appelle le 06 12 34 56 78.", "Appelle le zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit."),
    ("Au 06 12 34 56 78, merci.", "Au zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit, merci."),
    ("Dossier AB-472.", "Dossier AB quatre cent soixante-douze."),
    ("Un A320.", "Un A trois cent vingt."),
    ("Agent 007.", "Agent zéro zéro sept."),
    ("Version v0.7.4 publiée.", "Version zéro point sept point quatre publiée."),
    ("La release 2.14.1.", "La release deux point quatorze point un."),
    ("Le n° 12.", "Le numéro douze."),
    # intervalles, fractions, multiplicateurs
    ("Les tests 10-15 passent.", "Les tests dix à quinze passent."),
    ("Les trois quarts : 3/4.", "Les trois quarts : trois quarts."),
    ("Ratio 7/9.", "Ratio sept sur neuf."),
    ("Trois fois plus : 3x.", "Trois fois plus : trois fois."),
    # grands nombres
    ("Il y a 12 000 personnes.", "Il y a douze mille personnes."),
    ("En 1990.", "En mille neuf cent quatre-vingt-dix."),
    # élisions, fractions, textes techniques (revue d'Ada)
    ("Les 2 l'ont dit.", "Les deux l'ont dit."),
    ("Ils sont 3 s'ils viennent.", "Ils sont trois s'ils viennent."),
    ("Nous étions 5 m'a-t-il dit.", "Nous étions cinq m'a-t-il dit."),
    ("Le 3/4 du budget.", "Le trois quarts du budget."),
    ("Le 1/2 finale.", "Le un demi finale."),
    ("Le 24/9 et le 03/04.", "Le vingt-quatre septembre et le trois avril."),
    ("Commit d6b6b75 poussé.", "Commit d six b six b sept cinq poussé."),
    ("Environ ~5 minutes.", "Environ environ cinq minutes."),
    ("Le dossier ~/.openclaw.", "Le dossier ~/.openclaw."),
    ("En Sept 2026.", "En septembre deux mille vingt-six."),
    ("Sept tâches.", "Sept tâches."),
    ("En tête, Claude Opus 5.5 et GPT-5.4.", "En tête, Claude Opus cinq point cinq et GPT-cinq point quatre."),
    ("Il passe à Python 3.12 demain.", "Il passe à Python trois point douze demain."),
    ("Il fait à Paris 3.5 degrés.", "Il fait à Paris trois virgule cinq degrés."),
    ("Compte ~5 min.", "Compte environ cinq minutes."),
    # rien à faire
    ("Bonjour, je vous écoute.", "Bonjour, je vous écoute."),
    ("Au 12 rue Victor-Hugo.", "Au douze rue Victor-Hugo."),
    ("C'est-à-dire rien.", "C'est-à-dire rien."),
]


class NormalizeTest(unittest.TestCase):
    def test_cases(self):
        for src, want in CASES:
            with self.subTest(src=src):
                self.assertEqual(normalize(src), want)

    def test_no_digit_left(self):
        for src, _ in CASES:
            with self.subTest(src=src):
                self.assertNotRegex(normalize(src), r"\d")

    def test_supertonic_respell(self):
        for src, want in [
            ("dix-huit heures quarante-cinq", "dizhuite heures quarante cinq"),
            ("dix-huit jours", "dizuit jours"),
            ("Il en reste dix-huit.", "Il en reste dizhuite."),
            ("soixante-dix-huit", "swassante dizhuite"),
            ("huit heures, huit jours, huit.", "huite heures, hui jours, huite."),
            ("six heures, six jours, six.", "siz heures, si jours, sisse."),
            ("dix euros, dix minutes, dix", "diz euros, di minutes, disse"),
            ("les dix premiers, six cents, huit jours", "les di premiers, si cents, hui jours"),
            ("dix mille, six héros", "di mille, si héros"),
            ("quatre-vingt-dix-neuf centimes", "quatre vingt dizneuf centimes"),
            ("dix-sept ans", "dissète ans"),
            ("sept cent quarante", "sète cent quarante"),
            ("Soixante-douze, septembre, soixantaine", "Swassante douze, septembre, soixantaine"),
            ("vingt et un", "vingt et un"),
            ("Dix-neuf", "Dizneuf"),
            ("Victor-Hugo, c'est-à-dire", "Victor-Hugo, c'est-à-dire"),
            ("il a dix ans", "il a diz ans"),  # liaison
            ("six héros, dix haricots, six hôtels", "si héros, di haricots, siz hôtels"),  # h aspiré = consonne
        ]:
            with self.subTest(src=src):
                self.assertEqual(supertonic_respell(src), want)


if __name__ == "__main__":
    unittest.main()
