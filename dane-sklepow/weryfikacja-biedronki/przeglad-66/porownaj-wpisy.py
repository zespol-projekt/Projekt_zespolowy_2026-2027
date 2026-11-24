"""Resolve record aliases and verify additional address corrections."""
from collections import Counter
import json
from math import cos, hypot, radians
from pathlib import Path
import re
import subprocess
import sys
from pyproj import Transformer

folder = Path(__file__).resolve().parent
root = folder.parents[1]
catalogue = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    'import { prepareCatalogue } from "./przygotuj-dane.mjs";'
    'const d = prepareCatalogue(process.cwd(), { auditCount: 8 });'
    'console.log(JSON.stringify({ready:d.ready,review:d.review,input_fingerprint:d.input_fingerprint}));',
], cwd=root))
assert len(catalogue["review"]) == 66

def read(file):
    return json.loads((folder / file).read_bytes())

def key(value):
    return " ".join(str(value or "").casefold().strip().split())

def street(value):
    return re.sub(r"^(?:ul(?:ica)?\.?|dr\.?)\s+", "", key(value))

def distance(a, b):
    return 111_200 * hypot(a["latitude"] - b["latitude"],
                          (a["longitude"] - b["longitude"]) * cos(radians(a["latitude"])))

official = {r["id"]: r["official"] for r in read("../przeglad-586/raport.json")["decisions"]}
evidence = {r["id"]: r for r in read("dowody-adresow.json")}
cities = {r["city"]: r for r in read("inpost.json")}
comparisons = {r["id"]: r for r in read("punkty-porownawcze.json")}
osm_places = {}
for relative in ("../pelny-przebieg/osm-polaczone.json", "../przeglad-586/osm.json"):
    snapshot = read(relative)
    timestamp = snapshot["osm3s"]["timestamp_osm_base"]
    for element in snapshot["elements"]:
        osm_places[(element["type"], element["id"])] = (element, timestamp)

def find_mapped_store(store, comparison):
    point = comparison["point"]
    if "biedronka" not in key(comparison["title"]) or not point:
        return None
    candidates = []
    for element, timestamp in osm_places.values():
        tags = element.get("tags", {})
        center = element.get("center", element)
        if (tags.get("shop") not in {"convenience", "supermarket"}
                or key(tags.get("name") or tags.get("brand")) != "biedronka"
                or tags.get("disused") == "yes" or tags.get("construction") or "lat" not in center):
            continue
        position = {"latitude": center["lat"], "longitude": center["lon"]}
        if distance(point, position) > 27:
            continue
        site = tags.get("website") or tags.get("contact:website") or ""
        ref = re.search(r"biedronka\.pl/pl/(?:sklepy/)?shop,id,(\d+)", site)
        if ref and ref[1] != store["source"]["store_id"]:
            continue
        candidates.append((element, position, timestamp))
    return candidates[0] if len(candidates) == 1 else None
linked = read("powiazane-identyfikatory.json")
aliases = {"biedronka:7339": ("biedronka:7305", "lazy"), "biedronka:7953": ("biedronka:2518", "lubin"),
           "biedronka:7962": ("biedronka:673", "andrychow")}
