# Polecenia: dane, importer, baza

Stan: 19 listopada 2026. Ściąga z poleceniami używanymi przy katalogu produktów i cen (gałąź `feat/damian-baza-katalog`). Wszystkie polecenia są dla PowerShella na Windows. Ścieżki są takie jak u Damiana — inna osoba podmienia je na swoje.

W poleceniach występują znaczniki do podmiany:

| Znacznik | Skąd wziąć |
|---|---|
| `HOST`, `USER` | panel Supabase → **Connect** → **Session pooler** (host i użytkownik `postgres.<ref>`, port 5432) |
| `REF` | końcówka użytkownika `postgres.REF` albo adres projektu w panelu |
| `PLIK.sql` | nazwa pliku wygenerowanego przez importer w `raporty_importu` |

**Hasła bazy nigdy nie wpisujemy do poleceń ani plików.** psql i pg_dump same o nie zapytają.

## Zasady bezpieczeństwa

- Do wspólnej bazy najpierw zawsze **próba** (plik `…-proba.sql`, kończy się `ROLLBACK`), dopiero potem zapis.
- Zapis z `--sprzatanie` usuwa dane. Używamy go tylko świadomie, po próbie i kopii zapasowej.
- Między próbą a zapisem nie zmieniamy plików danych (zapis musi powstać z tych samych plików co próba).
- Kluczy z `.env` (zwłaszcza `service_role`) nie wklejamy do poleceń, plików w repo ani zmiennych `EXPO_PUBLIC_*`.
- Nie wykonujemy `supabase db reset --remote`.

## 1. Git

```powershell
cd C:\Users\good1\Desktop\Projekt\Projekt_zespolowy_2026-2027\smart_cart
git status                                  # co jest zmienione i na jakiej gałęzi jesteś
git switch feat/damian-baza-katalog         # przejście na gałąź pracy
git add scripts/ tests/ docs/ supabase/migrations/
git commit -m "Krótki opis zmiany"
git push
git log --oneline -5                        # ostatnie commity
```

Pracujemy na gałęzi, nie na `main`. Do `main` trafia to przez pull request na GitHubie.

## 2. Testy

```powershell
npm.cmd test                                # wszystkie testy Node (tests/*.test.mjs)
node --test tests/import-zrodla.test.mjs tests/import-katalogu.test.mjs   # tylko importer
```

Test bazy działa wyłącznie w osobnym, jednorazowym kontenerze Dockera (nigdy na Supabase):

```powershell
docker run --name smartcart-pg17-check -e POSTGRES_PASSWORD=smartcart-local-test -p 127.0.0.1:55440:5432 -d public.ecr.aws/supabase/postgres:17.11.0.003
# odczekaj kilkanaście sekund, aż Postgres wystartuje
npm.cmd run test:db
docker rm -f smartcart-pg17-check           # usunięcie kontenera po testach
```

Jeśli kontener już istnieje i działa, wystarczy `npm.cmd run test:db`. Wynik powinien kończyć się liniami „… passed.” (migracje, drzewo katalogu, import, sprzątanie).

## 3. Importer (folder `smart_cart`)

Importer **nie łączy się z bazą**. Tworzy plik SQL w `Dane_sklepy_current\raporty_importu\`, który uruchamia się przez psql (punkt 4).

```powershell
cd C:\Users\good1\Desktop\Projekt\Projekt_zespolowy_2026-2027\smart_cart
$dane = "C:\Users\good1\Desktop\Dane_sklepy_current"

