# SMARTCART

Aplikacja Expo / React Native na Androida, iOS i WWW. Ekrany: `src/app`; mapa: `src/features/stores`.

Stan po wdrożeniu **14 listopada 2026**: [zmiany, testy i ograniczenia danych](docs/wdrozenie-po-audycie.md).
Wdrożono ustalenia [ankiety](docs/plan-napraw-po-ankiecie.md): wyszukiwanie grup i ofert, prywatne nazwane listy, edycję produktów/ilości, porównanie pełnych opakowań i sprzedaży luzem oraz ulubione. Naprawiono formularze i zachowanie nawigacji przy zmianie sesji. Pięć migracji jest już we wspólnym Supabase.
[Baza produktów i cen](docs/database-context.md) jest osobna od katalogu placówek mapy. `supabase-schema.sql` odświeżono po wdrożeniu. [Utrzymanie katalogu](docs/utrzymanie-katalogu.md) opisuje migracje, eksport oraz uzupełnianie zweryfikowanych grup, dat i warunków promocji.
Źródła nie zawierają wszystkich metadanych: niepewne zamienniki pozostają osobnymi produktami, nieznany sposób sprzedaży wyłącza wycenę, a promocje bez dowodów nie są naliczane. [Audyt sprzed napraw](docs/stan-projektu.md) zachowuje historię wykrytych błędów.

## Katalog — etap 1 prac Radka

Przegląd z 20 listopada 2026 obejmuje istniejący przepływ `/products` → `GroupDetails` → `ShoppingProvider` → API list i `compare_basket`, a także `/favorites`. Zachowujemy tworzenie listy „Zakupy”, wybór aktywnej listy, atomowe dodawanie grupy lub konkretnego produktu oraz ponowne porównanie po edycji.

Po zmianie frazy katalog od razu ukrywa poprzednie wyniki i pokazuje ładowanie. Dotyczy to również 300 ms oczekiwania przed wysłaniem zapytania. Zapobiega to otwarciu starej karty i utracie komunikatu zapisu po nadejściu nowych wyników. Test w `tests/browser/shopping.spec.ts` sprawdza ten odstęp oraz opóźnioną odpowiedź; dotychczasowy scenariusz zakupowy sprawdza potwierdzenie dodania i przeliczenie koszyka.

Do kolejnego etapu potrzebne są ustalenia z Damianem. Lokalny kontrakt `search_product_groups` nie udostępnia ścieżki kategorii ani liczby różnych produktów w całej grupie. `offer_count` liczy oferty, a strona 50 wierszy `catalog_offers` nie wystarcza do rozpoznania grupy jednoelementowej. Odczyt Ulubionych pobiera tylko ID, nazwę i jednostkę grupy; domyślna ilość jest obecnie wyznaczana w aplikacji. Należy uzgodnić drzewo, pełne liczności, źródło domyślnej ilości oraz stronicowanie produktów i Ulubionych. Nie zweryfikowano w tym etapie nowych kontraktów w chmurze; lokalnie nadal jest pięć migracji z 14 listopada.

Z Filipem pozostają do uzgodnienia jedno pole wyszukiwania na ekranie Szukaj, przekazywanie parametru `q` i komponenty motywu. Obecny nagłówek i katalog wyświetlają osobne pola. Hierarchia kategorii i bezpośrednie karty pojedynczych produktów pozostają kolejnymi etapami. Część Ulubionych możliwą do wykonania na obecnym kontrakcie opisano poniżej.

Weryfikacja tego etapu: TypeScript i lint zaliczone; testy Node — 92 zaliczone, 1 pominięty z powodu braku Gitleaks; cztery testy zakupowe Playwright zaliczone. Test nawigacji przekroczył limit 45 s przy pierwszym budowaniu po odtworzeniu zależności (pobranie pakietu aplikacji zajęło około 35 s); osobne ponowienie z niezmienionym limitem zakończyło się powodzeniem w 9,6 s. Zależności odtworzono z istniejącego lockfile, bez zmiany wersji. Testy przeglądarkowe korzystały z fikcyjnego Supabase. Nie wykonywano migracji, importów ani odbioru na fizycznym telefonie.

