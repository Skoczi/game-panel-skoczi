# Game Panel PRO 2.0.51

- The sidebar node selector is available on every administrator page. New sessions start with **All nodes**; the chosen filter is retained within the browser tab.
- Game Servers filters by node identity, including hosts with identical names. Existing search, status and game filters still apply.
- Host Status shows a separate metrics summary for every node. Select a host to open its history charts.
- Each host has its own authenticated metrics stream. Switching hosts closes the previous stream; unavailable hosts show a connection state instead of zero or cached values.
- Panel settings remain global. Viewing a node does not change the runtime used by server operations. Leaving an edited server file still requires confirmation.

This is a central-panel update. Agents running 2.0.50 remain compatible; no game-server restart or database migration is required. Keep the previous panel images and configuration for rollback.
