# Dane sklepów SMARTCART

Katalog jest częścią repozytorium `Projekt_zespolowy_2026-2027`, obok katalogu `smart_cart`.
Zawiera cały zbiór, oryginały, poprawki, archiwum kontroli oraz narzędzia przygotowania danych.

Kod serwera HTTP i jego testy są w `smart_cart/server/serwer-mapy.mjs` oraz `smart_cart/tests/server.test.mjs`. Serwer uruchamia się z katalogu `smart_cart` poleceniem `npm.cmd run server`, a kontrolę danych bez uruchamiania serwera wykonuje `npm.cmd run server:check`. Domyślnie odczytuje `gotowe/sklepy.json` z tego katalogu. Można zmienić położenie danych przez `SMARTCART_DATA_DIR` w `smart_cart/.env.local`. Dane nie są importowane do pakietu Expo — aplikacja otrzymuje gotowy katalog przez API.

Pliki źródłowe i dowody mają zapisane sumy SHA-256. Główny `.gitattributes` wyłącza normalizację końców linii dla całego tego katalogu, aby Git zachował ich bajty także na Windows. Nie formatuj automatycznie źródeł, odpowiedzi JSON/HTML ani plików dowodowych.

Przed publikacją z archiwum `weryfikacja-biedronki/proba-20/stary-dzikow-zyn.html` usunięto wartość pola `TWILIO_ACCOUNT_ID` należącą do zewnętrznej strony. Zastąpiono ją znacznikiem `[REDACTED_TWILIO_ACCOUNT_ID]`. Plik `.meta.json` dokumentuje tę zmianę i sumę oryginału; sumy kontrolne w raportach oraz wynikach odpowiadają wersji oczyszczonej. Dane adresowe i decyzje przeglądu pozostały bez zmian. Przy ponownym pobieraniu archiwum należy usunąć takie identyfikatory przed publikacją.

Raporty archiwalne zachowują stan i opisy z chwili ich przygotowania. Zawarte w nich wzmianki o przechowywaniu poza repozytorium opisują wcześniejszy układ katalogów.

## Zawartość

- `surowe/` — cztery oryginalne pliki GeoJSON, bez zmian.
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

## Uzgodniony zakres

- Kraj: `addr:country = PL`, w szczególności dla międzynarodowego zbioru Lidla.
- Auchan: wyłącznie `brand = Auchan Super` lub `brand = Auchan Hiper`.
- Auchan Easy, Auchan Moje i ATAC są poza zakresem.

Analizowany stan źródeł zawiera po tych filtrach **8333 rekordy**:
Lidl 1014, Biedronka 3858, Dino 3315 i Auchan 146.
Aktualny podział na gotowe i wymagające weryfikacji znajduje się w `raport-przygotowania.json`.

Dla zapisanej migawki źródeł, po 227 udokumentowanych poprawkach (188 automatycznych i 39 po przeglądzie) oraz decyzjach kontroli:

| Sieć | Gotowe | Do weryfikacji | Razem |
| --- | ---: | ---: | ---: |
| Lidl | 1014 | 0 | 1014 |
| Biedronka | 3278 | 580 | 3858 |
| Dino | 3315 | 0 | 3315 |
| Auchan Super/Hiper | 146 | 0 | 146 |
| **Razem** | **7753** | **580** | **8333** |

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
