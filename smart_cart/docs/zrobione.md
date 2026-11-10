# Zrobione — zakres osoby 1 w SMARTCART

Data sprawdzenia: **10 listopada 2026 r.**

Podstawa: `RAPORT_WDROZENIA_LOGOWANIA_SUPABASE.md` z 3 listopada 2026,
w szczególności rozdział 4 „Osoba 1 — pełen zakres”, kontrakt z rozdziału 5,
wymagania API z rozdziału 7 oraz kryteria odbioru z rozdziałów 10–12.
Porównano je z obecnym kodem, konfiguracją lokalną, testami i zapisanymi wynikami
wcześniejszych prób z rzeczywistym Supabase.

## Wniosek

**Zakres implementacyjny osoby 1 jest wykonany i przygotowany do integracji.**
Istnieją rzeczywiste operacje Supabase, wspólna sesja, wysyłka kodów oraz chronione API.
Nie stwierdzono brakującej funkcji w samodzielnym zakresie implementacyjnym osoby 1.

**Nie oznacza to ukończenia całego raportu ani odbioru całej aplikacji.**
Osoba 2 musi jeszcze przygotować formularze, profil i ochronę nawigacji.
Obie osoby nadal mają obowiązek połączyć swoje zmiany, sprawdzić pełny przebieg
na urządzeniu i odtworzyć uruchomienie na osobnej czystej kopii.

## Zrealizowane wymagania osoby 1

| Wymaganie raportu | Co wykonano | Gdzie sprawdzić |
| --- | --- | --- |
| Wspólny projekt Supabase i rejestracja emailem | Używany jest projekt zespołu. Rejestracja jest otwarta, dostawca email włączony, automatyczne potwierdzanie i konta anonimowe wyłączone. Ponownie sprawdzono publiczne ustawienia Auth 10 listopada. | [Konfiguracja](supabase-setup.md), [klient](../src/lib/supabase.ts). |
| Jeden klient aplikacji, kontrakt i provider/hook | Jeden współdzielony klient, typowane wyniki, stany i operacje oraz `AuthProvider/useAuth`. Serwer ma osobnego klienta bez utrwalania sesji użytkownika. | [Typy](../src/features/auth/types.ts), [provider](../src/features/auth/AuthProvider.tsx), [instancja](../src/features/auth/instance.ts), [weryfikator API](../server/auth.mjs). |
| Przechowywanie sesji | Zwykła sesja: AsyncStorage na telefonie i localStorage na WWW, przez wspólny adapter. Sesja recovery wyłącznie w pamięci; hasła i kody nie są utrwalane. Właściwości magazynów są opisane. | [Adapter](../src/features/auth/storage.ts), [opis sesji](auth-session.md). |
| Odtwarzanie, refresh i cykl życia | Odtwarzanie sesji ze sprawdzeniem użytkownika, odświeżanie, powrót z tła, obsługa zdarzeń między kartami, wylogowanie oraz sprzątanie współdzielonych subskrypcji. Błąd sieci pozwala ponowić sprawdzenie. | [Serwis auth](../src/features/auth/service.ts), [instancja/AppState](../src/features/auth/instance.ts). |
| Wszystkie operacje konta | `signUp`, `verifySignupCode`, `resendSignupCode`, `signIn`, `sendPasswordResetCode`, `verifyPasswordResetCode`, `setNewPassword`, `signOut` oraz pomocnicze `retrySession`. Kod jest weryfikowany przez Supabase; reset ma osobny stan recovery i kończy się lokalnym wylogowaniem. | [Operacje](auth-operations.md), [implementacja](../src/features/auth/service.ts), [polskie błędy](../src/features/auth/errors.ts). |
| Polskie maile i polityka kodów/haseł | Dwa szablony z `{{ .Token }}`. Minimum nowego hasła: 8 znaków; kod: 6 cyfr, ważność: 600 sekund; odstęp wysyłki: 60 sekund; limit projektu: 30 maili/h. Wartości odnotowano z konfiguracji projektu. | [Potwierdzenie konta](../supabase/email-templates/confirm-signup.html), [reset hasła](../supabase/email-templates/reset-password.html), [ustawienia](supabase-setup.md). |
| SMTP i zwykłe adresy odbiorców | Użytkownik skonfigurował Gmail SMTP w Supabase. W testach 8–9 listopada kody rejestracji i resetu dotarły na kontrolowane skrzynki testowe spoza zespołu Supabase. | [Wyniki konfiguracji i doręczenia](supabase-setup.md), [testy rzeczywistych operacji](auth-operations.md). |
| Ochrona API i pobieranie sklepów | Weryfikacja tokenu i potwierdzonego konta, obsługa `401/403/503`, brak publicznego cache, ochrona `HEAD/304`, CORS, aktualny token, wspólny refresh, jedno ponowienie oraz anulowanie przy zmianie sesji. | [Serwer](../server/serwer-mapy.mjs), [weryfikator](../server/auth.mjs), [hook](../src/features/stores/useStores.ts), [pobieranie](../src/features/stores/fetchCatalog.ts). |
| Testy, zależności i instrukcje | Testy modułu auth, storage, sesji, SDK, serwera i pobierania. Dostosowane fixture'y mapy i dodatkowe testy przeglądarkowe. Zależności oraz lockfile, przykład env i instrukcja przekazania są w projekcie. Osobna tabela profili ani migracja bazy nie były potrzebne. | [Testy](../tests), [przykład env](../.env.example), [package.json](../package.json), [lockfile](../package-lock.json), [instrukcja dla kolegi](auth-handoff.md). |

