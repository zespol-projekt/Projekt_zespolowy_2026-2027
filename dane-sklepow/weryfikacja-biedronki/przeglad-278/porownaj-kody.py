"""Verify store points where the official and registry postal codes differ."""
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
    'const d = prepareCatalogue(process.cwd(), { auditCount: 4 });'
    'console.log(JSON.stringify({ready:d.ready,review:d.review,input_fingerprint:d.input_fingerprint}));',
], cwd=root))
assert len(catalogue["review"]) == 278

def read(file):
    return json.loads((folder / file).read_bytes())

def key(value):
    return " ".join(str(value or "").casefold().strip().split())

def street(value):
    return re.sub(r"^ul(?:ica)?\.?\s+", "", key(value))

def dist(a, b):
    return 111_200 * hypot(a["latitude"] - b["latitude"],
                          (a["longitude"] - b["longitude"]) * cos(radians(a["latitude"])))

def location(lat, lon):
    return {"latitude": lat, "longitude": lon}

addresses = {r["id"]: r for r in read("../przeglad-396/obserwacje.json")}
official = {r["id"]: r["official"] for r in read("../przeglad-586/raport.json")["decisions"]}
cards = read("karty-sklepow.json")
osm = read("../przeglad-586/osm.json")
observed_at = osm["osm3s"]["timestamp_osm_base"]
local = read("osm-kraczkowa.json")["elements"]
outline = next(e for e in local if e["type"] == "way" and e["id"] == 256289347)
nodes = [e for e in local if e["type"] == "node" and e["id"] in outline["nodes"]]
assert len(nodes) == len(set(outline["nodes"]))
outline["center"] = {axis: (min(n[axis] for n in nodes) + max(n[axis] for n in nodes)) / 2 for axis in ("lat", "lon")}
sources = osm["elements"] + [outline]
points = []
for item in sources:
    tags = item.get("tags", {})
    name = key(tags.get("name") or tags.get("brand"))
    if name != "biedronka" or tags.get("shop") not in {"supermarket", "convenience"} or tags.get("disused") == "yes" or tags.get("construction"):
        continue
    point = item.get("center", item)
    if "lat" not in point or "lon" not in point:
        continue
    website = tags.get("website") or tags.get("contact:website") or ""
    ref = re.search(r"biedronka\.pl/pl/(?:sklepy/)?shop,id,(\d+)", website)
    points.append((item, tags, location(point["lat"], point["lon"]), ref[1] if ref else None))

proof = {
    "6991": "https://mosty-galeria.pl/about-us/",
    "7440": "https://lublin24.pl/lublin/lublin-biedronka-otwiera-kolejny-sklep-w-centrum/CXGUHttJLrc2viWyNcpK",
    "7449": "https://cdn.biedronka.pl/__2024/T11B/regulamin/Lista_sklepow_objetych_promocja_od_14_03.pdf",
    "7836": "https://media.biedronka.pl/453144-wiosenne-przyspieszenie-biedronki",
}
used = [s["location"] for s in catalogue["ready"] if s["chain"] == "biedronka"]
transform = Transformer.from_crs(2180, 4326, always_xy=True)
decisions = []
for store in catalogue["review"]:
    id = store["id"]
    ref = store["source"]["store_id"]
    result = {"id": id, "status": "no_postcode_case"}
    decisions.append(result)
    if ref not in cards:
        continue
    row = addresses[id]
    e = row["expected"]
    candidates = [c for c in row["candidates"]
        if (key(c["city"]), street(c["street"]), key(c["number"])) == (key(e["city"]), street(e["street"]), key(e["number"]))
        and c["code"] and key(c["code"]) != key(e["postcode"])]
    result.update(status="no_confirmation", official=cards[ref], registry_url=row["url"],
                  postal_codes=[e["postcode"]] + sorted(set(c["code"] for c in candidates)))
    issues = sorted(i["code"] for i in store["quality"]["issues"])
    if (not cards[ref]["title"] or len(candidates) != 1 or official[id]["status"] == "date_closed_present"
            or not set(issues) <= {"missing_geometry", "shared_coordinates_different_cities"}):
        continue
    lon, lat = transform.transform(float(candidates[0]["x"]), float(candidates[0]["y"]))
    address_point = location(lat, lon)
    matches = []
    for item, tags, point, osm_ref in points:
        if osm_ref and osm_ref != ref:
            continue
        number = tags.get("addr:housenumber")
        city = tags.get("addr:city") or tags.get("addr:place")
        name = tags.get("addr:street")
        if (number and key(number) != key(e["number"])) or (city and key(city) != key(e["city"])):
            continue
        expected_street = street(e["street"])
        if name and not (street(name) == expected_street or street(name).endswith(" " + expected_street)):
            continue
        precise_address = osm_ref == ref or (city and number and (name or not expected_street))
        # At an exact address, the mapped shop can be considerably inside a building.
        radius = 90 if precise_address else 45
        if dist(point, address_point) <= radius:
            matches.append((item, point))
    if len(matches) != 1:
        continue
    item, point = matches[0]
    if any(dist(point, claimed) <= 20 for claimed in used):
        result["status"] = "point_already_claimed"
        continue
    used.append(point)
    osm_url = f'https://www.openstreetmap.org/{item["type"]}/{item["id"]}'
    more_evidence = [row["url"], *([proof[ref]] if ref in proof else [])]
    result.update(status="confirmed", distance_m=round(dist(point, address_point)),
                  accepted={"location": point, "evidence": osm_url, "precision": "osm_shop_point",
                    "official_address": cards[ref]["url"], "resolves": issues, "address_evidence": more_evidence})
    if item["id"] == 256289347:
        result["accepted"]["address_evidence"].append("https://api.openstreetmap.org/api/0.6/way/256289347/full.json")
        result["accepted"]["osm_observed_at"] = sys.argv[1]

totals = Counter(d["status"] for d in decisions)
print(dict(totals))
print([(d["id"], d["distance_m"]) for d in decisions if d["status"] == "confirmed"])
report = {"input_fingerprint": catalogue["input_fingerprint"], "reviewed": len(decisions),
          "osm_observed_at": observed_at, "retrieved_on": sys.argv[1], "accepted": totals["confirmed"],
          "totals": totals, "decisions": decisions}
(folder / "raport.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
