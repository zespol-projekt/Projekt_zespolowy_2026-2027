# Wdrożenie ustaleń po audycie — 14 listopada 2026

Kod realizuje 17 ustaleń [ankiety](plan-napraw-po-ankiecie.md). Pięć migracji zostały zastosowane do wspólnego projektu Supabase `smart-koszyk`. [Pierwotny audyt](stan-projektu.md) dokumentuje stan przed tym wdrożeniem.

## Zmiany w aplikacji

- Produkty: wyszukiwanie grup, rozwijanie ofert sieci, wybór potrzebnej ilości, dodanie najtańszego odpowiednika albo konkretnego produktu. Wyszukiwanie w nagłówku otwiera ten ekran z podanym zapytaniem.
- Koszyk: wiele nazwanych list zapisanych na koncie, zmiana nazwy, usuwanie z potwierdzeniem, dodawanie i usuwanie pozycji, zmiana ilości oraz przypięcie konkretnego produktu. Powtórne dodanie grupy atomowo zwiększa jej ilość. Przy braku listy powstaje „Zakupy”.
- Porównanie: pełne opakowania, także kombinacje różnych rozmiarów; produkty luzem według masy. Dodatkowe sztuki obniżające całkowity wydatek są osobną propozycją, wybieraną niezależnie dla każdej sieci. Zmiana ilości lub produktu usuwa wcześniejsze zgody na dodatkowe sztuki.
- Każda aktywna sieć pojawia się w wyniku. Brak choć jednej wyceny ukrywa sumę tej sieci i wyłącza ją z rankingu; dostępne pozycje nadal mają ceny.
- Ceny regularne korzystają z ostatniej znanej wartości `prawdziwa`, bez limitu wieku. Estymowane są pomijane. Interfejs pokazuje datę potwierdzenia albo jawny brak tej informacji.
- Promocje: tylko potwierdzony zasięg ogólny, rzeczywista cena promocyjna, poprawna reguła, dowód HTTPS oraz ważne daty. Obsługiwane reguły to cena jednostkowa, minimalna liczba opakowań i pakiet za określoną sumę; znany limit liczby rabatowanych sztuk jest respektowany. Wymaganie karty i aktywacji jest widoczne także przy propozycji dodatkowego zakupu. Nie potwierdzamy wcześniejszego wykorzystania limitu przez klienta.
- Ulubione: prywatne grupy produktów zapisane na koncie, dostępne również po ponownym zalogowaniu i na innym urządzeniu.
- Dane pobieramy ponownie po wejściu na listy/ulubione albo przyciskiem odświeżenia. Nie ma synchronizacji w czasie rzeczywistym ani scalania równoczesnych edycji offline.
- Logowanie: powrót do zamierzonego ekranu, zachowanie nawigacji przy zmianie/odświeżeniu sesji, wyczyszczenie celu przy jawnym wylogowaniu. Formularze znajdują się w `src/features/auth/AuthScreen.tsx`.
- Formularze: działająca zmiana adresu, wynik ponownej wysyłki, odliczanie 60 s osobno dla adresu i procesu, blokowanie duplikatów, anulowanie i odrzucanie spóźnionych odpowiedzi. Powrót z recovery czyści sekrety i kończy sesję odzyskiwania. Błąd wylogowania może być pokazany także po przejściu do formularza.
- Klient katalogu ma limit czasu, przerwanie przy zmianie sesji i jedno ponowienie po 401. Odpowiedź poprzedniej listy lub sesji nie jest prezentowana jako wynik nowego zapytania. Żądania SDK Auth mają ograniczony czas pojedynczego transportu.
- Ustawienia opisują rzeczywiste zasady wyceny. Mapa służy do znajdowania placówek, a ceny są danymi sieciowymi. Diagnostyka odróżnia niedostępność serwera mapy, błędny katalog i problemy połączenia.

## Baza i wdrożenie

Migracje w `supabase/migrations`:

1. `20261114000100_catalog_and_private_lists.sql` — grupy porównania, metadane, zachowawcza klasyfikacja, prywatne listy i ulubione, RLS oraz ograniczenie uprawnień katalogu.
2. `20261114000200_search_and_basket.sql` — poprawione wyszukiwanie, widoki, kontrakt JSON porównania i atomowe dodawanie pozycji.
3. `20261114000300_group_priority_and_promotion_validation.sql` — priorytet grup ogólnych nad pojedynczymi produktami, odrzucanie sprzecznych reguł i ochrona przed interpretowaniem kilogramów jako liczby opakowań w promocji.
4. `20261114000400_precise_product_variants.sql` — rozdzielenie wariantów kozich/owczych i ekologicznych oraz odrzucanie mieszanek i przetworzonych wariantów z grup podstawowych produktów.
5. `20261114000500_utf8_group_labels.sql` — stabilne polskie nazwy/klucze, ponowienie automatycznej klasyfikacji i pomijanie nieużywanych grup w wyszukiwaniu. Naprawia też kodowanie etykiet ujawnione przy zdalnej kontroli po poprzedniej migracji.

Katalog jest czytelny wyłącznie dla zalogowanych, potwierdzonych, nieanonimowych kont. Użytkownicy nie mogą go zapisywać ani wykonywać `TRUNCATE`. Właściciel listy/ulubionych wynika z `auth.uid()`; inne konto nie ma dostępu. Widoki działają jako wywołujący, a nowe funkcje mają jawne uprawnienia.

