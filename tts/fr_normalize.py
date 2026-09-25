"""French text normalisation for speech synthesis: every number, time, date, amount, unit and symbol is
written out in words before it reaches the TTS engine.

Why: Supertonic 3 (like most TTS models) guesses digits badly ("14h30" read "cacaz-o-30", "50 €" read
"cinquante", "AB-472" read "AB 462"). Words are read reliably by every engine, so this runs for all of
them, after the pronunciation lexicon (config/pronunciation.json keeps the last word on a specific term).

Only the spoken text is rewritten: subtitles and on-screen detail keep the original digits.
Entry point: normalize(text) -> str. Tests: .venv/bin/python -m unittest tts/test_fr_normalize.py
"""
import re

from num2words import num2words

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre"]
MONTHS_RX = "|".join(MONTHS + ["fevrier", "aout", "decembre"])
MONTH_ABBR = {"jan": "janvier", "janv": "janvier", "fév": "février", "fev": "février", "févr": "février", "feb": "février",
              "avr": "avril", "apr": "avril", "juil": "juillet", "jul": "juillet", "aug": "août", "sep": "septembre",
              "sept": "septembre", "oct": "octobre", "nov": "novembre", "déc": "décembre", "dec": "décembre"}

# Words starting with an aspirated h: no liaison before them ("six héros" = /si eʁo/, not "siz héros").
H_ASPIRE = ("hache", "haie", "haine", "hall", "halte", "hamac", "hameau", "hamburger", "hanche", "handicap", "hangar",
            "hardi", "hareng", "haricot", "harpe", "hasard", "hâte", "hausse", "haut", "hauteur", "héros", "hérisson",
            "hibou", "hiérarchie", "hockey", "hollande", "homard", "honte", "hors", "houx", "huit", "hurl")

# Nouns that make a preceding "un" feminine ("21 minutes" -> "vingt et une minutes").
FEMININE = {"heure", "minute", "seconde", "milliseconde", "fois", "semaine", "journée", "année", "personne",
            "page", "ligne", "erreur", "tâche", "carte", "version", "fenêtre", "étape", "question", "voix",
            "image", "vidéo", "photo", "requête", "demande", "alerte", "branche", "session", "machine",
            "minuterie", "nuit", "soirée", "matinée", "livre", "tonne", "calorie", "place", "chose", "fonction",
            "classe", "table", "colonne", "valeur", "règle", "piste", "zone", "escale", "étoile", "note"}

# Units written after a number: symbol -> (singular, plural). Matched case-sensitively, longest first.
UNITS = {
    "km/h": ("kilomètre heure", "kilomètres heure"), "m/s": ("mètre par seconde", "mètres par seconde"),
    "°C": ("degré", "degrés"), "°F": ("degré Fahrenheit", "degrés Fahrenheit"), "°": ("degré", "degrés"),
    "km": ("kilomètre", "kilomètres"), "cm": ("centimètre", "centimètres"), "mm": ("millimètre", "millimètres"),
    "m": ("mètre", "mètres"), "kg": ("kilo", "kilos"), "g": ("gramme", "grammes"), "mg": ("milligramme", "milligrammes"),
    "L": ("litre", "litres"), "l": ("litre", "litres"), "ml": ("millilitre", "millilitres"), "mL": ("millilitre", "millilitres"),
    "To": ("téraoctet", "téraoctets"), "Go": ("gigaoctet", "gigaoctets"), "Mo": ("mégaoctet", "mégaoctets"),
    "Ko": ("kilooctet", "kilooctets"), "TB": ("téraoctet", "téraoctets"), "GB": ("gigaoctet", "gigaoctets"),
    "MB": ("mégaoctet", "mégaoctets"), "KB": ("kilooctet", "kilooctets"), "kB": ("kilooctet", "kilooctets"),
    "Gio": ("gibioctet", "gibioctets"), "Mio": ("mébioctet", "mébioctets"),
    "GHz": ("gigahertz", "gigahertz"), "MHz": ("mégahertz", "mégahertz"), "kHz": ("kilohertz", "kilohertz"),
    "Hz": ("hertz", "hertz"), "kW": ("kilowatt", "kilowatts"), "kWh": ("kilowattheure", "kilowattheures"),
    "W": ("watt", "watts"), "V": ("volt", "volts"), "mA": ("milliampère", "milliampères"), "A": ("ampère", "ampères"),
    "ms": ("milliseconde", "millisecondes"), "min": ("minute", "minutes"), "mn": ("minute", "minutes"),
    "s": ("seconde", "secondes"), "sec": ("seconde", "secondes"), "j": ("jour", "jours"),
    "ft": ("pied", "pieds"), "kt": ("nœud", "nœuds"), "kts": ("nœuds", "nœuds"), "NM": ("nautique", "nautiques"),
    "hPa": ("hectopascal", "hectopascals"), "px": ("pixel", "pixels"), "fps": ("image par seconde", "images par seconde"),
    "tr/min": ("tour par minute", "tours par minute"),
}
UNITS_RX = "|".join(re.escape(u) for u in sorted(UNITS, key=len, reverse=True))

