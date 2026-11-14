# Stan projektu SMARTCART — 14 listopada 2026

**Dokument historyczny: audyt przed naprawami.** Wskazane niżej błędy zostały następnie objęte wdrożeniem; aktualny stan, wyniki testów i pozostałe braki danych opisuje [raport po wdrożeniu](wdrozenie-po-audycie.md). Wyniki 82/82 i 12/17 dotyczą punktu wyjścia, nie bieżącego kodu.

Audyt całego folderu `SMARTCART`, wykonany na gałęzi `main`, commit `bcea540`.
To punkt odniesienia sprzed wdrożenia. [Pierwotny raport logowania](../../docs/RAPORT_WDROZENIA_LOGOWANIA_SUPABASE.md) zachowuje wymagania i stan z 3 listopada.

Po audycie przeprowadzono dwie ankiety z autorem projektu. [Plan napraw po ankiecie](plan-napraw-po-ankiecie.md) zapisuje 17 uzgodnień dotyczących zachowania docelowego, w tym opakowań i sprzedaży luzem, precyzyjnych zamienników, promocji ogólnych, wieku cen, kompletności wyceny, uprawnień i wielu prywatnych list. Ustalenia nie zmieniają wyników audytu ani obecnej implementacji opisanej poniżej.

## Zakres i sposób sprawdzenia

Przed zmianą dokumentacji spis plików obejmował 2069 plików roboczych: 1980 w `dane-sklepow`, 87 w `smart_cart` i 2 poza tymi katalogami. Pominięto przy zliczaniu `.git`, `node_modules`, `.expo`, wyniki Playwright i `supabase/.temp`.
Przejrzano kod aplikacji i serwera, konfiguracje, zależności, testy, dokumenty, eksport SQL, narzędzia danych, raporty i manifest źródeł.
Duże źródła i archiwum odpowiedzi oceniono przez ich strukturę, raporty oraz kontrolę spójności źródeł i dowodów wykorzystywanych w przygotowaniu danych. Nie przeprowadzano ponownej ręcznej weryfikacji każdej placówki ani wszystkich archiwalnych stron HTML.

Nie wysyłano nowych maili, nie tworzono kont ani nie zmieniano zdalnego schematu. Błędy RPC opisane poniżej zostały potwierdzone odczytowo wcześniej w tej samej sesji, 14 listopada; szczegóły są w [kontekście bazy](database-context.md).
Zmiany tego audytu dotyczą dokumentacji. Kod, testy, eksport SQL i źródła danych pozostają w zastanym stanie.

## Układ folderu i odpowiedzialności

| Miejsce | Rola |
| --- | --- |
| `SMARTCART/RAPORT_WDROZENIA_LOGOWANIA_SUPABASE.md` | Pierwotne wymagania i plan podziału pracy nad auth, z aktualną adnotacją historyczną |
| `Projekt_zespolowy_2026-2027/.git` | Repozytorium kodu i danych; sam folder `SMARTCART` nie jest repozytorium Git |
| `smart_cart/src/app` | Ekrany i wspólny layout Expo Router |
| `smart_cart/src/features/auth` oraz `src/lib/supabase.ts` | Klient Supabase, operacje konta, magazyn i cykl życia sesji |
| `smart_cart/src/features/stores` | Pobieranie katalogu, filtry, lokalizacja, mapa i komunikacja z iframe/WebView |
| `smart_cart/server` | Osobny serwer HTTP mapy oraz weryfikacja tokenu w Supabase |
| `smart_cart/tests` | 82 testy Node oraz 17 scenariuszy Playwright |
| `smart_cart/supabase-schema.sql` | Eksport struktury zdalnej bazy produktów i cen, bez rekordów |
| `smart_cart/supabase/config.toml` | Nowa konfiguracja lokalnego stosu CLI, nie kopia ustawień Auth projektu w chmurze |
| `smart_cart/supabase/email-templates` | Polskie szablony maili do ręcznego zapisania w panelu |
| `dane-sklepow` | Niezależny katalog placówek, oryginalne GeoJSON, poprawki, dowody, raporty i skrypty |

