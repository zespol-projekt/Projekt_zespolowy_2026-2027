# Import katalogu produktów i cen

Stan: 19 listopada 2026. Importer zastępuje dawne `data_pipeline.py` i `upload_to_db.py` (poza repozytorium), których nie należy już uruchamiać. Kod: `scripts/import/`. Importer nie łączy się z bazą: generuje SQL, który administrator wykonuje przez `psql`.

## Źródła i zasady

Wejściem są pliki scraperów (`zrodla_v2/` w folderze danych, poza repozytorium): antonka (bieżące i historia), tanszykoszyk i kodyzbiedry. Regulaminy tych serwisów wymagają zgody na wykorzystanie danych w innej bazie. Zespół używa ich do testów projektu studenckiego; przed publicznym udostępnieniem aplikacji trzeba ten temat rozstrzygnąć.

- **Cena regularna:** kodyzbiedry (od 22.11.2026 datą ceny jest data aktualizacji wpisu w źródle, a bez niej data dodania wpisu; dzień naszego pobrania nie jest datą ceny, wpis bez daty ma brak daty), antonka dla Carrefour (sklep internetowy, data `lastUpdated`) oraz kwota podana wprost w opisie promocji („poza promocją: X zł”). Pole `regular_price` z tanszykoszyk nie jest ceną regularną (bywa ceną z 30 dni lub ceną odniesienia). Brakującą cenę regularną wyliczamy z promocji (opis niżej, decyzja zespołu z 23.11.2026); poza tym cen nie szacujemy.
- **Ceny z gazetek** są promocjami z okresem ważności. Do automatycznego naliczania (`promo_scope = nationwide`) trafiają tylko promocje z tanszykoszyk, które mają cenę, datę końca, link do oferty i warunek wierny obecnym regułom: `unit` (obniżka, supercena) albo `min_quantity` („przy zakupie N”), z kartą/aplikacją, aktywacją i limitem, jeśli źródło je podaje. „Drugi X% taniej”, „N+M gratis”, mieszanie produktów i ceny szacowane pozostają niepotwierdzone.
- **Tylko żywność, bez alkoholu.** Produkt bazowy przypisują reguły `slownik-produktow-bazowych.json` (1:1 z `base_dictionary.py`) oraz po nich 42 reguły „pozostałe …” z `slownik-rozszerzenie.json` (19.11.2026). Pomijane są: alkohol (także piwo bezalkoholowe), produkty z niespożywczych kategorii źródła (chemia, kosmetyki, dla zwierząt, alkohole itd.) i nazwy z czarnej listy. Wszystko jest liczone w raporcie.
- **Jedna pozycja** to produkt w sieci (19.11.2026). Łączymy obserwacje, które mają wspólny EAN, identyczną nazwę albo tę samą nazwę bez ilości opakowania i tę samą ilość (np. „Awokado Hass” i „Awokado Hass 1 szt.”). Kodyzbiedry podaje często kilka EAN pod jedną nazwą z półki (np. „ALPRO JOG. SOJOWY KOKOS 400g” ma 4); to jedna pozycja, a wszystkie jej EAN są brane pod uwagę przy dopasowaniu. Cena regularna: najnowsza; przy tej samej dacie źródło o wyższym priorytecie, potem cena najczęstsza, potem najniższa. Promocja: o najpóźniejszej dacie końca.
- **Ilość opakowania** odczytujemy najpierw z nazwy, potem z pola gramatury źródła (pole bywa sprzeczne z nazwą, np. nazwa 400 g, pole 500 g). Zapis „450 g (15 sztuk)” (Carrefour) to 450 g, nie 15 szt (od 24.11.2026; wyjątki w sztukach: jaja, słodzik, bulion / rosół w kostkach).

## Dopasowanie do bazy (decyzja z 18.11.2026)

