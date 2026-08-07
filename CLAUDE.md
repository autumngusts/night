# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static-site GM/player companion tool for a tabletop RPG ("夜渡り" / Elden Ring Nightreign TRPG), plus a home page that can host other mini-projects (`site_src/projects.py`). Python generates static HTML at build time; all actual game logic runs client-side in vanilla ES5 JavaScript and persists to `localStorage` (with optional Firebase Realtime Database sync for "cloud" games). There is no build framework (no npm/webpack) and no automated test suite — verification is manual (browser click-through) or via ad-hoc Playwright scripts against the built `dist/`.

## Commands

```bash
python generate.py      # builds dist/ from site_src/ + static_src/ (must re-run after any source edit)
python -m http.server 8000 --directory dist   # serve dist/ locally to test in a browser
```

On Windows, use `py -3 generate.py` if `python` isn't on PATH.

There is no lint/test command — nothing is configured. `node --check static_src/<file>.js` is useful as a quick syntax gate before rebuilding a large JS file. Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs `python generate.py` and deploys `dist/` to GitHub Pages — the built output is never committed (`dist/` is gitignored).

### Manual verification

Since there's no test harness, the working pattern for verifying JS changes is: rebuild, serve `dist/` locally, then drive it with a throwaway Playwright script (not checked in) that navigates the real UI and/or reads `window.PriTest*` globals plus `localStorage` directly. Two things trip this up reliably:
- The admin page (`admin/index.html`) gates everything behind `window.prompt("password")` (hardcoded `"night"`, see `games.js`) — a Playwright script needs a `page.on("dialog", ...)` handler that accepts prompts with `"night"`, or every admin action hangs.
- Writing a hand-rolled/partial state object into `pritest-night-state-<gameId>` *before* the first real page load causes the app to silently fall back to defaults for the fields you didn't set. Prefer: let the app build a real state through normal UI actions first, then read-modify-write only the specific fields you need via `localStorage`, then `page.reload()`.

## Architecture

### Build pipeline

`generate.py` does two things: (1) copies `static_src/*.js` and `style.css` verbatim into `dist/static/`, and stamps `static_src/i18n.template.js` → `dist/static/i18n.js` by substituting `__I18N_DATA__` with the JSON-serialized `STRINGS` dict from `site_src/i18n_data.py`; (2) calls each `site_src/*_page.py`'s `build_*_html()` to produce `dist/{index,night,admin,admin/scenarios,characters}/index.html`. Every page shares one shell (`site_src/layout.py`'s `page_shell`) — header, language switcher, footer script tags — and pages are otherwise independent HTML documents (no client-side router).

To add a new mini-project page: add `site_src/<name>_page.py` with a `build_*_html()`, register it in `generate.py`'s `build_pages()`, add an entry to `site_src/projects.py`, and add its i18n keys to `site_src/i18n_data.py`.

### i18n

All user-facing strings live in one place: `site_src/i18n_data.py`'s `STRINGS` dict, keyed by language (`zh`/`ja`/`en`) then by string key. `zh` is the default/fallback language. Static HTML elements pick up strings automatically via `data-i18n="key"` attributes (applied by `i18n.template.js`'s `applyI18n()`); JS-generated content calls `window.I18N.t(key, params)` with `{param}`-style interpolation. Data modules (character types, weapons, enemies, etc.) instead store bilingual text directly as `{ja, zh}` objects (built with a local `C(ja, zh)` helper in each file) and pick the current language at render time — `en` is largely unauthored for game data and falls back to `ja`.

### Client-side module map (`static_src/*.js`)

All modules are IIFEs that attach a namespace to `window` (e.g. `window.PriTestGames`, `window.PriTestCharacterDrawer`). Load order matters and is defined once in `generate.py`'s copy list / each page's `extra_scripts`.

