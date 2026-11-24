# Dane sklepów SMARTCART

Kontrola publikacji 14 listopada 2026: z 70 archiwalnych HTML usunięto 76 wartości kluczy/licencji stron trzecich. Treść dowodowa i dane placówek pozostały zachowane; sumy kontrolne i referencje odświeżono. [Raport sanitizacji](raport-sanitizacji.json) i [stan historii Git](../smart_cart/docs/publikacja-git.md). Zgodnie z decyzją właściciela historia pozostaje bez zmian; redakcja dotyczy bieżących plików, a stare wartości nadal są w dawnym commicie.

Katalog jest częścią repozytorium `Projekt_zespolowy_2026-2027`, obok katalogu `smart_cart`.
Zawiera cały zbiór, oryginały, poprawki, archiwum kontroli oraz narzędzia przygotowania danych.

Kontrola historyczna: **14 listopada 2026** — 37/37 testów oraz `przygotuj-dane.mjs --check`
zaliczone; podział nadal wynosi **7753 gotowe / 580 do weryfikacji**.
To kontrola zapisanej migawki, bez nowego pobierania i bez potwierdzenia bieżącego otwarcia placówek.
[Audyt całego projektu](../smart_cart/docs/stan-projektu.md) rozróżnia ten katalog od bazy produktów i cen Supabase.

Kod serwera HTTP i jego testy są w `smart_cart/server/serwer-mapy.mjs` oraz `smart_cart/tests/server.test.mjs`. Serwer uruchamia się z katalogu `smart_cart` poleceniem `npm.cmd run server`, a kontrolę danych bez uruchamiania serwera wykonuje `npm.cmd run server:check`. Domyślnie odczytuje `gotowe/sklepy.json` z tego katalogu. Można zmienić położenie danych przez `SMARTCART_DATA_DIR` w `smart_cart/.env.local`. Dane nie są importowane do pakietu Expo — aplikacja otrzymuje gotowy katalog przez API.

Obecne API wymaga sesji potwierdzonego użytkownika Supabase dla `GET` i `HEAD /v1/stores`.
Publiczny `/health` oraz `server:check` pozwalają sprawdzić dane bez logowania.
`public.stores` w bazie produktów oznacza sieci handlowe, nie te pojedyncze placówki.
Nie ma automatycznej synchronizacji między tym katalogiem a zdalną bazą cen.

Pliki źródłowe i dowody mają zapisane sumy SHA-256. Główny `.gitattributes` wyłącza normalizację końców linii dla całego tego katalogu, aby Git zachował ich bajty także na Windows. Nie formatuj automatycznie źródeł, odpowiedzi JSON/HTML ani plików dowodowych.

Przed publikacją z archiwum `weryfikacja-biedronki/proba-20/stary-dzikow-zyn.html` usunięto wartość pola `TWILIO_ACCOUNT_ID` należącą do zewnętrznej strony. Zastąpiono ją znacznikiem `[REDACTED_TWILIO_ACCOUNT_ID]`. Plik `.meta.json` dokumentuje tę zmianę i sumę oryginału; sumy kontrolne w raportach oraz wynikach odpowiadają wersji oczyszczonej. Dane adresowe i decyzje przeglądu pozostały bez zmian. Przy ponownym pobieraniu archiwum należy usunąć takie identyfikatory przed publikacją.

Raporty archiwalne zachowują stan i opisy z chwili ich przygotowania. Zawarte w nich wzmianki o przechowywaniu poza repozytorium opisują wcześniejszy układ katalogów.

## Zawartość