`.env.local` istnieje i jest ignorowany przez Git; nie zapisujemy jego wartości w dokumentacji. `supabase/.temp` także jest ignorowane.
Eksport SQL i pliki lokalnej konfiguracji CLI nie zastępują wersjonowanych migracji: aktualnie nie ma katalogu z migracjami ani dołączonego importera produktów z rozmowy Gemini.

## Technologie i uruchomienie

Wymagane środowisko projektu: Node.js 24; audyt wykonano na Node.js 24.13.1.
Zainstalowane wersje obejmują Expo 58.0.22, Expo Router 58.0.29, React/React DOM 19.3.0, React Native 0.88.1, TypeScript 6.0.3, Supabase JS 2.119.0, AsyncStorage 2.2.0, WebView 14.0.1, MapLibre GL JS 6.16.0 i Playwright 1.64.1.
`npm.cmd ls --depth=0` nie wykazało brakujących bezpośrednich zależności.

WWW jest aplikacją SPA (`web.output: single`), bez API Routes i renderowania serwerowego. TypeScript działa w trybie `strict`; alias `@/*` wskazuje `src/*`. Włączono typed routes i React Compiler.
Serwer Node mapy jest osobnym procesem, standardowo na porcie 8787; Metro/WWW standardowo na 8081.
Instrukcja uruchomienia i zmiennych jest w [README](../README.md).

## Co jest zaimplementowane w aplikacji

| Obszar | Obecny stan kodu |
| --- | --- |
| Główny layout | Montuje jeden `AuthProvider`; `AppShell` wyświetla ładowanie, błąd, formularze albo chronioną aplikację zgodnie ze stanem auth |
| Formularze | `AuthUI` wewnątrz `src/app/_layout.tsx`: logowanie, rejestracja, potwierdzenie emaila, żądanie resetu, kod resetu i nowe hasło; nie ma osobnych plików tras `/auth/*` |
| Walidacja hasła | Bieżące wskazanie minimum 8 znaków i zgodności potwierdzenia na rejestracji i zmianie hasła |
| Sesja | Odtwarzanie, weryfikacja konta, odświeżanie, współdzielenie subskrypcji, obsługa zmiany sesji i lokalnego wylogowania; recovery w pamięci |
| Profil | Pokazuje email zalogowanego użytkownika i przycisk wylogowania |
| Start | Skróty do koszyka, ulubionych, sklepów i produktów; panel produktów jest atrapą |
| Sklepy | Mapa, cztery filtry sieci, wyszukiwanie miejscowości/adresów, klastry, karta, lokalizacja i zewnętrzna nawigacja |
| Produkty, Koszyk, Ulubione | Puste komponenty `View`; bez połączenia z bazą produktów i cen |
| Ustawienia | Tytuł i informacja o przyszłych ustawieniach; brak funkcji edycji |
| Wyszukiwanie produktów w nagłówku | Pole interfejsu bez podłączonej operacji wyszukiwania |

Istnienie bramki auth w layoucie nie jest równoznaczne z zaliczeniem całego odbioru nawigacji. Bieżące testy ujawniły problem utrzymania ekranu przy zmianie sesji, opisany poniżej.

## Mapa i serwer placówek

Mapa korzysta z MapLibre w WebView na telefonie i iframe na WWW; wspólne HTML i runtime są w `src/features/stores/map/document.js`.
Kod silnika i CSS pochodzą z przypiętej wersji unpkg, podkład Positron i zasoby z OpenFreeMap. Działanie wymaga internetu i WebGL2; brak trybu offline.
WebView otrzymuje wirtualny adres bazowy HTTPS `https://smartcart.invalid/map/`. Nie jest to rzeczywisty endpoint danych.
Most mapy przekazuje katalog, wybór, lokalizację i polecenia widoku, bez tokenów auth. Komunikaty sprawdzają kanał, a WWW także źródło iframe.

