# Kontrola publikacji Git — 14 listopada 2026

## Zakres i wynik

Przejrzano pliki śledzone i nowe pliki dopuszczone przez reguły Git, a osobno lokalną historię wszystkich referencji. Skan odbywa się lokalnie; treść repozytorium i wartości kluczy nie są wysyłane do serwisu skanującego.

Wartości z lokalnego `.env.local` nie zostały znalezione w publikowanych plikach. Sam plik konfiguracji pozostaje lokalny i ignorowany. Zdalnej bazy Supabase nie zmieniano w ramach tego porządkowania.

W 70 archiwalnych HTML zewnętrznych stron znaleziono 76 wartości pól usług/licencji, m.in. odtwarzacza, monitoringu, wyszukiwania i map. Są to dane dostarczone przez pobrane strony, nie klucze aplikacji SMARTCART. Usunięto ich wartości i zastąpiono znacznikiem `[REDACTED_API_KEY]`. Nie wykonywano żądań sprawdzających ich ważność.

Sumy kontrolne dowodów i ich referencje zostały odświeżone, oryginalne sumy zachowano w opisie sanitizacji. [Raport sanitizacji](../../dane-sklepow/raport-sanitizacji.json) zawiera ścieżki, nazwy pól i skróty SHA-256, bez wartości kluczy. Przebudowano metadane wynikowe zbioru; nie zmieniono danych lokalizacyjnych, adresów ani statusów 7753 gotowych placówek. Przebudowanie plików nie potwierdza aktualności placówek w terenie.

Ogólna reguła skanera zgłaszała też zwykłe identyfikatory źródeł, np. numer sklepu z nazwą rodzaju odpowiedzi, oraz jawny przykładowy klucz grupy produktów. Dodano wąskie wyjątki ograniczone formatem wartości, regułą i ścieżką. Nie wyłączono skanowania całego archiwum, testów ani plików SQL. Rzeczywiste klucze Supabase, także publishable, są zabronione w publikowanych plikach. Niefunkcjonalne fixtury i szablon z placeholderami pozostają do testów i konfiguracji.

## Decyzja właściciela: historia pozostaje bez zmian

Skan `--history` wykrywa te same 76 wartości w już opublikowanym commicie `f4c917a41fe6`. Edycja bieżących plików nie usuwa ich z wcześniejszych wersji.

14 listopada 2026 właściciel wybrał: „Nie przepisuj historii — pozostaw tylko oczyszczone bieżące pliki”. Zakres przygotowania do publikacji obejmuje więc bieżące pliki i indeks Git. Historia oraz zdalny `main` pozostają bez zmian; stare wartości nadal można odczytać w wcześniejszych commitach. Nie wykonuj przepisywania historii ani `push --force` na podstawie tego raportu. Nie utworzono commita ani nie wykonano pushu.

Jeżeli po późniejszych kontrolach zostanie znaleziony rzeczywisty sekret należący do zespołu, samo usunięcie pliku nie unieważnia klucza; potrzebne będzie również jego unieważnienie u dostawcy. W tej kontroli nie wykryto kopii rzeczywistych kluczy lokalnego Supabase w publikowanych plikach.

## Co usunięto i co zachowano

- Dodano główne `.gitignore`: konfiguracje `.env`, prywatne klucze/certyfikaty, cache Expo, zależności, eksporty, raporty testów i lokalny stan Supabase są ignorowane w całym repozytorium.
- Usunięto nieużywane style dawnego formularza z `_layout.tsx`.
- Usunięto lokalnie jednorazowy eksport `.expo/final-export`, robocze raporty katalogu/chmury/lint/npm, kopię schematu sprzed migracji i wygenerowane wyniki testów. Posprzątano też tymczasowe kopie audytu. Zachowano aktywny cache Metro, używaną konfigurację i `node_modules` potrzebne do pracy.
- Zachowano źródła GeoJSON, raporty weryfikacji i dowody — są używane do odtwarzania katalogu i testów. HTML zachowują treść dowodową z usuniętymi wartościami kluczy.
- Zachowano `tests/fixtures/legacy-schema.sql`: to potrzebny punkt startowy testów migracji, nie przypadkowa duplikacja aktualnego schematu.
- Zachowano ikony, splash i zasoby ikony iOS — są wskazane w konfiguracji Expo i pliku ikony.
- Historyczny raport logowania przeniesiono do `docs/` w katalogu głównym repozytorium; linki nie wymagają pliku spoza checkoutu. W nadrzędnym folderze roboczym pozostał odsyłacz.
- Zachowano cztery instrukcje zespołu w `zadania/`; opisują następne zadania, nie ich wykonanie.

