"""Compare exact official store addresses with archived GUGiK UUG results."""
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import re
import sys
import subprocess
import unicodedata
from pyproj import Transformer

folder = Path(__file__).resolve().parent
root = folder.parents[1]
followup = "--pozostale" in sys.argv[3:]
report_dir = folder.parent / "przeglad-396" if followup else folder
catalogue = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    'import { prepareCatalogue } from "./przygotuj-dane.mjs";'
    f'const data = prepareCatalogue(process.cwd(), {{ auditCount: {2 if followup else 1} }});'
    'console.log(JSON.stringify({ready:data.ready,review:data.review,input_fingerprint:data.input_fingerprint}));',
], cwd=root))
review = catalogue["review"]
ready = catalogue["ready"]
official = json.loads((folder.parent / "przeglad-586/raport.json").read_bytes())
observations = json.loads(Path(sys.argv[1]).read_bytes())
assert len(observations) == len({row["id"] for row in observations}) == len(review) == (396 if followup else 582)
by_id = {row["id"]: row for row in observations}
official_by_id = {row["id"]: row for row in official["decisions"]}
transform = Transformer.from_crs("EPSG:2180", "EPSG:4326", always_xy=True)
supported = {"missing_geometry", "missing_street_address", "shared_coordinates_different_cities"}

def key(value):
    return unicodedata.normalize("NFC", str(value or "")).casefold().strip(" ,")

def street_key(value):
    name = re.sub(r"^ul(?:ica)?\.?\s+", "", key(value))
    name = re.sub(r"^(?:al\.|aleje?)\s+", "aleja ", name)
    name = re.sub(r"^(?:os\.|osiedle)\s+", "osiedle ", name)
    name = re.sub(r"^(?:pl\.|plac)\s+", "plac ", name)
    return re.sub(r"\s+", " ", re.sub(r"(?<=\w)[-–](?=\w)", " ", name))

def number_key(value):
    return re.sub(r"\s+", "", key(value))

def city_key(value):
    city = key(value)
    return re.sub(r"\bwlkp\.?$", "wielkopolski", city) if followup else city

def signature(city, street, number, postcode):
    return city_key(city), street_key(street), number_key(number), key(postcode)

GIVEN_NAMES = frozenset("""
adama aleksandra andrzeja antoniego bartosza bogdana bolesława bronisława cypriana edwarda emila
franciszka henryka ignacego jakuba jana jarosława jerzego józefa juliana juliusza karola kazimierza
konstantego leona ludwika macieja mariana mateusza michała mieczysława mikołaja piotra raimunda
romana ryszarda sebastiana stanisława stefana tadeusza teofila tomasza wacława waldemara wiktora
wincentego witolda władysława władysławę wojciecha zygmunta
""".split())

def street_matches(left, right):
    if left == right:
        return True
    if not followup or not left or not right:
        return False
    a, b = left.split(), right.split()
    if a[0] == b[0] and a[0] in {"aleja", "osiedle", "plac"}:
        a, b = a[1:], b[1:]
    for short, long in ((a, b), (b, a)):
        if not short or len(long) < 2 or long[0] not in GIVEN_NAMES:
            continue
        if short == long[1:] and len(short[0]) >= 5:
            return True
        if len(short) == len(long) and short[0] == long[0][0] + "." and short[1:] == long[1:]:
            return True
    return False

def match_address(candidate, expected):
    return (candidate[0] == expected[0] and candidate[2:] == expected[2:]
            and street_matches(candidate[1], expected[1]))

published_addresses = defaultdict(set)
published_points = []
for store in ready:
    if store["chain"] == "biedronka":
        a = store["address"]
        published_addresses[signature(a["city"], a["street"], a["house_number"], a["postal_code"])].add(store["id"])
        published_points.append(store["location"])
claimed = list(published_points)
def near(left, right, metres):
    y = (left["latitude"] - right["latitude"]) * 111_200
    x = (left["longitude"] - right["longitude"]) * 111_200 * math.cos(math.radians(left["latitude"]))
    return math.hypot(x, y) <= metres

decisions = []
approved_addresses = Counter()

def candidate_has_municipality(candidate, municipality):
    return candidate.get("jednostka", "").rstrip("}").split(",")[-1].strip('"') == municipality