## Ulubione — interfejs na istniejącym API

`FavoritesScreen` pokazuje zwarte wiersze `FavoriteRow`: neutralną ikonę grupy, pełną nazwę, serduszko usuwania i przycisk dodania do listy. Kliknięcie nazwy otwiera oferty bezpośrednio pod właściwą grupą; dane ofert pobierane są dopiero po rozwinięciu i korzystają z istniejącej paginacji po 50 wierszy. Widok zachowuje opisy cen i promocji z `OfferInfo`; nie wyznacza liczby różnych produktów z liczby ofert.

Dodawanie wymaga ręcznego wpisania ilości w jednostce grupy. Nie podstawiamy domyślnego litra ani kilograma, których endpoint Ulubionych nie zwraca. Użytkownik widzi docelową listę i może wybrać inną istniejącą listę; przy braku list nadal działa tworzenie „Zakupy” w `ShoppingProvider`. Dodanie grupy przekazuje `selected_product_id=null`; przy ofercie można świadomie wybrać konkretny produkt. Zapis korzysta z dotychczasowego atomowego RPC, walidacji ilości i ochrony sesji. W trakcie operacji formularz i usuwanie są zablokowane; błąd zachowuje wpisaną ilość, a sukces podaje ilość i nazwę listy.

Serduszko usuwa wyłącznie wpis `favorite_groups`, następnie odświeża widok. Nie zmienia pozycji zakupowych. Ponowne wejście odświeża dane, a zmiana sesji odcina poprzednie dane i wyniki operacji. Pusty widok prowadzi do katalogu; błędy pobierania Ulubionych, ofert i list mają ponowienie i nie są przedstawiane jako brak danych.

Zakres oczekujący na uzgodnienia: wyszukiwanie po pełnym zbiorze Ulubionych i jego stronicowanie, domyślne ilości z kontraktu, docelowe ikony oraz integracja ze wspólnym motywem Filipa. Widok korzysta z obecnych `Controls` i nie wprowadza drugiego mechanizmu motywu. API, typy wspólne, SQL i zależności nie zostały zmienione.

`tests/browser/favorites.spec.ts` sprawdza dodanie grupy i konkretnego produktu, wybór listy, ilość i jednostkę, blokadę kolejnego zapisu, błędy z ponowieniem, usunięcie bez zmiany zakupów, ponowne wejście/reload, stan serduszka w katalogu i wylogowanie podczas zapisu. Scenariusz na szerokości 320 px zapisuje zrzuty widoku zwartego i rozwiniętego do `test-results`; wszystkie dane kont i katalogu są fikcyjne.

Weryfikacja z 20 listopada 2026: sześć testów Ulubionych zaliczonych, cztery istniejące testy zakupowe zaliczone, TypeScript i lint zaliczone, Node — 92 zaliczone i jeden pominięty z powodu braku Gitleaks. Pierwsze otwarcie aplikacji przekroczyło limit testu podczas budowania; długi scenariusz dodawania i usuwania rozdzielono na dwa niezależne przypadki bez zwiększania limitu czasu. Końcowy przebieg sześciu testów Ulubionych trwał 22,5 s. Zrzuty na szerokości 320 px obejrzano; nie wykonano odbioru na fizycznym telefonie, migracji ani zapisów do wspólnej bazy.

### Dostępność Ulubionych

Szybkie dodawanie ustawia fokus w polu ilości. Enter kończy wpisywanie i zamyka klawiaturę bez zapisu; zakup nadal wymaga przycisku dodania. „Anuluj dodawanie” zamyka formularz również przy rozwiniętych ofertach i pozostawia fokus na przycisku otwierającym. Zwijanie ofert przywraca fokus do nazwy grupy. Wpisana ilość pozostaje dostępna po ponownym otwarciu. Stan rozwinięcia odpowiada widoczności formularza.