Produkt z bazy jest „tym samym”, gdy (w tej kolejności): zgadza się któryś EAN pozycji; sieć + nazwa w sklepie + opakowanie; sieć + identyczna nazwa; sieć + nazwa bez ilości (`rdzenNazwy`, w SQL `pg_temp.rdzen`, ten sam wzorzec) + ta sama ilość albo brak ilości w bazie. Przy kilku EAN nowy produkt dostaje najmniejszy, a istniejący zachowuje swój. Raport pokazuje liczbę możliwych dubli w każdej sieci przed i po imporcie (ta sama nazwa bez ilości i ilość, różne produkty). Dopasowany produkt i jego oferta w danej sieci dostają nowe dane (także brak ceny regularnej, jeśli nowe źródło jej nie ma). Starych produktów i ofert bez dopasowania nie zmieniamy. Nowe produkty klasyfikuje do grup istniejący wyzwalacz. Każda zmieniona oferta wskazuje wpis w `import_runs`.

## Ceny regularne wyliczone z promocji (decyzja zespołu z 23.11.2026)

Od 23.11.2026 importer domyślnie wylicza cenę regularną z promocji. Zaakceptował to team leader na spotkaniu zespołu; decyzja zastępuje wcześniejszą zasadę z `Damian.MD`, że ceny szacowane nie wchodzą do porównania. Opcja `--bez-wyliczania` wyłącza wyliczanie. Dawna opcja `--regularne-z-promocji` jest dopuszczalna, ale nic już nie zmienia.

- Dotyczy pozycji, które nie mają żadnej potwierdzonej ceny regularnej, a mają promocję z ceną (głównie Lidl, Kaufland, Dino).
- Cena wyliczona trafia do bazy jako `price_status = 'prawdziwa'` (żeby porównanie koszyka ją liczyło) z `price_source = 'wyliczona_z_promocji'`; datą jest dzień obserwacji promocji. W podglądzie CSV kolumna `wyliczenie` podaje metodę.
- Metody (`scripts/import/wyliczanie.mjs`): najpierw mechanika podana wprost („N+M gratis”, „drugi X% taniej”, „drugi za Y zł”, „-X%”; „-X%” przy promocji „przy zakupie N” jest niejednoznaczne — raz to rabat na każdą sztukę, raz tylko na drugą — więc wtedy liczymy współczynnikiem, poprawka z 23.11.2026); w pozostałych przypadkach cena promocyjna / współczynnik, czyli mediana stosunku cena promocyjna : cena odniesienia z naszych danych dla sieci i rodzaju promocji (jednostkowa albo „przy zakupie N”). Do nauki współczynnika służą ceny „poza promocją” oraz ceny odniesienia „przed obniżką” i „inna”; cena „najniższa z 30 dni” nie jest używana.
- Raport JSON (`podsumowanie.wyliczenia`) podaje liczbę wyliczonych cen w sieciach, metody, współczynniki z liczbą par oraz sprawdzenie na pozycjach z potwierdzoną aktualną ceną (mediana błędu, odsetek w granicy 10%). Na danych z 18.11.2026: wzory mechaniki mylą się średnio o mniej niż 1%, współczynnik o ok. 8–10% (ok. 2/3 cen w granicy 10%).
- **Import bez wyliczania** (`--bez-wyliczania`) zastępuje wyliczone ceny danymi ze źródeł, czyli brakiem ceny regularnej tam, gdzie źródła jej nie mają. Sprawdzenie: `SELECT count(*) FROM store_offers WHERE price_source = 'wyliczona_z_promocji';` ma dać 0. Wpisy w `price_history` z tym źródłem zostają (historia).
- W aplikacji wyliczoną cenę warto podpisać (np. „cena wyliczona z promocji”), bo bywa obarczona błędem kilku procent.

## Sprzątanie: w bazie tylko nasze dane (decyzja z 19.11.2026)

Opcja `--sprzatanie` dodaje do tej samej transakcji, po imporcie:

1. usunięcie ofert sieci obecnych w imporcie, których ten import nie odświeżył (sieć bez żadnej pozycji w imporcie nie jest ruszana);
2. usunięcie produktów, które przez to zostały bez żadnej oferty (historia cen ich ofert znika razem z ofertami);
3. usunięcie pustych grup porównawczych, z wyjątkiem grup sprawdzonych ręcznie (`reviewed:`), użytych na listach, w ulubionych lub w przekierowaniach.