Dotychczasowe produkty, oferty i historia cen zostały zachowane. Stara sygnatura `compare_basket(integer[],boolean,boolean)` została zastąpiona przez `compare_basket(p_items jsonb)`; starsze klienty muszą używać nowego kontraktu. Aktualny [eksport schematu](../supabase-schema.sql) zawiera stan po pięciu migracjach. Szczegóły: [kontekst bazy](database-context.md).

Pracujemy ze wspólną bazą w chmurze. Konfiguracja lokalnego CLI ma zgodne podstawowe parametry haseł/kodów, ale nie jest eksportem ustawień chmury i nie służy do ich automatycznego nadpisania. Testy SQL używały wyłącznie osobnego, tymczasowego kontenera Postgres 17; nie uruchamiano dodatkowego lokalnego Auth.

## Potwierdzone wyniki

| Kontrola | Wynik |
| --- | --- |
| Testy Node aplikacji | 89/89 |
| Playwright / Chrome, fikcyjne sesje i transport | 20/20, w tym stare 17 przypadków oraz listy, edycja i anulowanie logowania |
| TypeScript i ESLint | Zaliczone, bez błędów i ostrzeżeń lint |
| Testy SQL / Postgres 17 | Zaliczone: kombinacje opakowań, masa, progi i limity promocji, aktywacja, wariant dodatkowy, brak sumy niepełnej sieci, estymaty, wyszukiwanie, atomowe dodawanie, właściciel/inne konto/gość/niepotwierdzone konto, różne marki tego samego mleka, laktoza, masło kozie, mieszanka ryżu i polskie klucze grup |
| Klasyfikacja rzeczywistych 8952 produktów w izolowanej bazie | Zaliczone, bez niepoprawnych jednostek i błędów migracji |
| Zdalne RPC po wdrożeniu | Wyszukiwanie grup, stare wyszukiwanie ofert i porównanie 1000 ml mleka UHT 3,2% wykonują się poprawnie dla pięciu sieci |
| Publiczne REST bez sesji | Produkty, listy i wyszukiwanie: odmowa HTTP 401 |
| Zdalne uprawnienia | Brak odczytu katalogu dla `anon`, brak zapisu i `TRUNCATE` dla `authenticated` |
| Eksport Expo WWW / Android / iOS | Wszystkie trzy pakiety zbudowane w `.expo/final-export` |
| Dane mapy | 37/37 testów, kontrola 7753 gotowych / 580 do weryfikacji |
| `npm audit` po aktualizacji zgodnych zależności | 0 podatności; poprawka `minimatch@10` przez override 11.0.1 |

Powód override: [advisory autora minimatch](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249). Zachowano Expo SDK 58; zainstalowana poprawka Expo to 58.0.25. Nie zastosowano sugerowanego przez npm downgrade do SDK 52. Node 24 nadal może wypisywać informację `MODULE_TYPELESS_PACKAGE_JSON`; nie wpływa ona na wyniki testów.

Testy przeglądarkowe nie wysyłają maili. Odczytowa weryfikacja chmury nie tworzyła kont ani nie zmieniała prywatnych list. Pakowanie aplikacji mobilnych nie zastępuje odbioru na fizycznym Androidzie/iOS; pełnego procesu mailowego z nowym UI i testów na fizycznych urządzeniach w tej sesji nie wykonano.

## Braki w danych, których nie uzupełniamy zgadywaniem

Zdalny odczyt po migracji: **8952 produkty, 9894 oferty, 8797 zapisanych grup (8789 z przypisanymi produktami)**, pięć aktywnych sieci: Biedronka, Carrefour, Dino, Kaufland i Lidl. Status `prawdziwa` ma 9217 ofert, a `brak` 677; nie znaleziono statusu `estymowana`.

Automatyczne precyzyjne reguły obejmują 187 produktów. Pozostałe 8765 zachowują osobne grupy konkretnego produktu. Wśród wszystkich produktów 6068 ma niepotwierdzony sposób sprzedaży; takie oferty nie biorą udziału w wycenie. 2811 produktów oznaczono jako paczkowane, a 73 jako luzem na podstawie dostępnej nazwy i jednostki. To klasyfikacja zachowawcza, wymagająca dalszego przeglądu danych źródłowych; nie oznacza ręcznej weryfikacji każdej etykiety.

Stary import nie zawierał dat obserwacji cen regularnych ani dowodów ogólnodostępności i znormalizowanych reguł promocji. Nowe pola pozostają puste/niepotwierdzone: obecnie **0 zapisanych dat obserwacji i 0 promocji dopuszczonych do automatycznego naliczenia**. Regularne potwierdzone ceny nadal mogą być używane. Nie przypisujemy im daty migracji jako daty potwierdzenia.

To ograniczenie zawartości katalogu, które może skutkować niepełnymi koszykami. Gotowy proces uzupełnienia grup, sprzedaży, dat i promocji opisuje [utrzymanie katalogu](utrzymanie-katalogu.md). Nie dostarczono kodu pierwotnego importera z rozmowy Gemini; nie powstał automatyczny, cykliczny import świeżych cen ze wszystkich sieci.

580 placówek mapy nadal wymaga weryfikacji źródeł. Nie zmieniano ich dowodów, współrzędnych ani statusów w ramach przebudowy porównywarki.
