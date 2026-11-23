# Rodzaje produktów

Stan: 24 listopada 2026. Migracje `20261124000100_product_types.sql` (model, API), `20261124000200_product_types_pilot.sql` (pilot) `20261124000300_product_types_all.sql` (pozostałe działy, szybsze przypisywanie) `20261124000400_product_type_flavors.sql` (smaki), `20261124000500_search_relevance.sql` (wyszukiwanie) `20261124000600_product_types_more.sql` (kolejne rodzaje, pokrycie 97%) `20261124000700_product_types_quality.sql` (korekty przypisań, nowe nazwy, wyszukiwanie) `20261124000800_search_primary.sql` (wyszukiwanie: trafienie główne, bez dodatków typu „w sosie pomidorowym”) i `20261124000900_package_weight_from_name.sql` (gramatura zamiast liczby sztuk, np. „450 g (15 sztuk)”). Testy: `tests/database-product-types.sql`. Kontrakt API: `docs/api-katalogu.md`, sekcja „Rodzaje produktów”.

## Po co

Klient dodaje do listy **rodzaj produktu** (np. „Pomidory krojone w puszce”), a porównanie wybiera w każdej sieci jej najtańszy produkt tego rodzaju. Sieci mają różne marki, więc identyczny produkt w kilku sklepach to rzadkość. Przed rodzajami 93% grup zamienników było tylko w jednej sieci.

Decyzje zespołu (23.11.2026):
- w danej sieci jeden produkt na pozycję, bez mieszania marek;
- 5 alternatyw i „Pokaż więcej”;
- ceny podejrzane są widoczne, ale nie wygrywają;
- ser żółty według gatunku; procent tłuszczu dzieli rodzaj;
- smak nie dzieli rodzaju, ale rodzaj może mieć **smaki** (podrodzaje, 23.11 wieczorem): klient wybiera „Chipsy ziemniaczane” (dowolny smak) albo „Chipsy ziemniaczane paprykowe”;
- „N szt” rodzaju liczonego na wagę = N × typowe opakowanie;
- wybór produktu w sieci działa też w innych sieciach z tym samym produktem.

## Model

```
kategoria → podkategoria → [produkt bazowy] → RODZAJ → produkty → oferty w sieciach
```

| Tabela / kolumna | Znaczenie |
|---|---|
| `product_types` | rodzaj: `slug`, `name`, `subcategory_id`, `unit` (g / ml / szt), `g_ml_equal` (1 g = 1 ml), `default_quantity` (NULL = typowe opakowanie), `typical_package` (mediana gramatury, liczona), `display_order`, `is_active`, `parent_id` (smak: rodzaj nadrzędny) |
| `product_type_rules` | reguła: `priority` (pierwsza pasująca wygrywa), `base_product_names` (z jakich produktów bazowych), `include_pattern`, `exclude_pattern` |
| `product_type_reviews` | decyzja ręczna dla produktu: rodzaj albo NULL = bez rodzaju; ma pierwszeństwo przed regułami |
| `products.product_type_id`, `product_type_source` | przypisanie: `rule` / `review` / NULL |
| `shopping_list_items.product_type_id`, `store_choices` | pozycja listy wskazuje grupę **albo** rodzaj; wybory produktów w sieciach `{"<store_id>": product_id}` |
| `favorite_types` | ulubione rodzaje |

Produktów bazowych nie zmieniamy, bo stoi na nich importer: dopasowanie, limit 25 na sieć × produkt bazowy, mediany kalorii i drzewo. Grupy zamienników zostają w bazie: łączą duplikaty i obsługują dotychczasowe listy.

## Przypisanie

- Wzorce to wyrażenia regularne PostgreSQL sprawdzane na `catalog_search_norm(nazwa produktu)`: małe litery, bez polskich znaków, interpunkcja zamieniona na spację (np. „3,2%” → `3 2%`). `\y` oznacza granicę wyrazu.
- Produkt dostaje rodzaj, gdy:
  - jego produkt bazowy jest w `base_product_names`;
  - jednostka pasuje (albo `g_ml_equal` i g/ml);
  - ma gramaturę;
  - nazwa pasuje do `include_pattern` i nie pasuje do `exclude_pattern`.