Jeśli produkt do usunięcia jest wybrany na czyjejś liście zakupów, całość jest przerywana i nic się nie zapisuje. Produkty dopasowane do nowych danych zostają pod tym samym ID. Raport pokazuje liczbę usuniętych ofert i produktów w każdej sieci, źródła usuniętych ofert i liczbę usuniętych grup.

To masowe usunięcie we wspólnej bazie: zapis (`--zapis --sprzatanie`) tylko po próbie, po zgodzie team leadera i po kopii zapasowej tabel katalogu:

```powershell
mkdir C:\Users\good1\Desktop\Dane_sklepy_current\kopie_bazy
docker run --rm -it -v "C:\Users\good1\Desktop\Dane_sklepy_current\kopie_bazy:/kopia" postgres:17 pg_dump "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -Fc -t public.stores -t public.categories -t public.base_products -t public.comparison_groups -t public.products -t public.store_offers -t public.price_history -f /kopia/katalog-przed-importem.dump
```

## Uruchomienie

Z katalogu `smart_cart` (ścieżkę folderu danych podaj swoją):

```powershell
node scripts/import/import-katalogu.mjs --dane C:\Users\good1\Desktop\Dane_sklepy_current
```

Powstaje `raporty_importu/import-<czas>-proba.sql` (kończy się `ROLLBACK`) i raport JSON. Dopóki migracje `20261118000100_catalog_tree.sql` i `20261119000100_extended_base_products.sql` nie są wdrożone, dołącz je do próby (w tej kolejności): `--z-migracja supabase/migrations/20261118000100_catalog_tree.sql --z-migracja supabase/migrations/20261119000100_extended_base_products.sql`. Migracje i import wykonują się w jednej transakcji, potem `ROLLBACK`. Opcja `--sprzatanie` opisana jest wyżej. Opcja `--podglad` zapisuje dodatkowo CSV: co trafi do bazy i co zostanie pominięte.

Wykonanie przez Docker (bez instalowania psql). Dane połączenia: panel Supabase → **Connect** → **Session pooler** (host, port 5432, użytkownik `postgres.<ref>`). Hasło bazy wpisujesz dopiero po zapytaniu psql; nie zapisuj go w plikach ani poleceniach.

```powershell
docker run --rm -it -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql:ro" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -f /sql/PLIK.sql
```

Raport pokazuje liczbę pozycji według dopasowania, nowe i zastąpione oferty oraz pokrycie grup mleka w sieciach. Zapis (`--zapis`, `COMMIT`) wykonujemy dopiero po przejrzeniu próby, po wdrożeniu migracji i za zgodą właściciela danych.

## Raport stanu katalogu

`scripts/raport-katalogu.sql` tylko odczytuje dane (transakcja `READ ONLY`, na końcu `ROLLBACK`): liczby ofert w sieciach (z ceną regularną, z promocją, z ceną do porównania dziś), kategorie × sieci, produkty z EAN, porównywalność grup między sieciami i ostatnie importy. Uruchomienie jak import, z `-f /repo/scripts/raport-katalogu.sql` i folderem repo podłączonym jako `/repo`.

## Testy

- `node --test tests/import-zrodla.test.mjs tests/import-katalogu.test.mjs` — odczyt źródeł, ilości, typy cen, reguły promocji, cytowanie SQL.
- `npm.cmd run test:db` — w izolowanym kontenerze wykonuje wygenerowany SQL dwa razy na „starych” produktach: dopasowanie po EAN i po nazwie, zastąpienie oferty, nietknięta stara oferta, brak duplikatów i wycofanie próby.

## Znane ograniczenia (dane z 18.11.2026)

- Ok. 38 400 pozycji spożywczych (19.11.2026). Lidl, Kaufland i Dino mają prawie wyłącznie promocje z gazetek.
- Niespożywcze kategorie źródeł, alkohol, produkty spoza słownika i obserwacje bez ceny nie są importowane (liczby w raporcie podglądu).
- Reguły „pozostałe …” są szerokie: produkty trafiają do właściwej podkategorii, ale zostają osobnymi grupami (bez łączenia jako zamienniki).
- Mleko bez „UHT”/„świeże” w nazwie lub bez pojemności zostaje osobnym produktem (etap Nabiał → Mleko: reguły i przegląd).
