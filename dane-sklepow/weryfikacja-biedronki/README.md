# Weryfikacja Biedronki — 2 listopada 2026

Odpowiedzi, narzędzia i raporty są częścią katalogu `dane-sklepow` w repozytorium, obok aplikacji `smart_cart`.
Pierwotne GeoJSON nie zostały zmienione. Poprawki są odwracalne i mają zapisane dowody.

## Wynik

| Etap | Gotowe — wszystkie sieci | Biedronki do kontroli |
| --- | ---: | ---: |
| Pierwotna migawka | 7530 | 803 |
| Mała próba | 7536 | 797 |
| Rozszerzony przebieg | 7718 | 615 |
| Po przeglądzie siedmiu zmian | 7716 | 617 |
| Po pierwszej partii 20 propozycji | 7735 | 598 |
| Po drugiej partii 20 propozycji | 7753 | 580 |

Na etapie automatycznym przyjęto 188 zmian, w tym 182 nowe. Uzupełniono 181 brakujących punktów,
poprawiono 2 podejrzane punkty i uzupełniono 5 adresów. Zachowano wszystkie 8333
rekordy objęte zakresem czterech sieci. Nie scalono żadnego sklepu.
Przegląd siedmiu zmian potwierdził pięć przypadków w porównanych źródłach. Trzebinia 2698
oraz Grąbków 7078 wróciły do kontroli z powodu niejednoznacznego numeru adresowego.
Ich dane i poprawki są zachowane. Pełny raport: `przeglad-siedmiu/README.md`.

Następnie sprawdzono celową próbę 20 ze 181 uzupełnionych lokalizacji.
19 punktów leży 4–61 m od dokładnego adresu UUG, a Białystok potwierdzono na poziomie
właściwej galerii handlowej. Nie było nowych wstrzymań; na tym etapie podział wynosił 7716/617.
Na tym etapie odnotowano przegląd 27 rekordów: 25 potwierdzonych w opisanym zakresie i 2 do kontroli.
Szczegóły i ograniczenia: `proba-20/README.md`; zestawienie: `proba-20/wynik.csv`.

Pierwsza partia 20 propozycji dała 19 przyjętych zmian: 16 lokalizacji, 3 adresy uliczne
i dodatkowo poprawiony kod Mrągowa na 11-700. Żagań 2220 pozostał nierozstrzygnięty.
Raport: `propozycje-01/README.md`; zestawienie: `propozycje-01/wynik.csv`.
Po pierwszej partii przejrzanych było 47 rekordów, w tym 44 potwierdzone w opisanym zakresie i 3 do kontroli.

Druga partia dała 20 przyjętych poprawek współrzędnych. Z tego 18 rekordów przeszło
do gotowych danych, a Knurów 1444 i Ostrołęka 1449 pozostają do kontroli kodu pocztowego.
Adresów i kodów w tej partii nie zmieniono. Raport: `propozycje-02/README.md`;
zestawienie: `propozycje-02/wynik.csv`. Zapisano także odpowiedź błędu przy HTTP 200;
nie wykorzystano jej jako dowodu, a adres potwierdzono innym zapytaniem.

Łącznie przejrzano 67 rekordów: 62 potwierdzone w opisanym zakresie i 5 do kontroli.
Zachowano 227 poprawek (188 automatycznych i 39 po przeglądzie), bez zmian w surowych danych.

Pozostałe 580 rekordów obejmuje 556 braków współrzędnych, 9 braków adresu ulicznego,
9 podejrzanych punktów, 2 możliwe duplikaty i 5 konfliktów adresu z przeglądu źródeł.
Żagań ma równocześnie brak adresu i uwagę o konflikcie. Dwa duplikaty mają dodatkowo ostrzeżenie
wspólnych współrzędnych, więc raport przyczyn zawiera więcej wpisów niż rekordów.
Gotowe oznacza przejście kontroli automatycznych, a nie potwierdzenie rzeczywistego
położenia i otwarcia każdej placówki.

## Co sprawdzić

1. Otwórz `przyjete-poprawki.csv`: ID, pierwotny adres, reguła, odnośnik OSM, punkt i zmienione pola oraz bieżący status.
   Przy poprawce adresu jest także jego nowa treść. Porównaj obiekt OSM z faktyczną placówką.
