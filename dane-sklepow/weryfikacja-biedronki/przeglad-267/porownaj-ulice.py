"""Corroborate expanded street names using OSM shop points and Geoportal."""
from collections import Counter, defaultdict
import json
from math import cos, hypot, radians
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from pyproj import Transformer

folder = Path(__file__).resolve().parent
root = folder.parents[1]
catalogue = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    'import { prepareCatalogue } from "./przygotuj-dane.mjs";'
    'const d = prepareCatalogue(process.cwd(), { auditCount: 5 });'
    'console.log(JSON.stringify({ready:d.ready,review:d.review,input_fingerprint:d.input_fingerprint}));',
], cwd=root))
assert len(catalogue["review"]) == 267

def read(file):
    return json.loads((folder / file).read_bytes())

def words(value):
    return re.findall(r"[^\W\d_]+|\d+", unicodedata.normalize("NFC", str(value or "")).casefold())

def key(value):
    return " ".join(words(value))

def house(value):
    return str(value or "").casefold().strip().removeprefix("nr ").replace(" ", "")

titles = set("""
ul ulica al aleja aleje pl plac os osiedle gen generała ppłk podpułkownika płk pułkownika
kontradmirała adm admirała kap kapitana ks księdza prymasa marsz marszałka prezydenta
""".split())
names = set("""
adama aleksandra andrzeja antoniego ary augusta bartosza bogdana bolesława bronisława cypriana
edwarda emila eugeniusza fiodora franciszka franklina fryderyka gabriela gustawa henryka ignacego
jakuba jana janusza jarosława jerzego józefa juliana juliusza karola kazimierza klaudiusza
konstantego leona ludwika macieja mariana marii mateusza michała mieczysława mikołaja piotra
poli romana romualda ryszarda stanisława stanisławy stefana tadeusza teofila tomasza wacława
waldemara wiktora wincentego witolda władysława wojciecha zofii zygmunta
""".split())

def street_agrees(a, b):
    left, right = [[w for w in words(name) if w not in titles] for name in (a, b)]
    if not left or not right:
        return False
    if left == right:
        return True
    for short, full in ((left, right), (right, left)):
        extra = len(full) - len(short)
        if extra > 0 and full[extra:] == short and len(short[0]) >= 5 and all(w in names for w in full[:extra]):
            return True
        if short[-1] != full[-1] or len(short[-1]) < 5 or len(short) > len(full):
            continue
        # The supplied initials or given names must match in the order written.
        prefix = full[:-1]
        if prefix and all(w in names for w in prefix) and all(
            w == formal or (len(w) == 1 and formal.startswith(w))
            for w, formal in zip(short[:-1], prefix)
        ):
            return True
    return False

def distance(a, b):
    return 111_200 * hypot(a["latitude"] - b["latitude"],
                          (a["longitude"] - b["longitude"]) * cos(radians(a["latitude"])))

snapshot = read("../przeglad-586/raport.json")
official = {r["id"]: r["official"] for r in snapshot["decisions"]}
elements = read("../przeglad-586/osm.json")["elements"]
osm_by_url = {f'https://www.openstreetmap.org/{e["type"]}/{e["id"]}': e for e in elements}
requests = defaultdict(list)
for row in read("zapytania.json"):
    requests[row["id"]].append(row)
occupied = [s["location"] for s in catalogue["ready"] if s["chain"] == "biedronka"]
transform = Transformer.from_crs(2180, 4326, always_xy=True)
decisions = []
for store in catalogue["review"]:
    id = store["id"]
    result = {"id": id, "status": "no_osm_address_candidate"}
    decisions.append(result)
    if id not in requests:
        continue
    source = official[id]
    item = source["item"]
    issues = sorted(i["code"] for i in store["quality"]["issues"])
    result["status"] = "no_independent_match"
    if issues != ["missing_geometry"] or source["status"] == "date_closed_present":
        continue
    a = store["address"]
    if (key(a["city"]) != key(item["city"]) or house(a["house_number"]) != house(item["street_number"])
            or not street_agrees(a["street"], item["street"])):
        result["status"] = "official_address_differs"
        continue
    matches = []
    for row in requests[id]:
        hint = row["osm"]
        osm = osm_by_url[hint["osm_url"]]
        tags = osm.get("tags", {})
        site = tags.get("website") or tags.get("contact:website") or ""
        ref = re.search(r"biedronka\.pl/pl/(?:sklepy/)?shop,id,(\d+)", site)
        if ref and ref[1] != store["source"]["store_id"]:
            continue
        b = hint["address"]
        if (key(row["city"]) != key(item["city"]) or house(b["house_number"]) != house(item["street_number"])
                or not street_agrees(b["street"], item["street"])
                or (b["postal_code"] and b["postal_code"] != item["zip_code"])):
            continue
        candidates = [c for c in row["candidates"] if
                      key(c["city"]) == key(item["city"]) and house(c["number"]) == house(item["street_number"])
                      and c["code"] == item["zip_code"] and street_agrees(c["street"], b["street"])
                      and street_agrees(c["street"], item["street"])]
        if len(candidates) != 1:
            continue
        candidate = candidates[0]
        lon, lat = transform.transform(float(candidate["x"]), float(candidate["y"]))
        point = hint["location"]
        metres = distance(point, {"latitude": lat, "longitude": lon})
        if metres <= 80:
            matches.append((row, metres, candidate))
    if len(matches) != 1:
        continue
    row, metres, candidate = matches[0]
    point = row["osm"]["location"]
    if any(distance(point, p) <= 20 for p in occupied):
        result["status"] = "point_already_claimed"
        continue
    occupied.append(point)
    result.update(status="confirmed", registry_distance_m=round(metres), registry_address=candidate,
                  accepted={"location": point, "evidence": row["osm"]["osm_url"], "precision": "osm_shop_point",
                            "official_address": source["url"], "resolves": issues, "address_evidence": [row["url"]]})
totals = Counter(d["status"] for d in decisions)
print(dict(totals))
print([(d["id"], d["registry_distance_m"]) for d in decisions if d["status"] == "confirmed"])
result = {"input_fingerprint": catalogue["input_fingerprint"], "reviewed": len(decisions),
          "retrieved_on": sys.argv[1], "osm_observed_at": snapshot["osm_observed_at"],
          "accepted": totals["confirmed"], "totals": totals, "decisions": decisions}
(folder / "raport.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
