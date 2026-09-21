# Etap 5 — wydajność i lokalny kandydat 2.0.49

Pomiary 21.09.2026. Punktem odniesienia jest lokalny stan po etapie 4, przed optymalizacją frontendu. To pomiar syntetyczny, nie wynik produkcji WAW ani terenowe Core Web Vitals.

## Profil i wyniki

Apple M3 Pro, macOS arm64, Node 26.5, Chromium 140; okno 1365×900, spowolnienie CPU ×4, opóźnienie sieci 80 ms, pobieranie 4 Mb/s, wysyłanie 1 Mb/s. Trzy niezależne próby, nowy kontekst i wyłączony cache. Logowanie korzysta z rzeczywistego produkcyjnego buildu. Serwer, edytor i konsola korzystają z produkcyjnie zbudowanego AppShell z API fixture (20 ms); ruch poza lokalny serwer jest zablokowany.

| Mediana | Przed | Kandydat | Budżet kolejnych zmian (+10%) |
|---|---:|---:|---:|
| Gotowy formularz logowania | 5589 ms | 960 ms | 1056 ms |
| Gotowy widok serwera | 5969 ms | 2283 ms | 2512 ms |
| Pierwsze otwarcie edytora | 12130 ms | 5079 ms | 5587 ms |
| Przejście konsoli na pełny ekran podczas strumienia | 609 ms | 503 ms | 553 ms |

JS/CSS logowania: 2 602 975 B przesyłanych przed zmianą, 318 588 B po zmianie (1 077 145 B po rozpakowaniu). Konsola: 5000 początkowych wpisów, następnie 3000 wpisów w partiach po 100; bufor pozostaje ograniczony do 5000. Pomiar interakcji obejmuje sterowanie Playwright, dlatego nie jest INP. Niepełne próbki LCP zapisane jako `null` nie oznaczają zera. Nie używamy ich do oceny Core Web Vitals.

Dane: [baza](performance/baseline.json), [pierwsza optymalizacja](performance/optimized.json), [kandydat](performance/candidate.json). Wszystkie trzy ukończone serie bez błędów JavaScript przeglądarki. Zmienność sprzętu i obciążenia wymaga ponownego pomiaru przed interpretowaniem przekroczenia budżetu.

## Zmiany wynikające z pomiarów

- AppShell ładowany dopiero po logowaniu. Wspólne `clsx` i `tailwind-merge` w małej paczce UI: wejście nie pobiera wykresów przez przypadkową zależność.
- Nginx kompresuje statyczny HTML/JS/CSS. Pliki z hashem mają długi cache; `index.html` wymaga ponownej walidacji. Rzeczywisty lokalny kontener sprawdza kompresję, nagłówki oraz fallback SPA.
- Zapamiętywanie wyrenderowanych wierszy konsoli eliminuje ponowne formatowanie czasu dla niezmienionych wpisów.
- Przy pełnym buforze wykrywanie nowych logów uwzględnia tożsamość ostatniego wpisu. Licznik nowych logów i podążanie za końcem działają także przy stałej długości listy. Osobny test odtwarza 5000 + 100 + 100 wpisów.

Edytor nadal jest największą paczką ładowaną na żądanie. Ostrzeżenie Vite o rozmiarze pozostaje; nie usuwamy funkcji edytora ani limitu historii dla samego wyniku benchmarku.

## Powtarzanie

```sh
npm run build --prefix frontend
GP_PERF_LABEL=check node frontend/scripts/measure-performance.mjs
node frontend/scripts/check-performance.mjs \
  docs/pro/performance/candidate.json docs/pro/performance/check.json
```

Własny Chromium można wskazać przez `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Porównywarka wymaga tego samego środowiska i profilu, minimum trzech prób, braku błędów przeglądarki i median w granicy +10%. Nie uruchamiać ciężkich testów równolegle z pomiarem. Baseline bez kompresji służy do porównania tej optymalizacji; przyszły budżet odnosi się do `candidate.json`.

## Wydanie i rollback

Wersja panelu i agenta pozostaje 2.0.49. Lokalny skrypt przygotowuje archiwa źródeł wskazanego commitu kandydata i poprzedniej Revision 49, manifest oraz sumy SHA-256. Instrukcja: [DEPLOYMENT.md](DEPLOYMENT.md). To pakiet źródeł do przygotowania aktualizacji, nie wykonany snapshot WAW. Wdrożenie wymaga dostępu do WAW1, zgodnych agentów, kopii baz/środowiska/obrazów oraz odbioru z klientem gry. Niczego nie opublikowano i nie wdrożono.

## Kontrola końcowa

166/166 testów UI, następnie 4/4 testy modalu API po poprawie jego odstępów i wspólnych przełączników. Build produkcyjny poprawny. Weryfikacja zrzutów desktop/mobile oraz obu motywów była dozwolona przez użytkownika; dotyczyła lokalnych fixtures, bez danych produkcji. Ostatnie poprawki wyglądu modalu API nastąpiły po zapisaniu pomiarów; nie zmieniają ścieżek wykonawczych benchmarku. Backend etapu 4 pozostaje bez zmian: 143 testy, 3 awarie magazynu, 1 integracja Linux.