## Szczegóły ochrony API

- `GET` i `HEAD /v1/stores` wymagają tokenu zalogowanego użytkownika z potwierdzonym
  emailem. Publiczny klucz projektu nie zastępuje tego tokenu.
- Serwer wywołuje rzeczywiste `auth.getUser(token)` właściwego projektu, następnie
  sprawdza wymagane pola JWT. Samo odkodowanie tokenu nie daje dostępu.
- Kontrola dostępu następuje przed katalogiem, jego ETag i odpowiedzią `304`.
  Odpowiedzi chronione oraz błędy mają `Cache-Control: no-store`.
- `OPTIONS` działa bez tokenu i dopuszcza `Authorization`. `/health` jest publiczny
  i techniczny; `server:check` sprawdza dane bez logowania i otwierania portu.
- Katalog i gzip nadal są buforowane wewnątrz serwera. Format danych i zbiór
  7753 sklepów pozostały zachowane; nie przeniesiono danych do Supabase ani pakietu Expo.
- Pierwsze `401` pozwala na jedno wspólne odświeżenie i jedno ponowienie żądania.
  Kolejne `401` kończy tylko nadal aktualną sesję. Sam refresh nie przeładowuje katalogu.
- Wylogowanie lub nowa sesja przerywa pobieranie i ukrywa poprzednie dane.
  Obowiązuje timeout 15 sekund; stare odpowiedzi nie przywracają katalogu.
- Tokeny nie trafiają do dokumentu mapy, formularzy ani parametrów tras.
  Publiczny endpoint produkcyjny wymaga HTTPS; lokalne HTTP jest do pracy deweloperskiej.

Ograniczenia są jawne: poprawny JWT sam nie dowodzi ukończenia resetu hasła;
lokalne wylogowanie nie gwarantuje natychmiastowego unieważnienia każdej kopii JWT.
Klient nie udostępnia tokenu katalogowi w stanie recovery. Szczegóły:
[granice ochrony i CORS](auth-api.md).

## Wyniki weryfikacji

| Kontrola | Wynik | Kiedy i jaki zakres |
| --- | --- | --- |
| Testy Node | **82/82 zaliczone** | Ponownie 10 listopada: `node --test --test-isolation=none tests/*.test.mjs`. Testy korzystają z kontrolowanych odpowiedzi tam, gdzie potrzebny jest Supabase. |
| TypeScript | **Zaliczone** | Ponownie 10 listopada: `npx.cmd --no-install tsc --noEmit`. |
| Dane sklepów | **Zaliczone, 7753 rekordy** | Ponownie 10 listopada: `npm.cmd run server:check`. |
| Lokalny serwer z obecną konfiguracją i prawdziwym katalogiem | **Zaliczone** | 10 listopada: uruchomiony na wolnym porcie, `/health` → `200`, `GET/HEAD /v1/stores` bez tokenu → `401`, `no-store`. Po sprawdzeniu zatrzymany. |
| Aktualne publiczne ustawienia Supabase Auth | **HTTP 200, zgodne z wymaganiami** | 10 listopada: email włączony, rejestracja otwarta, wymagane potwierdzenie emaila, anonimowe konta wyłączone. Ten odczyt nie sprawdza treści maili ani ustawień SMTP. |
| Testy Chrome/Playwright | **17/17 zaliczone** | Wcześniejsza kontrola 9 listopada: prawdziwy kod mapy i aplikacji, fikcyjna sesja i transport. W tym audycie nie powtarzano bez zmian kodu. |
| Eksport Android, iOS i WWW | **Zaliczony, kod procesu 0** | Wcześniejsza kontrola etapu 6: `expo export --platform all`, czysty cache i dwa workery. To kontrola pakowania, nie test na urządzeniu. |
| Prawdziwe operacje konta i doręczenie kodów | **Zaliczone** | 8–9 listopada: rejestracja, kod, logowanie, reset, zmiana hasła, stare hasło odrzucone / nowe działa, lokalne wylogowanie. Nie ponawiano wysyłki przy sporządzaniu tego raportu. |
| API a rzeczywisty Supabase | **Fałszywy token odrzucony: 401** | Wcześniejszy test negatywny weryfikatora. Pozytywne scenariusze HTTP API są sprawdzone z kontrolowanym transportem, nie jako pełny przebieg z formularza. |
| Lint | **Niezaliczone** | Ponownie 10 listopada: brak konfiguracji i zależności ESLint w repozytorium. Nie uznajemy tego polecenia za zaliczone. |

