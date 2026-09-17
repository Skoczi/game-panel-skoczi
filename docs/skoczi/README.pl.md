# OVH Game Panel by Skoczi — przewodnik

To **niezależny fork społecznościowy**, a nie oficjalne wydanie OVHcloud.
Bazujemy na wersji OVH 1.5.0; pierwsza rewizja to **1.5.0-skoczi.1 (preview)**.

## Co zmieniłem względem OVH?
- Wybór dodatkowego **IPv4 hosta dla każdego portu TCP/UDP** przy instalacji i edycji.
- Ten sam port na różnych IP jest dozwolony; nakładające się przypisania są odrzucane.
- Kilka mapowań jednego portu kontenera nie nadpisuje się nawzajem.
- Lista serwerów i kopiowanie adresu pokazują wybrane IP gry, niezależnie od domeny panelu.
- Administrator określa dozwolone adresy w GAMEPANEL_BIND_IPS.
- Telemetria nowych instalacji jest domyślnie wyłączona.
- Automatyczny aktualizator jest wyłączony w preview; informacje o wydaniach pochodzą z tego forka.
- Dodane testy, CI, instrukcje i jawny wykaz zmian.

[Pełny changelog](../../CHANGELOG-SKOCZI.md) · [Mapa zmian w plikach](CHANGES.md)

## Od czego zacząć?
**Od osobnej testowej maszyny**, nie od działającego hosta z Pterodactylem/Nginx.
Standardowy instalator instaluje Traefika i zajmuje porty 80/443. Nie jest instalatorem „obok” istniejących usług.

1. Przeczytaj [instalację](INSTALLATION.md).
2. Zainstaluj przypięty tag preview na nowej maszynie.
3. Skonfiguruj IP w systemie zgodnie z wymaganiami dostawcy.
4. Dodaj własne IP do środowiska backendu.
5. Przetestuj jeden nowy serwer i połączenie prawdziwym klientem gry.

Przykład w /opt/gamepanel/deploy/.env (adresy wyłącznie dokumentacyjne):
```dotenv
GAMEPANEL_BIND_IPS=192.0.2.10,192.0.2.11
TELEMETRY_ENABLED=false
```

Po zmianie trzeba odtworzyć kontener backendu, aby wczytał nowe środowisko. Dokładne kroki: [dodatkowe IP](ADDITIONAL-IPS.md).

## Czego ta wersja nie robi?
Nie tworzy interfejsów, MACVLAN-ów, tras ani reguł firewalla. Nie wybiera IP ruchu wychodzącego. Nie migruje Pterodactyla. Nie dodaje limitów IP per użytkownik, MFA ani kompletnej izolacji najemców. Brak wybranego IP zachowuje domyślne działanie Dockera, zwykle wszystkie interfejsy.

Backend ma dostęp do socketa Dockera — traktuj go jak usługę administracyjną hosta.
[Ograniczenia](LIMITATIONS.md) · [Testy i rozwój](DEVELOPMENT.md)

## Prywatność i autorstwo
Repozytorium zawiera kod i przykłady, nie konfigurację konkretnego serwera. Nie publikuj .env, baz danych, kluczy, certyfikatów ani logów z sekretami.
Wyłączenie telemetrii nie wyłącza pobierania katalogu czy obrazów od zewnętrznych usług.

Zachowujemy autorstwo OVH i licencję Apache 2.0. Zmiany Skoczi są opisane oddzielnie, a historia Git pozwala je porównać z oryginałem.
