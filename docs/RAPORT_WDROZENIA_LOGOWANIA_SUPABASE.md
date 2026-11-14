# SMARTCART — raport i zakres wdrożenia logowania

> **Adnotacja z 14 listopada 2026:** dokument poniżej zachowuje wymagania i plan
> ze stanu z 3 listopada. Opis braku integracji Supabase, pustego profilu i publicznego
> API jest historyczny. Obecny `main` (`bcea540`) zawiera klienta, sesję, formularze,
> profil, bramkę dostępu i chronione API mapy. Bieżący audyt: [stan projektu](../smart_cart/docs/stan-projektu.md).
> Audyt początkowo wykazał wynik Playwright 12/17. Po naprawach i wdrożeniu pięciu migracji:
> 89/89 Node, 20/20 Playwright, 37/37 testów danych, TypeScript, lint i pakowanie trzech platform zaliczone.
> Aktualny zakres oraz ograniczenia danych i odbioru na urządzeniach: [raport wdrożenia](../smart_cart/docs/wdrozenie-po-audycie.md).

Data analizy: **3 listopada 2026 r.**\
Repozytorium: `Projekt_zespolowy_2026-2027`\
Przeanalizowana gałąź: `main`, commit **`60c295e`** — scalenie PR #2 z mapą.\
Realizacja: **dwie osoby; cały poniższy zakres należy do nich**.\
Status dokumentu: historyczne wymagania i plan prac z 3 listopada; późniejszy stan opisuje adnotacja powyżej. Podczas pierwotnego przygotowania raportu nie wdrażano uwierzytelniania i nie zmieniano konfiguracji Supabase.

## 1. Cel i ustalenia obowiązujące

Wdrożyć jeden system kont oparty na **Supabase Auth**, zapewniający dostęp do właściwej części aplikacji wyłącznie zalogowanym użytkownikom z potwierdzonym emailem.

| Obszar | Uzgodnione zachowanie |
| --- | --- |
| Rejestracja | Otwarta dla każdego, bez zaproszeń i ręcznej akceptacji kont. |
| Dane rejestracji | Email, hasło i potwierdzenie hasła w formularzu. Potwierdzenie hasła nie jest osobnym polem zapisywanym w Supabase. |
| Potwierdzenie emaila | Jednorazowy kod z maila wpisywany w aplikacji. |
| Logowanie | Email i hasło. |
| Reset hasła | Email → kod z maila → weryfikacja kodu w aplikacji → nowe hasło → wylogowanie sesji odzyskiwania → ekran logowania. |
| Sesja | Odtwarzana po ponownym uruchomieniu; odświeżana zgodnie z mechanizmem Supabase. |
| Wylogowanie | Zakończenie bieżącej sesji na danym urządzeniu/przeglądarce i zamknięcie dostępu do chronionych ekranów. |
| Platformy tego etapu | Expo Go na telefonie i wersja przeglądarkowa. |
| Język | Formularze, maile, komunikaty i instrukcje użytkownika po polsku. |
| Google i linki do aplikacji | Kolejny etap; nie są warunkiem ukończenia obecnego zadania. |

Po poprawnym potwierdzeniu rejestracji wykorzystujemy sesję zwróconą przez Supabase i otwieramy ekran startowy `/`. Jeśli trzeba odtworzyć sesję przez zwykłe logowanie, użytkownik otrzymuje jasny komunikat. Nie tworzymy sesji zastępczej.

Produkty, ceny, gazetki, listy zakupów oraz baza produktów pozostają poza tym zadaniem. Istniejące puste ekrany tych funkcji mają być objęte ochroną dostępu, ale nie rozwijamy ich zawartości. Profil na tym etapie pokazuje email i umożliwia wylogowanie; edycja profilu i dodatkowe dane osobowe nie są potrzebne.

## 2. Stan projektu na 3 listopada 2026 — wyniki pierwotnej analizy

Poniższe ustalenia pochodzą z lokalnego kodu i testów. Zespół wybrał Supabase, ale repozytorium nie zawiera jeszcze integracji. Ustawienia zdalnego projektu Supabase nie były sprawdzane; należy je zweryfikować podczas realizacji zadania osoby 1.

### 2.1. Wersje i konfiguracja

Wersje odczytane z `smart_cart/package-lock.json`:

| Element | Wersja |
| --- | --- |
| Expo | `58.0.22` |
| Expo Router | `58.0.29` |
| React / React DOM | `19.3.0` |
| React Native | `0.88.1` |
| TypeScript | `6.0.3` |
| React Native WebView | `14.0.1` |
| MapLibre GL JS | `6.16.0` |
| Playwright | `1.64.1` |

Środowisko analizy: Node.js `24.13.1`, npm `11.8.0`. Instrukcja repo wymaga Node.js 24. TypeScript działa w trybie `strict`, alias `@/*` wskazuje `src/*`. Włączone są typed routes i React Compiler.

W `app.json` istnieje już `scheme: "smartcart"`. Nie oznacza to, że Expo Go jest własnym buildem obsługującym ten schemat. Na tym etapie stosujemy kody i nie uzależniamy procesu od przekierowania do aplikacji.

