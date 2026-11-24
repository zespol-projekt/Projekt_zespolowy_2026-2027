"""Compare remaining Biedronka records with an independent Overture Places snapshot."""
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
    'const d = prepareCatalogue(process.cwd(), { auditCount: 6 });'
    'console.log(JSON.stringify({ready:d.ready,review:d.review,input_fingerprint:d.input_fingerprint}));',
], cwd=root))
assert len(catalogue["review"]) == 240

def read(file):
    return json.loads((folder / file).read_bytes())

def tokens(value):
    text = unicodedata.normalize("NFD", str(value or "").casefold().replace("ł", "l"))
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.findall(r"[a-z]+|\d+", text)

def locality(value):
    return tuple(tokens(value))

def street_address(value):
    words = tokens(value)
    if words and words[0] in {"ul", "ulica"}:
        words = words[1:]
    if words and words[0] in {"al", "aleja", "aleje"}:
        words[0] = "aleja"
    if words and words[0] in {"os", "osiedle"}:
        words[0] = "osiedle"
    if words and words[0] in {"pl", "plac"}:
        words[0] = "plac"
    return tuple(words)

def distance(a, b):
    return 111_200 * hypot(a["latitude"] - b["latitude"],
                          (a["longitude"] - b["longitude"]) * cos(radians(a["latitude"])))

def identity(a):
    return (locality(a["city"]), street_address(a["street_address"]), a["postal_code"])

official = {row["id"]: row for row in read("../przeglad-586/raport.json")["decisions"]}
dataset = read("overture.json")
index = defaultdict(list)
independent = {"Microsoft", "meta", "Foursquare"}
for place in dataset:
    if place["name"].strip().casefold() != "biedronka" or place["confidence"] < 0.85:
        continue
    if not any(s["property"] == "" and s["dataset"] in independent for s in place["sources"]):
        continue
    point = re.fullmatch(r"POINT \(([-.0-9]+) ([-.0-9]+)\)", place["location"])
    if not point:
        continue
    point = {"latitude": float(point[2]), "longitude": float(point[1])}
    if not (48.9 <= point["latitude"] <= 55 and 14 <= point["longitude"] <= 24.3):
        continue
    for a in place["addresses"] or []:
        if a["country"] == "PL" and a["freeform"] and a["locality"] and a["postcode"]:
            key = (locality(a["locality"]), street_address(a["freeform"]), a["postcode"])
            index[key].append((place, a, point))

occupied = [s for s in catalogue["ready"] if s["chain"] == "biedronka"]
street_counts = Counter(identity(s["address"]) for s in occupied + catalogue["review"])
used = [(s["id"], s["location"]) for s in occupied]
address_variants = {
    "biedronka:1251": "Karola Bohdanowicza 21 lok. U3",
    "biedronka:1279": "Bernarda Pretficza 37",
    "biedronka:1340": "Edmunda Biernackiego 13",
    "biedronka:2004": "Hugona Kołłątaja 28A",
    "biedronka:2359": "Tadeusza Kościuszki 24B",
    "biedronka:2378": "Zofii Nałkowskiej 2",
    "biedronka:2437": "Stanisława Wyspiańskiego 8",
    "biedronka:2474": "Jerzego Siwińskiego 2",
    "biedronka:2496": "Kochanowskiego 45/47",
    "biedronka:2550": "Tadeusza Kościuszki 41/47",
    "biedronka:3032": "Prezydenta Lecha Kaczyńskiego 20",
    "biedronka:3062": "Klaudiusza Łazowskiego 44",
}
incomplete = {row["id"]: row for row in read("adresy-niepelne.json")}
transform = Transformer.from_crs(2180, 4326, always_xy=True)

def confirmed_incomplete(store, item):
    address = store["address"]
    row = incomplete[store["id"]]
    candidates = [c for c in row["candidates"] if locality(c["city"]) == locality(item["city"])
                  and street_address(c["street"]) == street_address(row["street"])
                  and str(c["number"]).casefold() == row["number"].casefold() and c["code"] == item["zip_code"]]
    if len(candidates) != 1 or not store["location"]:
        return None
    lon, lat = transform.transform(float(candidates[0]["x"]), float(candidates[0]["y"]))
    point = store["location"]
    metres = distance(point, {"latitude": lat, "longitude": lon})
    if metres > 80 or any(distance(point, used_point) <= 25 for _, used_point in used):
        return None
    label = f'{row["street"] or row["city"]} {row["number"]}'
    return {"address": {**address, "street_address": label, "street": row["street"] or None,
                        "house_number": row["number"], "formatted": f'{label}, {item["zip_code"]} {row["city"]}'},
            "location": point, "evidence": row["address_evidence"], "precision": "official_shop_point",
            "address_evidence": [row["url"]], "resolves": ["missing_street_address"], "registry_distance_m": round(metres)}