`GET` i `HEAD /v1/stores` wymagają Bearer tokenu potwierdzonego nieanonimowego użytkownika. Weryfikator wywołuje `auth.getUser(token)` i dodatkowo kontroluje claims. `/health` i preflight `OPTIONS` są publiczne.
Weryfikacja trwa maksymalnie 5 sekund. Odpowiedzi katalogu mają `Cache-Control: no-store`, CORS dopuszcza `Authorization` i `If-None-Match`; serwer obsługuje gzip, ETag i autoryzowane 304.
Klient ma limit 15 sekund, ponawia żądanie raz po 401, rozróżnia cykle sesji i odrzuca spóźnione odpowiedzi. `useStores` zamienia jednak błędy pobierania na jeden ogólny komunikat, przez co UI nie wyjaśnia różnicy między awarią weryfikacji a innym błędem danych.

Serwer wczytuje `.env.local` przy starcie. Po zmianie adresu/klucza Supabase trzeba go uruchomić ponownie. Błąd wcześniejszej konfiguracji klucza rozwiązano w tej sesji restartem; poprawiono to w instrukcji uruchomienia.
Na telefonie API musi być osiągalne pod adresem komputera. `localhost` telefonu nie wskazuje komputera, a tunel Expo sam nie tuneluje portu API.

## Dane mapy i archiwum kontroli

Źródła zapisano z migawek 24–27 października 2026; wygenerowane wyniki mają datę 3 listopada. To katalog lokalny, bez automatycznej synchronizacji z internetem ani bazą produktów Supabase.

| Sieć | Gotowe | Do weryfikacji |
| --- | ---: | ---: |
| Lidl | 1014 | 0 |
| Biedronka | 3278 | 580 |
| Dino | 3315 | 0 |
| Auchan Super/Hiper | 146 | 0 |
| Razem | 7753 | 580 |

Kontrola potwierdziła podział 8333 wybranych rekordów, 227 poprawek oraz decyzje przeglądu 67 rekordów (62 potwierdzone w opisanym zakresie i 5 wymagających kontroli).
Wśród przyczyn weryfikacji są m.in. 556 braków geometrii, 9 braków adresu, 9 podejrzanych punktów i 5 konfliktów między źródłami; przyczyny mogą się nakładać.
Gotowy rekord oznacza przejście opisanych kontroli, nie ręczne potwierdzenie aktualnego otwarcia sklepu.

Skrypty `pobierz-*` zapisują odpowiedzi z sieci, `scal-osm` łączy cache, a skrypty dopasowania, poprawek, przeglądu i przygotowania wyliczają wyniki z dowodami. Nie uruchamiano ich w trybie zapisującym ani nie odświeżano źródeł podczas audytu.
Archiwalne README poszczególnych prób opisują swoje etapy, więc liczby 7530, 7716 lub 7735 nie są sprzeczne z obecnym wynikiem 7753.
Szczegóły pochodzenia, licencji CC0/ODbL, niepewności identyfikatorów Dino i procedur aktualizacji są w [README danych](../../dane-sklepow/README.md).

## Baza produktów i cen Supabase

Obowiązującym źródłem struktury jest eksport `supabase-schema.sql` z 14 listopada, opisany szczegółowo w [database-context.md](database-context.md).
Tabele: `stores`, `categories`, `base_products`, `products`, `store_offers`, `price_history`.
Widok `v_store_offers_full` uwzględnia już obie daty promocji, oznacza wielosztuki i wystawia `single_item_price`.
`stores` to sieci, a nie placówki mapy. Zestaw sieci i liczby rekordów z wcześniejszego importu pozostają informacją historyczną; eksport nie zawiera danych do ich potwierdzenia.

