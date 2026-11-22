# Etap Nabiał → Mleko: reguły grup i przegląd ręczny

Stan: 20 listopada 2026. Pierwsza kategoria porządkowana etapami (`Damian.MD`, pkt 15).

## Grupy mleka

Grupa opisuje zgodne cechy, nie markę: **rodzaj (UHT / świeże) + tłuszcz + laktoza**, np. `milk:uht:3.2:z laktozą` → „Mleko UHT 3,2% · z laktozą”. Różne marki i opakowania (1 l, 0,5 l, wielopak 6×0,5 l) są w jednej grupie; porównanie liczy cenę za ml. Osobno: inny tłuszcz, UHT i świeże, z laktozą i bez, kozie/owcze (`:goat`, `:sheep`), ekologiczne (`:organic`, słowa „bio”, „ekolog…”, „organic”).

Klucz i nazwę grupy liczy jedna funkcja `public.milk_group(rodzaj, tłuszcz, laktoza, nazwa)` — tej samej używa reguła automatyczna i przegląd ręczny.

## Reguła automatyczna (migracja `20261121000100_milk_rules.sql`, `name_rule_v3`)

Produkt trafia do grupy mleka, gdy w nazwie jest „mleko”, zawartość tłuszczu (`3,2%`), rodzaj (`UHT` albo `świeże`), a opakowanie jest w ml. Poprawki względem v2:

- skrót „BEZ LAKT.” (Biedronka) = bez laktozy — wcześniej takie mleko trafiało do grupy **z** laktozą;
- skrót „BEZ LAK.” też = bez laktozy (migracja `20261123000200_milk_bez_lak.sql`, 22.11.2026; 2 produkty Biedronki przeniesione z grup „z laktozą”, produkt bazowy dopasowany do grupy przez `align_milk_base_products()`);
- „Mazurski Smak” to marka, nie mleko smakowe;
- zawsze osobno (nie są zwykłym mlekiem): smakowe („o smaku”, truskawkowe, kakao…), proteinowe, barista, zagęszczone, w proszku, fermentowane, roślinne / „nie-mleko”.

Migracja ponownie klasyfikuje mleka bez decyzji ręcznej. Jeśli stara grupa zostaje pusta, a jest na czyjejś liście zakupów lub w ulubionych, jest scalana z nową (`merge_comparison_group`, z przekierowaniem); pusta grupa produktowa bez odwołań jest usuwana (`settle_regrouped`).

## Przegląd ręczny (gdy nazwa nie mówi, czy to UHT czy świeże)

Nazwy typu „MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l” albo „Mlekovita Mleko Polskie 2%” nie rozstrzygają rodzaju — nie zgadujemy. Decyzję podejmuje człowiek (sprawdzenie na stronie sklepu / producenta), a baza zapamiętuje ją i jej pochodzenie:

- produkt dostaje grupę z `milk_group` i `classification_source = 'reviewed'` — reguła automatyczna i kolejne importy (zmiana nazwy, ceny) jej nie nadpisują;
- każda decyzja (także „pomiń”) jest zapisana w `catalog_reviews` (produkt, decyzja, grupa, szczegóły, plik źródłowy, czas); tabela tylko dla administratora;
- produkty z decyzją nie wracają na listę do przeglądu.

### Krok po kroku (w folderze `smart_cart`)

1. Lista do przejrzenia (tylko odczyt) → `Dane_sklepy_current\raporty_importu\mleko-do-przegladu.csv`:

   ```powershell
   docker run --rm -it -v "C:\Users\good1\Desktop\Projekt\Projekt_zespolowy_2026-2027\smart_cart:/repo:ro" -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -f /repo/scripts/mleko/mleko-do-przegladu.sql
   ```

2. Uzupełnij kolumnę **rodzaj**: `UHT`, `świeże` albo `pomiń` (puste = jeszcze bez decyzji, wiersz zostaje na następny raz). W razie potrzeby popraw **tluszcz** (np. `3,2`) i **laktoza** (`z laktozą` / `bez laktozy`). Kolumna **uwagi** jest dowolna (np. skąd wiadomo). Plik jest w UTF-8 ze średnikami: w Excelu otwieraj przez *Dane → Z tekstu/CSV* (kodowanie UTF-8), żeby polskie znaki były poprawne; zapis z Excela (także Windows-1250) skrypt też odczyta.

3. SQL z decyzji — najpierw próba, potem zapis:

   ```powershell
   node scripts/mleko/przeglad-mleka.mjs C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu\mleko-do-przegladu.csv
   node scripts/mleko/przeglad-mleka.mjs C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu\mleko-do-przegladu.csv --zapis
   ```

   Skrypt nie łączy się z bazą; tworzy `mleko-przeglad-<czas>-proba.sql` / `-zapis.sql` obok CSV. Błędy w liście (nieznany rodzaj, brak tłuszczu, powtórzony produkt) zatrzymują generowanie z listą wierszy do poprawy.

4. Uruchomienie pliku jak import (punkt 4 w `docs/polecenia.md`), np. `-f /sql/mleko-przeglad-…-proba.sql`. Próba kończy się `ROLLBACK` i pokazuje pokrycie grup mleka w sieciach; zapis — `COMMIT`.

## Wdrożenie migracji

```powershell
# próba na Supabase (ROLLBACK): grupy mleka przed/po i lista produktów, które zmienią grupę
docker run --rm -it -v "C:\Users\good1\Desktop\Dane_sklepy_current\raporty_importu:/sql" postgres:17 psql "host=HOST port=5432 dbname=postgres user=USER sslmode=require" -X -P pager=off -L /sql/raport-mleko-migracja.txt -f /sql/mleko-migracja-proba.sql
npx.cmd supabase@3.1.0 db push --remote --dry-run     # tylko 20261121000100_milk_rules.sql
npx.cmd supabase@3.1.0 db push --remote
```

## Testy

`tests/database-milk.sql` i `tests/database-milk-bez-lak.sql` (grupy, skróty BEZ LAKT. i BEZ LAK., marka vs smak, tłuszcz/UHT/świeże/eko/kozie osobno, wykluczenia, decyzja ręczna przetrwa zmianę nazwy, ponowna klasyfikacja nie porzuca list i ulubionych, uprawnienia), `tests/mleko.test.mjs` (CSV, kodowanie, decyzje, SQL), scenariusz w `scripts/check-migrations.mjs` (lista z bazy → decyzje → wygenerowany SQL wykonany w izolowanej bazie: próba i zapis).

## Czego reguły nie rozwiążą

Lidl, Kaufland i Dino mają w naszych danych głównie ceny z gazetek (promocje z datą końca), więc ich mleko bywa w grupach bez ceny na dziś. To ograniczenie źródeł, opisane w raporcie etapu; pomaga cotygodniowe odświeżanie danych i gazetek.