decisions = []
for store in catalogue["review"]:
    id = store["id"]
    result = {"id": id, "status": "missing_independent_address"}
    decisions.append(result)
    source = official[id]["official"]
    item = source["item"]
    issues = [i["code"] for i in store["quality"]["issues"]]
    if issues == ["missing_street_address"] and id in incomplete and item and source["status"] != "date_closed_present":
        accepted = confirmed_incomplete(store, item)
        if accepted:
            used.append((id, accepted["location"]))
            result.update(status="confirmed_official_address", accepted={**accepted, "official_address": source["url"]})
            continue
    postcode_only = (issues == ["cross_source_address_conflict"]
                     and store.get("source_review", {}).get("scope") == "location_confirmed_postcode_unresolved")
    replace_shared = issues == ["shared_coordinates_different_cities"]
    if issues != ["missing_geometry"] and not postcode_only and not replace_shared:
        result["status"] = "existing_conflict_remains"
        continue
    a = store["address"]
    if (not item or source["status"] == "date_closed_present" or not a["street_address"]
            or not a["postal_code"] or not a["house_number"] or a["street_address"].startswith("/")):
        continue
    address_key = identity(a)
    provided_address = " ".join(str(item[k]).strip() for k in ("street", "street_number") if item[k])
    if address_key != (locality(item["city"]), street_address(provided_address), item["zip_code"]):
        result["status"] = "official_address_differs"
        continue
    variant = address_variants.get(id)
    alternate = (address_key[0], street_address(variant), address_key[2]) if variant else address_key
    choices = {entry[0]["id"]: entry for entry in index[address_key] + index[alternate]}
    if alternate != address_key and street_counts[alternate]:
        result["status"] = "variant_already_claimed"
        continue
    result["overture_ids"] = list(choices)
    if len(choices) != 1 or street_counts[address_key] != 1:
        if choices:
            result["status"] = "ambiguous_address"
        continue
    place, matched, point = next(iter(choices.values()))
    if postcode_only and (not store["location"] or distance(point, store["location"]) > 40):
        result["status"] = "postcode_location_conflict"
        continue
    if replace_shared and store["location"] and distance(point, store["location"]) <= 100:
        result["status"] = "shared_point_not_replaced"
        continue
    ref_urls = [re.search(r"biedronka\.pl/pl/(?:sklepy/)?shop,id,(\d+)", url) for url in place.get("websites") or []]
    if any(ref and ref[1] != store["source"]["store_id"] for ref in ref_urls):
        result["status"] = "different_official_id"
        continue
    near = [other_id for other_id, other_point in used if distance(point, other_point) <= 25]
    if near:
        result.update(status="point_already_claimed", nearby=near)
        continue
    hints = official[id]["osm"].get("suggestions", [])
    linked = [hint for hint in hints if hint["reason"] == "official_store_id"]
    if linked and not all(distance(point, hint["location"]) <= 100 for hint in linked):
        result["status"] = "conflicting_linked_osm_point"
        continue
    used.append((id, point))
    rule = "official_postcode_and_existing_location" if postcode_only else (
        "replace_shared_coordinates" if replace_shared else ("street_name_variant" if alternate != address_key else "exact_address"))
    result.update(status="confirmed", rule=rule, confidence=place["confidence"], matched_address=matched, sources=place["sources"],
                  accepted={"location": point, "precision": "overture_shop_point", "resolves": issues,
                            "evidence": "https://explore.overturemaps.org/#" + f'{point["latitude"]}/{point["longitude"]}/18',
                            "overture_id": place["id"], "official_address": source["url"]})
totals = Counter(d["status"] for d in decisions)
print(dict(totals))
report = {"input_fingerprint": catalogue["input_fingerprint"], "reviewed": len(decisions),
          "retrieved_on": sys.argv[1], "overture_release": "2026-11-18.0",
          "accepted": totals["confirmed"] + totals["confirmed_official_address"], "totals": totals, "decisions": decisions}
(folder / "raport.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