Przyciski wewnątrz wiersza korzystają z kolorów i minimalnej wysokości wspólnych `Controls`, z zawijaniem długich etykiet. Dodawanie pokazuje krótkie „Dodaj grupę” lub „Dodaj ten produkt”, zachowując pełną nazwę w etykiecie dostępności; nie powtarza długiej nazwy na całym przycisku. Wybór listy ma oznaczenie dla technologii asystujących (`aria-pressed` w WWW i stan `selected` natywnie). Dekoracyjne symbole grupy i serduszka zachowują rozmiar, a tekst użytkowy podlega skalowaniu. Wspólne pliki nawigacji i `Controls.tsx` pozostają poza tą zmianą.

Testy w `tests/browser/favorites.spec.ts` obejmują dodatkowo obsługę przez Tab, Enter i spację, przenoszenie fokusu, anulowanie, stan wyboru listy i układ 320 × 480 px z dwukrotnie większym tekstem w karcie. Sprawdzają brak poziomego przepełnienia, pole dotyku serduszka co najmniej 44 × 44 px i pełną widoczność przycisku dodania po przewinięciu. Powiększenie jest kontrolowanym testem przeglądarkowym; nie zastępuje odbioru systemowego skalowania czcionek, TalkBack/VoiceOver ani klawiatury ekranowej na telefonie. Zrzut `favorites-large-text.png` trafia do katalogu wyników testu.

Kontrole po poprawkach dostępności: TypeScript i lint zaliczone. Siedem scenariuszy Ulubionych przeszło w przebiegu zestawu, a scenariusz klawiatury przeszedł po poprawieniu semantyki WWW w osobnym uruchomieniu. Próba z zimnym pakietem przekroczyła limit przy pierwszym otwieraniu strony; limitów i oczekiwań dotyczących zachowania nie osłabiano. Stan rozwinięcia jest przekazywany jawnie przez `aria-expanded`, ponieważ użyta wersja WWW nie przenosiła go z samego `accessibilityState`.

Po skróceniu widocznych napisów końcowe kontrole TypeScript i lint ponownie przeszły. Oba nowe scenariusze (klawiatura oraz większy tekst) zaliczono razem w 39,8 s; zrzut końcowego widoku z większym tekstem obejrzano.

## Katalog v1 — frontend przygotowany do odbioru API

Na podstawie przekazanego przez Damiana dokumentu `api-katalogu.md` z 21 listopada przygotowano katalog pod `/products?catalog=1`, dostępny przez „Otwórz katalog kategorii” w dotychczasowych Produktach. Wariant korzysta z istniejącej chronionej trasy `/products`, bez rozszerzania kontraktu nawigacji logowania. Ekran używa wyłącznie opisanych `catalog_tree`, `catalog_branch`, `catalog_search`, `catalog_group` i `catalog_product`. Brak funkcji lub niezgodna odpowiedź daje jawny błąd z ponowieniem, bez podstawiania danych demonstracyjnych. Aktualny stan wdrożenia tych funkcji w chmurze nie został zweryfikowany; w tej kopii nadal brakuje wskazanej migracji `20261122000100_catalog_api.sql` i testu SQL Damiana.

`catalogV1.ts` zawiera osobne typy i walidację odpowiedzi v1; `catalogV1Api.ts` korzysta z istniejącego klienta sesji, ograniczenia czasu, anulowania i ponowienia po 401. Drzewo zachowuje kolejność z API, ścieżkę kategorii i status porządkowania danych. Nawigacja odbywa się przez Expo Router, a niesynchronizowane szkice ilości są trzymane wyłącznie w pamięci sekcji Produkty i kasowane przy zmianie sesji. Listy zakupów nadal mają jedno źródło w `ShoppingProvider`.

