# Przegląd próbki 20 uzupełnionych lokalizacji

Data UTC: 2026-11-02T18:49:24.927Z

**Wynik: 20 sprawdzonych, bez nowego wstrzymania rekordu. 19 punktów potwierdzono względem dokładnego adresu UUG, a Białystok na poziomie właściwej galerii.**

W celowej próbie nie wykazano przypisania sklepu do innej miejscowości ani innego budynku. 19 punktów jest blisko dokładnego adresu UUG, a punkt Białegostoku leży w potwierdzonej galerii. Nie potwierdzono wejść ani dokładnego położenia lokalu w galerii.

## Dobór próby

Próba celowa warstwowa: wszystkie 5 trudniejszych dopasowań nazw ulic, minimum 3 prefiksy, 5 węzłów OSM i 3 adresy bez ulicy; następnie maksymalizacja minimalnej odległości od wybranych punktów. Remisy według ID. Dobór nie zależy od wyników sprawdzenia.

Próba nie jest losowa i nie służy do szacowania odsetka błędów w populacji 181 sklepów.

Lista 20 ID jest zachowana w `wybor.json`; nie wymieniano przypadków po poznaniu wyników. Próba zawiera wszystkie 5 dopasowań wariantu ulicy, 3 prefiksy, 5 węzłów OSM i 3 adresy bez odrębnej ulicy. Kategorie mogą się nakładać.

## Zestawienie

| Sklep | Odległość do dokładnego punktu UUG | Zakres |
| --- | ---: | --- |
| Gen. Kutrzeby 1, 62-095 Murowana Goślina | 22 m | Adres i budynek |
| M. Faradaya 21, 42-202 Częstochowa | 30 m | Adres i budynek |
| Droszyńskiego 28a, 80-381 Gdańsk | 11 m | Adres i budynek |
| T. Kościuszki 72a, 37-632 Stary Dzików | 37 m | Adres i budynek |
| Sienkiewicza 94b, 23-100 Bychawa | 27 m | Adres i budynek |
| al. Jana Pawła II 4, 09-530 Gąbin | 61 m | Adres i budynek |
| os. Lecha 9F, 66-235 Torzym | 4 m | Adres i budynek |
| Al. Wojska Polskiego 116, 62-800 Kalisz | 17 m | Adres i budynek |
| Świętojańska 15, 15-277 Białystok | 162 m | Galeria; uwagi poniżej |
| Nowotarska 9, 34-500 Zakopane | 9 m | Adres i budynek |
| Dębowiec 826, 38-220 Dębowiec | 14 m | Adres i budynek |
| Obryte 5b, 07-215 Obryte | 19 m | Adres i budynek |
| Michałowice 143, 49-314 Michałowice | 9 m | Adres i budynek |
| Topolowa 2, 72-344 Rewal | 22 m | Adres i budynek |
| Armii Krajowej 3a, 11-600 Węgorzewo | 21 m | Adres i budynek |
| Konstytucji 3 Maja 5, 58-540 Karpacz | 17 m | Adres i budynek |
| Krakowska 75, 26-500 Szydłowiec | 27 m | Adres i budynek |
| Spółdzielcza 11, 21-532 Łomazy | 17 m | Adres i budynek |
| Warszawska 40D, 87-148 Łysomice | 22 m | Adres i budynek |
| Jana III Sobieskiego 5, 76-200 Słupsk | 18 m | Adres i budynek |

## Przypadki wymagające wyjaśnienia

### T. Kościuszki 72a, 37-632 Stary Dzików

Najbliższy punkt UUG ma numer 72, ale oddzielne zapytanie o dokładny numer 72a potwierdza jego istnienie. Nie podmieniono numeru na najbliższy.

Katalog punktów sprzedaży ZYN również podaje Biedronkę przy Kościuszki 72A. Rejestrowy punkt 72A jest blisko budynku, mimo że najbliższym adresem jest 72.

