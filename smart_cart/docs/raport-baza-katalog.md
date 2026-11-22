# Raport: baza danych, katalog, importy, gazetki i API (Damian)

Stan: 21 listopada 2026. Gałąź `feat/damian-baza-katalog`. Zakres według `Damian.MD`: schemat i migracje, kategorie i grupy, produkty, ceny i promocje, importy, dane gazetek, kontrakty odczytu dla Radka i Filipa.

## Najważniejsze w skrócie

- Do wspólnej bazy Supabase wdrożono **5 nowych migracji** (drzewo kategorii, rozszerzenie słownika, gazetki, reguły mleka, API katalogu) i **Edge Function `leaflets`**. Eksport `supabase-schema.sql` jest odświeżony po wdrożeniu.
- Katalog ma stałe drzewo **kategoria → podkategoria → grupa → produkty i oferty sieci**: 10 kategorii, 50 podkategorii.
- Dane produktów i cen pochodzą z naszych plików scraperów (5 sieci), wgranych powtarzalnym importerem z trybem próbnym i raportem.
- Pierwsza kategoria, **Nabiał → Mleko**, jest uporządkowana regułami i przeglądem ręcznym (status `reviewed`). Pozostałe podkategorie mają status `preliminary`.
- **Radek** dostał kontrakt API katalogu: `docs/api-katalogu.md`.
- **Filip** dostał kontrakt i działające dane gazetek z 5 sieci: `docs/gazetki.md`.
- Polecenia administratora do powtarzania wszystkich kroków: `docs/polecenia.md`.

## 1. Schemat i migracje (wdrożone do wspólnej bazy)

| Migracja | Co robi |
|---|---|
| `20261118000100_catalog_tree.sql` | stała kolejność i slug kategorii, tabela `catalog_subcategories` (z `verification_status`), przypisanie produktów bazowych do podkategorii (FK pilnuje tej samej kategorii), `comparison_group_redirects` + `merge_comparison_group` (scalanie grup bez porzucania list i ulubionych), rejestr `import_runs` i `store_offers.last_import_run_id` |
| `20261119000100_extended_base_products.sql` | 42 produkty bazowe „pozostałe …”; piwo bez podkategorii (nie pojawia się w katalogu) |
| `20261120000100_leaflets.sql` | tabele `leaflets`, `leaflet_pages`, prywatny bucket Storage `leaflets`, RLS |
| `20261121000100_milk_rules.sql` | reguły mleka v3 (`milk_group`), rejestr decyzji przeglądu `catalog_reviews`, `settle_regrouped`, `reclassify_milk` |
| `20261122000100_catalog_api.sql` | funkcje API (`catalog_tree`, `catalog_branch`, `catalog_search`, `catalog_group`, `catalog_product`), znormalizowany tekst wyszukiwania liczony przy zapisie, indeks ofert po produkcie |

- Istniejące migracje z 14.11 nie były zmieniane. Istniejące funkcje i widoki (`search_product_groups`, `catalog_offers`, `add_shopping_item`, `compare_basket`, listy, ulubione) działają bez zmian; nowe API je uzupełnia.
- Każda migracja przed wdrożeniem: test w izolowanym Postgresie (`npm.cmd run test:db`), próba na wspólnej bazie w transakcji z `ROLLBACK`, `db push --dry-run`, potem `db push`.
- Uprawnienia: katalog i gazetki tylko do odczytu dla potwierdzonego konta; funkcje administracyjne i tabele rejestrów tylko dla `service_role`; gość nie ma dostępu. RLS nie był wyłączany.
- Kopia katalogu sprzed importu: `kopie_bazy/katalog-przed-importem.dump` (19.11.2026, poza repo).

## 2. Kategorie, podkategorie i grupy

- Kolejność kategorii i podział na podkategorie zatwierdzone przez Damiana (18.11.2026).
- Grupa opisuje zgodne cechy, nie markę. Grupy porównania powstają dla mleka, masła 82%, mąki, ryżu, cukru i jajek oraz dla produktów z tym samym EAN w kilku sieciach. Pozostałe produkty są osobnymi pozycjami (`kind: "product"`), bez zgadywania zamienników.
- Kontrprzykłady w testach: kozie/owcze osobno, mieszanki ryżu i ryż gotowy poza grupą czystego ryżu, warianty smakowe/barista/proteinowe poza zwykłym mlekiem.
- Przeklasyfikowanie i scalanie grup nie porzuca list ani ulubionych (przekierowanie i scalenie pozycji tej samej listy).