Wyszukiwanie obejmuje cały katalog, także przy otwartej gałęzi, przyjmuje początkową frazę `q`, ma 300 ms opóźnienia i nie udostępnia starych wyników podczas zmiany frazy. Paginacja korzysta z `total`, `limit` i `offset`; liczby produktów i sieci pochodzą z pełnych liczności API. Grupy rozwijają produkty z przypisanymi ofertami, a element `kind: "product"` od razu pobiera i pokazuje jego ceny sieci. Ceny „od” są jednostkowe, brak ceny pozostaje brakiem. Reguły promocji nadal wycenia backend.

Dodawanie do istniejącej listy wymaga ręcznego wpisania ilości; techniczne `default_quantity` nie jest traktowane jako zapotrzebowanie użytkownika. Grupa przekazuje `selected_product_id=null`, świadomie wybrany produkt — jego ID. Ulubione zapisują `group_id` przez dotychczasowe API. Data `regular_price_observed_at` nie jest podpisywana jako data potwierdzenia aktualności ceny.

Po otrzymaniu `odpowiedz_dla_radka.md` uzupełniono ustalenia: każda pozycja z `product_count: 1` automatycznie pobiera `catalog_group` i pokazuje produkt bez rozwijania, niezależnie od `kind`. Dodanie grupy nadal nie wybiera konkretnego produktu; osobny przycisk pozwala świadomie wskazać produkt. Daty regularne są opisane jako „Cena widziana DD.MM.RRRR” wyłącznie dla źródeł `antonka` i `tanszykoszyk`; `kodyzbiedry`, brakujące i nierozpoznane źródła lub daty pokazują „Data ceny nieznana”. Nie zmienia to wyceny backendu. Nieznane opakowanie ma wyraźny komunikat o braku porównania mimo ręcznego wpisania ilości. Domyślna ilość z API jest techniczna, dlatego formularze nadal wymagają świadomego wpisania potrzeby.

Ulubione używają `favorite_groups`, filtrują nazwy lokalnie bez rozróżniania wielkości liter, polskich znaków oraz przecinka i kropki w procentach. Podgląd pobiera `catalog_group` dopiero po rozwinięciu, pokazuje produkt raz ze wszystkimi ofertami, a 404 oznacza „Brak ofert w tej chwili” bez usuwania serduszka. Inne błędy, w tym brak RPC, nadal wymagają ponowienia. Planowanych `catalog_favorites` ani `quantity_known` nie wywołujemy. Nadal pozostają odbiór na rzeczywistym koncie, synchronizacja plików bazy oraz uzgodnienie z Filipem Home/Szukaj i jednego globalnego pola wyszukiwania. Nie scalano gałęzi Damiana, nie zmieniano SQL, wspólnego API/typów ani głównego layoutu.

Kontrolowane odpowiedzi są wyłącznie w `tests/fixtures/catalog-v1.ts`. Testy Node sprawdzają walidację kontraktu, pełne liczności, duplikaty, przypisania ofert, odrzucanie estymat jako ceny regularnej i nieznane opakowania. Testy przeglądarkowe w `tests/browser/catalog-v1.spec.ts` obejmują nawigację, zachowanie ilości, stronicowanie, wyszukiwanie, karty i dodawanie do list, błędy oraz sesję na fikcyjnym Supabase.

Weryfikacja z 21 listopada: TypeScript i lint zaliczone; Node — 97 zaliczonych, jeden pominięty z powodu braku Gitleaks (w tym pięć nowych testów kontraktu). Siedem scenariuszy nowego katalogu zaliczono w kolejnych przebiegach po poprawkach; osiem scenariuszy dotychczasowych Ulubionych i cztery zakupowe przeszły w zestawie regresji. Obejrzano widok kategorii i rozwiniętej grupy na szerokości 320 px. Naprawiono reset nawigatora przez stan szkiców i ostrzeżenie renderowania pustego tekstu; test drzewa sprawdza również brak tych błędów renderowania.