- Przypisuje wyzwalacz `products_product_type` przy dodaniu produktu i zmianie nazwy, produktu bazowego albo gramatury. Importer się nie zmienia.
- Po zmianie reguł lub decyzji: `SELECT public.refresh_product_types();` (polecenie w `docs/polecenia.md`, punkt 11). Zwraca liczbę zmienionych przypisań i przelicza `typical_package`. Sprawdza reguły po kolei (każde wyrażenie kompilowane raz): ok. 7 s dla ~13 tys. produktów i ~1 970 reguł (po migracji `…000900`). Wynik jest taki sam jak wyzwalacza (sprawdza to test).
- Produkt bez rodzaju zostaje pojedynczym produktem w wyszukiwarce i na liście.

## Smaki (podrodzaje)

- Smak to rodzaj z `parent_id`. Jest jeden poziom, a smak ma podkategorię i jednostkę rodzaju nadrzędnego (pilnuje tego wyzwalacz).
- Produkt ma jeden rodzaj, ten najdokładniejszy, np. „Chipsy ziemniaczane paprykowe”.
- Rodzaj nadrzędny obejmuje swoje produkty i produkty wszystkich smaków (`product_type_family`). Działa to w ekranie rodzaju, porównaniu, „Pokaż więcej”, wyborze produktu w sieci i typowym opakowaniu. Dla klienta to „dowolny smak”, czyli zachowanie sprzed podziału.
- Bezpośrednio w rodzaju nadrzędnym zostają produkty bez smaku w nazwie, rzadkie smaki oraz oferty „mix”, „różne rodzaje” i „A lub B”.
- Mediana do ceny podejrzanej jest liczona z całej rodziny, bo smak nie zmienia ceny za kg.
- **Popularny smak** to smak z ofertami w co najmniej 2 sieciach. Jest osobną pozycją w gałęzi i w wyszukiwarce, zaraz za swoim rodzajem nadrzędnym, od najpopularniejszego (sieci, potem produkty). Przykład dla „chipsy”:
  - „Chipsy ziemniaczane” (dowolny smak);
  - pod nim: paprykowe, cebulowe / śmietankowe, serowe, solone…
- **Rzadki smak** (1 sieć) jest tylko na ekranie rodzaju nadrzędnego. W wyszukiwarce pojawia się, gdy zapytanie pasuje do niego lepiej niż do rodzaju nadrzędnego, np. „ice tea cytrynowa”.
- API:
  - `catalog_type` rodzaju nadrzędnego zwraca `subtypes`, czyli wszystkie smaki z ofertami, od najpopularniejszego;
  - element rodzaju ma `subtype_count` i `parent`.
- Reguła smaku to reguła rodzaju nadrzędnego plus wzorzec smaku. Stoi tuż przed regułą nadrzędną, więc mieści się najwyżej 9 smaków na regułę.
- Smaki definiuje `Dane_sklepy_current\rodzaje_produktow\smaki.py`, a migrację tworzy `generuj_smaki.py`.
- Na danych z 23.11.2026 są 152 smaki w 33 rodzajach, a 111 z nich to smaki popularne:
  - **Słone przekąski:** chipsy, nachos, chrupki, popcorn, orzeszki w panierce.
  - **Nabiał:** jogurty owocowe i pitne, serki homogenizowane, serki do smarowania z dodatkami, ser topiony, napoje mleczne, desery.
  - **Słodycze i wypieki:**
    - lody, budyń, galaretka, żelki, wafelki, ptasie mleczko, batony proteinowe;
    - croissanty (według nadzienia), pączki i donuty.
  - **Napoje:** ice tea, napoje izotoniczne, woda smakowa, syropy, nektary, soki wieloowocowe, napoje owocowe, herbaty owocowe.
  - **Pozostałe:** musy, zupki błyskawiczne, hummus, pasztet.
- W rodzaju nadrzędnym zostają produkty bez smaku w nazwie, oferty „mix” i „różne rodzaje” oraz smaki, które nie mają osobnej pozycji. Przykład: z 121 chipsów ziemniaczanych 60 ma smak.

