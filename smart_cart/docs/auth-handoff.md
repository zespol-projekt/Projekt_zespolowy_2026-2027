# Przekazanie i odbiór — punkt 6

Stan na 9 listopada 2026: część osoby 1 jest przygotowana do połączenia z ekranami
osoby 2. Działają operacje konta, sesja i ochrona API. Nie oznacza to ukończenia
całej funkcji logowania w aplikacji: formularze, profil i chroniona nawigacja
czekają na implementację osoby 2 oraz wspólny odbiór.

## Co jest gotowe

| Punkt | Zakres i dokumentacja |
| --- | --- |
| 1 | [Kontrakt](auth-contract.md), typy wyników, stanów i operacji w `src/features/auth/types.ts`. |
| 2 | [Konfiguracja Supabase i SMTP](supabase-setup.md), `.env.example`, dwa polskie szablony maili z kodem. Doręczenie sprawdzone na prawdziwych skrzynkach. |
| 3 | [Operacje konta](auth-operations.md): rejestracja, potwierdzenie, logowanie, ponowna wysyłka, reset hasła i wylogowanie. |
| 4 | [Sesja i provider](auth-session.md): trwałe zwykłe logowanie, odtwarzanie, odświeżanie, `AuthProvider`, `useAuth`. Recovery tylko w pamięci. |
| 5 | [Chronione API](auth-api.md): weryfikacja użytkownika w Supabase, token przy pobieraniu sklepów, jedno ponowienie po `401`, anulowanie i czyszczenie danych przy zmianie sesji. |
| 6 | Niniejsze przekazanie, wyniki sprawdzeń i scenariusze wspólnego odbioru. |

Kod mapy, format katalogu i zbiór sklepów zachowują dotychczasową funkcję.
API wymaga teraz sesji, dlatego samo otwarcie zakładki Sklepy bez zalogowania
nie wyświetli mapy. To oczekiwany stan przed podłączeniem formularzy.

## Co ma zrobić osoba 2

1. Pracuj na kopii zawierającej zmiany osoby 1 oraz `package-lock.json`. W swojej
   kopii, z katalogu `smart_cart`, wykonaj `npm.cmd ci`. Utwórz `.env.local`
   według `.env.example`, używając adresu i publicznego klucza **wspólnego** projektu.
   Ten plik nie jest w Git. Nie zakładaj nowego Supabase ani osobnego SMTP.
2. W `src/app/_layout.tsx` otocz całe drzewo nawigacji jednym `AuthProvider`
   importowanym z `@/features/auth`. Provider pozostaje zamontowany zarówno dla
   formularzy, jak i właściwej aplikacji. Nie twórz drugiego klienta lub magazynu sesji.
3. Formularze korzystają z `useAuth()` z tego samego modułu. Typy wyników są
   w kontrakcie; sukces operacji to `result.ok`, a komunikat błędu to
   `result.error.message`. Formularz blokuje ponowne wysłanie podczas oczekiwania.
4. Dodaj ekrany logowania, rejestracji, potwierdzenia kodu, rozpoczęcia resetu,
   kodu resetu, nowego hasła oraz profil z emailem i wylogowaniem.
   Wynik `confirmationRequired` kieruje do kodu; `signInRequired` po potwierdzeniu
   kieruje do logowania. Nie uznawaj samego udanego `signUp` za zalogowanie.
5. Zabezpiecz nawigację zgodnie z tabelą poniżej, również przy bezpośrednim adresie,
   przeładowaniu oraz użyciu przycisków wstecz/dalej. Hasła i kody trzymaj wyłącznie
   w formularzu; nie przekazuj ich ani tokenów przez parametry tras.
6. Do pobierania sklepów pozostaw `useStores`. Tokeny i refresh są już obsługiwane.
   Uruchom API przez `npm.cmd run server`, a Expo w drugim terminalu przez
   `npm.cmd start`. Dodaj testy swoich formularzy i chronionej nawigacji.

| `state.status` | Dostępny widok |
| --- | --- |
| `initializing` | Neutralne ładowanie; bez chwilowego pokazania chronionych ekranów. |
| `signedOut` | Formularze konta. |
| `signedIn` | Aplikacja i mapa. |
| `recovery` | Wyłącznie proces resetu; przy `verifyingCode` oczekiwanie, przy `settingPassword` formularz nowego hasła. |
| `error` | Komunikat i przycisk `retrySession`; bez dostępu do chronionej części. |

Nowe hasło ma minimum 8 znaków, kod dokładnie 6 cyfr (również z zerem na początku).
`authPolicy` udostępnia te wartości, ważność kodu 600 sekund i odstęp wysyłki 60 sekund.
Frontend pokazuje odliczanie, a rzeczywiste ograniczenia egzekwuje Supabase.
Nie przycinaj haseł i kodów. Przy resecie pokazuj neutralną informację o wysyłce,
bez ujawniania, czy konto istnieje. Po udanym `setNewPassword` następuje `signedOut`;
użytkownik loguje się nowym hasłem. Przeładowanie w trakcie recovery wymaga nowego resetu.

## Wyniki sprawdzeń

Wyniki dotyczą obecnego kodu osoby 1. Testy z kontrolowanymi odpowiedziami SDK/HTTP
nie są dowodem ukończenia formularzy ani odbioru na telefonie.

