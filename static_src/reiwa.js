// 令和之野望（reiwa）：畫面與互動。資料在 reiwa_data.js，遊戲規則與 state 在 reiwa_core.js，美術在 reiwa_art.js。
// 單人對抗 AI 勢力，狀態存在 localStorage["pritest-reiwa-save"]（reiwa_core.js 的 SAVE_KEY）。
// 每次畫面變動整個重畫（el/svg 輔助函式與 i18n:change 重畫慣例沿用自 yellow.js／dejavu.js）；
// 出陣／守城／調兵視窗開啟後，選單與數量輸入不會因為重畫而被打斷：預估戰果只就地更新視窗內的區塊，
// 只在按下確認／取消時才讀取 DOM 數值。
(function () {
  "use strict";

  var D = window.PriTestReiwaData;
  var Core = window.PriTestReiwaCore;
  var Art = window.PriTestReiwaArt;
  var app = document.getElementById("rw-app");
  if (!app || !D || !Core || !Art) return;

  var state = Core.load();

  function freshUi() {
    return { selected: null, tab: "node", modal: null, provokeFrom: null, setup: { scenario: "s1585", difficulty: "normal", victoryMode: "conquest" } };
  }
  var ui = freshUi();

  // ---------------- 小工具 ----------------

  function t(key, params) {
    return window.I18N ? window.I18N.t(key, params) : key;
  }
  function L(obj) {
    return D.localizedText(obj);
  }
  function factionName(fid) {
    var f = D.factionById(fid);
    return f ? L(f.name) : fid;
  }
  function factionColor(fid) {
    var f = D.FACTIONS[fid];
    return f ? f.color : "#888888";
  }
  function nodeName(nid) {
    var n = D.nodeById(nid);
    return n ? L(n.name) : nid;
  }
  function troopName(tid) {
    var tt = D.troopType(tid);
    return tt ? L(tt.name) : tid;
  }
  function troopIcon(tid) {
    var tt = D.troopType(tid);
    return tt ? tt.icon : "";
  }
  function generalName(gid) {
    var g = D.generalById(gid);
    return g ? L(g.name) : gid;
  }
  function pct(x) {
    return Math.round(x * 100) + "%";
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function persist() {
    if (state) Core.save(state);
  }

  // 行動後的共通流程：存檔並重畫；若行動導致遊戲結束（例如事件中攻下最後一城）就顯示結局
  function after() {
    persist();
    render();
  }

  function resolveLogParams(params) {
    var out = {};
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (typeof v === "string") {
        if (D.FACTIONS[v]) out[k] = factionName(v);
        else if (D.nodeById(v)) out[k] = nodeName(v);
        else if (D.generalById(v)) out[k] = generalName(v);
        else out[k] = v;
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function logText(entry) {
    return t(entry.key, resolveLogParams(entry.params));
  }

  function tacticName(id) {
    return t("rw_tactic_" + id);
  }

  // ---------------- 開局設定：劇本／難度／勝利條件／勢力 ----------------

  function scenarioOwner(sc, nodeDef) {
    return sc.ownerOverrides[nodeDef.id] || nodeDef.faction;
  }

  function choiceRow(label, options, current, onPick) {
    return el("div", { class: "rw-setup-row" }, [
      el("b", { text: label }),
      el(
        "div",
        { class: "rw-setup-options" },
        options.map(function (o) {
          return el("button", {
            class: "rw-tab" + (o.id === current ? " rw-tab-on" : ""),
            text: o.label,
            title: o.title || null,
            onclick: function () {
              onPick(o.id);
              render();
            },
          });
        })
      ),
    ]);
  }

  function renderSetup() {
    var setup = ui.setup;
    var sc = D.SCENARIOS[setup.scenario];
    var previewNodes = {};
    D.NODES.forEach(function (n) {
      previewNodes[n.id] = { owner: scenarioOwner(sc, n) };
    });

    var grid = el("div", { class: "rw-faction-grid" });
    D.FACTION_ORDER.forEach(function (fid) {
      if ((sc.absent || []).indexOf(fid) !== -1 || (sc.eliminated || []).indexOf(fid) !== -1) return;
      var f = D.FACTIONS[fid];
      var nodes = D.NODES.filter(function (n) {
        return scenarioOwner(sc, n) === fid;
      });
      var kokudaka = nodes.reduce(function (sum, n) {
        return sum + D.KOKUDAKA_BY_PROFILE[n.profile];
      }, 0);
      var generalNames = f.generals.map(function (gid) {
        return generalName(gid);
      });
      grid.appendChild(
        el("div", { class: "rw-faction-card", style: "--rw-fc: " + f.color }, [
          el("div", { class: "rw-faction-dot", style: "background:" + f.color }),
          el("h3", { text: L(f.name) }),
          el("div", { class: "rw-trait-chip", text: "★ " + L(f.trait.name) }),
          el("div", { class: "rw-muted rw-small", text: L(f.trait.desc) }),
          el("div", { class: "rw-muted", text: t("rw_faction_nodes", { n: nodes.length }) + "・" + t("rw_faction_kokudaka", { n: kokudaka }) }),
          el("div", { class: "rw-muted rw-small", text: t("rw_faction_temperament", { v: t("rw_temperament_" + f.temperament) }) }),
          el("div", { class: "rw-muted rw-small", text: t("rw_faction_generals", { names: generalNames.join("・") }) }),
          el("button", {
            class: "rw-primary",
            text: t("rw_select_faction_start"),
            onclick: function () {
              state = Core.createInitialState(fid, setup);
              ui = freshUi();
              persist();
              render();
            },
          }),
        ])
      );
    });

    var previewMap = Art.renderMap({
      state: { nodes: previewNodes },
      selected: null,
      playerFaction: null,
      nodeName: nodeName,
      factionName: factionName,
      factionColor: factionColor,
      labels: mapLabels(),
    });

    return el("div", { class: "rw-wrap" }, [
      el("h2", { text: t("rw_select_faction_title") }),
      el("p", { class: "rw-intro", text: t("rw_intro") }),
      el("div", { class: "rw-panel rw-setup" }, [
        choiceRow(
          t("rw_setup_scenario"),
          D.SCENARIO_ORDER.map(function (id) {
            return { id: id, label: L(D.SCENARIOS[id].name) };
          }),
          setup.scenario,
          function (v) {
            setup.scenario = v;
          }
        ),
        el("div", { class: "rw-muted rw-small rw-setup-desc", text: L(sc.desc) }),
        choiceRow(
          t("rw_setup_difficulty"),
          D.DIFFICULTY_ORDER.map(function (id) {
            return { id: id, label: t("rw_difficulty_" + id), title: t("rw_difficulty_" + id + "_desc") };
          }),
          setup.difficulty,
          function (v) {
            setup.difficulty = v;
          }
        ),
        el("div", { class: "rw-muted rw-small rw-setup-desc", text: t("rw_difficulty_" + setup.difficulty + "_desc") }),
        choiceRow(
          t("rw_setup_victory"),
          [
            { id: "conquest", label: t("rw_victory_mode_conquest") },
            { id: "timed", label: t("rw_victory_mode_timed") },
          ],
          setup.victoryMode,
          function (v) {
            setup.victoryMode = v;
          }
        ),
        el("div", { class: "rw-muted rw-small rw-setup-desc", text: t("rw_victory_mode_" + setup.victoryMode + "_desc", { n: Core.victoryTarget(), turns: 40 }) }),
      ]),
      el("div", { class: "rw-setup-main" }, [el("div", { class: "rw-map-frame-box rw-setup-map" }, [previewMap]), grid]),
    ]);
  }

  // ---------------- 頂部資訊列 ----------------

  function topBar() {
    var f = state.factions[state.playerFaction];
    var fDef = D.FACTIONS[state.playerFaction];
    var disabled = !!ui.modal || !!state.gameOver;
    var counts = Core.nodeCounts(state);
    var mine = counts[state.playerFaction] || 0;
    var season = Core.seasonOf(state);
    var progress =
      state.victoryMode === "timed"
        ? t("rw_progress_timed", { n: mine, target: Core.victoryTarget(), turn: state.turn, limit: state.turnLimit })
        : t("rw_progress_conquest", { n: mine, target: Core.victoryTarget() });
    return el("div", { class: "rw-topbar" }, [
      el("div", { class: "rw-faction-dot", style: "background:" + fDef.color }),
      el("b", { text: L(fDef.name) }),
      el("span", { class: "rw-pill rw-trait-chip", title: L(fDef.trait.desc), text: "★ " + L(fDef.trait.name) }),
      el("span", { class: "rw-pill rw-season rw-season-" + season, text: t("rw_date_label", { year: Core.yearOf(state), season: t("rw_season_" + season) }) }),
      el("span", { class: "rw-pill", text: t("rw_turn_label", { n: state.turn }) }),
      el("span", { class: "rw-pill", text: t("rw_ap_label", { n: state.actionPoints, max: state.actionPointsMax }) }),
      el("span", { class: "rw-pill", text: t("rw_gold_label", { n: f.gold }) }),
      el("span", { class: "rw-pill" + (f.food < 50 ? " rw-pill-warn" : ""), text: t("rw_food_label", { n: f.food }) }),
      el("span", { class: "rw-pill rw-pill-goal", text: progress }),
      el("span", { class: "rw-spacer" }),
      el("button", {
        class: "rw-primary",
        text: t("rw_end_turn"),
        disabled: disabled,
        onclick: function () {
          var res = Core.endPlayerTurn(state);
          persist();
          handleAiStep(res);
        },
      }),
      el("button", {
        class: "rw-link",
        text: t("rw_restart"),
        onclick: function () {
          if (!window.confirm(t("rw_restart_confirm"))) return;
          Core.clearSave();
          state = null;
          ui = freshUi();
          render();
        },
      }),
    ]);
  }

  // AI 階段的每一步：需要玩家守城 → 守城視窗；回合推進 → 回合摘要 → 待決事件；遊戲結束 → 結局
  function handleAiStep(res) {
    if (res && res.type === "needPlayerDefense") {
      var defNode = state.nodes[res.pending.targetNodeId];
      ui.modal = { type: "defense", autoSlots: autoDefenseSlots(defNode) };
    } else if (state.gameOver) {
      ui.modal = { type: "gameover" };
    } else if (res && res.type === "turnAdvanced") {
      var rep = state.turnReport;
      if (rep && (rep.items.length || rep.arrows.length)) ui.modal = { type: "summary" };
      else nextEventModal();
    }
    persist();
    render();
  }

  function nextEventModal() {
    ui.modal = state.pendingEvents.length ? { type: "event" } : null;
  }

  // 玩家守城的預設編成：兵力前 5 的兵種全數上陣
  function autoDefenseSlots(node) {
    return D.TROOP_ORDER.slice()
      .sort(function (a, b) {
        return (node.troops[b] || 0) - (node.troops[a] || 0);
      })
      .slice(0, 5)
      .filter(function (tid) {
        return (node.troops[tid] || 0) > 0;
      })
      .map(function (tid) {
        return { type: tid, amount: node.troops[tid], tactic: "normal" };
      });
  }

  // ---------------- 地圖 ----------------

  function mapLabels() {
    return {
      seaJapan: t("rw_map_sea_japan"),
      seaPacific: t("rw_map_sea_pacific"),
      strait: t("rw_map_strait"),
      mutsuBay: t("rw_map_mutsu_bay"),
      mutsu: t("rw_map_mutsu"),
      dewa: t("rw_map_dewa"),
      echigo: t("rw_map_echigo"),
      north: t("rw_map_north"),
      cartouche: t("rw_map_cartouche"),
    };
  }

  function hostileToMe(fid) {
    return fid !== state.playerFaction && !Core.hasPact(state, state.playerFaction, fid);
  }

  // 選取城池時，標出可伐掠的目標（選自己的城）或可出兵的來源（選別人的城）
  function mapTargets() {
    var targets = {};
    if (!ui.selected) return targets;
    var selNode = state.nodes[ui.selected];
    var selMine = selNode.owner === state.playerFaction;
    D.neighborsOf(ui.selected).forEach(function (nid) {
      var n = state.nodes[nid];
      if (selMine ? hostileToMe(n.owner) : n.owner === state.playerFaction && hostileToMe(selNode.owner)) targets[nid] = true;
    });
    return targets;
  }

  function mapMarks() {
    var marks = {};
    Object.keys(state.sieges).forEach(function (nid) {
      marks[nid] = marks[nid] || {};
      marks[nid].siege = factionColor(state.sieges[nid].faction);
    });
    D.NODES.forEach(function (n) {
      if (state.nodes[n.id].owner === state.playerFaction) return;
      if (Core.nodeIntel(state, n.id).full && !Core.isAllied(state, state.playerFaction, state.nodes[n.id].owner)) {
        marks[n.id] = marks[n.id] || {};
        marks[n.id].intel = true;
      }
    });
    return marks;
  }

  function mapLegend() {
    var row = el("div", { class: "rw-map-legend" });
    var counts = Core.nodeCounts(state);
    D.FACTION_ORDER.forEach(function (fid) {
      if (!state.factions[fid].alive) return;
      var pact = Core.pactOf(state, state.playerFaction, fid);
      row.appendChild(
        el("span", { class: "rw-legend-item" + (fid === state.playerFaction ? " rw-legend-mine" : "") }, [
          el("span", { class: "rw-faction-dot", style: "background:" + factionColor(fid) }),
          el("span", { text: factionName(fid) }),
          el("b", { text: counts[fid] || 0 }),
          pact ? el("span", { class: "rw-pact-chip rw-pact-" + pact.type, text: t("rw_pact_short_" + pact.type) }) : null,
        ])
      );
    });
    return row;
  }

  function mapPanel() {
    var svg = Art.renderMap({
      state: state,
      selected: ui.selected,
      playerFaction: state.playerFaction,
      targets: mapTargets(),
      marks: mapMarks(),
      nodeName: nodeName,
      factionName: factionName,
      factionColor: factionColor,
      labels: mapLabels(),
      onSelect: function (id) {
        ui.selected = id;
        ui.tab = "node";
        render();
      },
    });
    return el("div", { class: "rw-panel rw-map-wrap" }, [
      el("h3", { text: t("rw_map_title") }),
      el("div", { class: "rw-muted rw-small", text: t("rw_map_hint") }),
      el("div", { class: "rw-map-frame-box" }, [svg]),
      mapLegend(),
    ]);
  }

  // ---------------- 側欄分頁 ----------------

  function tabsBar() {
    function tabBtn(key, label) {
      return el("button", {
        class: "rw-tab" + (ui.tab === key ? " rw-tab-on" : ""),
        text: label,
        onclick: function () {
          ui.tab = key;
          render();
        },
      });
    }
    return el("div", { class: "rw-tabs" }, [
      tabBtn("node", t("rw_tab_domestic") + " / " + t("rw_tab_invade")),
      tabBtn("generals", t("rw_tab_generals")),
      tabBtn("diplomacy", t("rw_tab_diplomacy")),
    ]);
  }

  function troopGrid(troops, maxTroops) {
    var grid = el("div", { class: "rw-troop-grid" });
    D.TROOP_ORDER.forEach(function (tid) {
      var n = troops[tid] || 0;
      grid.appendChild(
        el("div", { class: "rw-troop-chip" + (n === 0 ? " rw-muted" : "") }, [
          el("span", { class: "rw-troop-icon", text: troopIcon(tid) }),
          el("span", { text: troopName(tid) }),
          el("b", { text: n }),
        ])
      );
    });
    return el("div", {}, [grid, el("div", { class: "rw-muted rw-small", text: t("rw_node_troops_total", { n: Core.totalTroops(troops), max: maxTroops }) })]);
  }

  function formationList(formation) {
    return el(
      "div",
      { class: "rw-formation" },
      formation.map(function (s, i) {
        return el("span", { class: "rw-formation-slot" }, [
          el("b", { text: i + 1 }),
          document.createTextNode(" " + troopIcon(s.type) + " " + troopName(s.type) + " ×" + s.amount),
          el("span", { class: "rw-tactic-tag rw-tactic-" + s.tactic, text: tacticName(s.tactic) }),
        ]);
      })
    );
  }

  // 敵城情報：沒偵察只有概數與主力；偵察成功後可見完整駐軍與本回合守備編成
  function intelBlock(nodeDef, node) {
    var intel = Core.nodeIntel(state, nodeDef.id);
    if (intel.full) {
      var box = el("div", {}, [troopGrid(node.troops, Core.getNodeMaxTroops(node))]);
      if (intel.formation) {
        box.appendChild(el("div", { class: "rw-intel-ok rw-small", text: "👁 " + t("rw_intel_scouted") }));
        box.appendChild(formationList(intel.formation));
        if (intel.generalId) box.appendChild(el("div", { class: "rw-small rw-muted", text: t("rw_intel_general", { name: generalName(intel.generalId) }) }));
      }
      return box;
    }
    return el("div", { class: "rw-intel-fog" }, [
      el("div", { class: "rw-intel-approx", text: t("rw_intel_approx", { n: intel.approxTotal }) }),
      intel.mainType ? el("div", { class: "rw-small", text: t("rw_intel_main", { type: troopIcon(intel.mainType) + " " + troopName(intel.mainType) }) }) : null,
      el("div", { class: "rw-muted rw-small", text: t("rw_intel_need_scout") }),
    ]);
  }

  function castleStage(nodeDef, node) {
    return Art.castleStage({
      tiers: Math.max(1, Math.min(5, Math.floor(node.kokudaka / 25))),
      defense: node.defenseLevel,
      profile: nodeDef.profile,
      color: factionColor(node.owner),
      seed: nodeDef.id,
    });
  }

  function terrainNotes(nodeDef) {
    var notes = [];
    if (nodeDef.profile === "mountain") notes.push(t("rw_terrain_mountain"));
    if (nodeDef.profile === "coastal") notes.push(t("rw_terrain_coastal"));
    if (nodeDef.profile === "capital") notes.push(t("rw_terrain_capital"));
    if (Core.seasonOf(state) === 3 && D.WINTER_ATTACK_MUL[nodeDef.region]) notes.push(t("rw_terrain_winter", { n: pct(D.WINTER_ATTACK_MUL[nodeDef.region]) }));
    return notes;
  }

  function nodePanel() {
    if (!ui.selected) {
      return el("div", { class: "rw-panel" }, [el("p", { class: "rw-muted", text: t("rw_node_pick_hint") })]);
    }
    var nodeDef = D.nodeById(ui.selected);
    var node = state.nodes[ui.selected];
    var ownerDef = D.FACTIONS[node.owner];
    var isMine = node.owner === state.playerFaction;
    var siege = state.sieges[ui.selected];
    var pact = isMine ? null : Core.pactOf(state, state.playerFaction, node.owner);

    var pills = [
      el("span", { class: "rw-pill" }, [el("span", { class: "rw-faction-dot rw-dot-inline", style: "background:" + ownerDef.color }), el("b", { text: L(ownerDef.name) })]),
      el("span", { class: "rw-pill", text: t("rw_node_kokudaka", { n: node.kokudaka }) }),
      el("span", { class: "rw-pill", text: t("rw_node_defense", { n: node.defenseLevel, max: Core.maxDefenseLevel(ui.selected) }) }),
    ];
    if (pact) pills.push(el("span", { class: "rw-pill rw-pact-chip rw-pact-" + pact.type, text: t("rw_pact_" + pact.type, { n: pact.until - state.turn + 1 }) }));
    if (siege) pills.push(el("span", { class: "rw-pill rw-pill-warn", text: t("rw_node_besieged", { faction: factionName(siege.faction), n: Core.siegeTurns(state, ui.selected) }) }));

    var notes = terrainNotes(nodeDef);
    var box = el("div", { class: "rw-panel" }, [
      el("h3", { class: "rw-node-title", style: "--rw-fc:" + ownerDef.color, text: L(nodeDef.name) }),
      el("div", { class: "rw-castle-box" }, [castleStage(nodeDef, node), el("div", { class: "rw-castle-hint", text: t("rw_castle_drag_hint") })]),
      el("div", { class: "rw-castle-info" }, pills),
      notes.length ? el("div", { class: "rw-terrain-notes rw-small" }, notes.map(function (n) { return el("span", { text: n }); })) : null,
      el("h4", { text: t("rw_node_troops_title") }),
      isMine ? troopGrid(node.troops, Core.getNodeMaxTroops(node)) : intelBlock(nodeDef, node),
    ]);

    if (isMine) {
      box.appendChild(domesticActions(nodeDef, node));
      box.appendChild(transferActions(nodeDef));
      box.appendChild(militaryFromNode(nodeDef));
    } else {
      box.appendChild(militaryIntoNode(nodeDef, node));
    }
    return box;
  }

  function noAp() {
    return state.actionPoints <= 0 || !!state.gameOver;
  }

  function domesticActions(nodeDef, node) {
    var faction = state.factions[state.playerFaction];
    var besieged = Core.isBesieged(state, nodeDef.id);
    var wrap = el("div", { class: "rw-action-block" }, [el("h4", { text: t("rw_tab_domestic") })]);
    var gain = Core.developGain(state, state.playerFaction);

    wrap.appendChild(
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-secondary",
          text: t("rw_action_develop"),
          disabled: noAp() || faction.gold < Core.constants.DEVELOP_COST_GOLD,
          onclick: function () {
            Core.playerDevelop(state, nodeDef.id);
            after();
          },
        }),
        el("span", { class: "rw-muted rw-small", text: t("rw_action_develop_desc", { gold: Core.constants.DEVELOP_COST_GOLD, gain: gain }) }),
      ])
    );

    var maxDef = Core.maxDefenseLevel(nodeDef.id);
    wrap.appendChild(
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-secondary",
          text: t("rw_action_fortify"),
          disabled: noAp() || faction.gold < Core.constants.FORTIFY_COST_GOLD || node.defenseLevel >= maxDef,
          onclick: function () {
            Core.playerFortify(state, nodeDef.id);
            after();
          },
        }),
        el("span", { class: "rw-muted rw-small", text: node.defenseLevel >= maxDef ? t("rw_action_fortify_maxed") : t("rw_action_fortify_desc", { gold: Core.constants.FORTIFY_COST_GOLD }) }),
      ])
    );

    var typeSelect = el(
      "select",
      { id: "rw-recruit-type" },
      D.TROOP_ORDER.map(function (tid) {
        return el("option", { value: tid, text: troopIcon(tid) + " " + troopName(tid) + "（" + Core.recruitUnitGold(state.playerFaction, tid) + "）" });
      })
    );
    var room = Core.getNodeMaxTroops(node) - Core.totalTroops(node.troops);
    var amountInput = el("input", { id: "rw-recruit-amount", type: "number", min: "0", max: String(Math.max(0, Math.min(room, Core.constants.RECRUIT_MAX_PER_ACTION))), value: String(Math.max(0, Math.min(10, room))) });
    wrap.appendChild(
      el("div", { class: "rw-action-row rw-recruit-row" }, [
        el("span", { text: t("rw_action_recruit_type") + ":" }),
        typeSelect,
        el("span", { text: t("rw_action_recruit_amount") + ":" }),
        amountInput,
        el("button", {
          class: "rw-secondary",
          text: t("rw_action_recruit_confirm"),
          disabled: noAp() || room <= 0 || besieged,
          onclick: function () {
            Core.playerRecruit(state, nodeDef.id, typeSelect.value, parseInt(amountInput.value, 10) || 0);
            after();
          },
        }),
      ])
    );
    wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_action_recruit_cost", { gold: Core.constants.RECRUIT_GOLD_PER_UNIT, food: Core.constants.RECRUIT_FOOD_PER_UNIT, max: Core.constants.RECRUIT_MAX_PER_ACTION }) }));
    wrap.appendChild(el("div", { class: besieged ? "rw-bad rw-small" : "rw-muted rw-small", text: besieged ? t("rw_action_recruit_besieged") : t("rw_action_recruit_room", { n: Math.max(0, room) }) }));
    return wrap;
  }

  function transferActions(nodeDef) {
    var wrap = el("div", { class: "rw-action-block" }, [el("h4", { text: t("rw_transfer_title") })]);
    var dests = D.neighborsOf(nodeDef.id).filter(function (nid) {
      return state.nodes[nid].owner === state.playerFaction;
    });
    if (!dests.length) {
      wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_transfer_none") }));
      return wrap;
    }
    var row = el("div", { class: "rw-action-row" });
    dests.forEach(function (nid) {
      row.appendChild(
        el("button", {
          class: "rw-secondary",
          text: "→ " + nodeName(nid),
          disabled: noAp() || Core.isBesieged(state, nid) || Core.getNodeMaxTroops(state.nodes[nid]) - Core.totalTroops(state.nodes[nid].troops) <= 0,
          title: t("rw_transfer_room", { n: Math.max(0, Core.getNodeMaxTroops(state.nodes[nid]) - Core.totalTroops(state.nodes[nid].troops)) }),
          onclick: function () {
            ui.modal = { type: "transfer", from: nodeDef.id, to: nid };
            render();
          },
        })
      );
    });
    wrap.appendChild(row);
    wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_transfer_desc") }));
    return wrap;
  }

  function militaryButtons(sourceId, targetId) {
    var tgt = state.nodes[targetId];
    var siege = state.sieges[targetId];
    var row = [
      el("button", {
        class: "rw-secondary rw-btn-attack",
        text: "⚔ " + t("rw_invade_button"),
        disabled: noAp(),
        onclick: function () {
          ui.modal = { type: "invade", sourceNodeId: sourceId, targetNodeId: targetId };
          render();
        },
      }),
    ];
    if (siege && siege.faction === state.playerFaction) {
      row.push(
        el("button", {
          class: "rw-link",
          text: t("rw_siege_lift"),
          onclick: function () {
            Core.playerLiftSiege(state, targetId);
            after();
          },
        })
      );
    } else if (!siege) {
      row.push(
        el("button", {
          class: "rw-secondary",
          text: "🏯 " + t("rw_siege_button"),
          title: t("rw_siege_desc"),
          disabled: noAp() || !Core.canSiege(state, state.playerFaction, sourceId, targetId),
          onclick: function () {
            Core.playerSiege(state, sourceId, targetId);
            after();
          },
        })
      );
    }
    return row;
  }

  function scoutButton(targetId) {
    var intel = Core.nodeIntel(state, targetId);
    return el("button", {
      class: "rw-secondary",
      text: "🥷 " + t("rw_scout_button"),
      title: t("rw_scout_desc", { gold: Core.constants.SCOUT_COST_GOLD, p: pct(Core.scoutChance(state, state.playerFaction)) }),
      disabled: noAp() || intel.full || state.factions[state.playerFaction].gold < Core.constants.SCOUT_COST_GOLD,
      onclick: function () {
        var ok = Core.playerScout(state, targetId);
        ui.flash = ok ? t("rw_scout_success_flash", { node: nodeName(targetId) }) : t("rw_scout_fail_flash", { node: nodeName(targetId) });
        after();
      },
    });
  }

  function militaryFromNode(nodeDef) {
    var wrap = el("div", { class: "rw-action-block" }, [el("h4", { text: t("rw_tab_invade") })]);
    var neighbors = D.neighborsOf(nodeDef.id).filter(function (nid) {
      return state.nodes[nid].owner !== state.playerFaction;
    });
    if (!neighbors.length) {
      wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_invade_no_target") }));
      return wrap;
    }
    wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_invade_pick_target") }));
    neighbors.forEach(function (nid) {
      var tNode = state.nodes[nid];
      var pact = Core.pactOf(state, state.playerFaction, tNode.owner);
      var row = el("div", { class: "rw-action-row" }, [
        el("span", { class: "rw-faction-dot rw-dot-inline", style: "background:" + factionColor(tNode.owner) }),
        el("span", { text: nodeName(nid) + "（" + factionName(tNode.owner) + "）" }),
      ]);
      if (pact) row.appendChild(el("span", { class: "rw-muted rw-small", text: t("rw_invade_pact_" + pact.type) }));
      else {
        row.appendChild(scoutButton(nid));
        militaryButtons(nodeDef.id, nid).forEach(function (b) {
          row.appendChild(b);
        });
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  function militaryIntoNode(nodeDef, node) {
    var wrap = el("div", { class: "rw-action-block" }, [el("h4", { text: t("rw_tab_invade") })]);
    var pact = Core.pactOf(state, state.playerFaction, node.owner);
    if (pact) {
      wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_invade_pact_" + pact.type) }));
      return wrap;
    }
    var sources = D.neighborsOf(nodeDef.id).filter(function (nid) {
      return state.nodes[nid].owner === state.playerFaction;
    });
    if (!sources.length) {
      wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_invade_no_target") }));
      return wrap;
    }
    wrap.appendChild(el("div", { class: "rw-action-row" }, [scoutButton(nodeDef.id), el("span", { class: "rw-muted rw-small", text: t("rw_scout_desc", { gold: Core.constants.SCOUT_COST_GOLD, p: pct(Core.scoutChance(state, state.playerFaction)) }) })]));
    sources.forEach(function (sid) {
      var row = el("div", { class: "rw-action-row" }, [el("span", { text: nodeName(sid) + " → " + L(nodeDef.name) })]);
      militaryButtons(sid, nodeDef.id).forEach(function (b) {
        row.appendChild(b);
      });
      wrap.appendChild(row);
    });
    return wrap;
  }

  // ---------------- 武將 ----------------

  function statBar(label, v) {
    return el("div", { class: "rw-stat" }, [
      el("span", { class: "rw-stat-label", text: label }),
      el("span", { class: "rw-stat-bar" }, [el("span", { class: "rw-stat-fill", style: "width:" + v * 10 + "%" })]),
      el("b", { text: v }),
    ]);
  }

  function generalCard(g, extra) {
    var gs = Core.generalState(state, g.id);
    var busy = gs && gs.committedTurn === state.turn;
    return el("div", { class: "rw-general-card" }, [
      el("div", { class: "rw-general-head" }, [
        el("b", { text: L(g.name) }),
        el("span", { class: "rw-small rw-muted", text: t("rw_general_aptitude", { type: troopIcon(g.aptitude) + " " + troopName(g.aptitude) }) }),
        busy ? el("span", { class: "rw-pill rw-pill-warn", text: t("rw_general_busy") }) : null,
      ]),
      statBar(t("rw_stat_leadership"), g.stats.leadership),
      statBar(t("rw_stat_valor"), g.stats.valor),
      statBar(t("rw_stat_strategy"), g.stats.strategy),
      statBar(t("rw_stat_politics"), g.stats.politics),
      el("div", { class: "rw-small rw-muted", text: t("rw_general_command", { n: Core.commandCap(g.id) }) }),
      extra || null,
    ]);
  }

  function generalsPanel() {
    var me = state.playerFaction;
    var gens = Core.factionGenerals(state, me);
    var fDef = D.FACTIONS[me];
    var wrap = el("div", { class: "rw-panel" }, [
      el("h3", { text: t("rw_generals_title") }),
      el("div", { class: "rw-trait-box" }, [el("b", { text: "★ " + L(fDef.trait.name) }), el("span", { class: "rw-small", text: " " + L(fDef.trait.desc) })]),
      el("div", { class: "rw-small rw-muted rw-generals-effects" }, [
        el("div", { text: t("rw_effect_develop", { n: Core.developGain(state, me) }) }),
        el("div", { text: t("rw_effect_scout", { p: pct(Core.scoutChance(state, me)) }) }),
        el("div", { text: t("rw_effect_command", { n: Core.constants.COMMAND_NO_GENERAL }) }),
      ]),
    ]);
    if (!gens.length) wrap.appendChild(el("p", { class: "rw-muted", text: t("rw_generals_none") }));
    var grid = el("div", { class: "rw-general-grid" });
    gens.forEach(function (g) {
      grid.appendChild(generalCard(g));
    });
    wrap.appendChild(grid);
    wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_generals_help") }));
    return wrap;
  }

  // ---------------- 外交 ----------------

  function relationLabel(v) {
    if (v >= 40) return t("rw_diplomacy_friendly");
    if (v <= -40) return t("rw_diplomacy_hostile");
    return t("rw_diplomacy_neutral");
  }

  function diplomacyPanel() {
    var me = state.playerFaction;
    var wrap = el("div", { class: "rw-panel" }, [el("h3", { text: t("rw_diplomacy_title") }), el("div", { class: "rw-muted rw-small", text: t("rw_diplomacy_help", { a: Core.constants.ALLIANCE_TURNS, b: Core.constants.TRUCE_TURNS }) })]);
    D.FACTION_ORDER.filter(function (fid) {
      return fid !== me && state.factions[fid].alive;
    }).forEach(function (fid) {
      var f = D.FACTIONS[fid];
      var relation = Core.getRelation(state, me, fid);
      var pact = Core.pactOf(state, me, fid);
      var allied = pact && pact.type === "alliance";
      var status = pact ? t("rw_pact_" + pact.type, { n: pact.until - state.turn + 1 }) : relationLabel(relation);
      var row = el("div", { class: "rw-diplo-row" }, [
        el("span", { class: "rw-faction-dot rw-dot-inline", style: "background:" + f.color }),
        el("b", { text: L(f.name) }),
        el("span", { class: "rw-relation-bar" }, [el("span", { class: "rw-relation-fill", style: "width:" + Math.round(((relation + 100) / 200) * 100) + "%" })]),
        el("span", { class: "rw-muted rw-small", text: t("rw_diplomacy_relation", { n: relation }) + "・" + status }),
        el("span", { class: "rw-small rw-trait-chip", title: L(f.trait.desc), text: "★ " + L(f.trait.name) }),
      ]);
      var actions = el("div", { class: "rw-action-row" });
      actions.appendChild(
        el("button", {
          class: "rw-secondary",
          text: (allied ? t("rw_diplomacy_renew") : t("rw_diplomacy_alliance")) + "（" + pct(Core.schemeChance(state, me, fid, allied ? 0.5 : 0.3)) + "）",
          disabled: noAp(),
          onclick: function () {
            Core.playerProposeAlliance(state, fid);
            after();
          },
        })
      );
      if (!pact) {
        actions.appendChild(
          el("button", {
            class: "rw-secondary",
            text: t("rw_diplomacy_ceasefire") + "（" + pct(Core.schemeChance(state, me, fid, 0.45)) + "）",
            disabled: noAp(),
            onclick: function () {
              Core.playerProposeCeasefire(state, fid);
              after();
            },
          })
        );
      }
      if (allied) {
        actions.appendChild(
          el("button", {
            class: "rw-secondary",
            text: t("rw_diplomacy_reinforce") + "（" + pct(Core.schemeChance(state, me, fid, 0.35)) + "）",
            title: t("rw_diplomacy_reinforce_desc"),
            disabled: noAp(),
            onclick: function () {
              Core.playerRequestReinforcement(state, fid);
              after();
            },
          })
        );
      }
      actions.appendChild(
        el("button", {
          class: "rw-secondary",
          text: t("rw_diplomacy_provoke"),
          disabled: noAp(),
          onclick: function () {
            ui.provokeFrom = ui.provokeFrom === fid ? null : fid;
            render();
          },
        })
      );
      if (pact) {
        actions.appendChild(
          el("button", {
            class: "rw-link rw-danger",
            text: t("rw_diplomacy_break"),
            disabled: noAp(),
            onclick: function () {
              if (!window.confirm(t("rw_diplomacy_break_confirm", { faction: L(f.name) }))) return;
              Core.playerBreakPact(state, fid);
              after();
            },
          })
        );
      }
      row.appendChild(actions);
      if (ui.provokeFrom === fid) {
        var pickWrap = el("div", { class: "rw-action-row rw-provoke-pick" }, [el("span", { class: "rw-small", text: t("rw_diplomacy_provoke_pick", { target: L(f.name) }) })]);
        D.FACTION_ORDER.filter(function (b) {
          return b !== me && b !== fid && state.factions[b].alive;
        }).forEach(function (b) {
          pickWrap.appendChild(
            el("button", {
              class: "rw-secondary",
              text: factionName(b),
              onclick: function () {
                Core.playerProvoke(state, fid, b);
                ui.provokeFrom = null;
                after();
              },
            })
          );
        });
        row.appendChild(pickWrap);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  // ---------------- 出陣／守城編成 ----------------

  function tacticSelect(id, current) {
    return el(
      "select",
      { id: id, class: "rw-tactic-select" },
      Core.TACTIC_ORDER.map(function (tid) {
        return el("option", { value: tid, text: tacticName(tid), selected: tid === current ? true : null });
      })
    );
  }

  function slotEditor(pool, defaultSlots, onChange) {
    var rows = el("div", { class: "rw-slot-grid" });
    var refs = [];
    for (var i = 0; i < 5; i++) {
      var dft = defaultSlots[i] || { type: "", amount: 0, tactic: "normal" };
      var typeSelect = el(
        "select",
        { id: "rw-slot-type-" + i },
        [el("option", { value: "", text: t("rw_battle_empty_slot") })].concat(
          D.TROOP_ORDER.map(function (tid) {
            return el("option", { value: tid, text: troopIcon(tid) + " " + troopName(tid) + "（" + t("rw_battle_available", { n: pool[tid] || 0 }) + "）", selected: tid === dft.type ? true : null });
          })
        )
      );
      var amountInput = el("input", { id: "rw-slot-amount-" + i, type: "number", min: "0", value: String(dft.amount || 0) });
      var tactic = tacticSelect("rw-slot-tactic-" + i, dft.tactic || "normal");
      [typeSelect, amountInput, tactic].forEach(function (c) {
        c.addEventListener("input", onChange);
        c.addEventListener("change", onChange);
      });
      rows.appendChild(el("div", { class: "rw-slot" }, [el("b", { text: t("rw_battle_slot", { n: i + 1 }) }), typeSelect, amountInput, tactic]));
      refs.push({ typeSelect: typeSelect, amountInput: amountInput, tactic: tactic });
    }
    return {
      el: rows,
      readSlots: function () {
        return refs.map(function (r) {
          return { type: r.typeSelect.value || null, amount: parseInt(r.amountInput.value, 10) || 0, tactic: r.tactic.value };
        });
      },
    };
  }

  function generalPicker(factionId, idPrefix, onChange) {
    var generals = Core.availableGenerals(state, factionId);
    var sel = el(
      "select",
      { id: idPrefix + "-general" },
      [el("option", { value: "", text: t("rw_battle_general_none") + "（" + t("rw_battle_cap", { n: Core.constants.COMMAND_NO_GENERAL }) + "）" })].concat(
        generals.map(function (g) {
          return el("option", { value: g.id, text: L(g.name) + "｜" + troopIcon(g.aptitude) + troopName(g.aptitude) + "｜" + t("rw_battle_cap", { n: Core.commandCap(g.id) }) });
        })
      )
    );
    if (onChange) sel.addEventListener("change", onChange);
    return sel;
  }

  function vsBanner(attackerFid, defenderFid) {
    return el("div", { class: "rw-vs", style: "--rw-atk:" + factionColor(attackerFid) + ";--rw-def:" + factionColor(defenderFid) }, [
      el("span", { class: "rw-vs-side rw-vs-atk", text: factionName(attackerFid) }),
      el("span", { class: "rw-vs-mark", text: "VS" }),
      el("span", { class: "rw-vs-side rw-vs-def", text: factionName(defenderFid) }),
    ]);
  }

  function estimateView(est) {
    var cls = est.chance === "certain" || est.chance === "high" ? "rw-good" : est.chance === "mid" ? "rw-warn" : "rw-bad";
    return el("div", { class: "rw-estimate" }, [
      el("div", { class: "rw-small rw-muted", text: est.basis === "intel" ? t("rw_estimate_basis_intel") : t("rw_estimate_basis_guess") }),
      el("div", { class: cls, text: t("rw_estimate_chance_" + est.chance) }),
      el("div", { class: "rw-small", text: t("rw_estimate_losses", { a: est.attackerLoss, d: est.defenderLoss, ar: est.attackerRemaining, dr: est.defenderRemaining }) }),
      est.retreated ? el("div", { class: "rw-small rw-warn", text: t("rw_estimate_retreat") }) : null,
      el("div", { class: "rw-small" + (est.committed >= est.cap ? " rw-warn" : " rw-muted"), text: t("rw_battle_committed", { n: est.committed, max: est.cap }) }),
    ]);
  }

  function renderInvadeModal(modal) {
    var srcNode = state.nodes[modal.sourceNodeId];
    var tgtDef = D.nodeById(modal.targetNodeId);
    var tgtNode = state.nodes[modal.targetNodeId];
    var intel = Core.nodeIntel(state, modal.targetNodeId);
    var defaultSlots = D.TROOP_ORDER.slice()
      .sort(function (a, b) {
        return (srcNode.troops[b] || 0) - (srcNode.troops[a] || 0);
      })
      .slice(0, 5)
      .map(function (tid) {
        return { type: tid, amount: Math.floor((srcNode.troops[tid] || 0) * 0.5), tactic: "normal" };
      });
    var estimateBox = el("div", {});
    var editor;
    var general;
    var retreatBox;
    function refresh() {
      var est = Core.estimateInvade(state, { sourceNodeId: modal.sourceNodeId, targetNodeId: modal.targetNodeId, slots: editor.readSlots(), generalId: general.value || null, retreat: retreatBox.checked });
      estimateBox.innerHTML = "";
      estimateBox.appendChild(estimateView(est));
    }
    editor = slotEditor(srcNode.troops, defaultSlots, refresh);
    general = generalPicker(state.playerFaction, "rw-battle", refresh);
    retreatBox = el("input", { type: "checkbox", id: "rw-battle-retreat" });
    retreatBox.addEventListener("change", refresh);

    var intelLine = intel.full
      ? el("div", { class: "rw-intel-ok rw-small" }, [el("div", { text: "👁 " + t("rw_intel_scouted") }), formationList(intel.formation), intel.generalId ? el("div", { class: "rw-muted", text: t("rw_intel_general", { name: generalName(intel.generalId) }) }) : null])
      : el("div", { class: "rw-intel-fog rw-small", text: t("rw_intel_approx", { n: intel.approxTotal }) + "・" + (intel.mainType ? t("rw_intel_main", { type: troopIcon(intel.mainType) + troopName(intel.mainType) }) : "") + "・" + t("rw_intel_need_scout") });
    var notes = terrainNotes(tgtDef);
    var siegeTurns = state.sieges[modal.targetNodeId] && state.sieges[modal.targetNodeId].faction === state.playerFaction ? Core.siegeTurns(state, modal.targetNodeId) : 0;
    if (siegeTurns >= 2) notes.push(t("rw_terrain_besieged"));

    var body = el("div", { class: "rw-modal" }, [
      vsBanner(state.playerFaction, tgtNode.owner),
      el("h3", { text: t("rw_battle_title", { attacker: factionName(state.playerFaction), defender: factionName(tgtNode.owner), node: L(tgtDef.name) }) }),
      intelLine,
      notes.length ? el("div", { class: "rw-terrain-notes rw-small" }, notes.map(function (n) { return el("span", { text: n }); })) : null,
      editor.el,
      el("div", { class: "rw-action-row" }, [el("span", { text: t("rw_battle_general") + ":" }), general]),
      el("label", { class: "rw-action-row rw-small" }, [retreatBox, el("span", { text: t("rw_battle_retreat_option") })]),
      el("div", { class: "rw-muted rw-small", text: t("rw_tactic_help") }),
      estimateBox,
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: t("rw_battle_confirm"),
          onclick: function () {
            var defLevel = tgtNode.defenseLevel;
            var report = Core.playerInvade(state, { sourceNodeId: modal.sourceNodeId, targetNodeId: modal.targetNodeId, slots: editor.readSlots(), generalId: general.value || null, retreat: retreatBox.checked });
            if (!report) return;
            ui.modal = { type: "result", kind: "invade", report: report, step: 0, defenseLevel: defLevel };
            persist();
            render();
          },
        }),
        el("button", {
          class: "rw-link",
          text: t("rw_battle_cancel"),
          onclick: function () {
            ui.modal = null;
            render();
          },
        }),
      ]),
    ]);
    refresh();
    return body;
  }

  function renderDefenseModal(modal) {
    var info = Core.pendingAttackInfo(state);
    if (!info) {
      ui.modal = null;
      return el("div", { class: "rw-modal" });
    }
    var tgtDef = D.nodeById(info.targetNodeId);
    var tgtNode = state.nodes[info.targetNodeId];
    var editor = slotEditor(tgtNode.troops, modal.autoSlots || autoDefenseSlots(tgtNode), function () {});
    var general = generalPicker(state.playerFaction, "rw-defense");

    return el("div", { class: "rw-modal" }, [
      vsBanner(info.attackerFaction, state.playerFaction),
      el("h3", { text: t("rw_battle_defense_title", { attacker: factionName(info.attackerFaction), node: L(tgtDef.name) }) }),
      el("div", { class: "rw-enemy-info" }, [
        el("div", { text: t("rw_defense_from", { node: nodeName(info.sourceNodeId), n: info.approxTotal }) }),
        el("div", { text: t("rw_defense_types", { types: info.types.map(function (tid) { return troopIcon(tid) + troopName(tid); }).join("・") }) }),
        el("div", { text: info.generalId ? t("rw_defense_general", { name: generalName(info.generalId) }) : t("rw_defense_no_general") }),
      ]),
      el("p", { class: "rw-muted rw-small", text: t("rw_battle_defense_intro") }),
      editor.el,
      el("div", { class: "rw-action-row" }, [el("span", { text: t("rw_battle_general") + ":" }), general]),
      el("div", { class: "rw-muted rw-small", text: t("rw_tactic_help") }),
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: t("rw_battle_confirm"),
          onclick: function () {
            var defLevel = tgtNode.defenseLevel;
            var report = Core.resolvePlayerDefense(state, editor.readSlots(), general.value || null);
            if (!report) {
              ui.modal = null;
              handleAiStep(Core.continueAiPhase(state));
              return;
            }
            ui.modal = { type: "result", kind: "defense", report: report, step: 0, defenseLevel: defLevel };
            persist();
            render();
          },
        }),
      ]),
    ]);
  }

  function renderTransferModal(modal) {
    var from = state.nodes[modal.from];
    var to = state.nodes[modal.to];
    var room = Core.getNodeMaxTroops(to) - Core.totalTroops(to.troops);
    var inputs = {};
    var grid = el("div", { class: "rw-transfer-grid" });
    D.TROOP_ORDER.forEach(function (tid) {
      var input = el("input", { type: "number", min: "0", max: String(from.troops[tid]), value: "0", id: "rw-transfer-" + tid });
      inputs[tid] = input;
      grid.appendChild(el("label", { class: "rw-troop-chip" }, [el("span", { text: troopIcon(tid) + " " + troopName(tid) + "（" + from.troops[tid] + "）" }), input]));
    });
    return el("div", { class: "rw-modal" }, [
      el("h3", { text: t("rw_transfer_modal_title", { from: nodeName(modal.from), to: nodeName(modal.to) }) }),
      el("div", { class: "rw-muted rw-small", text: t("rw_transfer_room", { n: Math.max(0, room) }) }),
      grid,
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-secondary",
          text: t("rw_transfer_half"),
          onclick: function () {
            var budget = room;
            D.TROOP_ORDER.forEach(function (tid) {
              var n = Math.max(0, Math.min(Math.floor(from.troops[tid] / 2), budget));
              inputs[tid].value = String(n);
              budget -= n;
            });
          },
        }),
        el("button", {
          class: "rw-primary",
          text: t("rw_transfer_confirm"),
          onclick: function () {
            var troops = {};
            D.TROOP_ORDER.forEach(function (tid) {
              troops[tid] = parseInt(inputs[tid].value, 10) || 0;
            });
            var moved = Core.playerTransfer(state, modal.from, modal.to, troops);
            ui.modal = null;
            ui.flash = moved > 0 ? t("rw_transfer_done", { n: moved, to: nodeName(modal.to) }) : t("rw_transfer_nothing");
            after();
          },
        }),
        el("button", {
          class: "rw-link",
          text: t("rw_battle_cancel"),
          onclick: function () {
            ui.modal = null;
            render();
          },
        }),
      ]),
    ]);
  }

  // ---------------- 合戰結果 ----------------

  function clashCard(round, revealed, active) {
    var atkType = round.attackerType ? D.troopType(round.attackerType) : null;
    var defType = round.defenderType ? D.troopType(round.defenderType) : null;
    var defLabel = round.reserve ? t("rw_battle_reserve") : defType ? L(defType.name) : t("rw_battle_empty_slot");
    var defIcon = round.reserve ? "🏯" : defType ? defType.icon : "—";
    var classes = "rw-clash-card" + (active ? " rw-clash-active" : "") + (revealed ? "" : " rw-clash-pending");
    return el("div", { class: classes }, [
      el("div", { class: "rw-clash-unit rw-atk" }, [
        el("div", { class: "rw-clash-icon", text: revealed ? (atkType ? atkType.icon : "—") : "❓" }),
        revealed ? el("div", { class: "rw-small", text: atkType ? L(atkType.name) : t("rw_battle_empty_slot") }) : null,
        revealed && atkType ? el("div", { class: "rw-tactic-tag rw-tactic-" + round.attackerTactic, text: tacticName(round.attackerTactic) }) : null,
        revealed ? el("div", { class: "rw-small" }, [document.createTextNode(String(round.attackerAmount)), round.attackerLoss ? el("span", { class: "rw-clash-loss", text: " -" + round.attackerLoss }) : null]) : null,
      ]),
      el("div", { class: "rw-clash-spark", text: round.retreatAfter && revealed ? "🏳️" : "⚔️" }),
      el("div", { class: "rw-clash-unit rw-def" }, [
        el("div", { class: "rw-clash-icon", text: revealed ? defIcon : "❓" }),
        revealed ? el("div", { class: "rw-small", text: defLabel }) : null,
        revealed && defType ? el("div", { class: "rw-tactic-tag rw-tactic-" + round.defenderTactic, text: tacticName(round.defenderTactic) }) : null,
        revealed ? el("div", { class: "rw-small" }, [document.createTextNode(String(round.defenderAmount)), round.defenderLoss ? el("span", { class: "rw-clash-loss", text: " -" + round.defenderLoss }) : null]) : null,
      ]),
    ]);
  }

  function sumRounds(rounds, key) {
    return rounds.reduce(function (acc, r) {
      return acc + (r[key] || 0);
    }, 0);
  }

  function battleSceneFor(report, step) {
    var total = report.rounds.length;
    var phase = step === 0 ? "intro" : step <= total ? "round" : "final";
    var playerWon = (report.attackerFaction === state.playerFaction) === !!report.captured;
    var round = phase === "round" ? report.rounds[step - 1] : null;
    return Art.battleScene({
      phase: phase,
      round: round,
      rounds: report.rounds,
      captured: report.captured,
      retreated: report.retreated,
      playerWon: playerWon,
      attackerColor: factionColor(report.attackerFaction),
      defenderColor: factionColor(report.defenderFaction),
      attackerName: factionName(report.attackerFaction) + (report.attackerGeneralId ? "・" + generalName(report.attackerGeneralId) : ""),
      defenderName: factionName(report.defenderFaction) + (report.defenderGeneralId ? "・" + generalName(report.defenderGeneralId) : ""),
      nodeName: nodeName(report.targetNodeId),
      attackerTotal: phase === "final" ? report.attackerRemainingTotal : sumRounds(report.rounds, "attackerAmount"),
      defenderTotal: phase === "final" ? report.defenderNodeRemainingTotal : sumRounds(report.rounds, "defenderAmount"),
      typeName: troopName,
      typeIcon: troopIcon,
      tacticName: tacticName,
      labels: {
        advantage: t("rw_battle_advantage"),
        stampCaptured: t("rw_battle_stamp_captured"),
        stampRepelled: t("rw_battle_stamp_repelled"),
        stampRetreat: t("rw_battle_stamp_retreat"),
        deployed: t("rw_battle_deployed"),
        troops: t("rw_battle_troops"),
        reserve: t("rw_battle_reserve"),
        round: phase === "round" ? t("rw_battle_round_label", { n: step }) : "",
      },
    });
  }

  // 戰果明細（3D 與 2D 演出共用）：勝敗、掠奪、守方撤退、武將下場、關閉
  function resultDetails(modal) {
    var report = modal.report;
    var playerWon = (report.attackerFaction === state.playerFaction) === !!report.captured;
    var outcome = report.retreated
      ? t("rw_battle_result_retreated", { node: nodeName(report.targetNodeId) })
      : report.captured
        ? t("rw_battle_result_captured", { defender: factionName(report.defenderFaction), node: nodeName(report.targetNodeId) })
        : t("rw_battle_result_repelled", { node: nodeName(report.targetNodeId) });
    var box = el("div", { class: "rw-result-details" }, [
      el("p", { class: playerWon ? "rw-good" : "rw-bad", text: outcome }),
      el("p", { class: "rw-small", text: t("rw_battle_result_plunder", { gold: report.plunderGold }) }),
    ]);
    if (report.defenderRetreatNodeId) box.appendChild(el("p", { class: "rw-small", text: t("rw_battle_result_defender_retreat", { n: report.defenderRetreatAmount, node: nodeName(report.defenderRetreatNodeId) }) }));
    report.generalFates.forEach(function (gf) {
      box.appendChild(el("p", { class: "rw-small rw-warn", text: t(gf.fate === "dead" ? "rw_battle_general_dead" : "rw_battle_general_captured", { name: generalName(gf.generalId), faction: gf.captor ? factionName(gf.captor) : "" }) }));
    });
    box.appendChild(
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: t("rw_battle_result_close"),
          onclick: function () {
            if (modal.kind === "defense") {
              ui.modal = null;
              handleAiStep(Core.continueAiPhase(state));
            } else {
              ui.modal = state.gameOver ? { type: "gameover" } : state.pendingEvents.length ? { type: "event" } : null;
              after();
            }
          },
        }),
      ])
    );
    return box;
  }

  function clashRow(report, revealedCount, activeIdx) {
    var row = el("div", { class: "rw-clash-row" });
    report.rounds.forEach(function (r, idx) {
      row.appendChild(clashCard(r, idx < revealedCount, idx === activeIdx));
    });
    return row;
  }

  // 3D 合戰（使用者指定 2026-11-02）：5 路部隊同時開戰，演出結束才顯示 5 路戰果與明細；
  // 演出中重畫（例如切換語言）時，已看完的戰鬥直接顯示終局畫面
  function renderResultModal(modal) {
    var B3 = window.PriTestReiwaBattle3D;
    if (!B3 || modal.use2d || !B3.supported()) return renderResultModalSvg(modal);
    var report = modal.report;
    var tgtDef = D.nodeById(report.targetNodeId);
    var stage = el("div", { class: "rw-b3d rw-b3d-loading" }, [el("div", { class: "rw-b3d-loading-text", text: t("rw_b3d_loading") })]);
    var resultBox = el("div", { class: "rw-b3d-result" });
    var body = el("div", { class: "rw-modal rw-modal-battle rw-modal-b3d" }, [el("h3", { text: t("rw_battle_result_title") }), stage, resultBox]);
    function showResult() {
      if (resultBox.childNodes.length) return;
      resultBox.appendChild(clashRow(report, report.rounds.length, -1));
      resultBox.appendChild(resultDetails(modal));
    }
    if (modal.done) showResult();
    B3.load()
      .then(function () {
        if (!stage.isConnected) return;
        stage.classList.remove("rw-b3d-loading");
        B3.play(stage, {
          report: report,
          attackerColor: factionColor(report.attackerFaction),
          defenderColor: factionColor(report.defenderFaction),
          attackerName: factionName(report.attackerFaction) + (report.attackerGeneralId ? "・" + generalName(report.attackerGeneralId) : ""),
          defenderName: factionName(report.defenderFaction) + (report.defenderGeneralId ? "・" + generalName(report.defenderGeneralId) : "") + "（" + nodeName(report.targetNodeId) + "）",
          profile: tgtDef.profile,
          season: Core.seasonOf(state),
          defenseLevel: modal.defenseLevel !== undefined ? modal.defenseLevel : state.nodes[report.targetNodeId].defenseLevel,
          playerWon: (report.attackerFaction === state.playerFaction) === !!report.captured,
          typeIcon: troopIcon,
          typeName: troopName,
          startAtEnd: !!modal.done,
          labels: {
            troops: t("rw_battle_troops"),
            advantage: t("rw_battle_advantage"),
            reserve: t("rw_battle_reserve"),
            stampCaptured: t("rw_battle_stamp_captured"),
            stampRepelled: t("rw_battle_stamp_repelled"),
            stampRetreat: t("rw_battle_stamp_retreat"),
            phaseDeploy: t("rw_b3d_phase_deploy"),
            phaseVolley: t("rw_b3d_phase_volley"),
            phaseCharge: t("rw_b3d_phase_charge"),
            phaseMelee: t("rw_b3d_phase_melee"),
            skip: t("rw_b3d_skip"),
            replay: t("rw_b3d_replay"),
            drag: t("rw_b3d_drag"),
          },
          onDone: function () {
            modal.done = true;
            showResult();
          },
        });
      })
      .catch(function () {
        modal.use2d = true;
        ui.flash = t("rw_b3d_fallback");
        render();
      });
    return body;
  }

  // 2D 翻牌演出（不支援 WebGL 或 three.js 載入失敗時的備援）
  function renderResultModalSvg(modal) {
    var report = modal.report;
    var total = report.rounds.length;
    var step = modal.step || 0;
    var done = step > total;

    var row = el("div", { class: "rw-clash-row" });
    report.rounds.forEach(function (r, idx) {
      row.appendChild(clashCard(r, idx < step, idx === step - 1));
    });

    var body = el("div", { class: "rw-modal rw-modal-battle" }, [el("h3", { text: t("rw_battle_result_title") }), el("div", { class: "rw-bt-wrap" }, [battleSceneFor(report, step)]), row]);

    if (!done) {
      body.appendChild(
        el("div", { class: "rw-action-row" }, [
          el("button", {
            class: "rw-primary",
            text: step >= total ? t("rw_battle_show_result") : t("rw_battle_next_card"),
            onclick: function () {
              modal.step = step + 1;
              render();
            },
          }),
          el("button", {
            class: "rw-link",
            text: t("rw_battle_reveal_all"),
            onclick: function () {
              modal.step = total + 1;
              render();
            },
          }),
        ])
      );
      return body;
    }

    body.appendChild(resultDetails(modal));
    return body;
  }

  // ---------------- 回合摘要 ----------------

  function renderSummaryModal() {
    var rep = state.turnReport || { items: [], arrows: [] };
    var mini = Art.renderMap({
      state: state,
      selected: null,
      playerFaction: state.playerFaction,
      marks: mapMarks(),
      arrows: rep.arrows.map(function (a) {
        return { from: a.from, to: a.to, color: factionColor(a.faction), captured: a.captured };
      }),
      nodeName: nodeName,
      factionName: factionName,
      factionColor: factionColor,
      labels: mapLabels(),
    });
    var list = el(
      "div",
      { class: "rw-summary-list" },
      rep.items.length
        ? rep.items.map(function (entry, i) {
            return el("div", { class: "rw-log-item rw-summary-item", style: "animation-delay:" + (0.15 + i * 0.06) + "s" }, [document.createTextNode(logText(entry))]);
          })
        : [el("div", { class: "rw-muted", text: t("rw_summary_quiet") })]
    );
    return el("div", { class: "rw-modal rw-modal-summary" }, [
      el("h3", { text: t("rw_summary_title", { year: state.startYear + Math.floor((state.startSeason + rep.turn - 1) / 4), season: t("rw_season_" + ((state.startSeason + rep.turn - 1) % 4)) }) }),
      el("div", { class: "rw-summary-body" }, [el("div", { class: "rw-map-frame-box rw-summary-map" }, [mini]), list]),
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: state.pendingEvents.length ? t("rw_summary_next_events", { n: state.pendingEvents.length }) : t("rw_summary_close"),
          onclick: function () {
            nextEventModal();
            after();
          },
        }),
      ]),
    ]);
  }

  // ---------------- 待決事件 ----------------

  function renderEventModal() {
    var ev = state.pendingEvents[0];
    if (!ev) {
      ui.modal = null;
      return el("div", { class: "rw-modal" });
    }
    function choose(choice) {
      var res = Core.resolveEvent(state, ev.id, choice);
      if (res && res.ok === false) ui.flash = t("rw_event_failed_" + ev.type);
      ui.modal = state.gameOver ? { type: "gameover" } : null;
      if (!ui.modal) nextEventModal();
      after();
    }
    function btn(label, choice, primary) {
      return el("button", { class: primary ? "rw-primary" : "rw-secondary", text: label, onclick: function () { choose(choice); } });
    }
    var title;
    var desc;
    var buttons;
    var extra = null;
    if (ev.type === "allianceOffer" || ev.type === "truceOffer") {
      title = t("rw_event_" + ev.type + "_title", { faction: factionName(ev.from) });
      desc = t("rw_event_" + ev.type + "_desc", { faction: factionName(ev.from), n: ev.type === "allianceOffer" ? Core.constants.ALLIANCE_TURNS : Core.constants.TRUCE_TURNS });
      buttons = [btn(t("rw_event_accept"), "accept", true), btn(t("rw_event_decline"), "decline")];
    } else if (ev.type === "captive") {
      var g = D.generalById(ev.generalId);
      title = t("rw_event_captive_title", { name: L(g.name) });
      desc = t("rw_event_captive_desc", { name: L(g.name), faction: ev.origin ? factionName(ev.origin) : "—" });
      extra = generalCard(g);
      buttons = [btn(t("rw_event_captive_recruit"), "recruit", true), btn(t("rw_event_captive_release"), "release"), btn(t("rw_event_captive_execute"), "execute")];
    } else if (ev.type === "ronin") {
      var rg = D.generalById(ev.generalId);
      title = t("rw_event_ronin_title", { name: L(rg.name) });
      desc = t("rw_event_ronin_desc", { name: L(rg.name), gold: ev.cost });
      extra = generalCard(rg);
      buttons = [btn(t("rw_event_ronin_hire", { gold: ev.cost }), "accept", true), btn(t("rw_event_decline"), "decline")];
    } else if (ev.type === "merchant") {
      title = t("rw_event_merchant_title");
      desc = t("rw_event_merchant_desc", { node: nodeName(ev.nodeId), n: ev.amount, gold: ev.cost });
      buttons = [btn(t("rw_event_merchant_buy", { gold: ev.cost }), "accept", true), btn(t("rw_event_decline"), "decline")];
    } else {
      title = ev.type;
      desc = "";
      buttons = [btn(t("rw_event_decline"), "decline")];
    }
    return el("div", { class: "rw-modal rw-modal-event" }, [
      el("div", { class: "rw-event-seal", text: "報" }),
      el("h3", { text: title }),
      el("p", { text: desc }),
      extra,
      el("div", { class: "rw-muted rw-small", text: t("rw_event_remaining", { n: state.pendingEvents.length }) }),
      el("div", { class: "rw-action-row" }, buttons),
    ]);
  }

  function renderGameOverModal() {
    var won = state.gameOver.result === "victory";
    var key = won ? (state.gameOver.reason === "timeup" ? "rw_victory_desc_timed" : "rw_victory_desc") : state.gameOver.reason === "timeup" ? "rw_defeat_desc_timed" : "rw_defeat_desc";
    return el("div", { class: "rw-modal" }, [
      el("h3", { text: won ? t("rw_victory_title") : t("rw_defeat_title") }),
      el("p", { text: t(key, { faction: factionName(state.playerFaction), turn: state.turn }) }),
      el("button", {
        class: "rw-primary",
        text: t("rw_gameover_restart"),
        onclick: function () {
          Core.clearSave();
          state = null;
          ui = freshUi();
          render();
        },
      }),
    ]);
  }

  // ---------------- 事件紀錄／相剋表 ----------------

  function logPanel() {
    var items = state.log
      .slice(-30)
      .reverse()
      .map(function (entry) {
        return el("div", { class: "rw-log-item" }, [el("span", { class: "rw-muted rw-small", text: "#" + entry.turn + " " }), document.createTextNode(logText(entry))]);
      });
    return el("div", { class: "rw-panel rw-log" }, [el("h3", { text: t("rw_log_title") })].concat(items.length ? items : [el("div", { class: "rw-muted", text: t("rw_log_empty") })]));
  }

  function matchupPanel() {
    var details = el("details", { class: "rw-panel" }, [el("summary", { text: t("rw_matchup_title") })]);
    var table = el("div", { class: "rw-matchup-table" });
    D.TROOP_ORDER.forEach(function (tid) {
      var tt = D.troopType(tid);
      var beats = tt.beats.map(function (b) {
        return troopIcon(b) + troopName(b);
      });
      var beatenBy = D.countersOf(tid).map(function (b) {
        return troopIcon(b) + troopName(b);
      });
      table.appendChild(
        el("div", { class: "rw-matchup-row" }, [
          el("b", { text: tt.icon + " " + L(tt.name) }),
          el("span", { class: "rw-good", text: t("rw_matchup_beats_list", { list: beats.join("、") }) }),
          el("span", { class: "rw-bad", text: t("rw_matchup_beaten_list", { list: beatenBy.join("、") }) }),
          el("span", { class: "rw-muted rw-small", text: L(tt.note) }),
        ])
      );
    });
    details.appendChild(table);
    details.appendChild(el("div", { class: "rw-small rw-muted rw-rules-hint", text: t("rw_rules_hint") }));
    return details;
  }

  // ---------------- 主渲染 ----------------

  function renderGame() {
    if (state.gameOver && !ui.modal) ui.modal = { type: "gameover" };
    if (!ui.modal && state._pendingAiAttack) ui.modal = { type: "defense", autoSlots: autoDefenseSlots(state.nodes[state._pendingAiAttack.targetNodeId]) };
    if (!ui.modal && state.pendingEvents.length) ui.modal = { type: "event" };
    var panel = ui.tab === "diplomacy" ? diplomacyPanel() : ui.tab === "generals" ? generalsPanel() : nodePanel();
    var sidebar = el("div", { class: "rw-sidebar" }, [tabsBar(), panel]);
    var mainRow = el("div", { class: "rw-main-row" }, [mapPanel(), sidebar]);
    var flash = ui.flash ? el("div", { class: "rw-flash", text: ui.flash }) : null;
    ui.flash = null;
    return el("div", { class: "rw-wrap" }, [topBar(), flash, mainRow, matchupPanel(), logPanel()]);
  }

  function renderModal() {
    var backdrop = el("div", { class: "rw-modal-backdrop" });
    var type = ui.modal.type;
    var content;
    if (type === "invade") content = renderInvadeModal(ui.modal);
    else if (type === "defense") content = renderDefenseModal(ui.modal);
    else if (type === "transfer") content = renderTransferModal(ui.modal);
    else if (type === "result") content = renderResultModal(ui.modal);
    else if (type === "summary") content = renderSummaryModal();
    else if (type === "event") content = renderEventModal();
    else if (type === "gameover") content = renderGameOverModal();
    backdrop.appendChild(content);
    return backdrop;
  }

  function render() {
    app.innerHTML = "";
    if (!state) {
      app.appendChild(renderSetup());
      return;
    }
    // 重新整理時若停在 AI 階段中途（沒有待守城的攻擊），把 AI 階段跑完
    if (state._ai && !state._pendingAiAttack && !ui.modal) {
      handleAiStep(Core.continueAiPhase(state));
      return;
    }
    app.appendChild(renderGame());
    if (ui.modal) app.appendChild(renderModal());
  }

  window.addEventListener("i18n:change", render);
  render();
})();
