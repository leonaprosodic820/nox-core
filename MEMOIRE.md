# Mémoire de session — ShadowRoot

> Fichier de référence pour l’assistant : contexte, décisions, état des chantiers.  
> À **lire en début de session** ; à **mettre à jour** après un travail notable.

---

## Dernière vérification

- **Lu / mis à jour le :** 2026-04-21

---

## Contexte stable

- **Environnement :** macOS, shell zsh, dépôt maison `~/` (git : `.gitignore`, `MEMOIRE.md`, `cursor-rules/memoire-session.mdc`).
- **Terminal / Cursor :** projet `~/CursorLauncher/` — app **Cursor AI Terminal** (`cursor agent` dans le terminal, pas Cursor.app). Raccourci `~/Cursor-AI-Terminal.command`, app installée `~/Applications/Cursor-AI-Terminal.app`.
- **Variable utile :** `CURSOR_AGENT_WORKSPACE` pour le dossier de travail de l’agent.

---

## Journal (du plus récent au plus ancien)

### 2026-04-21 — Lanceur Cursor Agent

- Projet `CursorLauncher` : logo SVG, `AppIcon.icns`, `.app` avec `install.sh`, bannière terminal, `launch.sh` → `exec cursor agent --workspace …`.
- Règle Cursor : lecture de ce fichier à chaque session (`memoire-session`).
- **Git / mémoire :** la règle est versionnée dans `~/cursor-rules/memoire-session.mdc` ; le fichier utilisé par Cursor est un **lien symbolique** `~/.cursor/rules/memoire-session.mdc` → `../../cursor-rules/memoire-session.mdc` (évite de suivre tout `.cursor/` dans git, à cause du `.gitignore` interne Cursor).

---

## À faire / idées

- *(vide)*

---

## Notes

- Pas de secrets dans ce fichier (tokens, mots de passe).
- **Versionné dans git** : exceptions `!MEMOIRE.md` et `!cursor-rules/memoire-session.mdc` dans `~/.gitignore`. Après un clone ou si le lien est cassé :  
  `ln -sf ../../cursor-rules/memoire-session.mdc ~/.cursor/rules/memoire-session.mdc`