- `surowe/` — oryginalne migawki źródeł, w tym GeoJSON i JSON lokalizatora Kauflandu.
- `zrodla.json` — adresy źródeł, metadane zbiorów, uzgodnione filtry i sumy SHA-256.
- `przygotuj-dane.mjs` — lokalny skrypt przygotowania danych, wymaga Node.js 24.
- `przygotuj-dane.test.mjs` — testy filtrowania, normalizacji i kontroli jakości.
- `dopasuj-biedronke.mjs` — dopasowanie do zapisanych danych OSM bez internetu.
- `poprawki.mjs`, `poprawki.test.mjs` — nakładanie i testy poprawek z dowodami.
- `poprawki/biedronka.json` — przyjęte poprawki współrzędnych i adresów, z pierwotnymi wartościami i źródłem.
- `poprawki/biedronka-zweryfikowane.json` — 39 dodatkowych poprawek przyjętych po przeglądzie propozycji.
- `sprawdzone-poprawki.mjs`, `sprawdzone-poprawki.test.mjs` — walidacja zmian przyjętych po przeglądzie, adresów GUGiK i kodu z oficjalnego dokumentu.
- `pobierz-biedronke.mjs`, `pobierz-osm.mjs` — pobieranie odpowiedzi do lokalnego archiwum.
- `scal-osm.mjs` — scalanie zapisanych odpowiedzi OSM i wybór nowszej wersji tego samego obiektu.
- `podsumuj-weryfikacje.mjs` — kontrola wyników, porównanie oficjalnego API oraz raport podsumowujący.
- `przeglad.mjs`, `przeglad.test.mjs` — decyzje przeglądu źródeł, w tym wstrzymanie niejednoznacznych rekordów.
- `pobierz-siedem.mjs`, `opisz-przeglad-siedmiu.mjs` — archiwum i raport przeglądu siedmiu wskazanych zmian.
- `pobierz-probe20.mjs`, `opisz-probe20.mjs` — dobór, archiwum i raport próby 20 uzupełnionych lokalizacji.
- `pobierz-propozycje01.mjs`, `przyjmij-propozycje01.mjs` — pierwsza partia 20 propozycji: 19 przyjętych i 1 nierozstrzygnięta.
- `pobierz-propozycje01.mjs --batch=02`, `przyjmij-propozycje02.mjs` — druga partia: 20 przyjętych punktów, w tym 2 rekordy nadal do kontroli kodu pocztowego. Dobór pomija już przejrzane propozycje.
- `weryfikacja-biedronki/` — odpowiedzi źródeł, raporty i pliki CSV do przeglądu.
- `gotowe/sklepy.json` — sklepy, które przeszły opisane kontrole automatyczne.
- `do-weryfikacji/sklepy.json` — zachowane rekordy wymagające sprawdzenia, z kodami problemów.
- `raport-przygotowania.json` — aktualna liczebność, wykluczenia i przyczyny weryfikacji.
- `raport-jakosci.json` — archiwalny raport pierwszego przeglądu źródeł.

## Uruchamianie

W PowerShell, z katalogu głównego repozytorium `Projekt_zespolowy_2026-2027`:

```powershell
node .\dane-sklepow\przygotuj-dane.mjs
node .\dane-sklepow\przygotuj-dane.mjs --check
node --test .\dane-sklepow\przygotuj-dane.test.mjs .\dane-sklepow\poprawki.test.mjs .\dane-sklepow\przeglad.test.mjs .\dane-sklepow\sprawdzone-poprawki.test.mjs
```

Można też podać pełną ścieżkę skryptu z innego katalogu.
Wszystkie ścieżki danych są ustalane względem skryptu, a nie katalogu terminala.
Skrypt działa bez internetu i bez dodatkowych bibliotek.
Opcja `--check` sprawdza istniejące wyniki bez ich zapisywania.

Zwykłe uruchomienie odtwarza trzy pliki wynikowe. Oryginały i manifest pozostają bez zmian.
Jeżeli istnieje `poprawki/biedronka.json`, skrypt sprawdza dowody i nakłada zawarte tam poprawki.
Dołącza również `poprawki/biedronka-zweryfikowane.json`, jeżeli istnieje. Partie nie mogą
nadpisywać tych samych ID ani dotyczyć różnych migawek. Ponowne dopasowanie automatyczne
nie usuwa pliku poprawek przyjętych po przeglądzie.
Wyniki mają wspólną datę wygenerowania oraz odcisk źródeł i filtrów.
Zapisy są przygotowywane w plikach tymczasowych przed zastąpieniem wyników.
Jeśli zapis całego kompletu zostanie przerwany, `--check` wykryje niespójność;
wtedy należy ponowić generowanie.

## Zakres publikacji

Mapa publikuje Lidl, Biedronkę, Dino, Kaufland i hipermarkety Carrefour. Pierwotna migawka obejmuje także Auchan i służy do odtworzenia wcześniejszych kontroli.

