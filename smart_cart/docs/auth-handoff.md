# Przekazanie i odbiór integracji logowania

Stan po wdrożeniu **14 listopada 2026**. Formularze, profil, bramka, nawigacja i moduły zakupowe są połączone. [Raport wdrożenia](wdrozenie-po-audycie.md) opisuje zakres i ograniczenia; [audyt](stan-projektu.md) zachowuje stan sprzed napraw.

## Miejsca integracji

| Element | Implementacja |
| --- | --- |
| Provider | Jeden `AuthProvider` w `src/app/_layout.tsx` |
| Bramka | `AppShell`; Tabs pozostaje zamontowane, lecz jest ukryte i niedostępne poza `signedIn` |
| Formularze | `src/features/auth/AuthScreen.tsx`, tryby lokalne bez tras `/auth/*` |
| Cel nawigacji | `src/features/auth/navigation.ts`, tylko dozwolone ekrany aplikacji |
| Wspólny wygląd | `AuthShell` i `src/components/ui/Controls.tsx` |
| Profil | Email i wylogowanie; błąd po przejściu do formularza przez `accountNotice` |
| Operacje i sesja | `src/features/auth` i jeden klient `src/lib/supabase.ts` |
| Dane zakupowe | `src/features/catalog`, zapytania i operacje przypisane do klucza sesji |
| Dane mapy | `useStores` → `fetchCatalog` → osobne API z weryfikacją tokenu |

Naprawiono zmianę adresu, wyniki ponownej wysyłki, odliczanie, blokowanie duplikatów, anulowanie i spóźnione wyniki, powrót z recovery oraz utratę trasy przy odtwarzaniu sesji. Kontrakt: [auth-contract.md](auth-contract.md); magazyn i cykl życia: [auth-session.md](auth-session.md); API: [auth-api.md](auth-api.md).

## Druga kopia projektu

1. `npm.cmd ci` w `smart_cart`.
2. Uzupełnij `.env.local` publiczną konfiguracją wspólnego projektu. Klient i serwer mapy muszą wskazywać ten sam projekt.
3. Uruchom `npm.cmd run server` oraz `npm.cmd start` w osobnych terminalach.
4. Zaloguj się i sprawdź produkty, listy oraz mapę. Ręczne otwarcie `/v1/stores` bez tokenu powinno zwracać 401.
5. Po zmianie konfiguracji/dependencji zrestartuj odpowiednie procesy. Telefon wymaga dostępu do portu 8787 komputera.
6. Nie wdrażaj ponownie pięciu migracji do istniejącego projektu i nie nadpisuj konfiguracji chmury lokalnym TOML.

## Weryfikacja

89/89 Node, 20/20 Playwright, TypeScript, lint, testy SQL/RLS, eksport WWW/Android/iOS oraz 37/37 testów danych mapy zaliczone. Playwright działa na osobnym porcie 8091 z fikcyjnymi sesjami, bez wysyłek mailowych. Zdalne RPC i odmowa dostępu gościa zostały sprawdzone po migracjach.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run server:check
npm.cmd run test:e2e
```

Test migracji wymaga osobnego kontenera Postgres, zgodnie z [instrukcją](utrzymanie-katalogu.md). Zdalny katalog nadal wymaga uzupełnienia metadanych; niepełne wyceny są oczekiwanym zachowaniem przy braku potwierdzonych danych.

## Ręczny odbiór do wykonania

Poniższe punkty nie zostały potwierdzone w tej sesji na rzeczywistych urządzeniach i skrzynkach. Nie są listą niewdrożonych poprawek.

- Rejestracja, dostarczenie kodu, błędny/wygasły kod, zmiana adresu i ponowna wysyłka.
- Pełny reset kodem, nowe hasło i odrzucenie starego, restart podczas recovery.
- Sesja po zamknięciu aplikacji, przejścia tło/powrót, przerwy sieci i ponowienie.
- Klawiatura, wklejanie OTP, gesty mapy i lokalizacja na fizycznym Androidzie/iOS.
- Zapis list na jednym urządzeniu i odczyt po zalogowaniu na drugim; równoczesne zmiany wymagają odświeżenia.

Historyczne testy prawdziwych kont i maili z 8–9 listopada są w [auth-operations.md](auth-operations.md). Nie ponawiano ich automatycznie.