CURRENCIES = {"€": ("euro", "euros", "centime", "centimes"), "EUR": ("euro", "euros", "centime", "centimes"),
              "$": ("dollar", "dollars", "cent", "cents"), "USD": ("dollar", "dollars", "cent", "cents"),
              "£": ("livre", "livres", "penny", "pence")}

FRACTIONS = {(1, 2): "un demi", (1, 3): "un tiers", (2, 3): "deux tiers", (1, 4): "un quart", (3, 4): "trois quarts"}

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}

_SP = r"[ \u00a0\u202f]"             # ordinary, no-break and narrow no-break spaces
_INT = rf"\d{{1,3}}(?:{_SP}\d{{3}})+|\d+"   # 12 000 000 or 12000000
_NUM = rf"(?:{_INT})(?:[,.]\d+)?"


def _int(s):
    return int(re.sub(r"\D", "", s))


def words(n, feminine=False):
    """Cardinal in words; `feminine` turns a final "un" into "une" (une heure, vingt et une minutes)."""
    w = num2words(n, lang="fr")
    if feminine and re.search(r"(?:^|[ -])un$", w):
        w = w[:-2] + "une"
    return w


def digits_words(s):
    """Leading-zero codes and fractional parts: "007" -> "zéro zéro sept", "05" -> "zéro cinq"."""
    return " ".join(num2words(int(c), lang="fr") for c in s)


def number_words(raw, feminine=False):
    """'12 000', '3,5', '3.05', '007' -> words. The decimal part is read as a number ("virgule quatorze"),
    keeping its leading zeros ("virgule zéro cinq")."""
    raw = raw.strip()
    m = re.fullmatch(rf"({_INT})(?:[,.](\d+))?", raw)
    if not m:
        return raw
    ip, fp = m.group(1), m.group(2)
    digits = re.sub(r"\D", "", ip)
    if len(digits) > 1 and digits.startswith("0") and not fp:
        return digits_words(digits)
    out = words(int(digits), feminine and not fp)
    if fp:
        zeros = len(fp) - len(fp.lstrip("0"))
        rest = fp.lstrip("0")
        tail = (digits_words("0" * zeros) + " " if zeros else "") + (words(int(rest)) if rest else "")
        out += " virgule " + tail.strip()
    return out


def _value(raw):
    raw = re.sub(rf"{_SP}", "", raw).replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _plural(raw):
    return abs(_value(raw)) >= 2


def _next_word_feminine(following):
    m = re.match(r"\s*([^\W\d_]+)", following)
    if not m:
        return False
    w = m.group(1).lower()
    return w in FEMININE or (w.endswith("s") and w[:-1] in FEMININE)


def roman_to_int(s):
    total, prev = 0, 0
    for ch in reversed(s):
        v = ROMAN[ch]
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total


# ---------------------------------------------------------------------------------------------------------
# Rules, applied in order. Each one consumes its digits, so later, more generic rules never see them.