- **Infrastructure**: `i18n.template.js` (→ `i18n.js`), `games.js` (game CRUD, admin password gate, import/export/share via base64url-encoded JSON, QR sharing), `game_storage.js` (cloud sync — a no-op abstraction layer unless a game's `storageMode === "cloud"`, in which case it lazy-loads the Firebase SDK and mirrors state to Realtime Database), `firebase_config.js`, `qrcode.js` (vendored).
- **Reference/rulebook data** (mostly static bilingual content, no page-specific logic): `character_types.js`, `weapons.js`, `weapon_rulebook.js`, `talismans.js`, `consumables.js`, `enemies.js`, `fields.js` (map/board cards), `event_rulebook.js`, `night_bosses.js` + `night_boss_rulebook.js`, `worldview.js`, `scenarios.js` (fixed card layouts per scenario).
- **Page logic**: `admin.js` / `admin_scenarios.js` (game list + scenario/card-deck editor), `characters.js` (character roster/gallery page), `character_drawer.js` (huge — the shared character-detail/stat-computation module, see below), `night.js` (huge — the actual play-session engine, see below).

### `character_drawer.js` — shared character model & stat math

Owns character CRUD (`newCharacter`, stat steppers), and every damage/bonus computation: `computeArtPower` (the central power-modifier calculation — combines the character type's base `powerMod`, talisman bonuses, and relic-effect bonuses; feeds into both weapon-attack damage and skill/sorcery/incantation damage so a fix here is automatically reflected everywhere), `computeWeaponDamage`, talisman/relic/attached-effect bonus helpers (`talismanFlatMaxStatBonus`, `relicFlatMaxStatBonus`, `attachedFlatMaxStatBonus`, `totalFlatMaxStatBonus`, etc.). It's used by both `characters.js` (character creation/roster, no live game state) and `night.js` (during play), so anything that depends on live combat state (position, aggro) is exposed defensively — e.g. `night.js` sets `window.PriTestNightBattleContext`, and `character_drawer.js` checks `window.PriTestNightBattleContext && ...` rather than assuming it exists.

Characters have three distinct, independently-tracked bonus systems that look similar but are separate arrays on the character object and must each be checked when computing any "total" stat: `learnedRelicEffects` (type-specific, keyed `"<typeId>-r<group>-<index>"`, gated by character level via `relicMaxLearnable`), `learnedAttachedEffects` (a small fixed universal set, rolled via 2d6, capped at `MAX_ATTACHED_EFFECTS`), and `talismanIds` (equipped decorations, each with a single passive effect).

### `night.js` — play-session engine

The state machine for an actual session: dice pools, action/extra/defense phase transitions, the front/back-row battle board, combat modal (attack/skill/defense/flask/consumable/move/equip tabs), enemy HP tracking, turn rewards, event chips, near-death/revival. All state lives in one `state` object persisted to `localStorage["pritest-night-state-<gameId>"]` on every mutation (`saveState()`); characters are persisted separately to `localStorage["pritest-characters-<gameId>"]` (`saveRosterCharacters()`).

Two parsing conventions recur throughout combat/relic/talisman text and are load-bearing for damage math — get them wrong and numbers silently come out incorrect rather than erroring:
- `□` (hollow square) in a bonus description = literal `+1` per box (e.g. `最大HP+□□□` = `+3`); `■` (filled square) = a cost/consumption count, not a bonus.
- `▲` / `◆` in a damage line (e.g. `總合傷害：50+▲`) is a placeholder for the character's own power-modifier contribution, resolved via `computeArtPower`/`fixedSkillPowerValue` rather than being a literal number — don't treat it as text to strip, it's meaningful to the formula.

Many special per-ability behaviors (unique buffs, alternate action modes granted by a specific relic effect, position-locked or resource-gated skills) are hooked by checking `entry.id` inside `night.js`'s combat rendering functions (`renderCombatSkillAction`, `renderCombatDefenseAction`) rather than being data-driven — when a relic/talisman effect needs to change *how* a skill behaves (not just add a flat number), the established pattern is to synthesize a fake ability entry (same shape as a `character_types.js` ability: `{id, kind, name, body}`, see `CRUCIBLE_BEAST_ACTIONS` for the template) and conditionally concat it into the entries list so it flows through the existing generic cost/damage-parsing pipeline instead of being hand-coded.
