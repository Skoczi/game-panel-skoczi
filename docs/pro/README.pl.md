# Game Panel PRO 2.0.49

Niezależny fork OVH Game Panel, rozwijany przez Skoczi. Zachowujemy oryginalne prawa autorskie OVH i licencję Apache 2.0. `2.0.49` kontynuuje dawną Revision 49; nie jest wersją upstream 2.0.

To lokalny kandydat do dużej aktualizacji. Nie wdrożono go na eserv.pl ani WAW1.

## Najważniejsze zmiany

- Backup Native działa także przy uruchomionej grze. Kopia „live” nie gwarantuje spójności zapisu świata; dla spójnej kopii zatrzymaj grę.
- Archiwum trafia do `data/backups`, obok `serverfiles` i `log`, i zawiera wyłącznie `serverfiles`.
- Odtwarzanie wymaga zatrzymanego serwera. Najpierw sprawdzane i rozpakowywane jest archiwum, potem podmieniany katalog. Poprzednie pliki pozostają w `backups/recovery-<uuid>`.
- Edytor sprawdza wersję pliku i zapisuje przez atomową podmianę. Konflikt pozostawia szkic użytkownika i pokazuje aktualną zawartość serwera.
- Cron odrzuca błędną składnię, pokazuje strefę czasu noda i kolejne wykonania.
- Metryki pokazują używane vCPU, RAM i przyznane limity; zajętość danych gry oraz wolne miejsce noda są rozdzielone.
- W panelu jest changelog zainstalowanej wersji oraz sprawdzanie stabilnych wydań istniejącego forka GitHuba. Brak wydania nie oznacza „panel aktualny”.

## Przed wdrożeniem

Wymagana jest aktualizacja agenta WAW1. Stary agent nie zapewni nowego backupu, restore ani metryk. Nowy edytor zablokuje zapis, jeśli agent nie zwróci wersji pliku. Nie skonfigurowano jeszcze dostępu terminalowego do WAW1.

Stare archiwa `.native-backups` nie są usuwane ani automatycznie konwertowane. Nowy format dotyczy układu `data/serverfiles`; inne stare układy wymagają jawnej migracji. Nie zmieniamy automatycznie danych istniejących gier.

[Obsługa i ograniczenia](OPERATIONS.md) · [wdrożenie i rollback](DEPLOYMENT.md) · [macierz funkcji](FEATURES.md) · [changelog](../../CHANGELOG.md) · [miejsce na screeny](../screenshots/README.md).