Globalny `navigation.spec.ts` trzykrotnie przekroczył niezmieniony limit 45 s przy kolejnych przejściach i przeładowaniach; wynik pozostaje nierozstrzygnięty. W ostatnim śladzie pierwsze pobranie pakietu zajęło około 21,2 s, a jedno fikcyjne `/auth/v1/user` około 8,3 s; zakończone żądania Auth miały status 200. Nie zwiększano limitów ani nie wyłączano oczekiwań. Ślad ostatniej próby zapisuje się w `test-results/navigation-kolejne-wejścia-0d839-howują-działającą-aplikację/trace.zip`. Odbiór w chmurze, eksport platform, testy fizycznego urządzenia, migracje i importy nie były wykonywane w tym etapie.

Weryfikacja po odpowiedzi Damiana: końcowy TypeScript i lint zaliczone. Node: 99 zaliczonych, jeden pominięty z powodu braku Gitleaks, w tym nowe przypadki normalizacji wyszukiwania i dat cen. W pełnym przebiegu przeglądarkowym przeszło 19 z 21 scenariuszy; pierwszy scenariusz zatrzymał się na otwieraniu strony po 45 s, a drugi na oczekiwaniu na wyniki katalogu po 5 s. Oba przeszły w osobnym ponowieniu bez zmiany limitów. Łącznie sprawdzono osiem scenariuszy katalogu, dziewięć Ulubionych i cztery zakupowe. Po dodaniu kontroli zgodności ID ponownie przeszedł test bezpośredniej karty produktu. Obejrzano podgląd Ulubionych na 320 px; poprawiono też niespójność nazwy i rozmiaru opakowania w samej fixturze testowej. Testy nadal korzystają z fikcyjnego API. Poprzedni nierozstrzygnięty wynik globalnej nawigacji nie został w tym etapie ponowiony; rzeczywista sesja w chmurze, migracje i odbiór na telefonie pozostają poza tą weryfikacją.

## Logowanie — integracja Supabase

[Kontrakt modułu auth](docs/auth-contract.md) opisuje typy, operacje i podział pracy.
[Operacje konta — punkt 3](docs/auth-operations.md) obsługują rzeczywiste Supabase:
rejestrację, potwierdzanie kodów, logowanie, reset hasła i lokalne wylogowanie.
[Sesja i provider — punkt 4](docs/auth-session.md) dodają zapamiętywanie zwykłego
logowania, odtwarzanie i odświeżanie oraz `AuthProvider/useAuth` dla ekranów osoby 2.
Jeden provider jest zamontowany w `src/app/_layout.tsx`. W tym samym pliku `AppShell`
blokuje właściwą aplikację poza stanem `signedIn`, a `AuthScreen` zawiera formularze.
[Chronione API — punkt 5](docs/auth-api.md) wymaga sesji potwierdzonego konta;
pobieranie sklepów używa bieżącego tokenu i przerywa się przy wylogowaniu.
Bez sesji główny layout pokazuje formularz logowania; chroniona nawigacja jest ukryta i niedostępna, a mapa nie jest montowana.

[Przekazanie i odbiór](docs/auth-handoff.md) opisuje obecną integrację, otwarte braki
formularzy i nawigacji oraz checklistę odbioru na urządzeniach.

[Konfiguracja Supabase — punkt 2](docs/supabase-setup.md) zawiera ustawienia Auth,
SMTP dla projektu bez własnej domeny, polskie szablony maili oraz zmienne środowiskowe.
Konfigurację wspólnego projektu oraz rzeczywiste doręczenie obu kodów sprawdzono
8–9 listopada 2026; szczegóły i ograniczenia są zapisane w instrukcji.

## Uruchomienie — PowerShell

Wymagany Node.js 24 LTS. Z katalogu `SMARTCART` przejdź do aplikacji i zainstaluj zależności:

```powershell
cd .\Projekt_zespolowy_2026-2027\smart_cart
npm.cmd ci
```