## Powtarzalny skan przed commitem

Zainstaluj [Gitleaks](https://github.com/gitleaks/gitleaks) zgodnie z oficjalną instrukcją. Kontrolę wykonano wersją 8.30.1; oficjalny pakiet pobrano do ignorowanego `.audit-local/tools` i zweryfikowano sumą SHA-256 wydania. W innej kopii narzędzie może być w PATH albo wskazane przez `GITLEAKS_BIN`.

Z katalogu `smart_cart`:

```powershell
npm.cmd run check:secrets
```

Tryb domyślny obejmuje bieżące pliki śledzone oraz nowe pliki nieignorowane. Po przygotowaniu indeksu:

```powershell
npm.cmd run check:secrets -- --staged
```

Ten tryb czyta obiekty Git z indeksu, a nie późniejszą wersję roboczą pliku. Sprawdza też zabronione ścieżki i kopie rzeczywistych wartości z lokalnego `.env.local`. Raport wypisuje jedynie ścieżkę, linię i rodzaj problemu. Gitleaks pracuje na tymczasowej kopii w ignorowanym katalogu i zawsze ma redakcję wartości.

Osobna kontrola historii:

```powershell
npm.cmd run check:secrets -- --history
```

Ten tryb nadal kończy się niepowodzeniem z powodu wskazanego starego commita. To oczekiwany wynik dla świadomie zachowanej historii; nie oznacza zaliczonego skanu historii ani nowego wycieku w przygotowanym indeksie. Nie wyciszono tych wykryć. Parametry skanu wyłączają lokalne textconv PDF, które wcześniej przerywały pełny odczyt historii.

Brak Gitleaks, nierozwiązany konflikt indeksu, błąd skanu lub wykrycie sekretu kończą polecenie błędem. Nie pomijaj nieudanej kontroli. Żaden skaner nie zastępuje przeglądu własnego diffu i świadomego wyboru publikowanych plików.

## Sprawdzenie poprawności po porządkowaniu

W tym przebiegu zaliczono 93/93 testy Node (bez pominięć, w tym rzeczywisty pozytywny i negatywny test Gitleaks), TypeScript, ESLint, 37/37 testów danych, kontrolę wyników zbioru i `server:check` dla 7753 placówek. Potwierdzono sumy 70 oczyszczonych HTML i 69 istniejących plików metadanych obok nich, niezmienność danych gotowych placówek oraz brak odsyłaczy dokumentacji wychodzących poza checkout. Skan bieżących plików i dokładnego indeksu Git nie znalazł wycieków. Historia nadal zgłasza 76 wartości ze wskazanego starego commita.

Eksport SQL i stara fixture mają regułę `-text`, aby Windows nie zmienił bajtów objętych SHA-256. Dopuszczono w tych zachowanych eksportach oryginalne białe znaki oraz pusty końcowy wiersz w migracjach; nie zmieniano treści wdrożonych migracji dla samego formatowania.

Do ponowienia w kopii przygotowywanej do publikacji:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run server:check
node --test ../dane-sklepow/*.test.mjs
node ../dane-sklepow/przygotuj-dane.mjs --check
```

Testy kontroli publikacji sprawdzają ignorowane ścieżki, kopiowanie lokalnego sekretu, zgodność odczytu indeksu oraz pozytywny i negatywny przypadek Gitleaks. Test integracyjny skanera jest pomijany, jeśli binarium nie jest dostępne; nie oznacza to zaliczonego skanu repozytorium.
