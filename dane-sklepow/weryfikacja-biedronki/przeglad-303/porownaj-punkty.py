"""Resolve village numbering and cross-check ambiguous addresses with shop points."""
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
catalog = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    'import { prepareCatalogue } from "./przygotuj-dane.mjs";'
    'const data = prepareCatalogue(process.cwd(), { auditCount: 3 });'
    'console.log(JSON.stringify({ready:data.ready,review:data.review,input_fingerprint:data.input_fingerprint}));',
], cwd=root))

def read(file):
    return json.loads((folder / file).read_bytes())

def key(value):
    return " ".join(unicodedata.normalize("NFC", str(value or "")).casefold().strip(" ,").split())

def street(value):
    name = re.sub(r"^ul(?:ica)?\.?\s+", "", key(value))
    return re.sub(r"^(?:os\.|osiedle)\s+", "osiedle ", name)

def num(value):
    return key(value).replace(" ", "")

def distance(a, b):
    return 111_200 * hypot(a["latitude"] - b["latitude"],
                          (a["longitude"] - b["longitude"]) * cos(radians(a["latitude"])))

previous = {d["id"]: d for d in read("../przeglad-396/raport.json")["decisions"]}
observations = {r["id"]: r for r in read("../przeglad-396/obserwacje.json")}
official = {d["id"]: d["official"] for d in read("../przeglad-586/raport.json")["decisions"]}
osm = read("../przeglad-586/osm.json")
retry = defaultdict(list)
for row in read("zapytania.json"):
    retry[row["id"]].append(row)
cards = read("karty-sklepow.json")
assert len(catalog["review"]) == 303
transform = Transformer.from_crs(2180, 4326, always_xy=True)

def position(candidate):
    lon, lat = transform.transform(float(candidate["x"]), float(candidate["y"]))
    return {"latitude": round(lat, 7), "longitude": round(lon, 7)}

poi = []
for element in osm["elements"]:
    tags = element.get("tags", {})
    if tags.get("shop") not in {"supermarket", "convenience"} or tags.get("disused") == "yes" or tags.get("construction"):
        continue
    center = element.get("center", element)
    if "lat" not in center or "lon" not in center:
        continue
    website = tags.get("website") or tags.get("contact:website") or ""
    id_match = re.search(r"biedronka\.pl/pl/(?:sklepy/)?shop,id,(\d+)", website)
    poi.append(({"latitude": center["lat"], "longitude": center["lon"]},
                id_match.group(1) if id_match else None, tags,
                f'https://www.openstreetmap.org/{element["type"]}/{element["id"]}'))

def nearby_shop(store, expected, locations, numbers):
    matches = []
    for point, ref, tags, url in poi:
        if (ref and ref != store["source"]["store_id"]) or not all(distance(p, point) <= 60 for p in locations):
            continue
        address_agrees = (key(tags.get("addr:city") or tags.get("addr:place")) == key(expected["city"])
                          and street(tags.get("addr:street")) == street(expected["street"])
                          and num(tags.get("addr:housenumber")) in numbers)
        if ref == store["source"]["store_id"] or address_agrees:
            matches.append((point, url))
    return matches[0] if len(matches) == 1 else None

def candidate_matches(candidate, city, name, number):
    return (key(candidate["city"]) == key(city) and street(candidate["street"]) == street(name)
            and num(candidate["number"]) == num(number) and float(candidate["city_accuracy"]) == 1)