| Problem | Ustalenie |
| --- | --- |
| `compare_basket` | Ma parametry `p_allow_multibuy = true` i `p_normalize_weight = false`, lecz w odczytowym wywołaniu zwraca `42883` z powodu `round(double precision, integer)`, także przy wyłączonej normalizacji |
| `search_offers` | Zwraca `42703`; używa `store_offers.base_product_id` i innych nieistniejących kolumn, a także niezgodnych typów wyniku |
| Normalizacja ilości w koszyku | Jest proporcjonalna do mediany, bez zaokrąglania liczby kupowanych opakowań i kontroli jednostki w grupie |
| Warunki promocji | Rozpoznawanie wielosztuk po wzorcu w `promo_type` nie rozwiązuje liczby sztuk, wymogu karty ani limitów |
| Uprawnienia eksportu | `anon` i `authenticated` mają oprócz SELECT także `REFERENCES`, `TRIGGER`, `TRUNCATE`, `MAINTAIN`; nie jest to zestaw ograniczony do odczytu |

Nie podłączono tych tabel ani RPC do ekranów produktów, koszyka czy ulubionych. Ich naprawa i integracja to dalsza praca, nie zmiana wykonana podczas tego audytu.

## Konfiguracja Auth w chmurze i lokalny CLI

Kod i lokalne szablony email zakładają minimum 8 znaków hasła, 6 cyfr OTP i 10 minut ważności. W `authPolicy` jest również odstęp 60 sekund; nie jest to implementacja odliczania ani klientowej blokady wysyłki.
Ustawienia panelu SMTP, limitów i potwierdzenia emaila w [instrukcji Supabase](supabase-setup.md) mają historyczne źródła z 8–10 listopada. Sam eksport SQL ich nie potwierdza. Użytkownik potwierdził działanie logowania w tej sesji 14 listopada; nie oznacza to ponownego odbioru wszystkich operacji konta.

`supabase/config.toml`, wygenerowany przez CLI, ma inne wartości lokalne: `minimum_password_length = 6`, `auth.email.enable_confirmations = false`, `otp_expiry = 3600`, `max_frequency = '1s'`, `otp_length = 6`, `site_url = 'http://127.0.0.1:3000'`.
To nie jest pobrana konfiguracja projektu w chmurze. Uruchomienie lokalnego Auth z tym plikiem nie odtwarza kontraktu aplikacji; przed użyciem lokalnego stosu wymaga świadomego ujednolicenia. Konfiguracji nie wdrażano podczas audytu.

## Otwarte kwestie UI stwierdzone w kodzie

- Potwierdzenie rejestracji: pole email ma `value={emailForFlow || email}`, lecz zmiana wywołuje tylko `setEmail`. Gdy `emailForFlow` jest ustawiony, edycja nie zmienia adresu używanego przy weryfikacji.
- „Wyślij kod ponownie” pomija wynik `resendSignupCode`; nie prezentuje błędu/sukcesu, nie używa `pending` i nie ma odliczania 60 sekund.
- Główne przyciski wysyłania korzystają z `pending`, ale przełączanie trybów i anulowanie pozostają dostępne podczas oczekiwania. Brakuje jawnego odrzucania wyników poprzedniego formularza na poziomie UI. Ochrona rewizji serwisu sesji nie jest pełnym zastępstwem tej ochrony formularzy.
- „Powrót do logowania” w stanie recovery wywołuje `signOut` i kończy handler przed `setMode('signin')` oraz czyszczeniem pól. Powrót do właściwego formularza wymaga osobnego sprawdzenia i poprawy.
- Profil wywołuje `signOut` bez prezentowania wyniku błędu.
- Przy zmianie sesji bramka głównego layoutu odmontowuje `Tabs` podczas `initializing`. W teście nowej sesji ta sama osoba trafia na ekran startowy zamiast pozostać na mapie. Jest to obserwacja przeglądarkowa; przyczynę i sposób zachowania trasy należy dopracować w kodzie nawigacji.

Nie dopisywano fikcyjnych potwierdzeń zakończenia tych prac w kontraktach i checklistach.

## Wyniki sprawdzeń tego audytu