## Ceny

- **Cena za kg / l / szt dziś** (`unit_price`): cena 1 opakowania dziś (regularna albo promocja naliczana dziś) przeliczona na jednostkę.
- **Cena podejrzana:** poniżej 40% albo powyżej 300% mediany rodzaju, liczonej przy co najmniej 5 ofertach z ceną. Najczęściej to błędna gramatura albo stara cena (np. masło za 9 zł/kg). Jest pokazywana z oznaczeniem, ale nie wygrywa jako najtańsza i nie wchodzi do „od X zł”.
- **Porównanie:**
  - dla każdego produktu rodzaju w sieci liczymy najtańszy zakup samego tego produktu, który pokrywa ilość: pełne opakowania, a przy promocji „przy zakupie N” / zestawie także zakup do progu, jeśli wychodzi taniej;
  - wybieramy najtańszy niepodejrzany produkt, chyba że działa wybór klienta albo ten sam produkt wybrany w innej sieci.

## Rodzaje we wszystkich działach (24.11.2026)

- Pilot (migracja `…000200`): Nabiał, Przetwory pomidorowe, Konserwy warzywne i owocowe, 86 rodzajów.
- Pozostałe działy (migracja `…000300`): 574 rodzaje i 600 reguł, np. pomidory malinowe / czerwone / śliwkowe / koktajlowe, jabłka na wagę i na sztuki, kiełbasa śląska / krakowska / żywiecka, filet z piersi kurczaka, makaron penne / spaghetti, woda niegazowana / lekko gazowana / gazowana.
- Smaki (migracja `…000400`): rodzaje podrzędne, np. „Chipsy ziemniaczane paprykowe”.
- Uzupełnienie (migracja `…000600`): 149 nowych rodzajów i 1 061 reguł dla produktów, które po `…000300` nie miały rodzaju, np. mąka ryżowa / kukurydziana / owsiana, makaron konjac, śmietanka UHT 12% / 18% (karton), napój roślinny barista, woda lecznicza, kawa w kapsułkach (liczona w kapsułkach), bułka wysokobiałkowa, papier ryżowy. Dodaje też reguły do istniejących rodzajów.
- Korekty (migracje `…000700` i `…000900`): reguły z priorytetem ujemnym dla błędnych przypisań, opisane niżej.
- Razem 960 rodzajów (ze smakami) i ok. 1 970 reguł. Jeden rodzaj może mieć kilka reguł, np. z innym produktem bazowym.

Reguły z `…000600` mają priorytet od 20000, więc stoją za wszystkimi wcześniejszymi i łapią tylko produkty, które dotąd nie miały rodzaju. Wcześniejsze przypisania się nie zmieniają. Reguły z `*` zamiast listy produktów bazowych (priorytet od 30000) obejmują dowolny produkt bazowy. Są dla produktów przypisanych do złego produktu bazowego (np. tort w „Pozostałe owoce świeże”, ciastka w „Pozostałe makarony”) i mają wąski wzorzec. Baza pozwala na najwyżej 50 nazw w regule, więc taka reguła jest zapisana jako kilka reguł po 50 nazw.

Na kopii wspólnej bazy z 23.11.2026, po wszystkich migracjach do `…000900`, rodzaj ma 12 691 z 13 014 produktów z gramaturą i ofertą (97,5%; przed `…000600`: 10 966, 84%):

| Dział | Z rodzajem |
|---|---|
| Warzywa i Owoce | 753 z 806 (93%) |
| Pieczywo | 651 z 664 (98%) |
| Nabiał | 1 885 z 1 919 (98%) |
| Mięso i Ryby | 1 492 z 1 556 (96%) |
| Mrożonki i Gotowe | 632 z 659 (96%) |
| Sypkie i Makarony | 1 324 z 1 364 (97%) |
| Tłuszcze i Przetwory | 1 653 z 1 687 (98%) |
| Przyprawy i Pieczenie | 684 z 707 (97%) |
| Napoje | 1 899 z 1 923 (99%) |
| Słodycze i Przekąski | 1 718 z 1 728 (99%) |