def _phones(t):
    def fr(m):
        pairs = re.findall(r"\d\d", re.sub(r"\D", "", m.group(2)))
        head = "plus trente-trois, " + words(int(m.group(1)[-1])) if m.group(1).startswith("+") else digits_words(m.group(1))
        return head + ", " + ", ".join(digits_words(p) if p.startswith("0") else words(int(p)) for p in pairs)
    # 06 12 34 56 78 / 06.12.34.56.78 / +33 6 12 34 56 78
    return re.sub(r"(?<![\d,.])(\+33[ .]?[1-9]|0[1-9])((?:[ .-]?\d{2}){4})(?!\d|,\d)", fr, t)


def _dates(t):
    def dmy(d, mth, y):
        day = "premier" if d == 1 else words(d)
        return f"{day} {MONTHS[mth - 1]}" + (f" {words(y)}" if y is not None else "")

    def iso(m):
        y, mth, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return dmy(d, mth, y) if 1 <= mth <= 12 and 1 <= d <= 31 else m.group(0)
    t = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", iso, t)

    def slash(m):
        d, mth, y = int(m.group(1)), int(m.group(2)), m.group(3)
        if not (1 <= d <= 31 and 1 <= mth <= 12):
            return m.group(0)
        return dmy(d, mth, int(y) + (2000 if len(y) == 2 else 0))
    t = re.sub(r"\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b", slash, t)       # 24/09/2026, 24.09.26

    def day_month(m):  # "le 24/09" without a year: only after "le"/"du"/"au", and only when it cannot be a
        # fraction ("le 3/4 du budget", "le 1/2 finale"): a two-digit month ("03/04") or a day above 12.
        d, mth = int(m.group(2)), int(m.group(3))
        unambiguous = len(m.group(3)) == 2 or d > 12
        return m.group(1) + dmy(d, mth, None) if unambiguous and 1 <= d <= 31 and 1 <= mth <= 12 else m.group(0)
    t = re.sub(r"\b((?:le|du|au|dès le|jusqu'au)\s+)(\d{1,2})/(\d{1,2})\b(?!/)", day_month, t, flags=re.I)
    # "Sept 2026", "déc. 2025" (abbreviated month + year) -> full month, before "sept" is read as a number
    t = re.sub(r"\b(" + "|".join(MONTH_ABBR) + r")\.?(?=\s+\d{4}\b)", lambda m: MONTH_ABBR[m.group(1).lower().rstrip(".")], t, flags=re.I)
    # "1 mars" / "1er mars" -> "premier mars"
    t = re.sub(rf"\b1(?:er)?(?=\s+(?:{MONTHS_RX})\b)", "premier", t, flags=re.I)
    return t


def _times(t):
    def hm(h, mnt):
        if h > 24 or (mnt is not None and mnt > 59):
            return None
        out = words(h, feminine=True) + (" heure" if h in (0, 1) else " heures")
        if mnt:
            out += " " + words(mnt, feminine=True)
        return out

    def rep_h(m):
        s = hm(int(m.group(1)), int(m.group(2)) if m.group(2) else None)
        return s if s else m.group(0)
    t = re.sub(r"\b(\d{1,2})\s?h\s?(\d{2})?(?![\w])", rep_h, t)            # 14h30, 14 h 30, 8h, 18h45

    def rep_colon(m):
        s = hm(int(m.group(1)), int(m.group(2)))
        return s if s else m.group(0)
    def rep_hms(m):
        h, mnt, sec = (int(g) for g in m.groups())
        return " ".join(p for p in (f"{words(h, True)} heure{'s' if h > 1 else ''}" if h else "",
                                    f"{words(mnt, True)} minute{'s' if mnt > 1 else ''}" if mnt else "",
                                    f"{words(sec, True)} seconde{'s' if sec > 1 else ''}" if sec else "") if p) or "zéro seconde"
    t = re.sub(r"\b(\d{1,2}):([0-5]\d):([0-5]\d)\b", rep_hms, t)                  # 01:02:03 (durée)
    t = re.sub(r"\b([01]?\d|2[0-3]):([0-5]\d)(?![:\d])", rep_colon, t)      # 14:30
    return t