- Kaufland. Oficjalny lokalizator pobrany 23 listopada 2026 zwrócił 264 punkty ze współrzędnymi i ID. Lista regulaminowa zawierała 262 pozycje i rozbieżności w adresach. Publikacja używa adresu i współrzędnych z tego samego rekordu lokalizatora. [Lokalizator](https://sklep.kaufland.pl/.klstorefinder.json) · [Lista adresowa](https://sklep.kaufland.pl/regulaminy/lista-sklepow.html)
- Carrefour. Oficjalny widok z wybranym formatem pokazywał 92 wyniki w dostępnej kopii. Bezpośrednie pobranie dało HTTP 403. Do publikacji użyto migawki AllThePlaces z 14 listopada 2026, zebranej z oficjalnej listy Carrefour. Z 641 wpisów przechodzi 93 z dokładną marką `Carrefour`. W tym źródle Market, Express i Globi mają osobne wartości marki. Różnica 92/93 pozostaje do potwierdzenia na bieżącej oficjalnej liście. [Oficjalny filtr](https://www.carrefour.pl/sklepy?should=carrefour) · [Kod klasyfikacji AllThePlaces](https://github.com/alltheplaces/alltheplaces/blob/master/locations/spiders/carrefour_pl.py)

| Sieć | Gotowe | Do weryfikacji | Aliasy | Razem |
| --- | ---: | ---: | ---: | ---: |
| Lidl | 1014 | 0 | 0 | 1014 |
| Biedronka | 3859 | 0 | 3 | 3862 |
| Dino | 3315 | 0 | 0 | 3315 |
| Kaufland | 264 | 0 | 0 | 264 |
| Carrefour (hipermarkety) | 93 | 0 | 0 | 93 |
| **Razem** | **8545** | **0** | **3** | **8548** |

### Aktualizacja Biedronki 23 listopada 2026

Migawka AllThePlaces z 14 listopada zawiera 3862 rekordy, o cztery więcej niż poprzedni katalog. W porównaniu po identyfikatorach nie zniknęła żadna pozycja. Dawny adres API lokalizatora dla Warszawy zwrócił 404. Aktualne adresy sprawdzono na indywidualnych stronach sklepów. [Lokalizator](https://www.biedronka.pl/pl/sklepy)

- **7961**, Zgorzelec, Łużycka 108. Dodano punkt z migawki, a adres potwierdzono w źródle oficjalnym. [Placówka 7961](https://www.biedronka.pl/pl/shop,id,7961)
- **7958** w Borowej i **7962** w Andrychowie mają potwierdzone adresy. Nadal wymagają współrzędnych. [Placówka 7958](https://www.biedronka.pl/pl/shop,id,7958) · [Placówka 7962](https://www.biedronka.pl/pl/shop,id,7962)
- **7953** w Lubinie ma ten sam adres co **2518**. Pozostaje do weryfikacji jako możliwy duplikat. [Placówka 7953](https://www.biedronka.pl/pl/shop,id,7953) · [Placówka 2518](https://www.biedronka.pl/pl/shop,id,2518)
- Oficjalne strony potwierdziły zmiany adresu dla **780, 3695, 7796 i 2459**. Nowsza migawka nie podaje dla nich punktów, więc wszystkie cztery rekordy wymagają potwierdzenia współrzędnych. [780](https://www.biedronka.pl/pl/shop,id,780) · [3695](https://www.biedronka.pl/pl/shop,id,3695) · [7796](https://www.biedronka.pl/pl/shop,id,7796) · [2459](https://www.biedronka.pl/pl/shop,id,2459)
- Dla **3525** nowsza migawka wskazuje Dziećmorowice, a oficjalna karta nadal podaje Orzesze. Zachowano dotychczasowy adres. [Placówka 3525](https://www.biedronka.pl/pl/shop,id,3525)

### Weryfikacja wszystkich 586 rekordów Biedronki

Oficjalne API zwróciło HTTP 200 dla 413 miejscowości. Zestawiono dane wszystkich 586 sklepów z migawką OSM z 23 listopada 2026. Opublikowano cztery punkty z niepowtarzalnym dopasowaniem do adresu potwierdzonego przez sieć. W 559 rekordach z dopasowanym adresem oficjalne API nie podało współrzędnych, 14 miało niepełny lub różniący się adres, a 13 miało współrzędne z inną nierozwiązaną wątpliwością. Dane OSM odpowiadają za opublikowane współrzędne. [Decyzje dla 586 wpisów](weryfikacja-biedronki/przeglad-586/raport.json) · [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

Odtworzenie raportu z zapisanych odpowiedzi: `node dane-sklepow/sprawdz-biedronke-586.mjs` z katalogu repozytorium.

### Weryfikacja 582 pozostałych adresów w Geoportalu

23 listopada 2026 sprawdzono 582 rekordy. Dodano 186 punktów adresowych z Uniwersalnej Usługi Geokodowania GUGiK. Publikacja wymaga zgodności miejscowości, ulicy, numeru i kodu pocztowego z adresem Biedronki oraz braku konfliktu z inną placówką lub danymi OSM. Dla adresów bez ulicy, które funkcjonują jako numeracja miejscowości, wymagano zgodności tej numeracji. Punkt oznacza położenie oficjalnego adresu. Współrzędne przeliczono z EPSG:2180 do EPSG:4326. [Raport per placówka](weryfikacja-biedronki/przeglad-582/raport.json) · [Dokumentacja UUG](https://services.gugik.gov.pl/uug/)

Pozostało 396 pozycji. Dla 380 nie było dokładnego dopasowania, dziewięć ma niepełne dane adresowe, cztery zapytania nie zwróciły danych, a trzy przypadki pozostają zablokowane przez niejednoznaczność lub konflikt.

Raport można odtworzyć z zapisanych odpowiedzi poleceniem `python dane-sklepow/weryfikacja-biedronki/przeglad-582/porownaj-adresy.py dane-sklepow/weryfikacja-biedronki/przeglad-582/obserwacje.json 2026-11-23`. Wymaga zainstalowanego `pyproj`.

### Weryfikacja 396 adresów z różnym zapisem nazw

Porównano adresy wszystkich 396 placówek z Geoportalem. Ujednolicono skróty miejscowości i ulic, rozwinięto zgodne inicjały oraz imiona patronów, a 40 zapytań ponowiono po poprawieniu formatu. Wymagano zgodności numeru i kodu pocztowego oraz jednego wyniku bez konfliktu z punktem już na mapie. W Posmykowiźnie i Zwoleniu punkty potwierdzają także obiekty OSM z identyfikatorem placówki. Opublikowano 93 punkty adresowe. [Raport wszystkich 396 wpisów](weryfikacja-biedronki/przeglad-396/raport.json) · [Posmykowizna](https://www.openstreetmap.org/node/12601625065) · [Zwoleń](https://www.openstreetmap.org/way/1365054133)

Do weryfikacji pozostały 303 rekordy. 267 wciąż nie ma jednoznacznego dopasowania do oficjalnego adresu, 19 ma rozbieżność między adresem w katalogu a bieżącą odpowiedzią Biedronki, dziewięć ma niepełny adres, cztery zapytania pozostały bez użytecznej odpowiedzi, a cztery rekordy mają konflikt lub niejednoznaczność.

Odtworzenie: `python dane-sklepow/weryfikacja-biedronki/przeglad-582/porownaj-adresy.py dane-sklepow/weryfikacja-biedronki/przeglad-396/obserwacje.json 2026-11-23 --pozostale`.

### Numeracja miejscowości i rozbieżne kody pocztowe

Przegląd 303 pozostałych rekordów potwierdził 25 punktów. W 19 przypadkach Geoportal wskazał numerację miejscowości, którą katalog zapisał z nazwą w polu ulicy. Jeden adres w Ćwiklicach udało się dopasować po oddzieleniu numeru od nazwy ulicy. W pięciu przypadkach punkt sklepu z OSM potwierdził położenie mimo różnicy w kodzie pocztowym między źródłami. W raporcie zachowano oba kody. Sprawdzono także numery złożone, dla których nadal brakuje jednoznacznego potwierdzenia. [Raport 303 rekordów](weryfikacja-biedronki/przeglad-303/raport.json)

Odtworzenie: `python dane-sklepow/weryfikacja-biedronki/przeglad-303/porownaj-punkty.py 2026-11-23` z zainstalowanym `pyproj`.

### Potwierdzenie punktów mimo rozbieżnego kodu pocztowego

Wśród 278 rekordów pozostało 16 rozbieżności kodu pocztowego przy zgodnej miejscowości, ulicy i numerze. Dla tych 16 sprawdzono indywidualne karty Biedronki i porównano adres z obiektami sklepów w OSM. Jednoznaczny obiekt przy adresie potwierdził położenie 11 placówek. W Kraczkowej wykorzystano także geometrię budynku pobraną bezpośrednio z OSM. Oba kody pozostały w raporcie. Pięć tych rozbieżności nadal wymaga potwierdzenia. [Raport przeglądu](weryfikacja-biedronki/przeglad-278/raport.json) · [Sklep w Kraczkowej](https://www.openstreetmap.org/way/256289347)

Odtworzenie: `python dane-sklepow/weryfikacja-biedronki/przeglad-278/porownaj-kody.py 2026-11-23` z zainstalowanym `pyproj`.

### Potwierdzenie punktów z pełną nazwą ulicy w OSM

Dla 267 pozostałych rekordów sprawdzono dostępne kandydatury w OSM. W 65 przypadkach znaleziono dane pozwalające wysłać zapytanie do Geoportalu pełną nazwą ulicy. W 27 przypadkach adres Biedronki, adres z Geoportalu i punkt sklepu OSM były zgodne po rozwinięciu tytułów i inicjałów. Zaakceptowano współrzędne sklepu z OSM. W raporcie zapisano adres rejestrowy, odległość między punktami i źródła dla każdej przyjętej placówki. [Raport 267 rekordów](weryfikacja-biedronki/przeglad-267/raport.json)

Odtworzenie: `python dane-sklepow/weryfikacja-biedronki/przeglad-267/porownaj-ulice.py 2026-11-23` z zainstalowanym `pyproj`.

### Porównanie 240 rekordów z Overture Maps

Wydanie Places 2026-11-18.0 zwróciło 3838 kandydatów w polskim prostokącie. Przyjęto 161 punktów sklepów z Overture po potwierdzeniu adresu w danych Biedronki i sprawdzeniu powtórzeń. Osobno potwierdzono Gnojnik 528 z adresem rejestrowym i współrzędnymi oficjalnego API. Dane Places pochodzą m.in. z Meta, Microsoft i Foursquare. Zachowano licencje przy rekordach źródłowych. [Wyniki](weryfikacja-biedronki/przeglad-240/raport.json) · [Overture Maps Foundation, źródła i licencje](https://docs.overturemaps.org/attribution/)

### Korekty adresów po zestawieniu z Overture

Z 78 dalszych wpisów potwierdzono 12. Pięć punktów adresowych, w Łobzie, Niemczu, Szprotawie, Bierawie i Krasnem, potwierdzają niezależne opisy placówek i Geoportal. Sześć kolejnych punktów potwierdzono dzięki zgodności współrzędnych Overture z rejestrem adresowym po sprawdzeniu różnic zapisu. Dla rozbieżnego numeru w Dąbrowie Górniczej wykorzystano także obiekt sklepu w OSM. Dwa wpisy mają ten sam adres co już opublikowane punkty w Andrychowie i Lubinie. W Łazach API podało identyczny adres, współrzędne i identyfikator lokalizacji dla dwóch wpisów. Overture potwierdza jeden sklep. Publikujemy jedną pinezkę i zapisujemy drugi identyfikator jako alias. [Raport 78 wpisów](weryfikacja-biedronki/przeglad-78/raport.json)

Odtworzenie raportów z zapisanych danych wymaga `pyproj`. Uruchom `python dane-sklepow/weryfikacja-biedronki/przeglad-240/porownaj-overture.py 2026-11-23` oraz `python dane-sklepow/weryfikacja-biedronki/przeglad-78/porownaj-dowody.py 2026-11-23`.

### Weryfikacja 66 adresów i zamknięcie powtórzonych wpisów

Potwierdzono 20 placówek. Dziewięć punktów adresowych pochodzi z Geoportalu po doprecyzowaniu adresu na podstawie publicznych kart sklepów. Jedenaście punktów sklepów w OSM potwierdziły karty konkretnych adresów. Przy porównaniu odrzucono m.in. obiekt OSM z innym identyfikatorem Biedronki i kandydata z odnośnikiem do innej sieci. Sprawdzono również publiczne punkty InPost w 62 miejscowościach.

W Łazach i Lubinie wpisy mają to samo położenie i identyfikator lokalizacji w API Biedronki. W Andrychowie pełny adres obu wpisów jest taki sam i potwierdza go punkt InPost opisany jako znajdujący się przy markecie. Zachowano istniejące identyfikatory punktów na mapie, a trzy powiązane wpisy przeniesiono z kolejki do pola `duplicate_records` w pliku `do-weryfikacji/sklepy.json`. Trzy źródłowe wpisy pozostają policzone w łącznej liczbie rekordów. [Raport wszystkich 66 wpisów](weryfikacja-biedronki/przeglad-66/raport.json)

Odtworzenie: `python dane-sklepow/weryfikacja-biedronki/przeglad-66/porownaj-wpisy.py 2026-11-23` z zainstalowanym `pyproj`.

## Zakres pierwotnej migawki

- Kraj: `addr:country = PL`, w szczególności dla międzynarodowego zbioru Lidla.
- Auchan: wyłącznie `brand = Auchan Super` lub `brand = Auchan Hiper`.
- Auchan Easy, Auchan Moje i ATAC są poza zakresem.

Analizowany stan źródeł zawiera po tych filtrach **8333 rekordy**:
Lidl 1014, Biedronka 3858, Dino 3315 i Auchan 146.
Aktualny podział na gotowe i wymagające weryfikacji znajduje się w `raport-przygotowania.json`.

Dla zapisanej migawki źródeł zastosowano 227 udokumentowanych poprawek (188 automatycznych i 39 po przeglądzie) oraz decyzje kontroli.

Przed poprawkami podział wynosił 7530 gotowych i 803 do weryfikacji.
Pierwsza próba dała 6 poprawek; rozszerzony przebieg dodał kolejne 182.
Na etapie automatycznym uzupełniono 181 brakujących punktów, zmieniono 2 podejrzane punkty i uzupełniono 5 adresów.
Pierwsza partia przeglądu propozycji dodała 16 punktów i 3 adresy (Stopnica, Oleszyce, Opatów)
oraz poprawiła kod Mrągowa z 17-100 na 11-700. Łącznie uzupełniono 197 brakujących punktów.
Druga partia dodała 20 punktów, z czego 18 rekordów przeszło do zbioru gotowego;
Knurów 1444 i Ostrołęka 1449 mają potwierdzone lokalizacje, ale nadal wymagają
rozstrzygnięcia kodu pocztowego i pozostają w `do-weryfikacji/`. Nie zmieniono ich kodów.
Łącznie uzupełniono 217 brakujących punktów, niezależnie od końcowego statusu rekordu.
Żagań 2220 pozostaje nierozstrzygnięty: numer 9 z Targeo nie ma dokładnego wyniku w UUG;
nie zastąpiono go najbliższym numerem 14 ani numerem 6 przypisanym ładowarce.
Po porównaniu siedmiu zmian z dodatkowymi źródłami dwa rekordy (Trzebinia 2698 i Grąbków 7078)
otrzymały dodatkowy status wymagający kontroli adresu. Zachowano ich poprawki i historię,
ale znajdują się w `do-weryfikacji/`, nie w `gotowe/`.

Każdy rekord objęty zakresem trafia dokładnie do jednego zbioru wynikowego.
Skrypt nie usuwa ani nie scala automatycznie podejrzanych sklepów.
Rekordy wykluczone filtrem nadal znajdują się w oryginalnych GeoJSON.

## Format sklepu

Oba pliki `sklepy.json` zawierają metadane oraz tablicę `stores`.
Rekord ma ten sam format w obu zbiorach:

- `id` — sieć i identyfikator źródłowy;
- `chain`, `name`, `brand`, `store_format` — sieć, nazwa i format;
- `address` — pełny adres, adres uliczny, opcjonalne części i kraj;
- `location` — jawnie nazwane `latitude` i `longitude`, albo `null` przy brakującej lub nieprawidłowej geometrii;
- `website` — strona sklepu, jeżeli jest w źródle;
- `source` — identyfikatory, odwołanie do oryginalnego rekordu i data źródła;
- `quality` — status i lista powodów skierowania do weryfikacji.
- `source_review` — dla 67 sprawdzonych rekordów: wynik porównania źródeł, uwagi, data i odnośnik do raportu; `scope` wskazuje zakres potwierdzenia, np. `building_only` dla Białegostoku, `location_only_official_address_variant` dla Bydgoszczy i Gdańska, `unresolved_address` dla Żagania oraz `location_confirmed_postcode_unresolved` dla Knurowa i Ostrołęki.
- `corrections` — tylko dla poprawionych sklepów: pierwotna lokalizacja, rozwiązane problemy i dowody.

GeoJSON zapisuje punkty w kolejności [długość geograficzna, szerokość geograficzna].
Skrypt przenosi je do nazwanych pól, bez odwracania osi ani zgadywania lokalizacji.
Pełny adres jest zachowany; skrypt rozdziela części tylko wtedy, gdy pasują do jednoznacznego wzorca.

Pierwszeństwo identyfikatora ma `properties.ref`, następnie `Feature.id`.
Dino nie ma `ref`, więc korzysta z `Feature.id`. Nie gwarantujemy, że dostawca
zachowa ten identyfikator po zmianie danych. Przed wdrożeniem trwałych ulubionych
sklepów trzeba ustalić utrzymywanie tożsamości między aktualizacjami.
Powtórzone identyfikatory dostają rozróżniający sufiks i trafiają do weryfikacji.

## Kontrole jakości

Do weryfikacji trafiają rekordy z:

- brakującą albo nieprawidłową geometrią;
- punktem poza orientacyjnym prostokątem obejmującym Polskę;
- brakującą miejscowością albo adresem ulicznym;
- powtórzonym identyfikatorem w tej samej sieci;
- współrzędnymi wspólnymi z innymi rekordami tej samej sieci, z dokładnością do pięciu miejsc po przecinku;
- powtórzonym adresem ulicznym w tej samej miejscowości i sieci.

Różne sieci mogą współdzielić lokalizację, np. w centrum handlowym.
To samo zaokrąglone położenie nie przesądza o duplikacie: rekordy są zachowane do sprawdzenia.
Liczba powodów może być większa od liczby rekordów do weryfikacji,
bo sklep może mieć kilka problemów.

**Gotowe oznacza przejście tych kontroli, a nie potwierdzenie faktycznego
położenia każdego sklepu czy kompletności sieci.**

## Aktualizacja źródeł

Skrypt sprawdza SHA-256 każdego oryginału i zatrzymuje się,
jeśli plik różni się od manifestu.
Nowe pobrania trzeba świadomie zapisać wraz z nowymi metadanymi i sumami
w `zrodla.json`, a potem ponowić przygotowanie i przejrzeć raport.
Skrypt nie pobiera danych ani nie uzupełnia braków z innych serwisów.

Zapisany stan pochodzi ze zbiorów z 24–27 października 2026.
Daty źródeł nie zawierają strefy czasowej i są zachowane w oryginalnej formie.
Daty wygenerowania wyników mają oznaczenie UTC.
Adresy `latest` mogą zwracać nowsze pliki; lokalne kopie zachowują analizowany stan.

## Rozszerzona weryfikacja Biedronki

Odczytano oficjalne API dla 551 miejscowości i porównano wszystkie 803 pierwotnie
problematyczne rekordy po identyfikatorze sklepu. API nie dostarczyło nowych współrzędnych
ani pełnych ulic dla rekordów z brakującym adresem. Cztery różnice w zapisie adresów
pozostawiono do kontroli, w tym Obra: numer 15 w API wobec 15B w migawce.

Zapisano 16 odpowiedzi OSM, dających po scaleniu 3867 unikalnych obiektów.
Pobrano pełne odpowiedzi dla wszystkich dziewięciu prostokątów obejmujących Polskę;
dwa zapytania wymagały podziału na mniejsze obszary. To pokrycie zapytań, a nie gwarancja
kompletności sklepów w OSM. Wcześniejsza mała próba i odpowiedzi błędów są zachowane.

Reguły przyjęcia oraz szczegóły przeglądu opisano w `weryfikacja-biedronki/README.md`.
Najważniejsze pliki:

- `weryfikacja-biedronki/podsumowanie.json` — liczby, zakres i wyniki kontroli.
- `weryfikacja-biedronki/przyjete-poprawki.csv` — 227 zmian ze statusem bieżącym; 4 rekordy z poprawkami wstrzymane po przeglądzie.
- `weryfikacja-biedronki/pozostale-do-sprawdzenia.csv` — 580 pozostałych sklepów; 131 ma sugestie OSM, w tym nierozstrzygnięty Żagań.
- `weryfikacja-biedronki/kolejne-propozycje.csv` — 130 propozycji jeszcze nieobjętych przeglądem.
- `weryfikacja-biedronki/propozycje-01/README.md` — raport decyzji dla pierwszej partii 20 propozycji.
- `weryfikacja-biedronki/propozycje-02/README.md` — druga partia oraz dwa przypadki przyjętych punktów z nierozstrzygniętym kodem pocztowym.
- `weryfikacja-biedronki/przeglad-siedmiu/README.md` — szczegółowy wynik przeglądu: 5 potwierdzonych i 2 do kontroli.
- `weryfikacja-biedronki/proba-20/README.md` — celowa próba 20 uzupełnionych lokalizacji: 19 blisko dokładnego punktu adresowego oraz 1 we właściwej galerii handlowej.
- `weryfikacja-biedronki/mozliwe-duplikaty.json` — dwa wpisy z Łaz, zachowane osobno z propozycją postępowania.

CSV mają separator średnikowy i UTF-8 z BOM. Kilka propozycji dla sklepu daje kilka
wierszy z tym samym ID. Sugestie nie są zastosowanymi poprawkami, a ich ranking nie jest
prawdopodobieństwem. Pozostałe problemy obejmują 556 brakujących punktów, 9 brakujących
adresów, 9 podejrzanych punktów oraz 2 możliwe duplikaty. Te dwa duplikaty mają również
ostrzeżenie wspólnych współrzędnych, więc nie należy ponownie dodawać ich do sumy.
Pięć rekordów ma uwagi o konflikcie adresu z przeglądu: Trzebinia, Grąbków, Żagań,
Knurów i Ostrołęka.
Żagań ma także brak adresu ulicznego, więc nie należy sumować tych przyczyn jako odrębnych sklepów.

Próba 20 obejmuje wszystkie 5 dopasowań wariantu ulicy, minimum 3 prefiksy ulic,
5 węzłów OSM i 3 adresy z numeracją miejscowości, z rozproszeniem geograficznym.
Nie dała podstaw do nowych wstrzymań. To próba celowa; nie określa odsetka błędów
we wszystkich 181 uzupełnionych lokalizacjach. Białystok potwierdzono na poziomie galerii,
bez wskazania wejścia ani dokładnego lokalu. Rozbieżność kodu UUG opisano w raporcie;
zachowano 15-277 podawane przez Biedronkę i zarządcę centrum.

Po zmianie zapisanych danych OSM lub konfiguracji trzeba wykonać kolejno:

```powershell
node .\dane-sklepow\dopasuj-biedronke.mjs
node .\dane-sklepow\przygotuj-dane.mjs
node .\dane-sklepow\przygotuj-dane.mjs --check
```

Następnie `node .\dane-sklepow\podsumuj-weryfikacje.mjs` odtwarza raport i aktualne CSV oraz sprawdza kompletność ID.
Przygotowanie danych nakłada `decyzje-przegladu.json` po poprawkach automatycznych;
kontroluje zgodność pierwotnej migawki, oczekiwanego punktu i adresu oraz SHA-256 dowodów.
Zmiana przeglądu wymaga ponownego generowania wyników. Skanowanie automatyczne samo
nie usuwa decyzji wstrzymującej dany rekord.

Nałożenie poprawki wymaga zgodności migawki All the Places, pierwotnego adresu i punktu,
sum kontrolnych dowodów oraz współrzędnych wskazanego obiektu OSM.
Ostrzeżenia niepoprawionych rekordów są zachowane nawet wtedy, gdy po poprawieniu
innego sklepu znika wcześniejsza para identycznych punktów.

Pozycje pochodzą z punktów OSM lub pola `center` Overpass dla obszarów, co jest zapisane
w dowodach. Nie są weryfikacją wejścia do sklepu ani potwierdzeniem jego otwarcia.
Poprawki zawierają oznaczenie **© OpenStreetMap contributors**, licencję **ODbL-1.0**
oraz odnośnik do https://www.openstreetmap.org/copyright.

Narzędzia przygotowania danych nie zmieniają kodu aplikacji. Mapa korzysta z gotowego katalogu udostępnianego przez serwer w `smart_cart/server/`.

### Przegląd 43 pozostałych Biedronek

Sprawdzono karty sieci dla 43 wpisów. Dodano 9 punktów na podstawie obiektów OpenStreetMap porównanych z adresami w rejestrze GUGiK, komunikatami sieci lub innymi źródłami wskazanymi w raporcie. Pozostałe 34 wpisy pozostają w kolejce weryfikacji. [Raport wszystkich 43 wpisów](weryfikacja-biedronki/przeglad-43/raport.json)

### Ponowna weryfikacja 34 wpisów Biedronki

Do katalogu dodano 15 punktów i pozostawiono 19 wpisów do weryfikacji. Raport zawiera wynik dla każdego wpisu, zapytania do rejestru i wykorzystane źródła. W trzech przypadkach współrzędne pochodzą z dokładnego punktu adresowego GUGiK. [Raport weryfikacji](weryfikacja-biedronki/przeglad-34/raport.json)

### Przegląd 19 pozostałych wpisów Biedronki

Dodano 9 punktów, w tym 2 dokładne punkty adresowe z rejestru GUGiK. Dla 10 wpisów dostępne źródła nadal nie rozstrzygają numeru, statusu placówki lub położenia. [Raport weryfikacji](weryfikacja-biedronki/przeglad-19/raport.json)

### Przegląd 10 pozostałych adresów Biedronki

Porównano adresy z punktami dojazdu, obrysami budynków, ortofotomapą GUGiK i lokalizacjami automatów paczkowych. Dodano 5 punktów. [Raport weryfikacji](weryfikacja-biedronki/przeglad-10/raport.json)

### Przegląd 5 ostatnich wpisów Biedronki

Dodano punkty w Tuszynie, Gorzowie Wielkopolskim i Paproci. Do weryfikacji pozostały Lubowidz oraz Łomnica. [Raport weryfikacji](weryfikacja-biedronki/przeglad-5/raport.json)

### Weryfikacja Lubowidza i Łomnicy

Do katalogu dodano Biedronkę w Lubowidzu przy Jana Pawła II 1A. Punkt wyznaczono ze środka budynku handlowego w ewidencji powiatu żuromińskiego. W kolejce pozostaje Łomnica, gdzie źródła obu sieci wskazują Widokową 2. [Raport weryfikacji](weryfikacja-biedronki/przeglad-2/raport.json)

### Weryfikacja Łomnicy

Dodano Biedronkę przy Widokowej 2 w Łomnicy po porównaniu aktualnych lokalizatorów sieci, obrysu w OpenStreetMap i adresu automatu InPost przy sklepie. Kolejka weryfikacji jest pusta. [Raport weryfikacji](weryfikacja-biedronki/przeglad-lomnicy/raport.json)
