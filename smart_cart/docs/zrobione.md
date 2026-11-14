# Zrobione — stan po wdrożeniu z 14 listopada 2026

Wdrożono pięć migracji do wspólnego Supabase oraz podłączono produkty, listy, porównywanie i ulubione. Naprawiono nawigację oraz wskazane w audycie problemy formularzy. Szczegółowy zakres, dowody i ograniczenia danych zawiera [raport wdrożenia](wdrozenie-po-audycie.md).

- Produkty: grupy, oferty sieci, ilości, wybór najtańszego odpowiednika lub konkretnego produktu.
- Prywatne nazwane listy na koncie: zapis, zmiana nazwy, usuwanie, edycja pozycji i ponowna wycena.
- Porównanie kosztu pełnych opakowań i produktów luzem; osobny wybór tańszego wariantu większej ilości dla każdej sieci.
- Wszystkie aktywne sieci w wyniku, bez sum i rankingu dla niepełnej wyceny.
- Promocje ogólne z potwierdzonymi warunkami, kartą, aktywacją i limitami; estymaty pomijane.
- RLS katalogu po zalogowaniu i prywatność własnych list; odebrane zapisy i TRUNCATE katalogu.
- Powrót do zamierzonego ekranu, zachowanie trasy przy odtwarzaniu sesji, obsługa anulowania i spóźnionych wyników.
- Działający ESLint, usunięty nieistniejący skrypt resetu, poprawione testy i zależności.

Weryfikacja: **89/89 Node, 20/20 Playwright, TypeScript, lint, testy SQL/RLS, eksport WWW/Android/iOS, 37/37 testów danych mapy**. `npm audit`: 0 podatności po aktualizacji.

Dane nadal wymagają uzupełnienia: precyzyjne zamienniki poza zdefiniowanymi regułami, sposób sprzedaży 6068 produktów, rzeczywiste daty obserwacji i dowody promocji. [Proces administracyjny](utrzymanie-katalogu.md) jest gotowy. Nie wykonano nowego pełnego odbioru na fizycznym telefonie ani wysyłek maili. 580 placówek mapy pozostaje do weryfikacji źródłowej.

[Audyt sprzed napraw](stan-projektu.md) i [pierwotny raport logowania](../../docs/RAPORT_WDROZENIA_LOGOWANIA_SUPABASE.md) pozostają dokumentami historycznymi.