claimed = [store["location"] for store in catalog["ready"] if store["chain"] == "biedronka"]
supported = {"missing_geometry", "missing_street_address", "shared_coordinates_different_cities"}
decisions = []
for store in catalog["review"]:
    id = store["id"]
    prior = previous[id]
    row = observations[id]
    expected = row.get("expected")
    result = {"id": id, "previous_status": prior["status"], "status": "no_new_confirmation"}
    decisions.append(result)
    issues = sorted(i["code"] for i in store["quality"]["issues"])
    if not set(issues) <= supported:
        result["status"] = "existing_conflict_remains"
        continue
    if official[id]["status"] == "date_closed_present":
        result["status"] = "closed_record"
        continue

    correction = None
    if prior["status"] == "catalogue_address_conflict" and expected and not expected["street"]:
        a = store["address"]
        if (key(a["city"]) == key(expected["city"]) == key(a["street"])
                and num(a["house_number"]) == num(expected["number"]) and key(a["postal_code"]) == key(expected["postcode"])):
            candidate = prior["candidate"]
            if candidate_matches(candidate, expected["city"], "", expected["number"]) and key(candidate["code"]) == key(expected["postcode"]):
                correction = {"location": position(candidate), "evidence": row["url"]}
                result["rule"] = "village_numbering"

    evidence = retry[id]
    manual = next((q for q in evidence if q["rule"] == "manual_format"), None)
    if manual and id == "biedronka:2282" and cards["2282"]["title"]:
        a = store["address"]
        condensed = lambda value: re.sub(r"\s+", "", key(value))
        matches = [c for c in manual["candidates"] if candidate_matches(c, a["city"], manual["street"], manual["number"])
                   and key(c["code"]) == key(a["postal_code"])]
        if len(matches) == 1 and condensed(a["street_address"]) == condensed(manual["street"] + manual["number"]):
            correction = {"location": position(matches[0]), "evidence": manual["url"]}
            result["rule"] = "corrected_number_spacing"

    parts = [q for q in evidence if q["rule"] == "compound_number"]
    if expected and len(parts) == 2 and cards.get(store["source"]["store_id"], {}).get("title"):
        found = [[c for c in q["candidates"] if candidate_matches(c, q["city"], q["street"], q["number"])
                  and key(c["code"]) == key(expected["postcode"])] for q in parts]
        if all(len(group) == 1 for group in found):
            points = [position(group[0]) for group in found]
            if distance(*points) <= 40:
                shop = nearby_shop(store, expected, points, {num(q["number"]) for q in parts})
                if shop:
                    correction = {"location": shop[0], "evidence": shop[1], "address_evidence": [q["url"] for q in parts]}
                    result["rule"] = "compound_number_with_osm_shop"

    if expected and not correction and expected["street"] and expected["postcode"]:
        options = [c for c in row["candidates"] if candidate_matches(c, expected["city"], expected["street"], expected["number"])]
        if len(options) == 1 and options[0]["code"] and key(options[0]["code"]) != key(expected["postcode"]):
            point = position(options[0])
            shop = nearby_shop(store, expected, [point], {num(expected["number"])})
            if shop:
                correction = {"location": shop[0], "evidence": shop[1], "address_evidence": [row["url"]]}
                result.update(rule="postcode_discrepancy_with_osm_shop", source_postcodes=[expected["postcode"], options[0]["code"]])

    if not correction:
        continue
    location = correction["location"]
    if not (48.9 <= location["latitude"] <= 55 and 14 <= location["longitude"] <= 24.3):
        result["status"] = "outside_poland"
        continue
    if any(distance(location, current) <= 20 for current in claimed):
        result["status"] = "point_already_claimed"
        continue
    claimed.append(location)
    result.update(status="confirmed", accepted={**correction, "resolves": issues,
                  "precision": "address_point" if correction["evidence"].startswith("https://services.gugik.gov.pl/") else "osm_shop_point",
                  "official_address": cards.get(store["source"]["store_id"], {}).get("url", official[id]["url"])})

totals = Counter(row["status"] for row in decisions)
rules = Counter(row["rule"] for row in decisions if row["status"] == "confirmed")
print(json.dumps({"totals": totals, "confirmed_by_rule": rules}, ensure_ascii=False))
report = {"input_fingerprint": catalog["input_fingerprint"], "reviewed": len(decisions),
          "retrieved_on": sys.argv[1], "osm_observed_at": osm["osm3s"]["timestamp_osm_base"],
          "accepted": totals["confirmed"], "totals": totals, "confirmed_by_rule": rules, "decisions": decisions}
(folder / "raport.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