catalogue_addresses = defaultdict(set)
for store in review:
    row = by_id[store["id"]]
    expected = row.get("expected")
    if expected:
        catalogue_addresses[signature(expected["city"], expected["street"], expected["number"], expected["postcode"])].add(store["id"])
for store in review:
    row = by_id[store["id"]]
    source = official_by_id[store["id"]]
    decision = {"id": store["id"], "status": row["status"]}
    decisions.append(decision)
    if row["status"] != "fetched":
        continue
    expected = row["expected"]
    expected_key = signature(expected["city"], expected["street"], expected["number"], expected["postcode"])
    if not expected_key[3]:
        decision["status"] = "missing_postcode"
        continue
    matches = [candidate for candidate in row["candidates"]
               if match_address(signature(candidate["city"], candidate["street"], candidate["number"], candidate["code"]), expected_key)
               and float(candidate["city_accuracy"]) == 1]
    decision["exact_matches"] = len(matches)
    if len(matches) != 1:
        decision["status"] = "address_not_unique" if matches else "no_exact_address"
        continue
    decision["candidate"] = matches[0]
    issues = {issue["code"] for issue in store["quality"]["issues"]}
    if not issues or not issues <= supported or source["official"]["status"] == "date_closed_present":
        decision["status"] = "unresolved_store_conflict"
        continue
    if published_addresses[expected_key] or len(catalogue_addresses[expected_key]) != 1 or approved_addresses[expected_key]:
        decision["status"] = "address_already_claimed"
        continue
    a = store["address"]
    locality_override = (followup and store["id"] == "biedronka:583"
                         and expected_key == ("posmykowizna", "", "43", "98-355")
                         and key(a["city"]) == "działoszyn"
                         and key(a["street"]).startswith("m.posmykowizna")
                         and candidate_has_municipality(matches[0], "Działoszyn"))
    if (city_key(a["city"]) != expected_key[0] and not locality_override) or key(a["postal_code"]) != expected_key[3]:
        decision["status"] = "catalogue_address_conflict"
        continue
    existing_street = street_key(a["street"])
    existing_number = number_key(a["house_number"])
    if existing_street and not locality_override and not street_matches(existing_street, expected_key[1]) and existing_street != f"{expected_key[1]} {expected_key[2]}":
        decision["status"] = "catalogue_address_conflict"
        continue
    if existing_number and existing_number != expected_key[2]:
        decision["status"] = "catalogue_address_conflict"
        continue
    candidate = matches[0]
    longitude, latitude = transform.transform(float(candidate["x"]), float(candidate["y"]))
    location = {"latitude": round(latitude, 7), "longitude": round(longitude, 7)}
    decision["location"] = location
    if not (14 <= longitude <= 24.3 and 48.9 <= latitude <= 55):
        decision["status"] = "outside_poland"
        continue
    if any(near(location, previous, 20) for previous in claimed):
        decision["status"] = "point_already_claimed"
        continue
    # A conflicting OSM shop ID at a materially different address needs individual review.
    osm_ids = [suggestion for suggestion in source["osm"].get("suggestions", [])
               if suggestion["reason"] == "official_store_id"]
    if osm_ids and not all(near(location, suggestion["location"], 100) for suggestion in osm_ids):
        decision["status"] = "osm_location_conflict"
        continue
    accepted = {
        "location": location, "evidence": row["url"], "official_address": source["official"]["url"],
        "resolves": sorted(issues), "precision": "address_point",
    }
    if locality_override or "missing_street_address" in issues or existing_street != expected_key[1] or existing_number != expected_key[2]:
        street_address = f'{expected["street"] or expected["city"]} {expected["number"]}'
        accepted["address"] = {**a, "city": expected["city"] if locality_override else a["city"], "street": expected["street"] or None, "house_number": expected["number"],
                               "street_address": street_address,
                               "formatted": f'{street_address}, {expected["postcode"]} {expected["city"]}'}
    decision.update(status="confirmed_address_point", accepted=accepted)
    claimed.append(location)
    approved_addresses[expected_key] += 1

totals = Counter(row["status"] for row in decisions)
print(json.dumps(totals, ensure_ascii=False))
report = {"input_fingerprint": catalogue["input_fingerprint"], "reviewed": len(decisions),
          "provider": "GUGiK UUG", "retrieved_on": sys.argv[2], "precision": "official_address_point",
          "accepted": totals["confirmed_address_point"], "totals": totals, "decisions": decisions}
(report_dir / "raport.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