| Kontrola | Wynik i zakres |
| --- | --- |
| Testy Node | 82/82; operacje auth, storage, sesja, wyścigi odpowiedzi, refresh, timeout, HTTP API i model mapy. |
| TypeScript | `npx.cmd --no-install tsc --noEmit` — zaliczone. |
| Zależności | `npm.cmd ls --depth=0` — bez brakujących bezpośrednich zależności. |
| Chrome / Playwright | 17/17; mapa, trasy, brak sesji, zmiana sesji, wylogowanie i jednokrotne ponowienie `401`. Sesje testowe i podkład są fikcyjne. |
| Dane | `server:check` — 7753 sklepy; działa także bez konfiguracji auth. |
| Konfiguracja serwera | Start bez konfiguracji Supabase odrzucony; `/health` publiczny, katalog chroniony. |
| Prawdziwy Supabase i maile | 8–9 listopada: rejestracja i potwierdzenie, logowanie, reset kodem, nowe hasło działa / stare odrzucone, lokalne wylogowanie. [Opis](auth-operations.md). |
| Weryfikator API a prawdziwy Supabase | Fałszywy token odrzucony (`401`); pozytywne scenariusze HTTP API testowane z kontrolowanym transportem. |
| Eksport aplikacji | Android, iOS i WWW — zaliczone, proces zakończony kodem 0. Pliki lokalne w ignorowanym `.expo/auth-final-export`; niczego nie publikowano. |
| Lint | Nie zaliczono: istniejące polecenie nie ma konfiguracji ani zależności ESLint. Nie instalowano ich w ramach auth. |
| Odbiór Expo Go / iOS | Pełny przebieg logowania i mapy wymaga jeszcze formularzy oraz ręcznego sprawdzenia. Testy Chrome nie zastępują urządzenia. |

Polecenia do powtórzenia po połączeniu zmian, z katalogu `smart_cart`:

```powershell
npm.cmd test
npx.cmd --no-install tsc --noEmit
npm.cmd run server:check
npm.cmd run lint
npm.cmd run test:e2e
npx.cmd --no-install expo export --platform all --max-workers 2 --clear
```

Playwright wymaga Google Chrome i uruchamia własne Expo z fikcyjnym projektem
Supabase; zatrzymaj wcześniej Metro. Eksport również wykonuj bez działającego Metro.
W kontroli końcowej eksport z jednym workerem zatrzymywał się przy starcie Metro;
powiodła się próba z czystym cache i dwoma workerami, jak w poleceniu powyżej.
Sprawdzenie pakowania nie jest testem uruchomienia aplikacji na urządzeniu.
W środowisku blokującym procesy runnera użyj
`node --test --test-isolation=none tests/*.test.mjs`.
Nie powtarzaj testów prawdziwej wysyłki przy każdym uruchomieniu testów automatycznych.

## Wspólny odbiór po podłączeniu UI

Każdy scenariusz sprawdźcie w przeglądarce i na Androidzie w Expo Go. iOS oznaczcie
jako sprawdzony dopiero po próbie na dostępnym urządzeniu lub symulatorze.

- [ ] Nowy adres spoza zespołu Supabase: rejestracja, odbiór kodu, brak dostępu przed potwierdzeniem, potwierdzenie i wejście do aplikacji.
- [ ] Błędny, wygasły i ponownie użyty kod oraz kod z innego procesu: komunikat, bez wejścia do chronionej części.
- [ ] Ponowna wysyłka i poprawienie emaila: właściwy proces, odliczanie, obsługa limitu; brak duplikacji żądań. Faktycznej granicy 30 maili/h dotychczas nie wyczerpywano.
- [ ] Logowanie poprawnym i błędnym hasłem; niepotwierdzone konto wraca do potwierdzania.
- [ ] Reset: kod → nowe hasło → logowanie; stare hasło odrzucone. W trakcie resetu mapa niedostępna, a przeładowanie nie daje zwykłej sesji.
- [ ] Zwykłe logowanie przetrwa zamknięcie i ponowne otwarcie; tło → powrót odtwarza właściwy stan bez migania chronionych ekranów.
- [ ] Brak internetu / awaria API: komunikat i ponowienie, bez pętli żądań i zastępczego zalogowania.
- [ ] Wylogowanie w trakcie pobierania i w drugiej karcie: znikają dane; nowa sesja tego samego konta nie przyjmuje starej odpowiedzi.
- [ ] Bezpośredni adres chronionego ekranu, reload i wstecz/dalej nie obchodzą ochrony; profil pokazuje właściwy email i umożliwia wylogowanie.
- [ ] Po zalogowaniu działają filtry, wyszukiwanie, karta sklepu, lokalizacja i nawigacja. Mały ekran i klawiatura nie zasłaniają formularzy, działa wklejanie kodu.
- [ ] Druga osoba uruchomiła projekt z własnej czystej kopii według README; po integracji ponownie przeszły testy i eksport.

Do chwili wspólnego odbioru pozostają otwarte: chroniona nawigacja/formularze,
test całego przebiegu UI z rzeczywistym Supabase, testy urządzeń i kontrola czystej kopii.
Nie scalajcie do `main` samego wymagania logowania bez działającego UI.
Granice ochrony JWT i recovery są opisane w [dokumencie API](auth-api.md).
