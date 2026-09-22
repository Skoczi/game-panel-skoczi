# Etap A — stan lokalny 2.0.49

20.09.2026. Kontynuacja audytu lokalnego kandydata. Zmiany przygotowane lokalnie; bez wdrożenia i publikacji GitHub. Wersja pozostaje **Game Panel PRO 2.0.49**.

## Zrealizowane

- Backup Native działa przy włączonym i wyłączonym serwerze. Archiwizuje tylko `serverfiles`, zapisuje wynik w `data/backups`.
- Ręczny backup ma opcjonalną nazwę. Formularz korzysta ze wspólnego modala i pola tekstowego; nazwa jest sprawdzana także przez backend. Data i unikalny identyfikator chronią przed nadpisaniem wcześniejszej kopii. Harmonogram zachowuje automatyczne nazwy.
- Archiwum jest sprawdzane przed publikacją. Zewnętrzne/uszkodzone/cykliczne linki i niedozwolone wpisy kończą operację błędem. Brak cichego uznania nieodtwarzalnej kopii za udaną.
- Ręczne operacje Native mają trwały status. HTTP zwraca 202, interfejs odczytuje wynik krótkimi zapytaniami. Po odświeżeniu strony ostatnie operacje nadal są widoczne.
- Restore wymaga zatrzymania gry, przygotowuje pliki w stagingu i zachowuje poprzedni katalog. Trwały dziennik pozwala na rollback przerwanej operacji po restarcie agenta. Błąd odzyskania blokuje kolejne mutacje.
- Zwykły menedżer plików nie udostępnia zarządzanych backupów, również przez link do chronionego katalogu i pobranie całego katalogu nadrzędnego.
- Starsze archiwa `.native-backups` są widoczne do pobrania jako format wymagający ręcznego odzyskania. Brak `serverfiles` daje jawny komunikat o migracji. Żadne pliki gry ani receptury nie są automatycznie przenoszone.
- Rozpakowanie zwykłego archiwum najpierw przygotowuje staging. Kolizje są sprawdzane przed nadpisaniem, poprzednie pliki zachowane na czas transakcji. Dziennik umożliwia cofnięcie przerwanego commitowania plików.
- Blokada rozpakowania obejmuje pełny czas zadania w tle. Nie kończy się wraz z odpowiedzią HTTP.
- Harmonogram rozdziela post po sukcesie od cleanup wykonywanego również po błędzie. Strict cron, strefa węzła i podgląd kolejnych terminów pozostają dostępne.
- Edytor zachowuje wersjonowanie zawartości, obsługę konfliktów, atomowy zapis i synchronizację pliku/katalogu.
- CPU/RAM pokazują wartości bezwzględne i przyznane limity. Dane gry i wolne miejsce węzła pozostają osobnymi wartościami.
- Potwierdzenia nawigacji, ustawień i zarządzania używają wspólnego komponentu. W kodzie aplikacji nie pozostały wywołania `window.confirm`. Ostrzeżenie przeglądarki przy zamknięciu całej karty z niezapisanym edytorem pozostaje mechanizmem `beforeunload`.
- Poprawiono test audio: zamiast obrazu udającego MP3 używa prawdziwej próbki dźwięku. Nie zmieniano obsługi prawidłowych plików audio na podstawie błędnej fixture.

## Walidacja

- Backend: **115/115**.
- Interfejs: **125/125**, headless, bez screenshotów.
- TypeScript backend oraz TypeScript/Vite frontend: **PASS**.
- `git diff --check`: **PASS**.
- Pozostaje wcześniejsze ostrzeżenie Vite o wielkości paczek.

## Granice etapu

Nie rozwijano profili, instalatorów gier ani ReHLDS. Nie dodano importera Eggs, nowych gier, automatycznej retencji lub magazynu zewnętrznego. Starsze układy danych wymagają zaplanowanej migracji wraz z odpowiednią recepturą; nie zgadujemy jej w tym etapie.

Przed wdrożeniem trzeba zaktualizować również **agenta WAW1** i przeprowadzić akceptację na tymczasowym serwerze Linux: backup live, restore, przerwanie procesu, odzyskanie, start gry i rollback wydania. Lokalne testy symulują stany awarii i używają mocków statusu Dockera; nie zastępują tych prób.

Backup live nadal nie jest transakcyjnym snapshotem świata gry. Cleanup nie gwarantuje wykonania po wyłączeniu hosta. Proces gry nie uczestniczy w blokadach plikowych panelu — przed zastępowaniem plików aktywnie zapisywanych przez grę należy ją zatrzymać. Po nieudanym rozpakowaniu mogą pozostać puste, nowo utworzone katalogi; nadpisane pliki są cofane.

Szczegóły eksploatacji i format dzienników opisuje [OPERATIONS.md](OPERATIONS.md), a przygotowanie wydania i agentów [DEPLOYMENT.md](DEPLOYMENT.md).