2. Otwórz `pozostale-do-sprawdzenia.csv`: 580 unikalnych ID, 131 z propozycjami OSM i 4 ze wstrzymanymi poprawkami.
   Jeden sklep może mieć do trzech wierszy. Ranking pomaga sortować sugestie i nie jest
   procentem pewności. Puste pola oznaczają brak propozycji w zapisanych danych.
3. Sprawdź `mozliwe-duplikaty.json`: Łazy, Targowa 8, ID 7305 i 7339. Oba wpisy mają
   ten sam adres, punkt i oficjalny `location_id`, ale różne numery sklepu i godziny.
   Po potwierdzeniu jednej placówki można ustalić jedną tożsamość i zachować oba ID
   jako aliasy. Obecnie oba wpisy pozostają do kontroli.

CSV mają separator `;` i UTF-8 z BOM, odpowiednie do importu w Excelu.
`do-sprawdzenia.csv` zawiera wszystkie 803 decyzje, także przyjęte poprawki.
Zmiana samego CSV nie zmienia zbioru wynikowego. Decyzje i pełne dowody są w
`raport-dopasowania.json` i `../poprawki/biedronka.json`.
Nowe poprawki po przeglądzie są zapisane osobno w `../poprawki/biedronka-zweryfikowane.json`.
`kolejne-propozycje.csv` zawiera 130 jeszcze nieprzejrzanych propozycji; nierozstrzygnięty
Żagań jest w raporcie pierwszej partii i nie jest ponownie liczony jako nowa propozycja.
Knurów i Ostrołęka mają już przyjęte współrzędne; ich dalszy przegląd dotyczy kodów pocztowych.
Podsumowanie zbiera wszystkie raporty `propozycje-NN/raport.json`, a kolejne pobrania
pomijają wcześniej przejrzane ID. Dobór partii zapisuje się przed pobraniem dowodów.

## Oficjalne API

Pobrano i zapisano 551 odpowiedzi list sklepów według miejscowości. Porównano po
konkretnym ID wszystkie 803 rekordy wymagające kontroli w pierwotnej migawce;
każdy znaleziono w API. Wszystkie odpowiedzi mają status 200 i prawidłowy SHA-256.

Nie uzyskano nowych współrzędnych: 773 rekordy nadal nie miały ich w API, a pozostałe
punkty były takie same jak w migawce. Nie uzyskano też pełnej ulicy z numerem dla
rekordów z brakującym adresem. Znaleziono cztery różnice względem znormalizowanego
adresu: Żagań 2220 (`E.`), Opatów 7026 (`1`), Obra 7796 (`15` zamiast `15B`) oraz
Łomnica 7906 (końcowy przecinek). Nie zastosowano ich jako poprawek.

Szczegóły: `raport-oficjalnego-api.json`. Odpowiedzi, daty, URL i sumy kontrolne:
`pelny-przebieg/oficjalne/manifest.json` i pliki obok.
Pierwsza próba sześciu sklepów jest zachowana w `2026-11-02T17-45-17-761Z/`.
Brak zmian w API nie potwierdza poprawności punktów.

## OpenStreetMap

Scalono 16 zapisanych odpowiedzi, uzyskując 3867 unikalnych obiektów. Są to pierwotne
125 obiektów z pięciu okolic oraz odpowiedzi regionalne. Uzyskano pełne odpowiedzi
dla dziewięciu prostokątów obejmujących Polskę: siedem bez podziału i dwa po podziale
na cztery części. Obszary są zapisane w `pelny-przebieg/osm-polaczone.json`.
Pełna odpowiedź oznacza ukończone zapytanie; nie gwarantuje kompletności danych OSM.

Przy powtórzonym typie i ID obiektu wybrano wersję z nowszej migawki OSM.
`provenance` zawiera pliki składowe, SHA-256, zakres i pochodzenie każdego obiektu.
Brak dopasowania oznacza brak wyniku spełniającego reguły w zapisanych odpowiedziach.

Przyjęto:

- 178 dopasowań dokładnej ulicy i numeru, z rozwinięciem skrótów `ul.`, `al.`, `pl.`, `os.`,
  przy zgodnej miejscowości lub kodzie pocztowym i bez sprzeczności pozostałych pól;
- 5 dopasowań wariantu nazwy ulicy lub inicjału patrona, dodatkowo potwierdzonych
  identycznym ID w oficjalnym adresie strony sklepu zapisanym w OSM;