Bez rodzaju zostaje 323 produkty z gramaturą i ofertą, głównie:
- produkty liczone w sztukach bez rodzaju na sztuki (np. „Winiary Rosół wołowy 120 g (12 sztuk)”, zestawy „… 10 szt”);
- produkty, które nie są jedzeniem, w działach spożywczych (ok. 35: maszynki i woda po goleniu, zabawki, kosmetyki, płyny do czyszczenia). To błędy danych do poprawy w imporcie;
- mieszanki „A lub B”, oferty „różne rodzaje” i pojedyncze nietypowe produkty (np. kawior z dorsza, rillette).

## Korekty i nazwy (migracja `…000700`)

Przegląd przypisań na danych z 23.11.2026 (np. produkty, których pierwsze słowo nazwy to inna kategoria niż rodzaj) pokazał błędy wcześniejszych reguł:
- twaróg półtłusty w „Twaróg tłusty” (27 produktów; wzorzec `tlust` trafiał w „poltlusty”, a reguła półtłustego wykluczała `tlusty`);
- „Daktyle … cola” i „Donut cola” w „Cola”, „Tort jogurtowy” w „Jogurt naturalny”, „Piernik śliwkowy Lazur” w „Ser z niebieską pleśnią”, „Czekolada Milka Oreo” w „Ciastka z kremem”.

Migracja dodaje 61 reguł korekt z priorytetem ujemnym i notatką `korekta`. Stoją przed wszystkimi innymi regułami i dotyczą tylko wskazanych produktów (wąski wzorzec, produkty bazowe wyliczone z danych). Zmienia się 142 przypisania.

17 rodzajów dostaje nazwy ze słowami, których używają klienci (slug bez zmian), np.:
- „Napój mleczny smakowy” → „Mleko smakowe (napój mleczny)”, smaki „Mleko czekoladowe / truskawkowe / waniliowe / bananowe”;
- „Zupka błyskawiczna” → „Zupa / zupka błyskawiczna (instant)”;
- „Serek do smarowania naturalny” → „Serek twarogowy do smarowania (naturalny)”.

Zmiany wyszukiwania opisuje `docs/api-katalogu.md` („Od …000700”). W wynikach z rodzajami jest teraz więcej rodzajów, a mniej pojedynczych produktów. Sprawdzone na 377 typowych zapytaniach (nazwy rodzajów i np. „mleko”, „ser”, „chleb”): pojedyncze produkty, które mają rodzaj, w pierwszych 30 wynikach — przed zmianą 4 341, po zmianie około 2 400. To głównie trafienia przez składnik lub smak, np. „Pesto z cytryną” przy „cytryna”.

## Gramatura zamiast liczby sztuk (migracja `…000900`)

Carrefour podaje opakowanie jako „450 g (15 sztuk)”. Importer brał ostatnią liczbę, więc produkt miał „15 szt” i nie mógł trafić do rodzaju liczonego w gramach (np. „FRoSTA Złote paluszki rybne 450 g (15 sztuk)” był pojedynczym produktem obok rodzaju „Paluszki rybne”).
- Importer (`scripts/import/normalizacja.mjs`, `ilosc`) bierze teraz gramaturę. Wyjątki zostają w sztukach: jaja, słodzik w tabletkach, bulion / rosół w kostkach.
- Migracja poprawia 56 zapisanych produktów (te same zasady). Pozycje list z takim produktem w sztukach przelicza na gramy (2 szt z „450 g (15 sztuk)” → 60 g).
- Dodaje 3 korekty (np. „Mentos … Guma do żucia 15,5 g (8 sztuk)” do „Guma do żucia”, a nie do draży).
- Na danych z 23.11.2026 rodzaj dostaje 36 kolejnych produktów (12 655 → 12 691).