- [3513-oficjalna](https://www.biedronka.pl/pl/shop,id,3513) — lokalny plik: `3513-oficjalna.html`.
- [3513-osm](https://api.openstreetmap.org/api/0.6/way/1375378614/full.json) — lokalny plik: `3513-osm.json`.
- [3513-gugik-wgs84](https://services.gugik.gov.pl/uug/?request=GetAddress&address=Stary+Dzik%C3%B3w%2C+Tadeusza+Ko%C5%9Bciuszki+72A&exact_number=1&srid=4326) — lokalny plik: `3513-gugik-wgs84.json`.
- [3513-gugik-reverse](https://services.gugik.gov.pl/uug/?request=GetAddressReverse&location=POINT%2822.9338183+50.2438193%29&srid=4326) — lokalny plik: `3513-gugik-reverse.json`.
- [stary-dzikow-zyn](https://www.zyn.com/pl/pl/storedetails?path=stary-dzik%C3%B3w.html) — lokalny plik: `stary-dzikow-zyn.html`.

### al. Jana Pawła II 4, 09-530 Gąbin

Najbliższy punkt UUG ma numer 5, ale oddzielne zapytanie o dokładny numer 4 potwierdza jego istnienie. Nie podmieniono numeru na najbliższy.

Targeo potwierdza sklep pod tym adresem 15 m od punktu OSM. Punkt rejestrowy numeru 4 leży 61 m od środka budynku.

- [1150-oficjalna](https://www.biedronka.pl/pl/shop,id,1150) — lokalny plik: `1150-oficjalna.html`.
- [1150-osm](https://api.openstreetmap.org/api/0.6/way/536606518/full.json) — lokalny plik: `1150-osm.json`.
- [1150-gugik-wgs84](https://services.gugik.gov.pl/uug/?request=GetAddress&address=G%C4%85bin%2C+Aleja+Jana+Paw%C5%82a+II+4&exact_number=1&srid=4326) — lokalny plik: `1150-gugik-wgs84.json`.
- [1150-gugik-reverse](https://services.gugik.gov.pl/uug/?request=GetAddressReverse&location=POINT%2819.7374913+52.3986447%29&srid=4326) — lokalny plik: `1150-gugik-reverse.json`.
- [gabin-targeo](https://mapa.targeo.pl/biedronka-supermarket-al-jana-pawla-ii-4-gabin~10102425/biedronka-supermarket/adres) — lokalny plik: `gabin-targeo.html`.

### Świętojańska 15, 15-277 Białystok

OSM i Targeo różnią się o 212 m. Oba punkty leżą wewnątrz geometrii Alfa Centrum przy Świętojańskiej 15. Właściciel centrum potwierdza najemcę Biedronka. Potwierdzono właściwą galerię; dokładny lokal i wejście nie zostały potwierdzone.

UUG podaje kod 15-082, natomiast Biedronka i zarządca Alfa Centrum podają 15-277. Zachowano kod z tych dwóch źródeł. SIMC w OSM różni się od UUG i nie został użyty jako dowód tożsamości.

Najbliższy punkt UUG ma numer 17A, ale oddzielne zapytanie o dokładny numer 15 potwierdza jego istnienie. Nie podmieniono numeru na najbliższy.

- [6963-oficjalna](https://www.biedronka.pl/pl/shop,id,6963) — lokalny plik: `6963-oficjalna.html`.
- [6963-osm](https://api.openstreetmap.org/api/0.6/node/12536968071.json) — lokalny plik: `6963-osm.json`.
- [6963-gugik-wgs84](https://services.gugik.gov.pl/uug/?request=GetAddress&address=Bia%C5%82ystok%2C+%C5%9Awi%C4%99toja%C5%84ska+15&exact_number=1&srid=4326) — lokalny plik: `6963-gugik-wgs84.json`.
- [6963-gugik-reverse](https://services.gugik.gov.pl/uug/?request=GetAddressReverse&location=POINT%2823.1677737+53.1244503%29&srid=4326) — lokalny plik: `6963-gugik-reverse.json`.
- [bialystok-targeo](https://mapa.targeo.pl/biedronka-supermarket-swietojanska-15-bialystok~22738043/biedronka-supermarket/adres) — lokalny plik: `bialystok-targeo.html`.
- [bialystok-alfa-kontakt](https://www.alfacentrum.com.pl/kontakt) — lokalny plik: `bialystok-alfa-kontakt.html`.
- [bialystok-alfa-sklep](https://www.alfacentrum.com.pl/najemcy/sklepy/Biedronka-pl) — lokalny plik: `bialystok-alfa-sklep.html`.
- [bialystok-otoczenie-osm](https://api.openstreetmap.org/api/0.6/map?bbox=23.166,53.1235,23.172,53.128) — lokalny plik: `bialystok-otoczenie-osm.xml`.

## Dowody i odtworzenie

Archiwum zawiera 106 odpowiedzi HTTP 200 z URL, datami i SHA-256. Szczegóły każdej decyzji, odnośniki do źródeł i dokładne odległości są w `raport.json`, zestawienie do Excela w `wynik.csv`.

```powershell
node .\dane-sklepow\pobierz-probe20.mjs
node .\dane-sklepow\opisz-probe20.mjs
node .\dane-sklepow\przygotuj-dane.mjs
node .\dane-sklepow\podsumuj-weryfikacje.mjs
```

Pobieranie korzysta z archiwum. Pozostałe komendy działają offline. Nowe decyzje dołączono do wcześniejszych siedmiu, zachowując wstrzymania Trzebini i Grąbkowa. Geometrii ani adresów sklepów nie zmieniono.

## Ograniczenia

- Próba nie jest losowa i nie służy do szacowania odsetka błędów w populacji 181 sklepów.
- To nie jest kontrola terenowa ani potwierdzenie otwarcia sklepu.
- Rejestr adresowy potwierdza adres, nie markę najemcy. Tożsamość sklepu sprawdzono na oficjalnej karcie i w OSM.
- Odległość do punktu adresowego nie jest pomiarem błędu GPS; punkt sklepu, środek budynku, lokal i punkt adresu mogą się różnić.
- Parametr accuracy w odpowiedzi UUG opisuje dopasowanie tekstowe, nie prawdopodobieństwo poprawności.

Dane OSM: © OpenStreetMap contributors, ODbL-1.0.
