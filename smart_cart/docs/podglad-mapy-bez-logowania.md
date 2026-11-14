# Podgląd mapy — aktualizacja po integracji logowania

**Aktualizacja: 14 listopada 2026. Poprzednia instrukcja podmiany dwóch plików jest nieaktualna.**
Dotyczyła stanu sprzed integracji UI. Obecny główny layout wymaga `signedIn` i nie montuje mapy dla osoby wylogowanej.
Sama zmiana `useStores.ts` i weryfikatora serwera nie otworzy ekranu mapy.

W kodzie nie ma zaimplementowanej flagi `--preview-map` ani produkcyjnego przełącznika omijającego auth.
Nie należy traktować wcześniejszego fragmentu instrukcji jako dostępnej funkcji aplikacji.

## Podgląd rzeczywistego katalogu

1. Przygotuj konfigurację według [README](../README.md).
2. Uruchom `npm.cmd run server` oraz `npm.cmd start` w osobnych terminalach.
3. Zaloguj się istniejącym, potwierdzonym kontem.
4. Otwórz zakładkę **Sklepy**.

Katalog ma 7753 gotowe placówki. API wymaga tokenu; ręczne otwarcie `/v1/stores` bez niego zwraca oczekiwane 401.
Do kontroli samego pliku danych bez logowania i bez sieci służy:

```powershell
npm.cmd run server:check
```

To kontrola danych, nie wizualny podgląd mapy.

## Automatyczny test mapy bez rzeczywistego konta

Playwright uruchamia aplikację z fikcyjną sesją i katalogiem oraz prawdziwym silnikiem MapLibre:

```powershell
$env:MAP_TEST_PORT = '8091'
npm.cmd run test:e2e -- tests/browser/stores.spec.ts
Remove-Item Env:MAP_TEST_PORT
```

Potrzebne są Google Chrome i wolny port. Testy korzystają z lokalnych zasobów biblioteki i zastępczego podkładu, więc nie są interaktywnym podglądem rzeczywistych 7753 sklepów.
Przed naprawami audyt miał wynik 12/17. Po wdrożeniu wszystkie testy mapy oraz nowe testy zakupów przechodzą: łącznie 20/20. [Bieżący raport](wdrozenie-po-audycie.md).

Żaden z tych sposobów nie wymaga wyłączania ochrony dostępu w kodzie.