| Sprawdzenie | Wynik |
| --- | --- |
| `npm.cmd test` | 82/82 zaliczone |
| `npx.cmd --no-install tsc --noEmit` | Zaliczone, kod procesu 0 |
| `npm.cmd run server:check` | Zaliczone, 7753 sklepy |
| `npm.cmd ls --depth=0` | Zaliczone, komplet bezpośrednich zależności |
| `node --test dane-sklepow/*.test.mjs` z repo | 37/37 zaliczone |
| `node dane-sklepow/przygotuj-dane.mjs --check` | Zaliczone, 7753 gotowe / 580 do weryfikacji |
| `node --check` dla plików `.mjs` | Zaliczone, 32 pliki |
| Chrome/Playwright, osobny `MAP_TEST_PORT=8091` | 12/17 zaliczone, 5 nieudanych |
| ESLint | Brak konfiguracji i pakietów; istniejącego `npm run lint` nie uznano za zaliczone, nie instalowano nic automatycznie |
| `reset-project` | Wskazuje nieistniejący `scripts/reset-project.js`; nie jest działającym narzędziem |
| Eksport Android/iOS/WWW | Nie ponawiano w tym audycie; wcześniejszy zapis powodzenia z 9 listopada ma charakter historyczny |
| Rzeczywiste urządzenia i pełne operacje email | Nie powtarzano; pozostają do ręcznego odbioru po integracji UI |

Node wypisuje ostrzeżenie `MODULE_TYPELESS_PACKAGE_JSON` dla modułów TS/JS; nie blokuje ono zaliczonych testów. Nie zmieniano typu modułów pakietu w ramach dokumentacji.

Pięć nieudanych scenariuszy Playwright:

1. `navigation.spec.ts:3`: oczekuje nagłówka chronionej aplikacji bez przygotowania sesji; obecnie renderuje się formularz logowania.
2. `stores-auth.spec.ts:4`: selektor tekstu „Zaloguj się” jest niejednoznaczny po dodaniu tytułu i przycisku formularza.
3. `stores-auth.spec.ts:32`: ten sam problem selektora po wylogowaniu w innej karcie.
4. `stores-auth.spec.ts:41`: po zmianie sesji oczekuje mapy z nowym katalogiem, ale widoczny jest ekran startowy.
5. `stores-auth.spec.ts:93`: ten sam problem niejednoznacznego selektora po drugim 401.

Wszystkie dziesięć scenariuszy `stores.spec.ts` oraz dwa pozostałe scenariusze `stores-auth.spec.ts` przeszły. To testy z fikcyjnym projektem, sesjami i podkładem, a nie odbiór rzeczywistego Supabase na telefonie.
Przy zamykaniu testów trzeba było zatrzymać dwa pomocnicze procesy Expo uruchomione przez ten audyt, aby runner zakończył sprzątanie. Podsumowanie runnera: 12 passed, 5 failed, kod 1. Działającego Expo użytkownika i serwera API nie zatrzymywano.
Ślady i zrzuty nieudanych testów znajdują się w ignorowanym `test-results/`; kolejne uruchomienie Playwright może je zastąpić.

## Kolejne prace wynikające z analizy

1. Naprawić i ponownie sprawdzić dwa RPC przed użyciem ich w aplikacji.
2. Uporządkować rzeczywiste uprawnienia bazy i rozdzielić konfigurację lokalną CLI od uzgodnionych ustawień chmury.
3. Poprawić utrzymanie trasy przy zmianie sesji, wskazane braki formularzy oraz dostosować testy do aktualnego UI.
4. Dodać działający lint, uporządkować nieistniejący skrypt resetu i wykonać pełny odbiór na urządzeniach.
5. Dopiero następnie integrować produkty, koszyk, ulubione i wyszukiwanie z aktualnym kontraktem bazy.

Lista opisuje otwarte prace. W tym zadaniu zaktualizowano dokumentację, bez ich implementowania.