Przed pierwszym uruchomieniem skopiuj `.env.example` do `.env.local` i uzupełnij
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` oraz `SUPABASE_URL`.
Oba adresy muszą wskazywać ten sam projekt; publiczny klucz ma postać `sb_publishable_…`.
`.env.local` jest ignorowany przez Git.

W terminalu 1, w katalogu `smart_cart`, uruchom serwer danych:

```powershell
npm.cmd run server
```

Kod serwera znajduje się w `server/serwer-mapy.mjs`. Serwer czyta przygotowane dane z `../dane-sklepow/gotowe/sklepy.json` i udostępnia `http://localhost:8787/v1/stores` oraz `/health`. Cały katalog `dane-sklepow` jest w repozytorium, obok `smart_cart`: zawiera gotowy zbiór, oryginalne GeoJSON, poprawki, raporty, archiwum weryfikacji i narzędzia przygotowania danych. Po sklonowaniu repo zespół otrzymuje kod i dane.

Dane są odczytywane przez serwer; aplikacja Expo nadal pobiera sklepy przez API. Pliki źródłowe i raporty nie są importowane do pakietu aplikacji. Reguła w głównym `.gitattributes` wyłącza zmianę końców linii w `dane-sklepow`, aby zachować sumy SHA-256 źródeł i dowodów również po pobraniu repo na Windows.

W terminalu 2, również w katalogu `smart_cart`, uruchom aplikację:

```powershell
npm.cmd start
```

Otwórz projekt w Expo Go kodem QR albo naciśnij `w`, aby uruchomić przeglądarkę. Mapa jest w zakładce **Sklepy**. Telefon i komputer powinny być w tej samej sieci; port 8787 komputera musi być dostępny dla telefonu.

W trybie deweloperskim aplikacja używa hosta przeglądarki lub komputera z Expo, z portem 8787. Opcjonalnie ustaw pełny adres endpointu w `.env.local` i uruchom Expo ponownie:

```dotenv
EXPO_PUBLIC_STORES_API_URL=http://ADRES_IP_KOMPUTERA:8787/v1/stores
```

`localhost` na telefonie oznacza telefon. Tunel Expo nie udostępnia automatycznie serwera danych — potrzebny jest wtedy osobno dostępny adres API.

### Konfiguracja serwera danych

`npm.cmd run server` automatycznie wczytuje `.env.local` z katalogu `smart_cart`. Możesz skopiować `.env.example` jako szablon. Serwer korzysta z zainstalowanego SDK Supabase.

Po zmianie adresu lub klucza Supabase zrestartuj **serwer danych i Expo**.
Serwer Node nie przeładowuje `.env.local` automatycznie. Gdy logowanie działa,
a sklepy są niedostępne, sprawdź, czy na porcie 8787 nie działa starszy proces ze starą konfiguracją.
`/health` potwierdza dane i działanie HTTP, ale nie poprawność połączenia z Supabase.

- `SUPABASE_URL` i `SUPABASE_PUBLISHABLE_KEY` — adres i publiczny klucz wspólnego projektu. Jeśli ich nie podasz, serwer użyje odpowiadających zmiennych `EXPO_PUBLIC_SUPABASE_*`. Brak konfiguracji blokuje start. Nie potrzeba klucza `service_role`.

- `SMARTCART_DATA_DIR` — katalog zawierający `gotowe/sklepy.json`. Domyślnie `../dane-sklepow` względem `smart_cart`, czyli w katalogu głównym repozytorium. Ścieżka względna jest zawsze liczona od katalogu aplikacji, także przy uruchomieniu skryptu z innego miejsca. Standardowy układ po sklonowaniu repo nie wymaga ustawiania tej zmiennej.
- `SMARTCART_DATA_PORT` — domyślnie `8787`. Jeśli zmienisz port, dostosuj również `EXPO_PUBLIC_STORES_API_URL` i uruchom Expo ponownie.

Przykład własnej lokalizacji danych w `.env.local`:

```dotenv
SMARTCART_DATA_DIR=C:/dane-smartcart
SMARTCART_DATA_PORT=8787
```

