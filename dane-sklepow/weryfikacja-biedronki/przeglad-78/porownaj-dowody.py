"""Verify corrections for exact addresses found in Biedronka and partner sources."""
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
    'const d = prepareCatalogue(process.cwd(), { auditCount: 7 });'
    'console.log(JSON.stringify({ready:d.ready,review:d.review,input_fingerprint:d.input_fingerprint}));',
], cwd=root))
assert len(catalogue["review"]) == 78

def key(value):
    return " ".join(str(value or "").casefold().split())

def street(value):
    return re.sub(r"^ul(?:ica)?\.?\s+", "", key(value))

def distance(a, b):
    return 111_200 * hypot(a["latitude"] - b["latitude"],
                          (a["longitude"] - b["longitude"]) * cos(radians(a["latitude"])))

evidence = {r["id"]: r for r in json.loads((folder / "dowody.json").read_bytes())}
observations = {r["id"]: r for r in json.loads((folder.parent / "przeglad-396/obserwacje.json").read_bytes())}
official = {r["id"]: r for r in json.loads((folder.parent / "przeglad-586/raport.json").read_bytes())["decisions"]}
overture = json.loads((folder.parent / "przeglad-240/overture.json").read_bytes())
variants = {
    "biedronka:1190": ("al. Bohaterów Warszawy 34 lok. 35", "Aleja Bohaterów Warszawy", "35"),
    "biedronka:1270": ("ul. Łukaszewicza 43", "Józefa Łukaszewicza", "43"),
    "biedronka:1380": ("gen. Sikorskiego 18a", "Sikorskiego", "18a"),
    "biedronka:1829": ("Aleja Rzeczypospolitej 14", "Rzeczypospolitej", "14"),
    "biedronka:2006": ("Katowicka II 30", "Katowicka II", "30"),
    "biedronka:2355": ("Konopnickiej 48", "Konopnickiej", "50"),
}

def corroborate_variant(store):
    id = store["id"]
    label, registered_street, number = variants[id]
    a = store["address"]
    r = observations[id]
    precise = [c for c in r["candidates"] if key(c["city"]) == key(a["city"])
               and street(c["street"]) == street(registered_street)
               and key(c["number"]) == key(number) and c["code"] == a["postal_code"]]
    places = [place for place in overture if key(place["name"]) == "biedronka" and place["confidence"] >= .85
              and any(key(b["locality"]) == key(a["city"]) and key(b["freeform"]) == key(label)
                      and b["postcode"] == a["postal_code"] for b in place["addresses"] or [])
              and any(src["property"] == "" and src["dataset"] in {"Microsoft", "meta", "Foursquare"} for src in place["sources"])]
    if len(precise) != 1 or len(places) != 1:
        return None
    candidate, place = precise[0], places[0]
    lon, lat = transform.transform(float(candidate["x"]), float(candidate["y"]))
    anchor = {"latitude": lat, "longitude": lon}
    point = re.fullmatch(r"POINT \(([-.0-9]+) ([-.0-9]+)\)", place["location"])
    if not point:
        return None
    loc = {"latitude": float(point[2]), "longitude": float(point[1])}
    if distance(loc, anchor) > 25:
        return None
    hints = official[id]["osm"].get("suggestions", [])
    matching_osm = [h for h in hints if distance(loc, h["location"]) <= 65]
    if id == "biedronka:2355" and not matching_osm:
        return None
    return {
        "location": loc, "precision": "overture_shop_point", "resolves": ["missing_geometry"],
        "official_address": official[id]["official"]["url"],
        "evidence": "https://explore.overturemaps.org/#" + f'{loc["latitude"]}/{loc["longitude"]}/18',
        "overture_id": place["id"], "overture_release": "2026-11-18.0",
        "address_evidence": [r["url"], *(h["osm_url"] for h in matching_osm)],
        "registry_distance_m": round(distance(loc, anchor)),
    }