### Nabiał → Mleko (`docs/mleko.md`)

- Reguła automatyczna v3: rodzaj (UHT/świeże) + tłuszcz + laktoza, dopiski kozie/owcze/ekologiczne; skrót „BEZ LAKT.” rozpoznawany; zagęszczone, w proszku, fermentowane i roślinne poza grupami mleka.
- Przegląd ręczny mlek, których nazwa nie mówi UHT/świeże: lista CSV → decyzje Damiana → zapis z rejestrem w `catalog_reviews` (21.11.2026).
- Stan po przeglądzie: 88 produktów, 94 oferty, 11 grup mleka; pozostałe pozycje w podkategorii to mleko w proszku, zagęszczone i barista jako osobne produkty.

## 3. Import produktów, cen i promocji (`docs/import-katalogu.md`)

- Źródła: antonka (bieżące i historia), tanszykoszyk, kodyzbiedry. Pliki scraperów i same scrapery są poza repo.
- Kroki rozdzielone: odczyt plików → normalizacja → łączenie obserwacji w pozycje „produkt w sieci” → dopasowanie do bazy (EAN → sieć+nazwa+opakowanie → sieć+nazwa → nazwa bez ilości) → wygenerowany SQL.
- Tryb próbny (`ROLLBACK`) i zapis, raport dopasowań, podgląd CSV (co trafi do bazy, co pominięte i dlaczego), rejestr przebiegu w `import_runs`.
- Cena z gazetki jest promocją z okresem, nigdy ceną regularną. Cen nie szacujemy. Promocja jest naliczana automatycznie tylko z ceną, okresem, linkiem dowodowym i regułą `unit`/`min_quantity`; złożone warunki zostają niepotwierdzone.
- Zapis 19.11.2026 z `--sprzatanie` (decyzja Damiana: w bazie tylko nasze dane). Sprzątanie przerywa się, gdy produkt do usunięcia jest wybrany na czyjejś liście zakupów.

Stan ofert po imporcie:

| Sieć | Oferty |
|---|---|
| Biedronka | 4 614 |
| Carrefour | 5 252 |
| Lidl | 934 |
| Kaufland | 788 |
| Dino | 730 |

Lidl, Kaufland i Dino mają w źródłach prawie wyłącznie ceny z gazetek, więc poza okresem promocji wiele ich ofert nie ma dziś ceny (`price_today: null`). Aktualny stan liczb: `scripts/raport-katalogu.sql` (tylko odczyt).

Kolejne odświeżenie: ręcznie, raz w tygodniu (scrapery → import bez `--sprzatanie` → gazetki), według `docs/polecenia.md` pkt 10. **Nie ma skonfigurowanego automatycznego harmonogramu.**

## 4. API dla Radka (`docs/api-katalogu.md`)

- Funkcje RPC: drzewo kategorii, gałąź (grupy i produkty podkategorii), wyszukiwanie globalne, grupa z ofertami, produkt z historią cen. Każda zwraca JSON z `version: 1`.
- Wyszukiwanie: polskie znaki, wielkość liter, `3,2%` = `3.2%` = `3,2 %`, wszystkie słowa zapytania, paginacja.
- Wynik rozróżnia grupę i produkt; `product_count` (różne produkty) i `offer_count` (oferty sieci) liczone z wszystkich ofert, nie ze strony wyników.
- Ceny: `price_today` za opakowanie, `unit_price_today` za 1 kg / 1 l / 1 szt; „od X zł” z ceny jednostkowej, nigdy z cen opakowań różnych rozmiarów.
- Błędy: 401 gość, 403 konto niepotwierdzone, 404 brak podkategorii/grupy/produktu.
- `group_id` z wyników działa z istniejącym `add_shopping_item`, ulubionymi i `compare_basket`.
- Czas na wspólnej bazie (~11,5 tys. produktów, z połączeniem): wyszukiwanie ok. 0,15 s, gałąź ok. 0,1 s, drzewo ok. 0,3 s.