WWW działa jako SPA: **`web.output: "single"`**. Serwer danych jest osobnym procesem Node.js. Nie przełączamy WWW na renderowanie serwerowe ani Expo API Routes w ramach tego zadania.

W bezpośrednich zależnościach i lockfile brakuje obecnie klienta `@supabase/supabase-js` oraz adapterów trwałego przechowywania sesji. Biblioteki należy dobrać do tego projektu; nie kopiować całej listy zależności z przykładowego startera.

### 2.2. Pliki istotne dla wdrożenia

Wszystkie ścieżki w tabeli są względne wobec `smart_cart`.

| Plik / katalog | Stan obecny i znaczenie dla zadania |
| --- | --- |
| `src/app/_layout.tsx` | Zawiera cały wspólny interfejs, nagłówek, wyszukiwarkę i `Tabs` z `expo-router/js-tabs`. Wszystkie ekrany są obecnie dostępne bez logowania. |
| `src/components/navigation/BottomBar.tsx` | Własny dolny pasek: Sklepy, Ulubione, Koszyk, Produkty, Profil. Nie powinien pojawiać się na formularzach logowania. |
| `src/app/index.tsx` | Ekran startowy ze skrótami; po wdrożeniu wymaga zalogowania. |
| `src/app/profile/index.tsx` | Pusty ekran; miejsce na email użytkownika i wylogowanie. |
| `src/app/settings/index.tsx` | Pusty ekran; pozostaje chroniony, rozbudowa ustawień poza zakresem. |
| `src/app/stores/index.tsx` | Eksportuje istniejący ekran mapy; nie zastępować nowym ekranem mapy. |
| `src/features/stores/useStores.ts` | Pobiera katalog bez tokenu, ma timeout, anulowanie i ponowienie; wymaga integracji z sesją i rozróżnienia błędów auth od błędów danych. |
| `server/serwer-mapy.mjs` | API bez uwierzytelniania. `GET` i `HEAD /v1/stores` zwracają dane każdemu. |
| `tests/server.test.mjs` | Sprawdza publiczne API, gzip, ETag, CORS i ścieżkę danych; wymaga rozszerzenia o autoryzację. |
| `tests/browser/navigation.spec.ts` | Zakłada wejście na `/`, `/stores`, `/settings` bez logowania; trzeba dostosować oczekiwania i sesję testową. |
| `tests/browser/map-fixture.ts`, `stores.spec.ts` | Testują mapę z fikcyjnym katalogiem i prawdziwym silnikiem. Po dodaniu auth potrzebują kontrolowanej sesji testowej. |
| `.env.example` | Zawiera tylko ustawienia serwera i adres API sklepów; należy dopisać przykłady konfiguracji auth. |
| `.gitignore` | Ignoruje `.env*.local`; zachować ten sposób przechowywania lokalnych ustawień. |

Najważniejsze konkretne problemy integracyjne:

- Serwer dopuszcza w CORS tylko nagłówek `If-None-Match`. Po dodaniu Bearer tokenu przeglądarka będzie potrzebowała również `Authorization` w odpowiedzi na preflight.
- `/v1/stores` ustawia obecnie `Cache-Control: public, max-age=60`. Chroniona odpowiedź nie może nadal być publicznie cache’owana.
- Weryfikacja tokenu musi poprzedzać także odpowiedź `304 Not Modified` i obsługę `HEAD`, nie tylko zwracanie JSON przez `GET`.
- `useStores` zamienia wszystkie błędy na komunikat o pobieraniu sklepów; po wdrożeniu `401` musi trafić do wspólnej obsługi sesji.
- Obecny układ renderuje cały interfejs aplikacji w głównym layoucie. Ekranów auth nie można po prostu dopisać jako kolejnych widocznych zakładek.
- Mapa WWW działa w iframe, a telefoniczna w WebView. **Tokenów, kodów i danych sesji nie przekazujemy do dokumentu mapy ani przez jego komunikaty.** Katalog pobiera warstwa aplikacji.

### 2.3. Elementy działające, które należy zachować

Mapa używa MapLibre w WebView/iframe, posiada cztery filtry sieci, wyszukiwanie, grupowanie punktów, kartę sklepu, lokalizację na żądanie i zewnętrzną nawigację. Pozostają jasny podkład i mały przycisk informacji o źródłach. Nie zmieniamy wyglądu ani silnika mapy przy okazji auth.

API odczytuje **7753 gotowe sklepy** z `../dane-sklepow/gotowe/sklepy.json`. Katalog `dane-sklepow` jest w repo, ale poza aplikacją. Nie przenosimy go do pakietu Expo ani do Supabase w ramach tego zadania. Nie zmieniamy źródeł, raportów i sum kontrolnych danych.

Ochrona API ogranicza pobieranie przez endpoint; nie czyni tajnymi publicznych danych obecnych w repozytorium. Chronione ekrany SPA również nie zastępują zabezpieczenia serwera.

## 3. Przepływy i obsługa stanów

### Rejestracja i potwierdzenie emaila