def _money(t):
    def amount(raw, cur, mult=""):
        sg, pl, csg, cpl = CURRENCIES[cur]
        raw = raw.strip()
        if mult:  # 3 k€ -> trois mille euros ; 1,5 M€ -> un virgule cinq million d'euros
            if mult in "kK":
                return f"{number_words(raw)} mille {pl}"
            scale = {"M": "million", "Md": "milliard"}[mult] + ("s" if _plural(raw) else "")
            return f"{number_words(raw)} {scale} " + ("d'" if pl[0] in "aeiouy" else "de ") + pl
        m = re.fullmatch(rf"({_INT})(?:[,.](\d{{1,2}}))?", raw)
        if not m:
            return f"{number_words(raw)} {pl}"
        units, cents = _int(m.group(1)), m.group(2)
        cents = int(cents.ljust(2, "0")) if cents else 0
        if units == 0 and cents:
            return f"{words(cents)} {cpl if cents > 1 else csg}"
        out = f"{words(units, feminine=(cur == '£'))} {pl if units >= 2 else sg}"
        if cents:
            out += f" {words(cents)}"
        return out

    cur_rx = r"€|EUR\b|\$|USD\b|£"
    t = re.sub(rf"({_NUM}){_SP}?(k|K|Md|M)({cur_rx})", lambda m: amount(m.group(1), m.group(3).strip(), m.group(2)), t)
    t = re.sub(rf"({_NUM}){_SP}?({cur_rx})", lambda m: amount(m.group(1), m.group(2).strip()), t)
    t = re.sub(rf"(€|\$|£){_SP}?({_NUM})", lambda m: amount(m.group(2), m.group(1)), t)
    return t


def _percent(t):
    return re.sub(rf"([-+]?)({_NUM}){_SP}?%", lambda m: ("moins " if m.group(1) == "-" else "") + number_words(m.group(2)) + " pour cent", t)


def _units(t):
    def rep(m):
        sign, raw, unit = m.group(1), m.group(2), m.group(3)
        sg, pl = UNITS[unit]
        neg = "moins " if sign in ("-", "−") else ("plus " if sign == "+" else "")
        return f"{neg}{number_words(raw, feminine=sg.split()[0] in FEMININE)} {pl if _plural(raw) else sg}"
    return re.sub(rf"(?:(?<=\s)|^|(?<=\())([-−+]?)({_NUM}){_SP}?({UNITS_RX})(?![\w/°'’])", rep, t)  # « les 2 l'ont dit » : pas des litres


# A decimal followed by one of these is a measurement, never a version ("à Paris 3.5 degrés").
_MEASURE_RX = UNITS_RX + r"|%|€|\$|£|degrés?\b|euros?\b|dollars?\b|pour cent\b|fois\b|ans?\b|jours?\b|heures?\b|minutes?\b|secondes?\b|kilo\w*|mètres?\b|litres?\b"


def _versions(t):
    # Product and model versions after a name ("Claude Opus 4.7", "GPT-5.4", "Python 3.12"): "point", not
    # "virgule". Only when the name is not the first word of the sentence, so "Pi vaut 3.14" stays a decimal.
    t = re.sub(rf"(?<=[a-zà-ÿ,;:] )([A-Z][A-Za-z]*[ -])(\d+)\.(\d+)\b(?![.,]\d)(?!\s*(?:{_MEASURE_RX}))",
               lambda m: f"{m.group(1)}{words(int(m.group(2)))} point {digits_words(m.group(3)) if m.group(3).startswith('0') else words(int(m.group(3)))}", t)
    t = re.sub(r"\b(version)\s+v(?=\d)", r"\1 ", t, flags=re.I)                       # "version v2.1" -> "version 2.1"
    t = re.sub(r"\bv(\d+(?:\.\d+)+)\b", lambda m: "version " + " point ".join(words(int(x)) for x in m.group(1).split(".")), t)
    return re.sub(r"\b\d+(?:\.\d+){2,}\b", lambda m: " point ".join(words(int(x)) for x in m.group(0).split(".")), t)


