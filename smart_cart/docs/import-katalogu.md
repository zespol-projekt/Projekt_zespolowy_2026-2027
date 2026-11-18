# Import katalogu produktów i cen

Stan: 18 listopada 2026. Importer zastępuje dawne `data_pipeline.py` i `upload_to_db.py` (poza repozytorium), których nie należy już uruchamiać. Kod: `scripts/import/`. Importer nie łączy się z bazą: generuje SQL, który administrator wykonuje przez `psql`.

## Źródła i zasady

Wejściem są pliki scraperów (`zrodla_v2/` w folderze danych, poza repozytorium): antonka (bieżące i historia), tanszykoszyk i kodyzbiedry. Regulaminy tych serwisów wymagają zgody na wykorzystanie danych w innej bazie. Zespół używa ich do testów projektu studenckiego; przed publicznym udostępnieniem aplikacji trzeba ten temat rozstrzygnąć.

- **Cena regularna:** kodyzbiedry (data pobrania; źródło nie podaje daty ceny), antonka dla Carrefour (sklep internetowy, data `lastUpdated`) oraz kwota podana wprost w opisie promocji („poza promocją: X zł”). Pole `regular_price` z tanszykoszyk nie jest ceną regularną (bywa ceną z 30 dni lub ceną odniesienia). Cen nie wyliczamy ani nie szacujemy.
- **Ceny z gazetek** są promocjami z okresem ważności. Do automatycznego naliczania (`promo_scope = nationwide`) trafiają tylko promocje z tanszykoszyk, które mają cenę, datę końca, link do oferty i warunek wierny obecnym regułom: `unit` (obniżka, supercena) albo `min_quantity` („przy zakupie N”), z kartą/aplikacją, aktywacją i limitem, jeśli źródło je podaje. „Drugi X% taniej”, „N+M gratis”, mieszanie produktów i ceny szacowane pozostają niepotwierdzone.
- **Produkt bazowy** przypisują reguły `slownik-produktow-bazowych.json` (przeniesione 1:1 z `base_dictionary.py`, wynik zgodny z Pythonem). Pozycje spoza słownika (m.in. chemia, kosmetyki) są pomijane i liczone w raporcie.
- **Jedna pozycja** to produkt w sieci: łączymy obserwacje o tym samym EAN albo tej samej nazwie i opakowaniu; bierzemy najnowszą cenę regularną i promocję o najpóźniejszej dacie końca.

## Dopasowanie do bazy (decyzja z 18.11.2026)

Produkt z bazy jest „tym samym”, gdy zgadza się EAN podany przez źródło albo sieć + nazwa w sklepie + opakowanie. Dopasowany produkt i jego oferta w danej sieci dostają nowe dane (także brak ceny regularnej, jeśli nowe źródło jej nie ma). Starych produktów i ofert bez dopasowania nie zmieniamy. Nowe produkty klasyfikuje do grup istniejący wyzwalacz. Każda zmieniona oferta wskazuje wpis w `import_runs`.

## Uruchomienie

Z katalogu `smart_cart` (ścieżkę folderu danych podaj swoją):

```powershell
node scripts/import/import-katalogu.mjs --dane C:\Users\good1\Desktop\Dane_sklepy_current
```

Powstaje `raporty_importu/import-<czas>-proba.sql` (kończy się `ROLLBACK`) i raport JSON. Dopóki migracja `20261118000100_catalog_tree.sql` nie jest wdrożona, dołącz ją do próby: `--z-migracja supabase/migrations/20261118000100_catalog_tree.sql` (migracja i import w jednej transakcji, potem `ROLLBACK`).

Wykonanie przez Docker (bez instalowania psql). Dane połączenia: panel Supabase → **Connect** → **Session pooler** (host, port 5432, użytkownik `postgres.<ref>`). Hasło bazy wpisujesz dopiero po zapytaniu psql; nie zapisuj go w plikach ani poleceniach.

```powershell
docker run --rm -it -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql:ro" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -f /sql/PLIK.sql
```

Raport pokazuje liczbę pozycji według dopasowania, nowe i zastąpione oferty oraz pokrycie grup mleka w sieciach. Zapis (`--zapis`, `COMMIT`) wykonujemy dopiero po przejrzeniu próby, po wdrożeniu migracji i za zgodą właściciela danych.

## Testy

- `node --test tests/import-zrodla.test.mjs tests/import-katalogu.test.mjs` — odczyt źródeł, ilości, typy cen, reguły promocji, cytowanie SQL.
- `npm.cmd run test:db` — w izolowanym kontenerze wykonuje wygenerowany SQL dwa razy na „starych” produktach: dopasowanie po EAN i po nazwie, zastąpienie oferty, nietknięta stara oferta, brak duplikatów i wycofanie próby.

## Znane ograniczenia (dane z 18.11.2026)

- 21 827 pozycji: Biedronka 12 611, Carrefour 7 630, Lidl 545, Kaufland 521, Dino 520. Ceny regularne ma 19 972 pozycji; Lidl, Kaufland i Dino mają prawie wyłącznie promocje z gazetek.
- 40 724 obserwacje bez produktu bazowego i 4 515 bez użytecznej ceny nie są importowane.
- Mleko bez „UHT”/„świeże” w nazwie lub bez pojemności zostaje osobnym produktem (etap Nabiał → Mleko: reguły i przegląd).