- 5 uzupełnień adresu: Trzebinia, Zaklików, Maciejowice, Drawno i Królewiec.
  Wymagano tego samego ID strony sklepu, zgodnej miejscowości, kompletnej ulicy
  i numeru oraz położenia do 75 metrów od istniejącego punktu. W Maciejowicach
  poprawiono również kod pocztowy. W Zaklikowie zastąpiono błędne pole numeru domu `DW855`.

Nie przyjmuje się budów, obiektów nieczynnych oznaczonych w danych, sprzecznych ID,
niejednoznacznych dopasowań ani katalogowych duplikatów. Jeden obiekt OSM nie może
automatycznie poprawiać kilku sklepów. Zbliżona pisownia ulicy bez dodatkowego
potwierdzenia ID pozostaje sugestią. `ref:id` OSM nie jest uznawane za identyfikator
API Biedronki; używany jest konkretny URL `/pl/shop,id,...`.

Punkty pochodzą z węzłów lub `center` Overpass dla obszarów. Nie oznaczają sprawdzonego
wejścia do sklepu. Poprawienie jednego błędnego punktu nie usuwa alarmów innych sklepów.
Powstanie nowego konfliktu adresu albo punktu zatrzymuje rekord do kontroli.

## Odtworzenie bez internetu

Z katalogu głównego repozytorium `Projekt_zespolowy_2026-2027`:

```powershell
node .\dane-sklepow\dopasuj-biedronke.mjs
node .\dane-sklepow\przygotuj-dane.mjs
node .\dane-sklepow\przygotuj-dane.mjs --check
node .\dane-sklepow\podsumuj-weryfikacje.mjs
node --test .\dane-sklepow\przygotuj-dane.test.mjs .\dane-sklepow\poprawki.test.mjs .\dane-sklepow\przeglad.test.mjs .\dane-sklepow\sprawdzone-poprawki.test.mjs
```

Podsumowanie kontroluje SHA-256, odtwarzalność wyników, zachowanie wszystkich ID,
zastosowanie wyłącznie zapisanych zmian i zachowanie sześciu poprzednich poprawek.
Testy obejmują filtrowanie, osie współrzędnych, konflikty, duplikaty, dowody i dopasowania.
Nałożenie poprawki wymaga tej samej migawki źródeł oraz tego samego pierwotnego adresu i punktu.
Przygotowanie danych nakłada także decyzje `decyzje-przegladu.json`. `--check` sprawdza
sumy dowodów i decyzje. Samo dopasowanie automatyczne nie odwołuje wstrzymania rekordu.
Aktualne CSV z bieżącymi statusami odtwarza ostatnia komenda `podsumuj-weryfikacje.mjs`.
Generatory opisów przeglądu dołączają decyzje swoich partii, zachowując pozostałe
rekordy i daty wcześniejszych ocen. Ponowne wygenerowanie raportu siedmiu nie usuwa próby 20.
Poprawki po przeglądzie wymagają przyjętej decyzji w raporcie, niezmienionych dowodów,
zgodnego pierwotnego punktu i adresu oraz zgodnej migawki. Nowe adresy są sprawdzane
z konkretnym rekordem UUG i ID sklepu; korekta kodu Mrągowa jest przypięta do wiersza
z oficjalnego PDF wraz z sumami dokumentu i wyciągu tekstowego. Reguł automatycznego
dopasowania ulic nie poszerzono.

## Pobieranie i scalanie

```powershell
node .\dane-sklepow\pobierz-biedronke.mjs
node .\dane-sklepow\pobierz-osm.mjs
node .\dane-sklepow\pobierz-osm.mjs --split-failed
node .\dane-sklepow\scal-osm.mjs
```

Narzędzia pobierające używają lokalnego archiwum i ograniczają częstotliwość zapytań.
Ponowne uruchomienie wznawia pracę z zapisanych odpowiedzi; nie wymusza ich odświeżenia.
Po scaleniu należy ponowić komendy z sekcji odtwarzania.
Samo pobranie danych nie zmienia aplikacji. Pierwotne pliki oraz poprzednia konfiguracja
i warstwa sześciu poprawek są zachowane.

Dane uzupełniające: © OpenStreetMap contributors, ODbL-1.0.
Źródło i licencja: https://www.openstreetmap.org/copyright.