occupied = [s for s in catalogue["ready"] if s["chain"] == "biedronka"]
transform = Transformer.from_crs(2180, 4326, always_xy=True)
decisions = []
for store in catalogue["review"]:
    id = store["id"]
    a = store["address"]
    decision = {"id": id, "status": "no_new_evidence"}
    decisions.append(decision)
    same_address = [s["id"] for s in occupied if key(s["address"]["formatted"]) == key(a["formatted"])]
    if same_address:
        decision.update(status="address_already_published", same_address=same_address)
        continue
    if id in {"biedronka:7305", "biedronka:7339"}:
        primary, alias = "biedronka:7305", "biedronka:7339"
        first, second = (official[ref]["official"] for ref in (primary, alias))
        a1, a2 = first["item"], second["item"]
        same_location = (a1["location_id"] and a1["location_id"] == a2["location_id"]
                         and all(a1[k] == a2[k] for k in ("city", "street", "street_number", "zip_code", "latitude", "longitude"))
                         and not a1["date_closed"] and not a2["date_closed"])
        corroborating = [p for p in overture if p["id"] == "cfe7cd8f-2942-49a0-b746-2114ebd69b2e"
                         and p["confidence"] > .95 and any(key(a["freeform"]) == "targowa 8"
                         and key(a["locality"]) == "łazy" for a in p["addresses"] or [])]
        if same_location and len(corroborating) == 1 and id == primary:
            loc = {"latitude": float(a1["latitude"]), "longitude": float(a1["longitude"])}
            lon, lat = map(float, re.findall(r"[0-9.]+", corroborating[0]["location"]))
            if distance(loc, {"latitude": lat, "longitude": lon}) <= 25 and all(
                distance(loc, s["location"]) > 25 for s in occupied
            ):
                occupied.append({"id": id, "location": loc, "address": a})
                decision.update(status="confirmed", rule="one_physical_location_two_records", alias_ids=[alias],
                    accepted={"location": loc, "evidence": first["url"], "official_address": first["url"],
                              "precision": "official_shop_point", "alias_ids": [alias],
                              "resolves": sorted(i["code"] for i in store["quality"]["issues"]),
                              "address_evidence": [f"https://explore.overturemaps.org/#{lat}/{lon}/18"]})
        elif same_location and any(s["id"] == primary for s in occupied):
            decision.update(status="same_physical_location", published_id=primary)
        continue
    if id in variants:
        correction = corroborate_variant(store)
        if correction and all(distance(correction["location"], s["location"]) > 25 for s in occupied):
            occupied.append({"id": id, "location": correction["location"], "address": a})
            decision.update(status="confirmed", rule="overture_and_registry", accepted=correction)
        else:
            decision["status"] = "variant_unconfirmed"
        continue
    if id not in evidence:
        continue
    r = evidence[id]
    issues = sorted(i["code"] for i in store["quality"]["issues"])
    assert issues == (["missing_street_address"] if r.get("secondary_evidence") else ["missing_geometry"])
    matches = [c for c in r["candidates"] if key(c["city"]) == key(r["city"])
               and key(c["number"]) == key(r["number"]) and c["code"] == a["postal_code"]
               and (street(c["street"]) == street(r["street"])
                    or (id == "biedronka:7848" and street(c["street"]) == "sobieskiego"))]
    decision.update(status="no_registry_point", evidence=r["evidence"], registry_url=r["url"])
    if r.get("secondary_evidence"):
        decision["secondary_evidence"] = r["secondary_evidence"]
    if len(matches) != 1:
        continue
    lon, lat = transform.transform(float(matches[0]["x"]), float(matches[0]["y"]))
    loc = {"latitude": round(lat, 7), "longitude": round(lon, 7)}
    if any(distance(loc, s["location"]) <= 25 for s in occupied):
        decision["status"] = "point_already_claimed"
        continue
    label = f'{r["street"] or r["city"]} {r["number"]}'
    new_address = {**a, "street": r["street"] or None, "house_number": r["number"],
                   "street_address": label, "formatted": f'{label}, {a["postal_code"]} {r["city"]}'}
    occupied.append({"id": id, "location": loc, "address": new_address})
    decision.update(status="confirmed", registry=matches[0],
                    accepted={"location": loc, "address": new_address, "precision": "address_point",
                              "resolves": issues, "evidence": r["url"], "official_address": r["evidence"],
                              **({"address_evidence": [r["secondary_evidence"]]} if r.get("secondary_evidence") else {})})

totals = Counter(d["status"] for d in decisions)
print(dict(totals))
print([d["id"] for d in decisions if d["status"] == "confirmed"])
result = {"input_fingerprint": catalogue["input_fingerprint"], "reviewed": len(decisions),
          "retrieved_on": sys.argv[1], "accepted": totals["confirmed"], "totals": totals, "decisions": decisions}
(folder / "raport.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