Serwer udostępnia przygotowany katalog po sprawdzeniu tokenu `Authorization: Bearer …`; wejście bez tokenu na `/v1/stores` zwróci `401`. Publiczny `/health` udostępnia wyłącznie informacje techniczne. Przy braku lub błędnych danych serwer kończy start, zanim otworzy port. `npm.cmd run server:check` sprawdza plik bez uruchamiania serwera, konfiguracji auth ani połączenia z Supabase. Samo importowanie modułu nie uruchamia serwera.

## Mapa sklepów

Mapa używa **MapLibre GL JS 6.16.0** na wszystkich platformach. Na telefonach działa wewnątrz `react-native-webview` dostępnego w Expo Go, a na WWW w osadzonej ramce. Obie wersje korzystają z tego samego dokumentu i stylów w `src/features/stores/map`. Podkład działa bez klucza API.

- Punkty pochodzą wyłącznie z przygotowanego katalogu (obecnie 7753 sklepy). Rekordy oczekujące na weryfikację są wykluczone, a kopia katalogu nie jest dołączana do aplikacji.
- Filtry obejmują Lidl, Biedronkę, Auchan i Dino. Wyszukiwarka filtruje nazwy i adresy, także bez polskich znaków. **Szukaj** ustawia widok na wyniki.
- Kliknięcie grupy przybliża mapę; kliknięcie sklepu otwiera kartę z nazwą i adresem.
- **Wyznacz trasę** otwiera zewnętrzną nawigację: Apple Maps na iOS lub adres Google Maps na Androidzie/WWW.
- **Moja lokalizacja** pyta o zgodę dopiero po kliknięciu, jednorazowo odczytuje pozycję i centruje mapę. Odmowa pozostawia ręczne przeglądanie. Pozycja nie jest wysyłana do serwera sklepów. Dystans w karcie jest odległością w linii prostej.
- **Cała Polska** przywraca widok kraju. Mapa ma stałą jasną kolorystykę.
- Przycisk **i** rozwija skrócone, klikalne oznaczenia OpenMapTiles i OpenStreetMap. Przy pierwszym otwarciu mapy w sesji aplikacji podpis jest widoczny przez 5 sekund, potem automatycznie się zwija. Kolejne wejścia w tej sesji zaczynają się ze zwiniętym podpisem.

Podkład to wektorowy Positron z OpenFreeMap z własnymi kolorami SMARTCART. Silnik i CSS są pobierane z przypiętego adresu unpkg; podkład, fonty i zasoby pochodzą z OpenFreeMap. Wymagane są internet i WebGL2; nie ma trybu offline. Paczka `maplibre-gl` w zależnościach deweloperskich służy do uruchamiania testów z lokalnymi plikami biblioteki.

Punkty i grupy są rysowane jako warstwy WebGL, bez tysięcy znaczników HTML. Do widoku trafia katalog po zmianie wyników filtrowania; przesuwanie mapy nie przesyła go ponownie. Dokument mapy sam nie pyta o lokalizację.

Oznaczenia © OpenMapTiles i © OpenStreetMap są dostępne pod przyciskiem **i** w rogu mapy. Źródłem bazowych danych sklepów jest All the Places (CC0); część poprawek pochodzi z OpenStreetMap (ODbL). Audyt i szczegóły pochodzenia rekordów pozostają w katalogu `dane-sklepow` w repozytorium.

### Android i uprawnienia

HTML w WebView otrzymuje bazowy adres HTTPS przez `source.baseUrl`. Bez niego dokument ma pochodzenie `null`, blokujące workery modułowe MapLibre. `https://smartcart.invalid/map/` jest wirtualnym adresem lokalnego dokumentu, nie serwerem do pobrania ani adresem API.

Silnik został sprawdzony przez użytkownika na Androidzie i komputerze. iOS oraz płynność na konkretnych modelach telefonów wymagają osobnych testów. Lokalizacja w przeglądarce wymaga bezpiecznego kontekstu, np. HTTPS albo localhost; HTTP pod adresem LAN może ją blokować.

## Publikacja i WWW