node scripts/import/import-katalogu.mjs --dane $dane                     # próba (ROLLBACK)
node scripts/import/import-katalogu.mjs --dane $dane --podglad           # próba + CSV: co trafi do bazy, co pominięte
node scripts/import/import-katalogu.mjs --dane $dane --zapis             # zapis (COMMIT): aktualizuje i dodaje, nic nie usuwa
node scripts/import/import-katalogu.mjs --dane $dane --sprzatanie        # próba ze sprzątaniem
node scripts/import/import-katalogu.mjs --dane $dane --zapis --sprzatanie   # zapis + usunięcie ofert, których import nie odświeżył
node scripts/import/import-katalogu.mjs --dane $dane --z-migracja supabase/migrations/PLIK_MIGRACJI.sql   # próba z niewdrożoną migracją
# ceny regularne wyliczane z promocji są domyślne (od 23.11.2026), opis w docs/import-katalogu.md
node scripts/import/import-katalogu.mjs --dane $dane --bez-wyliczania --podglad   # próba tylko z cenami potwierdzonymi w źródłach
```

| Opcja | Znaczenie |
|---|---|
| (brak) | próba: wszystko się wykonuje, na końcu `ROLLBACK` |
| `--zapis` | `COMMIT`: ceny dopasowanych produktów są aktualizowane, nowe produkty dodawane (limit 25 na sieć × produkt bazowy), nic nie jest usuwane |
| `--sprzatanie` | dodatkowo usuwa oferty sieci obecnych w imporcie, których ten import nie odświeżył, ich produkty bez ofert i puste grupy; przerywa całość, jeśli produkt jest na czyjejś liście zakupów |
| `--podglad` | dodatkowo `…-do-bazy.csv` i `…-pominiete.csv` (do Excela); kolumna `wyliczenie` podaje metodę wyliczenia ceny |
| `--bez-wyliczania` | bez cen regularnych wyliczonych z promocji (tylko ceny potwierdzone w źródłach); zapis w tym trybie usuwa wcześniej wyliczone ceny |
| `--z-migracja` | dołącza niewdrożoną migrację do próby (tylko próba) |

Każde uruchomienie zapisuje też `…json` z podsumowaniem i sumami kontrolnymi plików danych. Zasady dopasowania i limitu: `docs/import-katalogu.md`.

Zwykłe odświeżenie cen: nowe pliki danych → próba → przejrzenie raportu → `--zapis` (bez `--sprzatanie`).

## 4. Uruchomienie pliku SQL na Supabase (Docker + psql)

Nie trzeba instalować psql — używamy obrazu `postgres:17`.

```powershell
docker run --rm -it -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -P pager=off -L /sql/RAPORT.txt -f /sql/PLIK.sql
```

| Fragment | Znaczenie |
|---|---|
| `--rm -it` | kontener znika po zakończeniu; `-it` pozwala wpisać hasło |
| `-v "…:/sql"` | folder z Windows widoczny w kontenerze jako `/sql` |
| `sslmode=require` | połączenie szyfrowane |
| `-X` | bez osobistych ustawień psql |
| `-P pager=off` | wyniki nie otwierają się w przeglądarce tekstu |
| `-L /sql/RAPORT.txt` | cały przebieg zapisywany do pliku (psql **dopisuje** do istniejącego pliku — dla nowego przebiegu podaj nową nazwę) |
| `-f /sql/PLIK.sql` | plik do wykonania |

Gdy wyniki utkną w przeglądarce tekstu: `q`. Na znaku zachęty `postgres=>`: `\q`. Ctrl+C albo zamknięcie terminala w trakcie przerywa połączenie, a niezakończona transakcja jest cofana w całości.

## 5. Raport stanu katalogu (tylko odczyt)

```powershell
docker run --rm -it -v "C:\Users\good1\Desktop\Projekt\Projekt_zespolowy_2026-2027\smart_cart:/repo:ro" -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -P pager=off -L /sql/raport-katalogu.txt -f /repo/scripts/raport-katalogu.sql
```

Pokazuje: oferty w sieciach (z ceną regularną, z promocją, z ceną do porównania dziś), kategorie × sieci, produkty z EAN, w ilu sieciach grupy mają cenę, ostatnie importy. Działa w transakcji `READ ONLY` i kończy się `ROLLBACK`.

## 6. Kopia zapasowa katalogu

Przed każdym zapisem, który usuwa dane (`--sprzatanie`), i przed większymi zmianami:

```powershell
mkdir C:\Users\good1\Desktop\Dane_sklepy_current\kopie_bazy
docker run --rm -it -v "C:\Users\good1\Desktop\Dane_sklepy_current\kopie_bazy:/kopia" postgres:17 pg_dump "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -Fc -t public.stores -t public.categories -t public.base_products -t public.comparison_groups -t public.products -t public.store_offers -t public.price_history -f /kopia/katalog-RRRR-MM-DD.dump
```

Zawartość kopii (bez łączenia z bazą):

```powershell
docker run --rm -v "C:\Users\good1\Desktop\Dane_sklepy_current\kopie_bazy:/kopia" postgres:17 pg_restore --list /kopia/katalog-RRRR-MM-DD.dump
```

Kopię można obejrzeć, odtwarzając ją do lokalnego kontenera testowego. **Przywracanie do wspólnej bazy** (np. kopia `katalog-przed-importem.dump` z 19.11.2026) zastępuje bieżący katalog — robimy je tylko po uzgodnieniu z zespołem i z przygotowanym, sprawdzonym planem.

## 7. Supabase CLI (migracje i schemat)

Jednorazowo na komputerze:

```powershell
npx.cmd supabase@3.1.0 login                        # otwiera przeglądarkę
npx.cmd supabase@3.1.0 link --project-ref REF       # pyta o hasło bazy; zapis w supabase/.temp (poza gitem)
```

Wdrażanie nowych migracji z `supabase/migrations/`:

```powershell
npx.cmd supabase@3.1.0 migration list --remote      # które migracje są już w bazie
npx.cmd supabase@3.1.0 db push --remote --dry-run   # co zostałoby wdrożone (nic nie zmienia)
npx.cmd supabase@3.1.0 db push --remote             # wdrożenie
npx.cmd supabase@3.1.0 db dump --remote --file supabase-schema.sql   # aktualny eksport schematu do repo
```

Przed `db push` zawsze `--dry-run` i sprawdzenie, że lista zawiera dokładnie nowe migracje. Wdrożonych migracji nie edytujemy — każda zmiana to nowy plik migracji.

## 8. Gazetki

Pełny opis: `docs/gazetki.md`. Klucz `service_role` w `smart_cart\.env.admin.local` (poza gitem). Wszystkie gazetki przechodzą przez folder `gazetki_pobrane`; nazwy: `<sieć>_<od RRRR-MM-DD>_<do RRRR-MM-DD>_<tytuł>` (PDF albo folder ze stronami).

```powershell
$pob  = "C:\Users\good1\Desktop\Dane_sklepy_current\gazetki_pobrane"
$arch = "C:\Users\good1\Desktop\Dane_sklepy_current\gazetki_archiwum"
node scripts/gazetki/gazetki.mjs pobierz --folder $pob --archiwum $arch    # Biedronka, Lidl, Dino -> gazetki_pobrane
# ręcznie: PDF Kauflanda i Carrefoura do gazetki_pobrane (nazwa według wzoru), sprawdzenie dat Biedronki
node scripts/gazetki/gazetki.mjs dodaj-pobrane --archiwum $arch --folder $pob   # -> archiwum (obrazy stron)
node scripts/gazetki/gazetki.mjs wgraj --archiwum $arch --proba
node scripts/gazetki/gazetki.mjs wgraj --archiwum $arch                    # Storage + publikacja
node scripts/gazetki/gazetki.mjs sprzataj                                  # usunięcie dzień po końcu (archiwum zostaje)
node scripts/gazetki/gazetki.mjs usun --id <id> --proba                    # usunięcie wskazanej gazetki (np. duplikatu), potem bez --proba
npx.cmd supabase@3.1.0 functions deploy leaflets                           # wdrożenie Edge Function (po zmianie jej kodu)
```

## 9. Mleko: przegląd ręczny

Pełny opis: `docs/mleko.md`. Lista mlek bez rodzaju (UHT/świeże) → uzupełnienie kolumny `rodzaj` → SQL z decyzji (próba, potem `--zapis`) → uruchomienie jak w punkcie 4.

```powershell
docker run --rm -it -v "C:\Users\good1\Desktop\Projekt\Projekt_zespolowy_2026-2027\smart_cart:/repo:ro" -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -f /repo/scripts/mleko/mleko-do-przegladu.sql
node scripts/mleko/przeglad-mleka.mjs C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu\mleko-do-przegladu.csv            # próba
node scripts/mleko/przeglad-mleka.mjs C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu\mleko-do-przegladu.csv --zapis    # zapis
```

## 10. Typowy cykl odświeżenia danych

1. Aktualne pliki danych w folderze danych (poza repozytorium; ich przygotowanie nie jest częścią repo).
2. `npm.cmd test` (punkt 2).
3. Próba importu z `--podglad` (punkt 3) i uruchomienie jej na Supabase (punkt 4).
4. Przejrzenie raportu: dopasowania, nowe i zastąpione oferty, możliwe duble, mleko.
5. Zapis `--zapis` (bez `--sprzatanie`) z tych samych danych i uruchomienie (punkt 4).
6. Raport stanu katalogu (punkt 5).