Reguły generuje skrypt poza repo (`Dane_sklepy_current\rodzaje_produktow`):
- `rodzaje.py`: reguły pilota;
- `reguly_reszta.py`: pozostałe działy;
- `generuj_wszystkie.py`: tworzy migrację `…000300`;
- `wyszukiwanie_800.sql`: funkcje wyszukiwania z migracji `…000800` (wpisane do niej ręcznie, z nagłówkiem); migracja `…000900` jest pisana ręcznie;
- `korekty.py` (korekty i nowe nazwy), `korekty_bazy.py` (produkty bazowe korekt, z danych), `wyszukiwanie_700.sql` i `generuj_korekty.py`: migracja `…000700`;
- `reguly_uzupelnienie.py` i `generuj_uzupelnienie.py`: reguły i migracja `…000600`. Generator sprawdza jednostki i `g_ml_equal` istniejących rodzajów oraz liczby rodzajów i reguł po wstawieniu.

Dawny `generuj_sql.py` tworzył tylko pilota. Propozycja przypisań pilota do przeglądu jest w `propozycja-pilot-2026-11-23.csv`.

## Wdrożenie do wspólnej bazy

Migracje `20261124000100` – `20261124000900` (9 plików) wdrażamy razem, w kolejności, przez `db push` (`docs/polecenia.md`, punkt 7):
1. Testy: `npm.cmd test` i `npm.cmd run test:db`.
2. Kopia bazy przed wdrożeniem (punkt 6).
3. `migration list --remote` i `db push --remote --dry-run`: lista nowych migracji to dokładnie te 9 plików. Jeśli któraś z nich jest już wdrożona (zwłaszcza `…000400` w starszej wersji), nie wdrażamy dalej i sprawdzamy różnice.
4. `db push --remote`. Na kopii danych z 23.11.2026 trwa to ok. 2 min, z czego `…000200` (pilot) ok. 1,5 min, a pozostałe po kilka sekund.
5. Sprawdzenie: ok. 960 rodzajów, ok. 97% produktów z gramaturą i ofertą ma rodzaj, `catalog_search('paluszki rybne', 5, 0, true)` zwraca jeden rodzaj „Paluszki rybne”.
6. `db dump --remote --file supabase-schema.sql` i commit eksportu.

Pliki w `Dane_sklepy_current\lokalna_baza` (`cofnij-smaki.sql`, `przywroc-wyszukiwanie.sql`) służą tylko lokalnej bazie testowej. Nie uruchamiamy ich na wspólnej bazie.

Aplikacja (Expo) woła `catalog_search` i `catalog_branch` bez `p_with_types`, więc po wdrożeniu nadal nie pokazuje rodzajów. Zmienia się tylko trafność wyszukiwania (`…000500`: „mleko 2%”, całe słowa; `…000700`: odmiana słów). Pokazanie rodzajów w aplikacji to osobny krok, według kontraktu w `docs/api-katalogu.md`.

## Znane ograniczenia

- **Stare ceny Biedronki** (kodyzbiedry, wpisy z lutego–lipca 2026) bywają dużo niższe od dzisiejszych, a nie zawsze poniżej progu ceny podejrzanej. Wtedy Biedronka wygrywa porównanie nieaktualną ceną. Do rozstrzygnięcia: czy stare ceny regularne mają przegrywać z aktualnymi.
- **Szczegółowość rodzajów** jest do sprawdzenia w testach. Przykład: „Napój sojowy” zawiera napoje smakowe i naturalne.
- **Produkty bez gramatury** (179) nie dostają rodzaju: porównanie po rodzaju wymaga ilości. Przykłady: „Brokuł szt”, „Ziemniaki wczesne luz”, herbaty „20 tb” bez wagi.
- **Rodzaje „(sztuka)” i „(na wagę)”**: owoce i warzywa sprzedawane raz na sztuki, raz na kilogramy są w dwóch rodzajach (np. „Mango (sztuka)” i „Mango (na wagę)”). Ceny za sztukę i za kilogram nie dają się porównać.
- **Oferty „różne rodzaje” a smaki**: część sieci ma chipsy tylko jako „różne rodzaje” (np. Kaufland, Lidl). Takie oferty są w rodzaju nadrzędnym, więc w porównaniu konkretnego smaku sieć wychodzi jako „brak w sieci”. Do decyzji: czy liczyć je też dla każdego smaku.
- **Herbata w torebkach** liczona w sztukach ma osobne rodzaje „(opakowania liczone w torebkach)”.