## Co pozostaje do ukończenia całego raportu

**Osoba 2:** formularze konta, profil z emailem i wylogowaniem, montaż `AuthProvider`
w głównym layoucie, ochrona wszystkich tras i historii oraz testy ekranów.
Obecnie `src/app/_layout.tsx` nie montuje providera ani ochrony tras, a profil jest
pusty. Te elementy nie należą do samodzielnej implementacji osoby 1.

**Wspólnie:** połączenie zmian, pełne przejście od rejestracji do mapy z rzeczywistym
Supabase, ręczny odbiór w przeglądarce i Expo Go, powrót z tła, przerwany reset,
wylogowanie i ponowne logowanie, uruchomienie z czystej kopii przez drugą osobę.
Szczegółowa lista znajduje się w [instrukcji przekazania](auth-handoff.md).

Nie wyczerpywano rzeczywistego limitu 30 maili/h i nie potwierdzono osobnym testem
całej granicy 60 sekund. Wartości pochodzą z panelu, a aplikacja obsługuje błędy limitu.
Lint pozostaje osobną, jawną luką w narzędziach projektu. Wsparcie iOS nie ma jeszcze
potwierdzenia pełnego procesu na urządzeniu/symulatorze.

Google OAuth, linki otwierające aplikację, rozwój produktów/cen i dodatkowy profil
nie są brakami tego etapu — raport odłożył je poza obecny zakres.

## Jak uruchomić projekt

Wymagany Node.js 24. W PowerShell przejdź z głównego katalogu repozytorium do aplikacji:

```powershell
cd .\smart_cart
```

Po świeżym sklonowaniu lub zmianie zależności wykonaj `npm.cmd ci`.
Na obecnym komputerze zależności oraz `.env.local` już są przygotowane.
Na innym komputerze utwórz `.env.local` według [`.env.example`](../.env.example)
i wpisz adres oraz publiczny klucz wspólnego projektu. Nie zastępuj gotowego pliku
przykładowymi wartościami i nie dopisuj hasła SMTP ani klucza `service_role`.

**Terminal 1 — API sklepów**, z katalogu `smart_cart`:

```powershell
npm.cmd run server
```

Pozostaw ten terminal uruchomiony. Adres `http://localhost:8787/health` powinien
pokazać stan `ok`. Bezpośrednie otwarcie `/v1/stores` bez tokenu zwróci `401` — poprawnie.

**Terminal 2 — aplikacja**, również z katalogu `smart_cart`:

```powershell
npm.cmd start
```

Naciśnij **w**, aby otworzyć WWW, albo zeskanuj kod QR w **Expo Go** na telefonie.
Telefon i komputer muszą być w tej samej sieci, a port 8787 komputera dostępny.
Na telefonie `localhost` oznacza telefon. W razie potrzeby ustaw
`EXPO_PUBLIC_STORES_API_URL=http://ADRES_IP_KOMPUTERA:8787/v1/stores` w `.env.local`
i uruchom Expo ponownie. Tunel Expo nie wystawia automatycznie API sklepów.
Zatrzymanie każdego procesu: **Ctrl+C** w jego terminalu.

**Oczekiwany stan teraz:** aplikacja otwiera istniejące ekrany, ale bez sesji nie
pobiera katalogu ani nie pokazuje mapy. Nie ma jeszcze formularzy do zalogowania
z interfejsu. Będzie to możliwe po podłączeniu części osoby 2.

## Przekazanie plików

Na dzień audytu lokalny `.gitignore` zawiera wpis `docs/`. Ten raport został
zapisany w `smart_cart/docs/zrobione.md`, ale nowy plik jest ignorowany przez Git.
Jeżeli ma wejść do commita przy zachowaniu obecnego `.gitignore`, z katalogu
`smart_cart` można dodać go jawnie:

```powershell
git add -f docs/zrobione.md
```

Audyt nie zmieniał `.gitignore`, nie wykonywał commita ani nie wysyłał zmian.