Do wersji produkcyjnej ustaw `EXPO_PUBLIC_STORES_API_URL` na rzeczywisty publiczny endpoint HTTPS, zwracający katalog w formacie z `model.ts`. Lokalny serwer służy do pracy deweloperskiej; projekt nie wdraża hostingu. Poza trybem deweloperskim nie ma automatycznego adresu zastępczego.

WWW używa `web.output: "single"`: ekrany działają w przeglądarce, a dane pobierają z osobnego API. Projekt nie korzysta z API Routes ani loaderów Expo. Ten tryb omija odtworzony błąd renderowania serwerowego SDK 58 przy zmianie tras i przeładowaniu. Hosting musi przekierowywać adresy ekranów do `dist/index.html`. Jeśli dodacie serwerowe funkcje Expo, trzeba ponownie dobrać tryb WWW.

## Eksport bazy i lokalna konfiguracja Supabase

`supabase-schema.sql` jest migawką struktury zdalnej bazy z 14 listopada, bez rekordów.
Nie synchronizuje się automatycznie. [Aktualny kontrakt RPC](docs/database-context.md) i [obsługa eksportu/migracji](docs/utrzymanie-katalogu.md) opisują nowe funkcje po wdrożeniu napraw.

`supabase/config.toml` opisuje konfigurację lokalną, z dopasowanymi podstawowymi parametrami auth. Nie jest kopią konfiguracji chmury. Korzystamy ze wspólnego projektu; nie uruchamiamy dodatkowego lokalnego Auth.

## Sprawdzanie

Z katalogu aplikacji:

```powershell
npm.cmd test
npm.cmd run server:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:e2e
npx.cmd expo export --platform all
```

Testy jednostkowe używają runnera Node 24. Playwright wymaga zainstalowanego Google Chrome i uruchamia własne Expo z fikcyjną konfiguracją Supabase na domyślnym porcie **8091**. Inny wolny port można wskazać przez `MAP_TEST_PORT`. Testy uruchamiają rzeczywisty silnik i workery MapLibre z lokalnych plików, z fikcyjną sesją, sklepami i zastępczym podkładem — nie potrzebują prawdziwego konta ani nie pobierają publicznych kafelków.

Uruchamiaj jedną instancję Metro dla projektu. Po zmianie zależności lub problemie z cache zatrzymaj Expo i uruchom `npx.cmd expo start --clear --port 8081`, a następnie ponownie otwórz projekt w Expo Go. Eksport najlepiej wykonywać przy zatrzymanym serwerze deweloperskim.

Wyjątkiem jest izolowane Expo uruchamiane przez Playwright na osobnym porcie i z fikcyjnymi ustawieniami. Nie używaj jego adresu jako zwykłego środowiska deweloperskiego.

Wyniki po wdrożeniu: **89/89 testów Node, 20/20 Playwright, 37/37 testów danych, TypeScript, ESLint i kontrola 7753 sklepów zaliczone**. Eksport WWW/Android/iOS zakończony powodzeniem. Szczegóły oraz granice odbioru: [raport](docs/wdrozenie-po-audycie.md).
Przed publikacją dodano cztery testy kontroli sekretów: aktualny zestaw Node ma **93 testy**. Reguły i problem starszej historii Git opisuje [kontrola publikacji](docs/publikacja-git.md).

`npm.cmd run test:db` sprawdza migracje i RLS w wyłącznie testowym kontenerze Postgres. [Instrukcja](docs/utrzymanie-katalogu.md). Nieistniejący skrypt `reset-project` usunięto.

`npm.cmd test` obejmuje również `tests/server.test.mjs`: konfigurację ścieżki danych i działanie API na fikcyjnych rekordach. `server:check` odczytuje prawdziwy plik danych z repozytorium. Instrukcje kontroli i ponownego przygotowania całego zbioru są w `../dane-sklepow/README.md`.

Eksport sprawdza pakowanie kodu na trzy platformy; test przeglądarkowy nie zastępuje testowania gestów, uprawnień i płynności na fizycznych telefonach.