## 5. Gazetki dla Filipa (`docs/gazetki.md`)

- `GET /functions/v1/leaflets` (Edge Function, wdrożona, ACTIVE): sprawdza sesję i potwierdzony email, zwraca format `version: 1` z propozycji Filipa; strony jako obrazy z podpisanymi adresami ważnymi 1 h z prywatnego Storage.
- Lista: gazetki aktualne i przyszłe; wygasłe usuwane z bazy i Storage po dacie końca, archiwum lokalne zostaje.
- Pobieranie: Biedronka, Lidl, Dino automatycznie z oficjalnych stron; Kaufland i Carrefour jako PDF pobrane ręcznie. Blokad antybotowych nie omijamy.
- Stan archiwum 21.11.2026: 8 gazetek (Biedronka 3, Dino 2, Lidl, Kaufland, Carrefour), wgrywane do bazy poleceniem `wgraj`.

## 6. Testy i kontrole (21.11.2026)

| Kontrola | Wynik |
|---|---|
| `npm.cmd run test:db` (izolowany Postgres) | zaliczone: migracje i RLS (gość, niepotwierdzony, właściciel, inny użytkownik), drzewo katalogu, API katalogu, gazetki, reguły mleka, import (dwa uruchomienia, zmiana danych, próba z ROLLBACK) |
| `npm.cmd test` | 131 zaliczonych, 0 błędów, 1 pominięty (test Gitleaks przed instalacją narzędzia) |
| `npm.cmd run typecheck`, `npm.cmd run lint` | bez błędów |
| `npm.cmd run check:secrets` | zaliczone |
| Próby na wspólnej bazie (ROLLBACK) | import, reguły i przegląd mleka, API katalogu — przed każdym zapisem |

Nie uruchamiano `test:e2e`, `server:check` ani eksportu Expo: zmiany nie dotyczą kodu aplikacji (`src/`), nawigacji ani mapy.

## 7. Czego świadomie nie zrobiono i co zależy od innych

- **Kowal — placówki:** model placówek i mapowanie sieci do ustalenia na spotkaniu 22.11.2026. `stores` pozostaje tabelą sieci.
- **Filip:** odbiór czytnika gazetek w aplikacji (WWW i Expo Go) na prawdziwym endpoincie — jeszcze niepotwierdzony.
- **Radek:** podłączenie ekranów katalogu do nowego API (jego moduł `src/features/catalog`); kontrakt przekazany, kod aplikacji nie był zmieniany.
- Poza Nabiał → Mleko katalog jest wstępny (`preliminary`): większość produktów to osobne pozycje bez zamienników. Kolejne kategorie porządkujemy etapami.
- Produkty bez ilości w nazwie nie mają ceny jednostkowej. `image_url` bywa pusty.
- Regulaminy serwisów źródłowych: dane używane do testów projektu studenckiego; przed publicznym udostępnieniem aplikacji temat do rozstrzygnięcia.

## 8. Zmienione pliki (względem `main`)

- Migracje: 5 plików w `supabase/migrations/` (tabela w pkt 1); `supabase-schema.sql` (eksport po wdrożeniu).
- Edge Function: `supabase/functions/leaflets/` (`index.ts`, `odpowiedz.ts`).
- Skrypty administratora: `scripts/import/` (importer, normalizacja, słownik, analiza), `scripts/gazetki/`, `scripts/mleko/`, `scripts/raport-katalogu.sql`, rozszerzony `scripts/check-migrations.mjs`.
- Testy: `tests/database-catalog-tree.sql`, `database-catalog-api.sql`, `database-leaflets.sql`, `database-milk.sql`, `import-katalogu.test.mjs`, `import-zrodla.test.mjs`, `gazetki.test.mjs`, `mleko.test.mjs`.
- Dokumentacja: `docs/api-katalogu.md`, `gazetki.md`, `mleko.md`, `import-katalogu.md`, `polecenia.md`, ten raport; link w `utrzymanie-katalogu.md`.
- Konfiguracja: `tsconfig.json` i `eslint.config.cjs` pomijają `supabase/functions/**` (kod Deno, nie aplikacji).