def _ordinals(t):
    def rep(m):
        n, suffix = m.group(1), m.group(2).lower()
        if n.isdigit():
            v = int(n)
        else:
            v = roman_to_int(n)
        if v == 1:
            return "première" if suffix in ("re", "ère", "ere") else "premier"
        return num2words(v, lang="fr", to="ordinal")
    t = re.sub(r"\b(\d+)(er|re|ère|ere|e|ème|eme|ième|ieme)\b", rep, t)
    t = re.sub(r"\b([IVXLCDM]{1,6})(er|e|ème|eme)\b(?=\s+(?:siècle|arrondissement|république|édition|étage|régiment))", rep, t)
    return re.sub(r"\b([IVXLC]{1,6})(?=\s+siècle)", lambda m: num2words(roman_to_int(m.group(1)), lang="fr", to="ordinal"), t)


def _misc(t):
    t = re.sub(r"(?:\b[nN]°|№)\s?(?=\d)", "numéro ", t)
    t = re.sub(r"\bFL\s?(\d{2,3})\b", lambda m: "niveau " + words(int(m.group(1))), t)            # FL100
    t = re.sub(r"\b(\d+)\s?/\s?(\d+)\b", lambda m: FRACTIONS.get((int(m.group(1)), int(m.group(2))),
               f"{number_words(m.group(1))} sur {number_words(m.group(2))}"), t)
    t = re.sub(r"(?<=\d)\s?[xX×]\s?(?=\d)", " fois ", t)                                        # 3x4, 3 × 4
    t = re.sub(r"(?:(?<=\s)|^)[x×](\d+)\b", lambda m: "fois " + number_words(m.group(1)), t)   # x2
    t = re.sub(r"\b(\d+)\s?[x×](?=\s|$|[.,!?])", lambda m: number_words(m.group(1)) + " fois", t)  # 2x
    t = re.sub(r"\b(\d+(?:[,.]\d+)?)\s?k\b", lambda m: number_words(m.group(1)) + " mille", t)  # 10k
    t = re.sub(rf"\b({_NUM})\s?[-–—]\s?({_NUM})\b(?!\s?[-–—]\s?\d)", lambda m: f"{m.group(1)} à {m.group(2)}", t)  # 10-15
    return t


def _codes(t):
    # Hashes and hex ids (commit d6b6b75, 3fa9c2e1…): spelled character by character, not read as a number.
    t = re.sub(r"\b(?=[0-9a-f]*\d[0-9a-f]*[a-f])(?=[0-9a-f]*[a-f][0-9a-f]*\d)[0-9a-f]{6,40}\b",
               lambda m: " ".join(num2words(int(c), lang="fr") if c.isdigit() else c for c in m.group(0)), t)
    # Letters glued to digits: A320 -> A trois cent vingt, AB-472 -> AB quatre cent soixante-douze.
    t = re.sub(r"\b([A-Za-z]{1,6})[-_]?(\d+)\b", lambda m: f"{m.group(1)} {number_words(m.group(2))}", t)
    return re.sub(r"\b(\d+)([A-Za-z]{1,3})\b", lambda m: f"{number_words(m.group(1))} {m.group(2)}", t)       # 4K, 5G


def _numbers(t):
    def rep(m):
        sign = m.group(1) or ""
        neg = "moins " if sign in ("-", "−") else ("plus " if sign == "+" else "")
        return neg + number_words(m.group(2), feminine=_next_word_feminine(t[m.end():]))
    # A sign counts only at the start of a word ("-5", not the hyphen of "Victor-Hugo 12").
    return re.sub(rf"(?:(?:(?<=[\s(«\"'])|^)([-−+]))?(?<![\d,.])({_NUM})(?![\d])", rep, t)


def _symbols(t):
    t = t.replace("&", " et ").replace("=", " égale ").replace("≈", " environ ")
    t = re.sub(r"(?<=\w)\s?\+\s?(?=\w)", " plus ", t)
    return t