occupied = [s for s in catalogue["ready"] if s["chain"] == "biedronka"]
by_id = {s["id"]: s for s in occupied}
transform = Transformer.from_crs(2180, 4326, always_xy=True)
decisions = []
for store in catalogue["review"]:
    id = store["id"]
    a = store["address"]
    decision = {"id": id, "status": "no_new_evidence"}
    decisions.append(decision)
    lockers = cities.get(a["city"], {}).get("points", [])
    matches = [p["url"] for p in lockers if street(p["address"]["street"]) == street(a["street"])
               and key(p["address"]["building_number"]) == key(a["house_number"])
               and p["address"]["post_code"] == a["postal_code"]]
    if matches:
        decision["inpost_evidence"] = matches
    if id in aliases:
        parent, slug = aliases[id]
        pair = linked[slug]
        ids = {str(s["id"]): s for s in pair["stores"]}
        first, second = (ids[x.split(":")[1]] for x in (parent, id))
        if parent in by_id and a["formatted"].casefold() == by_id[parent]["address"]["formatted"].casefold() and all(
            first[k] == second[k] for k in ("city", "street", "street_number", "zip_code")
        ):
            same_point = first["location_id"] == second["location_id"] and bool(first["location_id"]) and all(
                first[k] is not None and first[k] == second[k] for k in ("latitude", "longitude")
            )
            confirmed_site = slug == "andrychow" and bool(matches) and second.get("created") and not second.get("date_closed")
            if same_point or confirmed_site:
                decision.update(status="alias_confirmed", alias_of=parent, evidence=pair["url"],
                    reason="same_location_id_and_coordinates" if same_point else "same_store_address_confirmed_by_inpost")
                continue
        decision["status"] = "alias_unconfirmed"
        continue
    if id in comparisons and sorted(i["code"] for i in store["quality"]["issues"]) == ["missing_geometry"]:
        mapped = find_mapped_store(store, comparisons[id])
        if mapped:
            osm, loc, timestamp = mapped
            if all(distance(loc, s["location"]) > 25 for s in occupied):
                occupied.append({"id": id, "location": loc, "address": a})
                decision.update(status="confirmed", rule="store_page_and_osm",
                    accepted={"location": loc, "precision": "osm_shop_point", "resolves": ["missing_geometry"],
                              "evidence": f'https://www.openstreetmap.org/{osm["type"]}/{osm["id"]}',
                              "official_address": official[id]["url"], "osm_observed_at": timestamp,
                              "address_evidence": [comparisons[id]["url"]]})
                continue
        decision["status"] = "no_verified_osm_point"
    if id not in evidence:
        continue
    r = evidence[id]
    decision.update(status="no_verified_address_point", evidence=r["source"], registry_url=r["url"])
    # Source-specific locality correction requires an explicit address on a store page.
    strong_locality = {"biedronka:7278", "biedronka:7340", "biedronka:7355", "biedronka:7375", "biedronka:7412", "biedronka:7422", "biedronka:7866"}
    if key(r["city"]) != key(a["city"]) and id not in strong_locality:
        continue
    if not r["title"] or "biedronka" not in key(r["title"]):
        continue
    source = official[id]
    issues = sorted(i["code"] for i in store["quality"]["issues"])
    if issues != ["missing_geometry"] or source["status"] == "date_closed_present":
        continue
    candidates = [c for c in r["candidates"] if
                  key(c["city"]) == key(r["city"]) and street(c["street"]) == street(r["street"])
                  and key(c["number"]) == key(r["number"]) and c["code"] == a["postal_code"]]
    if len(candidates) != 1:
        continue
    candidate = candidates[0]
    lon, lat = transform.transform(float(candidate["x"]), float(candidate["y"]))
    loc = {"latitude": round(lat, 7), "longitude": round(lon, 7)}
    if r["point"] and distance(loc, r["point"]) > 75:
        decision["status"] = "conflicting_independent_point"
        continue
    if any(distance(loc, s["location"]) <= 25 for s in occupied):
        decision["status"] = "point_already_claimed"
        continue
    label = f'{r["street"] or r["city"]} {r["number"]}'
    address = {**a, "street_address": label, "street": r["street"] or None, "house_number": r["number"],
               "city": r["city"], "formatted": f'{label}, {a["postal_code"]} {r["city"]}'}
    occupied.append({"id": id, "location": loc, "address": address})
    decision.update(status="confirmed", registry=candidate,
                    accepted={"location": loc, "address": address, "precision": "address_point",
                              "resolves": issues, "evidence": r["url"], "official_address": source["url"],
                              "address_evidence": [r["source"]]})

totals = Counter(d["status"] for d in decisions)
print(dict(totals))
print([d["id"] for d in decisions if d["status"] == "confirmed"])
report = {"input_fingerprint": catalogue["input_fingerprint"], "reviewed": len(decisions),
          "retrieved_on": sys.argv[1], "accepted": totals["confirmed"], "aliases": totals["alias_confirmed"],
          "totals": totals, "decisions": decisions}
(folder / "raport.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