1. Użytkownik podaje email, hasło i potwierdzenie hasła.
2. Formularz sprawdza dane; wymagania hasła odpowiadają konfiguracji Supabase.
3. Supabase tworzy niepotwierdzone konto i wysyła kod. Konto nadal nie daje dostępu do właściwej aplikacji.
4. Użytkownik wpisuje kod; weryfikacja następuje przez Supabase dla potwierdzenia emaila.
5. Poprawny wynik umożliwia wejście do aplikacji. Błędny lub wygasły kod pozostawia użytkownika przy potwierdzaniu.
6. Dostępne są ponowna wysyłka i poprawienie emaila. Zmiana emaila musi uruchamiać właściwy proces po stronie Supabase, a nie wyłącznie zmieniać podpis na ekranie.
7. Po przerwaniu procesu użytkownik może wrócić przez ekran logowania i kontynuować potwierdzanie niezweryfikowanego konta.

Szablon „Confirm sign up” ma prezentować kod `{{ .Token }}`. Weryfikację rejestracji należy oprzeć na aktualnym API `verifyOtp`, a nie przykładzie z niezgodną wersją SDK. [Szablony wiadomości](https://supabase.com/docs/guides/auth/auth-email-templates), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp).

### Logowanie i zwykła sesja

Email i hasło → weryfikacja Supabase → potwierdzone konto → ekran startowy. Niepotwierdzony email kieruje do potwierdzania, a nie do mapy. Dane konta pochodzą z Supabase; przyszłe dane użytkownika wiążemy z **`user.id`**, nie z emailem.

Podczas odtwarzania sesji pokazujemy neutralne ładowanie. Przejściowy problem sieciowy ma dać możliwość ponowienia; nie może tworzyć zastępczego zalogowania. Jednocześnie nie należy bezwarunkowo usuwać poprawnej zapisanej sesji przy każdym timeoutcie.

### Odzyskanie hasła

1. Podanie emaila wysyła wiadomość odzyskiwania z kodem.
2. Interfejs pokazuje neutralny komunikat, który nie służy do sprawdzania, czy podany adres ma konto.
3. Kod weryfikujemy w procesie **odzyskiwania (`recovery`)**, nie jako zwykłe logowanie lub potwierdzenie rejestracji.
4. Po poprawnej weryfikacji pokazujemy wyłącznie formularz nowego hasła.
5. Po skutecznym zapisaniu hasła kończymy lokalną sesję odzyskiwania, czyścimy jej stan i wracamy do logowania z komunikatem sukcesu.

Weryfikacja OTP może utworzyć sesję i wywołać zdarzenie logowania. Samo `session !== null` nie może wpuścić wtedy użytkownika na ekran startowy. Tryb odzyskiwania ustalamy przed weryfikacją kodu; nie polegamy wyłącznie na pojedynczym zdarzeniu `PASSWORD_RECOVERY`. Po restarcie w połowie procesu należy bezpiecznie wznowić formularz albo zakończyć sesję odzyskiwania i pozwolić rozpocząć procedurę ponownie. [Obsługa odzyskiwania przez Supabase Auth](https://github.com/supabase/auth/blob/master/README.md).

To rozdzielenie jest również wymaganiem nawigacji. Nie należy zakładać, że każdy poprawny JWT sam dowodzi ukończenia zmiany hasła; osoba 1 dokumentuje faktyczne właściwości tokenów używane przy ochronie API.

### Wylogowanie

Przycisk w profilu kończy bieżącą sesję, usuwa lokalnie przechowywaną sesję i czyści stan aplikacji powiązany z użytkownikiem. Przycisk „wstecz” nie przywraca chronionego ekranu. Przy zmianie konta nie może być widoczny stan poprzedniej osoby. Zdarzenia zakończenia sesji należy obsłużyć również w przeglądarce.

Zakres wylogowania trzeba ustawić jawnie jako lokalny: domyślne zachowanie SDK może obejmować wszystkie sesje użytkownika. Wydany JWT może pozostać ważny do końca swojego czasu życia; samo usunięcie go z telefonu nie unieważnia jego kopii na serwerze. Udokumentować przyjęty model, nie deklarować natychmiastowej globalnej revokacji bez jej wdrożenia. [signOut](https://supabase.com/docs/reference/javascript/auth-signout).

## 4. Podział pracy i własność plików

| Obszar | Osoba 1 — integracja | Osoba 2 — interfejs |
| --- | --- | --- |
| Gałąź | `feat/auth-supabase` | `feat/auth-ekrany` |
| Klient, sesja, operacje auth | Właściciel | Korzysta ze wspólnego modułu |
| Ustawienia Supabase, maile, SMTP | Właściciel | Sprawdza wygląd i przebieg procesów |
| Serwer i uwierzytelnione pobieranie sklepów | Właściciel | Integruje komunikaty i nawigację |
| Formularze i publiczne trasy auth | Dostarcza kontrakt | Właściciel |
| Root layout, ochrona tras i historia | Dostarcza stan sesji | Właściciel |
| Profil: email i wylogowanie | Dostarcza operację | Właściciel |
| Zależności, lockfile, przykłady env | Właściciel i koordynator | Zgłasza potrzebne zmiany |
| Testy | Moduł auth, sesja, serwer | Formularze, nawigacja, regresja mapy |
| Dokumentacja | Konfiguracja i backend | Obsługa ekranów i scenariusze odbioru |

Proponowane miejsca nowego kodu, do potwierdzenia po analizie przez wykonawców: klient w `src/lib/supabase.ts`, wspólna logika i provider w `src/features/auth`, ekrany auth w wyodrębnionej grupie tras. Nie są to istniejące pliki. Osoba 1 i 2 uzgadniają granice modułów przed jednoczesną edycją.

### Osoba 1 — pełen zakres

- Zweryfikować uzgodniony projekt Supabase zespołu; włączyć rejestrację emailem i wymagane potwierdzenie. Nie tworzyć równoległego systemu kont.
- Przygotować jeden współdzielony klient aplikacji, typowane operacje auth, provider/hook sesji i obsługę cyklu życia. Klient serwerowy do weryfikacji tokenów jest oddzielny i nie przechowuje globalnie sesji ostatniego użytkownika.
- Dobrać przechowywanie sesji do telefonu i WWW oraz opisać jego właściwości. Haseł i kodów nie utrwalać. Tokeny sesji przechowywać wyłącznie przez uzgodniony adapter; nie kopiować ich do wielu magazynów.
- Zapewnić odtwarzanie i odświeżanie, obsługę powrotu z tła, zakończenia sesji i sprzątanie subskrypcji. Oficjalny przykład React Native wymaga odpowiedniej obsługi storage i cyklu życia aplikacji. [Quickstart React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native).
- Wdrożyć wszystkie operacje z rozdziału 5 i osobny stan odzyskiwania hasła.
- Skonfigurować polskie szablony kodów, parametry ich ważności, ponowną wysyłkę i wymagania haseł. Zespół ma otrzymać zapisane rzeczywiste wartości konfiguracji, nie wartości wymyślone tylko w UI.
- Uruchomić wysyłkę na zwykłe adresy użytkowników. **Otwarta rejestracja wymaga własnej konfiguracji SMTP**: domyślna usługa Supabase jest ograniczona do adresów członków projektu i służy do testów. Przetestować również adres spoza zespołu. [SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp).
- Zabezpieczyć API i zmienić `useStores` zgodnie z rozdziałem 7; zachować format katalogu i mechanizmy wydajności serwera.
- Przygotować testy, plik przykładowej konfiguracji i instrukcję konfiguracji Supabase. Zmiany schematu, jeśli okażą się konieczne, mają mieć migracje i właściwe reguły dostępu. Sam ekran email + wylogowanie nie wymaga osobnej tabeli profili.

### Osoba 2 — pełen zakres

- Przygotować ekrany: logowanie, rejestracja, potwierdzenie rejestracji kodem, rozpoczęcie odzyskiwania hasła, kod odzyskiwania, nowe hasło oraz ładowanie/ponowienie sprawdzania sesji.
- Podłączyć ekrany wyłącznie do uzgodnionego modułu; nie tworzyć własnego drugiego klienta, osobnego storage ani równoległej flagi zalogowania.
- Wdrożyć ochronę wszystkich tras aplikacji, w tym `/`, `/stores`, `/favorites`, `/cart`, `/products`, `/profile`, `/settings`. Puste ekrany też są chronione.
- Oddzielić nagłówek aplikacji, wyszukiwarkę produktów i dolne zakładki od formularzy auth. Zachować położenie i wygląd interfejsu po zalogowaniu.
- Wykorzystać mechanizmy chronionych tras dostępne w aktualnym Expo Router. Niezbędne wydzielenie grup layoutów jest dozwolone, ale trzeba zachować dotychczasowe publiczne adresy istniejących ekranów i dostosować typed routes. Ochrona routera nie zabezpiecza API. [Protected routes](https://docs.expo.dev/router/advanced/protected/).
- W profilu wyświetlić email i działające wylogowanie. Nie rozbudowywać profilu o awatar, edycję danych lub dodatkowe tabele.
- Zapewnić obsługę klawiatury, przewijania formularzy, autofill, wklejania kodu, pokazania hasła, focusu, czytelnych etykiet i błędów na małym ekranie. Użytkownik nie może zgubić przycisku wysłania pod klawiaturą.
- Dostosować testy WWW do sesji testowej, dodać testy auth i wykonać ręczne testy w Expo Go. Obie osoby wzajemnie odtwarzają konfigurację i wykonują końcowy odbiór.

## 5. Wspólny kontrakt — ustalić przed budowaniem formularzy

Osoba 1 przygotowuje krótki kontrakt i typy jako pierwszą część pracy. Osoba 2 je przegląda. Poniższe nazwy są punktem wyjścia; uzgodnione nazwy mają być jednolite w całym rozwiązaniu.

| Operacja | Parametry i oczekiwany rezultat |
| --- | --- |
| `signUp` | Email i hasło; wynik wymaga potwierdzenia, bez otwierania aplikacji. |
| `verifySignupCode` | Email i kod; poprawne potwierdzenie i sesja albo typowany błąd. |
| `resendSignupCode` | Email; wynik wysyłki lub informacja o ograniczeniu. |
| `signIn` | Email i hasło; zwykła sesja, konieczność potwierdzenia albo błąd. |
| `sendPasswordResetCode` | Email; neutralna odpowiedź dla użytkownika i obsługa rzeczywistych błędów technicznych. |
| `verifyPasswordResetCode` | Email i kod; przejście do ograniczonego przepływu ustawiania nowego hasła. |
| `setNewPassword` | Nowe hasło; po powodzeniu zakończenie sesji odzyskiwania i powrót do logowania. |
| `signOut` | Zakończenie lokalnej sesji i wyczyszczenie stanu. |

Wspólny stan ma rozróżniać co najmniej: inicjalizację, brak sesji, zwykłe zalogowanie, odzyskiwanie hasła i błąd weryfikacji wymagający ponowienia. Dane użytkownika dostępne są przez jeden provider/hook. Kodów błędów nie należy rozpoznawać przez porównywanie angielskich zdań w wielu komponentach.

W kontrakcie ustalić także: źródło aktualnego tokenu dla API, zachowanie po `401`, sposób ponownej wysyłki, zasady anulowania operacji i obsługę zakończenia sesji podczas otwartego formularza. Testowe zastępniki są częścią testów; nie mogą zastąpić rzeczywistej integracji w oddawanej aplikacji.

## 6. Wymagania formularzy i komunikatów

- Email normalizować konsekwentnie zgodnie z przyjętą polityką; nie modyfikować hasła, np. przez automatyczne `trim()`.
- Wymagania hasła, długość kodu, czas jego ważności i odstęp wysyłki odczytać z przyjętej konfiguracji i opisać. Nie zakładać wartości tylko na podstawie przypadkowego tutoriala.
- Walidację UI uzupełnia rzeczywista weryfikacja Supabase. Kod nie jest sprawdzany lokalnie.
- Po wysłaniu formularza pokazać stan oczekiwania i zablokować duplikaty. Po błędzie umożliwić ponowienie.
- Obsłużyć błędny kod, wygaśnięcie, ponowne użycie, limit wysyłek, odrzucone hasło, niepotwierdzony email, utratę sieci i błąd dostawcy.
- Ponowna wysyłka respektuje ograniczenia serwera; licznik UI jest informacją dla użytkownika, nie jedynym zabezpieczeniem.
- Wiadomości zawierają nazwę SMARTCART, przeznaczenie kodu, kod i informację o ważności zgodną z konfiguracją. Nie umieszczamy w nich hasła.
- Wszystkie błędy widoczne dla użytkownika są po polsku; nie pokazujemy surowych odpowiedzi serwera, stack trace ani sekretów.

## 7. Wymagania API i bezpieczeństwa sesji

Za realizację tego rozdziału odpowiada osoba 1, a za zachowanie ekranów przy błędach — osoba 2.

1. `GET` i `HEAD /v1/stores` wymagają `Authorization: Bearer <access_token>` oraz potwierdzonego konta użytkownika z właściwego projektu Supabase. Nie akceptujemy klucza projektu, tokenu anonimowego ani samego zadeklarowanego `user.id` jako dowodu zalogowania.
2. Sprawdzać podpis, ważność i pochodzenie tokenu przez właściwe SDK/bibliotekę oraz wymagane claims. Samo dekodowanie JWT i odczyt `sub` nie jest weryfikacją. Nie implementować własnej kryptografii. Dobór metody uwzględnia konfigurację kluczy projektu. Potwierdzenia emaila nie ustalać z dowolnej flagi przesłanej przez klienta lub edytowalnych metadanych użytkownika; wykorzystać zaufany stan Supabase. [Weryfikacja JWT](https://supabase.com/docs/guides/auth/jwts), [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims).
3. Brak lub niepoprawne uwierzytelnienie daje `401`; niedozwolony typ konta `403`; awaria niezbędnego zewnętrznego sprawdzenia — kontrolowany błąd usługi, bez udostępniania katalogu. Nie mylić awarii Supabase z błędnym hasłem użytkownika.
4. Weryfikacja następuje **przed** zwróceniem katalogu, nagłówków odpowiedzi `HEAD` i `304` na pasujący ETag. Testy muszą to wykazać.
5. Zastąpić publiczne cache’owanie chronionych odpowiedzi przez `Cache-Control: no-store`, również dla błędów auth. Wewnętrzne cache katalogu i gzip można zachować: jest to wspólny zbiór sklepów, a nie cache sesji użytkownika.
6. Uzupełnić CORS o `Authorization`. Preflight `OPTIONS` ma działać bez tokenu i nie zwraca danych sklepów. CORS nie jest mechanizmem uwierzytelniania. Udokumentować konfigurację originów dla WWW i lokalnej pracy.
7. `/health` może pozostać publicznym endpointem technicznym bez danych kont i sekretów. `server:check` nadal sprawdza lokalny katalog bez logowania i bez otwierania portu. Zwykły start API ma natomiast zgłaszać brak wymaganej konfiguracji auth.
8. `useStores` pobiera aktualny token ze wspólnego mechanizmu sesji. Nie przechowuje kopii tokenu na stałe i nie pobiera od nowa 7753 sklepów przy każdym zdarzeniu odświeżenia tokenu.
9. Obsłużyć `401` z ograniczonym ponowieniem po odświeżeniu sesji, jeżeli jest możliwe. Współbieżne żądania nie mogą powodować lawiny odświeżeń. Trwała utrata sesji zamyka chronione ekrany; nie stosować pętli retry.
10. Po wylogowaniu anulować aktywne pobieranie i uniemożliwić opóźnionej odpowiedzi ponowne ustawienie stanu poprzedniej sesji. Zachować timeout i cleanup istniejącego hooka.
11. Sekretne klucze, hasła SMTP, kody, hasła użytkowników oraz tokeny nie trafiają do repo, logów, komunikatów błędów, parametrów tras ani dokumentu mapy. Publiczny klucz publishable Supabase jest przeznaczony do klienta; `service_role` i klucze secret/admin nigdy do aplikacji.
12. Rzeczywisty publiczny API endpoint wymaga HTTPS. Lokalne HTTP z adresem LAN i portem 8787 służy pracy deweloperskiej. Wdrożenie nie wymaga budowania nowej platformy hostingu.

## 8. Wersje, styl i optymalizacja

**Najpierw analiza aktualnego kodu, potem minimalny wymagany zakres zmian.** Wykonawcy ponownie sprawdzają stan `main`, jeśli zmieni się po wskazanym commicie. Każda przebudowa istniejącej części musi mieć uzasadnienie związane z auth i zostać opisana w PR.

- Zachować Expo SDK 58 i aktualną architekturę. „Aktualne API” oznacza zgodność z wersjami projektu, nie zbiorczą aktualizację wszystkiego do najnowszej wersji.
- Nowe biblioteki muszą działać w Expo Go i WWW. Nie dodawać pakietu wymagającego własnego kodu natywnego w tym etapie. Osoba 1 koordynuje `package.json` i `package-lock.json`; nie wykonywać `npm audit fix --force` jako pobocznej poprawki.
- Stosować TypeScript strict, konkretne typy i kontrolowane błędy. Nie maskować problemów przez nieuzasadnione `any`, `@ts-ignore` albo wyłączenie rygoru kompilatora.
- Logikę auth oddzielić od formularzy; używać wspólnego klienta i komponentów tam, gdzie rzeczywiście eliminują duplikację. Nie przenosić całej aplikacji na inny system stanu ani nowy zestaw UI.
- Zachować konwencje najbliższych plików. Obecny kod używa `StyleSheet`, jasnego tła `#F7F7F2`, białych powierzchni, zieleni `#07966D`, tekstu `#152D43` i zaokrąglonych kontrolek. Nowe formularze mają pasować do tego stylu, bez globalnego przeformatowania istniejących plików.
- Jedna kontrolowana inicjalizacja klienta, odtwarzania sesji i subskrypcji. Prawidłowe zależności efektów oraz usuwanie listenerów, timeoutów i żądań. Sprawdzić zachowanie przy ponownym montowaniu komponentów.
- Nie przenosić auth do iframe/WebView mapy. Nie zmieniać formatu katalogu, grupowania punktów ani źródeł danych.
- Optymalizacje uzasadniać zachowaniem aplikacji: unikać zbędnych żądań, renderów i resetów mapy. Nie dodawać abstrakcji lub memoizacji wyłącznie na zapas.

## 9. Konfiguracja i dokumentacja do oddania

Osoba 1 rozszerza istniejący `.env.example` i README; osoba 2 uzupełnia instrukcję ekranów i odbioru. Jako spójny punkt wyjścia przyjąć:

| Zmienna | Przeznaczenie |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Adres projektu używany przez aplikację. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publiczny klucz klienta. |
| `SUPABASE_URL` | Adres projektu dla osobnego serwera Node, jawnie odczytywany i weryfikowany przez serwer. |
| Dodatkowe zmienne backendu | Tylko te, których wymaga wybrana metoda weryfikacji; wyjaśnić ich przeznaczenie i tajność. |
| Istniejące zmienne sklepów | Zachować `EXPO_PUBLIC_STORES_API_URL`, `SMARTCART_DATA_DIR`, `SMARTCART_DATA_PORT`. |

Nazwy wolno zmienić po wspólnym uzgodnieniu, ale instrukcja i kod mają być zgodne. Rzeczywiste lokalne wartości przechowywać w ignorowanym `.env.local`. Hasła SMTP konfiguruje się po właściwej stronie usługi; nie jako zmienne `EXPO_PUBLIC_*`.

Dołączyć: opis ustawień Supabase, źródła i lokalizację konfiguracji SMTP bez sekretów, bezpieczne szablony obu maili w repo, faktyczne parametry haseł/kodów, sposób uruchomienia obu procesów i listę testów. Jeśli ustawienie w dashboardzie nie jest częścią migracji, zapisać je w instrukcji. Kod ani instrukcja nie mogą wymagać znajomości prywatnego komputera jednego autora.

## 10. Testy i kryteria odbioru

### 10.1. Sprawdzenia bazowe wykonane przy analizie

| Kontrola | Wynik |
| --- | --- |
| `npm.cmd test` w `smart_cart` | **10/10 testów przeszło.** |
| `npx.cmd tsc --noEmit` | **Przeszło.** |
| `npm.cmd run server:check` | **Przeszło; 7753 sklepy.** |
| `npm.cmd ls --depth=0` | **Przeszło; bez brakujących bezpośrednich zależności.** |
| `node --test dane-sklepow/*.test.mjs` z głównego katalogu repo | **37/37 testów przeszło.** |
| `node dane-sklepow/przygotuj-dane.mjs --check` | **Przeszło; 7753 gotowe, 580 do weryfikacji.** |
| `npm.cmd run test:e2e` | **11/11 testów przeszło; końcowy kod procesu 0.** |

Testy przeglądarkowe używają prawdziwego silnika MapLibre z lokalnych plików i zastępczego podkładu. Nie potwierdzają działania zewnętrznego dostawcy map ani gestów na fizycznym telefonie. Rzeczywistej wysyłki emaili i konfiguracji Supabase nie testowano, ponieważ integracja jeszcze nie istnieje.

W tym uruchomieniu na Windows zawiesiło się końcowe sprzątanie serwera uruchomionego przez Playwright, już po zakończeniu wszystkich przypadków. Zakończono wyłącznie procesy testowego Expo po potwierdzeniu ich pochodzenia; wtedy runner zakończył się poprawnie i zapisał status `passed`. Wartość czasu całego uruchomienia obejmuje ten przestój. Nie pozostawiono testowego serwera.

W repo istnieje `npm run lint`, ale brak bezpośredniej zależności ESLint i konfiguracji lintowania. **Nie deklarować, że lint jest zielony** — podczas analizy go nie uruchamiano, aby nie inicjalizować instalacji/konfiguracji. Node zgłasza ostrzeżenia `MODULE_TYPELESS_PACKAGE_JSON` dla istniejących modułów JS/TS; nie są to niepowodzenia testów. Nie zmieniać globalnie systemu modułów tylko po to, aby uciszyć ostrzeżenie.

### 10.2. Obowiązkowe scenariusze funkcjonalne

| Scenariusz | Oczekiwany wynik | Odpowiedzialność |
| --- | --- | --- |
| Nowy dowolny adres email | Rejestracja i rzeczywiste doręczenie kodu, także poza zespołem Supabase | 1 + 2 |
| Niepotwierdzone konto | Brak dostępu do aplikacji i danych API | 1 + 2 |
| Poprawny kod rejestracji | Potwierdzone konto i prawidłowe wejście do aplikacji | 1 + 2 |
| Błędny, wygasły lub ponownie użyty kod | Kontrolowany błąd, bez przejścia do chronionej części | 1 + 2 |
| Kod użyty w innym procesie | Brak wykonania niewłaściwej operacji | 1 + 2 |
| Ponowne wysłanie i limit | Działająca wysyłka, właściwy stan oczekiwania, respektowanie limitów serwera | 1 + 2 |
| Istniejące konto / niepotwierdzona rejestracja | Brak duplikatów i możliwość kontynuowania właściwego procesu | 1 + 2 |
| Poprawne i błędne hasło | Odpowiednio sesja lub komunikat; brak obchodzenia logowania | 1 + 2 |
| Odzyskiwanie hasła | Kod → nowe hasło → zakończenie sesji odzyskiwania → logowanie | 1 + 2 |
| Restart podczas odzyskiwania | Wznowienie tylko właściwego procesu albo bezpieczny powrót do logowania | 1 + 2 |
| Nowe i stare hasło po zmianie | Nowe działa; stare jest odrzucane | 1 |
| Restart / powrót z tła | Ważna zwykła sesja odtwarza się; brak chwilowego pokazania niewłaściwego ekranu | 1 + 2 |
| Brak internetu / awaria Supabase | Komunikat i ponowienie; brak zastępczego zalogowania i pętli żądań | 1 + 2 |
| Bezpośrednie adresy ekranów, reload, wstecz/dalej | Niezalogowany pozostaje poza chronionymi ekranami | 2 |
| Wylogowanie i zmiana użytkownika | Historia i opóźnione odpowiedzi nie ujawniają poprzedniego stanu | 1 + 2 |
| API: brak tokenu, fałszywy, wygasły lub z innego projektu | Brak katalogu i właściwy kod błędu | 1 |
| API: `HEAD` i pasujący ETag bez tokenu | Brak obejścia ochrony przez `HEAD` lub `304` | 1 |
| API: preflight z `Authorization` | `OPTIONS` działa, a właściwe żądanie nadal wymaga sesji | 1 |
| Mapa po zalogowaniu | Filtry, wyszukiwanie, karta, lokalizacja i nawigacja działają jak wcześniej | 2 |
| Mały ekran i klawiatura | Widoczny formularz, błędy i przyciski; działające wklejanie kodu | 2 |

### 10.3. Automatyzacja i polecenia

Osoba 1 dodaje testy operacji, granic sesji i rzeczywistego HTTP API z kontrolowanym weryfikatorem/tokenami testowymi. Przynajmniej jeden scenariusz integracyjny weryfikuje połączenie z rzeczywistym Supabase. Sam mock zwracający „sukces” nie potwierdza integracji.

Osoba 2 dodaje testy formularzy i chronionej nawigacji oraz dostosowuje istniejące testy mapy. Można użyć jawnych fixture’ów sesji w środowisku testowym; nie dodawać produkcyjnego parametru lub przełącznika pomijającego logowanie. Testy nie mogą wymagać ręcznego wpisywania prawdziwego OTP przy każdym uruchomieniu.

Podstawowe komendy, uruchamiane z `smart_cart` po wdrożeniu:

```powershell
npm.cmd ci
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run server:check
npm.cmd run test:e2e
npx.cmd expo export --platform all
```

`npm ci` wykonywać w czystej kopii/uzgodnionym środowisku, nie w trakcie pracy drugiej osoby na wspólnym katalogu. Eksporty uruchamiać przy zatrzymanym Metro. W ramach tej analizy nie wykonywano nowego eksportu ani reinstalacji zależności. Po wdrożeniu wymagane są też ręczne testy na Androidzie w Expo Go i w przeglądarce. Wsparcie iOS trzeba sprawdzić na dostępnym urządzeniu/symulatorze i uczciwie opisać zakres weryfikacji.

## 11. Kolejność realizacji i PR-y

1. **Obie osoby:** aktualizacja własnych kopii `main`, lektura wskazanych plików i potwierdzenie zakresu niezbędnych zmian. Bez wspólnego katalogu roboczego.
2. **Osoba 1:** pierwszy mały PR z kontraktem, typami, podstawą integracji i instrukcją konfiguracji. Osoba 2 zaczyna ekrany na uzgodnionych typach, używając zastępnika tylko do pracy/testów.
3. **Osoba 1:** operacje email/kod, sesja, SMTP, zabezpieczenie API i pobierania sklepów. **Osoba 2:** formularze, nawigacja i profil. Zmiany wspólnych plików są koordynowane, nie nadpisywane.
4. **Obie osoby:** integracja na wspólnej podstawie po aktualizacji gałęzi; testy pełnego przebiegu i poprawienie regresji.
5. **Wzajemny odbiór:** każda osoba odtwarza rozwiązanie z instrukcji drugiej. Do odbioru całości nie pozostawia się dodatkowego zadania integracyjnego dla lidera.

Nie scalać do `main` stanu z wymaganym logowaniem, ale niedziałającą rejestracją, ani zabezpieczonego API bez działającej obsługi tokenów w aplikacji. Jeśli potrzebna jest tymczasowa wspólna gałąź integracyjna, obie osoby ustalają ją przed PR-ami. Każdy PR ma mieć opis problemu i końcowego zachowania, uzasadnienie ingerencji w istniejące pliki, wynik testów oraz zrzuty ekranów zmian UI. Instalację zależności wykonuje osoba 1 i dołącza lockfile. Bez bezpośredniego pushowania implementacji do `main`.

## 12. Definicja ukończenia

- [ ] Wszystkie procesy z rozdziału 1 działają z rzeczywistym Supabase i rzeczywistym mailem.
- [ ] Rejestracja jest otwarta dla każdego; email wymaga potwierdzenia kodem.
- [ ] Reset również używa kodu; nie wymaga strony pośredniej ani linku do Expo Go.
- [ ] Sesja, odzyskiwanie, wylogowanie i ochrona historii działają zgodnie z opisem.
- [ ] Chronione są ekrany oraz API; CORS, cache, `HEAD` i `304` są przetestowane.
- [ ] Dotychczasowa mapa i format danych zachowały działanie.
- [ ] TypeScript, testy bazowe i nowe testy przechodzą; eksporty są sprawdzone.
- [ ] Działanie potwierdzono w Expo Go i WWW; ograniczenia pozostałych platform zapisano.
- [ ] README, `.env.example`, szablony maili i konfiguracja Supabase są kompletne i bez sekretów.
- [ ] Osoba inna niż autor uruchomiła projekt z czystej kopii na podstawie instrukcji.
- [ ] Nie pozostały atrapy odpowiedzi, niedziałające przyciski ani `TODO` zastępujące obowiązkowy zakres.
- [ ] Każda zmiana istniejącego kodu ma związek z zadaniem, a całość przeszła przegląd.

## 13. Jawnie odłożony kolejny etap

Po ukończeniu tego zadania planowane są:

- logowanie przez Google w tym samym systemie kont Supabase;
- potwierdzanie emaila i reset hasła przez link otwierający właściwy ekran aplikacji;
- development build i konfiguracja powrotów do aplikacji, dopasowana do platform.

Istniejący `scheme: "smartcart"` jest punktem wyjścia, a nie gotową integracją. Obecnego zadania nie blokujemy przyciskami Google, konfiguracją OAuth ani niedokończonymi przekierowaniami. Rozdzielenie logiki auth i formularzy ma ułatwić późniejszą rozbudowę. [Expo: OAuth i ograniczenia Expo Go](https://docs.expo.dev/guides/authentication/), [Supabase: mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).

---

Dokument powstał na podstawie rzeczywistego kodu wskazanego commitu, wykonanych kontroli oraz oficjalnej dokumentacji podlinkowanej przy wymaganiach. Nie jest potwierdzeniem istniejącej konfiguracji zdalnego Supabase ani wdrożenia opisanej funkcji.