def normalize(text):
    t = re.sub(r"(?<=\d)[\u00a0\u202f](?=\d)", " ", text)
    t = re.sub(r"[~≈]\s?(?=[-+]?\d)", "environ ", t)  # before the unit rules: "~5 min" -> "environ cinq minutes"
    for rule in (_phones, _dates, _times, _money, _percent, _versions, _ordinals, _units, _misc, _codes, _numbers, _symbols):
        t = rule(t)
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------------------------------------------------
# Engine-specific respelling (applied by the Supertonic sidecar only, after normalize()).
# Measured 2026-09-24 (synthesis -> Whisper large-v3-turbo, 4 voices M1/M4/M5/F3; Piper and Pocket TTS read
# the same sentences right, so the fault is the model's): Supertonic 3 garbles hyphenated number compounds
# ("dix-huit" heard "dix 8", "soixante-douze" heard "612") and some number words on some voices. Phonetic
# spellings kept because they scored 14/14 (7 voices x 2 draws; "diz huit" only 11/14): "dissète" (17),
# "dizuit" (18), "dizneuf" (19), "sète" (7: "sept cent" heard "cep cent"), "swassante" (60: "soixante"
# heard "soit"/"swac"). Final consonants were then measured with a phoneme recogniser
# (wav2vec2-xlsr-53-espeak): see the "huite" rule below; names go through config/pronunciation.json.
_NUMBER_WORDS = ("zéro|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|"
                 "vingts?|trente|quarante|cinquante|soixante|cents?|mille|millions?|milliards?|et")


_BEFORE_VOWEL = rf"\b(?=\s+(?!(?i:{'|'.join(H_ASPIRE)}))[aeiouyàâéèêëîïôûœhAEIOUYÀÂÉÈÊÎÔÛŒH])"
_BEFORE_PAUSE = r"\b(?=\s*(?:[.,;:!?…]|$))"
_BEFORE_CONSONANT = rf"\b(?=\s+(?:(?i:{'|'.join(H_ASPIRE)})|[bcçdfgjklmnpqrstvwxzBCÇDFGJKLMNPQRSTVWXZ]))"
_SOUNDED = rf"(?:{_BEFORE_VOWEL}|{_BEFORE_PAUSE})"


def supertonic_respell(text):
    t = text
    for _ in range(3):  # "soixante-dix-huit": each pass unhooks one hyphen of a chain
        t = re.sub(rf"\b({_NUMBER_WORDS})-({_NUMBER_WORDS})\b", r"\1 \2", t, flags=re.I)
    t = re.sub(r"\b([dD])ix sept\b", r"\1issète", t)
    # Final consonants: this model drops the t of "huit" (heard "dizi", "ouvi"). Where French pronounces it
    # (before a vowel or a pause) a written final "e" brings it back: 14/14 for "huite" / "dizhuite" vs 0/14.
    t = re.sub(rf"\b([dD])ix huit{_SOUNDED}", r"\1izhuite", t)
    t = re.sub(r"\b([dD])ix (huit|neuf)\b", lambda m: m.group(1) + "iz" + m.group(2).replace("huit", "uit"), t)
    t = re.sub(rf"\b([hH])uit{_SOUNDED}", r"\1uite", t)
    t = re.sub(rf"\b([sSdD])ix{_BEFORE_VOWEL}", r"\1iz", t)                     # six heures -> siz heures
    t = re.sub(rf"\b([sSdD])ix{_BEFORE_PAUSE}", r"\1isse", t)                   # il en reste six. -> sisse
    # ...and the reverse: before a consonant French drops it ("dix premiers" = /di/), which this model does not.
    t = re.sub(rf"\b([sSdD])ix{_BEFORE_CONSONANT}", r"\1i", t)                  # les dix premiers -> les di premiers
    t = re.sub(rf"\b([hH])uit{_BEFORE_CONSONANT}", r"\1ui", t)                  # huit jours -> hui jours
    t = re.sub(r"\b([sS])ept\b", r"\1ète", t)
    return re.sub(r"\b([sS])oixante\b", r"\1wassante", t)


if __name__ == "__main__":
    import sys
    for line in sys.argv[1:] or sys.stdin:
        print(normalize(line))
