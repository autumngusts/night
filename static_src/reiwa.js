// 令和之野望（reiwa）：畫面與互動。資料在 reiwa_data.js，遊戲規則與 state 在 reiwa_core.js。
// 單人對抗 AI 勢力，狀態存在 localStorage["pritest-reiwa-save"]（reiwa_core.js 的 SAVE_KEY）。
// 每次畫面變動整個重畫（el/svg 輔助函式與 i18n:change 重畫慣例沿用自 yellow.js／dejavu.js）；
// 伐掠／防守視窗開啟後，選單與數量輸入不會因為重畫而被打斷，只在按下確認／取消時才讀取 DOM 數值。
(function () {
  "use strict";

  var D = window.PriTestReiwaData;
  var Core = window.PriTestReiwaCore;
  var Art = window.PriTestReiwaArt;
  var app = document.getElementById("rw-app");
  if (!app || !D || !Core || !Art) return;

  var state = Core.load();

  var ui = {
    selected: null,
    tab: "node",
    modal: null,
    provokeFrom: null,
  };

  function t(key, params) {
    return window.I18N ? window.I18N.t(key, params) : key;
  }
  function lang() {
    return window.I18N ? window.I18N.getLang() : "zh";
  }
  function L(obj) {
    return D.localizedText(obj);
  }
  function factionName(fid) {
    var f = D.factionById(fid);
    return f ? L(f.name) : fid;
  }
  function nodeName(nid) {
    var n = D.nodeById(nid);
    return n ? L(n.name) : nid;
  }
  function troopName(tid) {
    var tt = D.troopType(tid);
    return tt ? L(tt.name) : tid;
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

  function svgEl(tag, attrs, children) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function persist() {
    if (state) Core.save(state);
  }

  function resolveLogParams(params) {
    var out = {};
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (typeof v === "string") {
        if (D.FACTIONS[v]) out[k] = factionName(v);
        else if (D.nodeById(v)) out[k] = nodeName(v);
        else out[k] = v;
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  // ---------------- 選擇勢力 ----------------

  function renderFactionSelect() {
    var grid = el("div", { class: "rw-faction-grid" });
    D.FACTION_ORDER.forEach(function (fid) {
      var f = D.FACTIONS[fid];
      var nodes = D.NODES.filter(function (n) {
        return n.faction === fid;
      });
      var kokudaka = nodes.reduce(function (sum, n) {
        return sum + D.KOKUDAKA_BY_PROFILE[n.profile];
      }, 0);
      var generalNames = D.generalsOfFaction(fid)
        .map(function (g) {
          return L(g.name);
        })
        .join("・");
      grid.appendChild(
        el("div", { class: "rw-faction-card", style: "--rw-fc: " + f.color }, [
          el("div", { class: "rw-faction-dot", style: "background:" + f.color }),
          el("h3", { text: L(f.name) }),
          el("div", { class: "rw-muted", text: t("rw_faction_nodes", { n: nodes.length }) }),
          el("div", { class: "rw-muted", text: t("rw_faction_kokudaka", { n: kokudaka }) }),
          el("div", { class: "rw-muted rw-small", text: t("rw_faction_generals", { names: generalNames }) }),
          el("button", {
            class: "rw-primary",
            text: t("rw_select_faction_start"),
            onclick: function () {
              state = Core.createInitialState(fid);
              ui.selected = null;
              ui.tab = "node";
              persist();
              render();
            },
          }),
        ])
      );
    });

    return el("div", { class: "rw-wrap" }, [
      el("h2", { text: t("rw_select_faction_title") }),
      el("p", { class: "rw-intro", text: t("rw_intro") }),
      grid,
    ]);
  }

  // ---------------- 頂部資訊列 ----------------

  function topBar() {
    var f = state.factions[state.playerFaction];
    var fDef = D.FACTIONS[state.playerFaction];
    var disabled = !!ui.modal || !!state.gameOver;
    return el("div", { class: "rw-topbar" }, [
      el("div", { class: "rw-faction-dot", style: "background:" + fDef.color }),
      el("b", { text: L(fDef.name) }),
      el("span", { class: "rw-pill", text: t("rw_turn_label", { n: state.turn }) }),
      el("span", { class: "rw-pill", text: t("rw_ap_label", { n: state.actionPoints, max: state.actionPointsMax }) }),
      el("span", { class: "rw-pill", text: t("rw_gold_label", { n: f.gold }) }),
      el("span", { class: "rw-pill", text: t("rw_food_label", { n: f.food }) }),
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
          ui.selected = null;
          ui.modal = null;
          render();
        },
      }),
    ]);
  }

  function handleAiStep(res) {
    if (res && res.type === "needPlayerDefense") {
      var defNode = state.nodes[res.pending.targetNodeId];
      ui.modal = {
        type: "defense",
        pending: res.pending,
        autoSlots: Core.aiAutoDefenseSlots(defNode),
      };
    }
    render();
  }

  // ---------------- 地圖 ----------------

  function factionColor(fid) {
    var f = D.FACTIONS[fid];
    return f ? f.color : "#888888";
  }

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

  // 選取城池時，標出可以伐掠的目標（選自己的城）或可以出兵的來源（選別人的城）
  function mapTargets() {
    var targets = {};
    if (!ui.selected) return targets;
    var selNode = state.nodes[ui.selected];
    var selMine = selNode.owner === state.playerFaction;
    D.neighborsOf(ui.selected).forEach(function (nid) {
      var n = state.nodes[nid];
      if (selMine) {
        if (n.owner !== state.playerFaction && !Core.isAllied(state, state.playerFaction, n.owner)) targets[nid] = true;
      } else if (n.owner === state.playerFaction && !Core.isAllied(state, state.playerFaction, selNode.owner)) {
        targets[nid] = true;
      }
    });
    return targets;
  }

  function mapLegend() {
    var row = el("div", { class: "rw-map-legend" });
    D.FACTION_ORDER.forEach(function (fid) {
      if (!state.factions[fid].alive) return;
      var count = D.NODES.filter(function (n) {
        return state.nodes[n.id].owner === fid;
      }).length;
      row.appendChild(
        el("span", { class: "rw-legend-item" + (fid === state.playerFaction ? " rw-legend-mine" : "") }, [
          el("span", { class: "rw-faction-dot", style: "background:" + factionColor(fid) }),
          el("span", { text: factionName(fid) }),
          el("b", { text: count }),
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

  // ---------------- 側欄：城池 / 外交 分頁 ----------------

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
    return el("div", { class: "rw-tabs" }, [tabBtn("node", t("rw_tab_domestic") + " / " + t("rw_tab_invade")), tabBtn("diplomacy", t("rw_tab_diplomacy"))]);
  }

  function troopGrid(troops, maxTroops) {
    var grid = el("div", { class: "rw-troop-grid" });
    D.TROOP_ORDER.forEach(function (tid) {
      var tt = D.troopType(tid);
      var n = troops[tid] || 0;
      grid.appendChild(
        el("div", { class: "rw-troop-chip" + (n === 0 ? " rw-muted" : "") }, [
          el("span", { class: "rw-troop-icon", text: tt.icon }),
          el("span", { text: L(tt.name) }),
          el("b", { text: n }),
        ])
      );
    });
    return el("div", {}, [grid, el("div", { class: "rw-muted rw-small", text: t("rw_node_troops_total", { n: Core.totalTroops(troops), max: maxTroops }) })]);
  }

  // 城池 3D 模型：天守層數依石高（每 25 一層，最多 5 層）、城郭依築城等級（木柵 → 白牆城門 → 角櫓石垣 → 護城河），
  // 地形依城池 profile（平原水田／山城土丘／沿海海灣／本城城下町），旗幟為城主勢力色
  function castleStage(nodeDef, node) {
    return Art.castleStage({
      tiers: Math.max(1, Math.min(5, Math.floor(node.kokudaka / 25))),
      defense: node.defenseLevel,
      profile: nodeDef.profile,
      color: factionColor(node.owner),
      seed: nodeDef.id,
    });
  }

  function nodePanel() {
    if (!ui.selected) {
      return el("div", { class: "rw-panel" }, [el("p", { class: "rw-muted", text: t("rw_node_pick_hint") })]);
    }
    var nodeDef = D.nodeById(ui.selected);
    var node = state.nodes[ui.selected];
    var ownerDef = D.FACTIONS[node.owner];
    var isMine = node.owner === state.playerFaction;
    var maxTroops = Core.getNodeMaxTroops(node);

    var box = el("div", { class: "rw-panel" }, [
      el("h3", { class: "rw-node-title", style: "--rw-fc:" + ownerDef.color, text: L(nodeDef.name) }),
      el("div", { class: "rw-castle-box" }, [castleStage(nodeDef, node), el("div", { class: "rw-castle-hint", text: t("rw_castle_drag_hint") })]),
      el("div", { class: "rw-castle-info" }, [
        el("span", { class: "rw-pill" }, [
          el("span", { class: "rw-faction-dot rw-dot-inline", style: "background:" + ownerDef.color }),
          el("b", { text: L(ownerDef.name) }),
        ]),
        el("span", { class: "rw-pill", text: t("rw_node_kokudaka", { n: node.kokudaka }) }),
        el("span", { class: "rw-pill", text: t("rw_node_defense", { n: node.defenseLevel, max: Core.constants.DEFENSE_LEVEL_MAX }) }),
      ]),
      el("h4", { text: t("rw_node_troops_title") }),
      troopGrid(node.troops, maxTroops),
    ]);

    if (isMine) {
      box.appendChild(domesticActions(nodeDef, node));
      box.appendChild(invadeFromNode(nodeDef, node));
    } else {
      box.appendChild(invadeIntoNode(nodeDef, node));
    }
    return box;
  }

  function actionNotice(ok, key) {
    return ok ? null : el("div", { class: "rw-bad rw-small", text: t(key) });
  }

  function domesticActions(nodeDef, node) {
    var faction = state.factions[state.playerFaction];
    var wrap = el("div", { class: "rw-action-block" }, [el("h4", { text: t("rw_tab_domestic") })]);

    wrap.appendChild(
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-secondary",
          text: t("rw_action_develop"),
          disabled: state.actionPoints <= 0 || faction.gold < Core.constants.DEVELOP_COST_GOLD,
          onclick: function () {
            Core.playerDevelop(state, nodeDef.id);
            persist();
            render();
          },
        }),
        el("span", { class: "rw-muted rw-small", text: t("rw_action_develop_desc", { gold: Core.constants.DEVELOP_COST_GOLD, gain: 6 }) }),
      ])
    );

    wrap.appendChild(
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-secondary",
          text: t("rw_action_fortify"),
          disabled: state.actionPoints <= 0 || faction.gold < Core.constants.FORTIFY_COST_GOLD || node.defenseLevel >= Core.constants.DEFENSE_LEVEL_MAX,
          onclick: function () {
            Core.playerFortify(state, nodeDef.id);
            persist();
            render();
          },
        }),
        el("span", {
          class: "rw-muted rw-small",
          text: node.defenseLevel >= Core.constants.DEFENSE_LEVEL_MAX ? t("rw_action_fortify_maxed") : t("rw_action_fortify_desc", { gold: Core.constants.FORTIFY_COST_GOLD }),
        }),
      ])
    );

    var typeSelect = el(
      "select",
      { id: "rw-recruit-type" },
      D.TROOP_ORDER.map(function (tid) {
        return el("option", { value: tid, text: D.troopType(tid).icon + " " + L(D.troopType(tid).name) });
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
          disabled: state.actionPoints <= 0 || room <= 0,
          onclick: function () {
            var tid = typeSelect.value;
            var amt = parseInt(amountInput.value, 10) || 0;
            Core.playerRecruit(state, nodeDef.id, tid, amt);
            persist();
            render();
          },
        }),
      ])
    );
    wrap.appendChild(
      el("div", { class: "rw-muted rw-small" }, [
        document.createTextNode(t("rw_action_recruit_cost", { gold: Core.constants.RECRUIT_GOLD_PER_UNIT, food: Core.constants.RECRUIT_FOOD_PER_UNIT, max: Core.constants.RECRUIT_MAX_PER_ACTION })),
      ])
    );
    wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_action_recruit_room", { n: room }) }));

    return wrap;
  }

  function invadeFromNode(nodeDef, node) {
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
      var tDef = D.nodeById(nid);
      var tNode = state.nodes[nid];
      var allied = Core.isAllied(state, state.playerFaction, tNode.owner);
      wrap.appendChild(
        el("div", { class: "rw-action-row" }, [
          el("span", { class: "rw-faction-dot rw-dot-inline", style: "background:" + D.FACTIONS[tNode.owner].color }),
          el("span", { text: L(tDef.name) + "（" + factionName(tNode.owner) + "）" }),
          allied
            ? el("span", { class: "rw-muted rw-small", text: t("rw_invade_allied") })
            : el("button", {
                class: "rw-secondary",
                text: t("rw_invade_button"),
                disabled: state.actionPoints <= 0,
                onclick: function () {
                  openInvadeModal(nodeDef.id, nid);
                },
              }),
        ])
      );
    });
    return wrap;
  }

  function invadeIntoNode(nodeDef, node) {
    var wrap = el("div", { class: "rw-action-block" }, [el("h4", { text: t("rw_tab_invade") })]);
    var sources = D.neighborsOf(nodeDef.id).filter(function (nid) {
      return state.nodes[nid].owner === state.playerFaction;
    });
    var allied = Core.isAllied(state, state.playerFaction, node.owner);
    if (allied) {
      wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_invade_allied") }));
      return wrap;
    }
    if (!sources.length) {
      wrap.appendChild(el("div", { class: "rw-muted rw-small", text: t("rw_invade_no_target") }));
      return wrap;
    }
    sources.forEach(function (sid) {
      var sDef = D.nodeById(sid);
      wrap.appendChild(
        el("div", { class: "rw-action-row" }, [
          el("span", { text: L(sDef.name) + " → " + L(nodeDef.name) }),
          el("button", {
            class: "rw-secondary",
            text: t("rw_invade_button"),
            disabled: state.actionPoints <= 0,
            onclick: function () {
              openInvadeModal(sid, nodeDef.id);
            },
          }),
        ])
      );
    });
    return wrap;
  }

  // ---------------- 外交 ----------------

  function relationLabel(v) {
    if (v >= 40) return t("rw_diplomacy_friendly");
    if (v <= -40) return t("rw_diplomacy_hostile");
    return t("rw_diplomacy_neutral");
  }

  function diplomacyPanel() {
    var wrap = el("div", { class: "rw-panel" }, [el("h3", { text: t("rw_diplomacy_title") })]);
    D.FACTION_ORDER.filter(function (fid) {
      return fid !== state.playerFaction && state.factions[fid].alive;
    }).forEach(function (fid) {
      var f = D.FACTIONS[fid];
      var relation = Core.getRelation(state, state.playerFaction, fid);
      var allied = Core.isAllied(state, state.playerFaction, fid);
      var pct = Math.round(((relation + 100) / 200) * 100);
      var row = el("div", { class: "rw-diplo-row" }, [
        el("span", { class: "rw-faction-dot rw-dot-inline", style: "background:" + f.color }),
        el("b", { text: L(f.name) }),
        el("span", { class: "rw-relation-bar" }, [el("span", { class: "rw-relation-fill", style: "width:" + pct + "%" })]),
        el("span", { class: "rw-muted rw-small", text: t("rw_diplomacy_relation", { n: relation }) + "・" + (allied ? t("rw_diplomacy_allied") : relationLabel(relation)) }),
      ]);
      var actions = el("div", { class: "rw-action-row" });
      actions.appendChild(
        el("button", {
          class: "rw-secondary",
          text: t("rw_diplomacy_alliance"),
          disabled: state.actionPoints <= 0 || allied,
          onclick: function () {
            Core.playerProposeAlliance(state, fid);
            persist();
            render();
          },
        })
      );
      actions.appendChild(
        el("button", {
          class: "rw-secondary",
          text: t("rw_diplomacy_ceasefire"),
          disabled: state.actionPoints <= 0,
          onclick: function () {
            Core.playerProposeCeasefire(state, fid);
            persist();
            render();
          },
        })
      );
      actions.appendChild(
        el("button", {
          class: "rw-secondary",
          text: t("rw_diplomacy_provoke"),
          disabled: state.actionPoints <= 0,
          onclick: function () {
            ui.provokeFrom = fid;
            render();
          },
        })
      );
      row.appendChild(actions);
      if (ui.provokeFrom === fid) {
        var pickWrap = el("div", { class: "rw-action-row rw-provoke-pick" }, [el("span", { class: "rw-small", text: t("rw_diplomacy_provoke_pick", { target: L(f.name) }) })]);
        D.FACTION_ORDER.filter(function (b) {
          return b !== state.playerFaction && b !== fid && state.factions[b].alive;
        }).forEach(function (b) {
          pickWrap.appendChild(
            el("button", {
              class: "rw-secondary",
              text: factionName(b),
              onclick: function () {
                Core.playerProvoke(state, fid, b);
                ui.provokeFrom = null;
                persist();
                render();
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

  // ---------------- 伐掠／防守 5 格指派 ----------------

  function slotEditor(pool, defaultSlots) {
    var rows = el("div", { class: "rw-slot-grid" });
    var refs = [];
    for (var i = 0; i < 5; i++) {
      var dft = defaultSlots[i] || { type: "", amount: 0 };
      var typeSelect = el(
        "select",
        { id: "rw-slot-type-" + i },
        [el("option", { value: "", text: t("rw_battle_empty_slot") })].concat(
          D.TROOP_ORDER.map(function (tid) {
            return el("option", { value: tid, text: D.troopType(tid).icon + " " + L(D.troopType(tid).name) + "（" + (pool[tid] || 0) + "）", selected: tid === dft.type ? true : null });
          })
        )
      );
      var amountInput = el("input", { id: "rw-slot-amount-" + i, type: "number", min: "0", value: String(dft.amount || 0) });
      rows.appendChild(
        el("div", { class: "rw-slot" }, [
          el("b", { text: t("rw_battle_slot", { n: i + 1 }) }),
          typeSelect,
          amountInput,
        ])
      );
      refs.push({ typeSelect: typeSelect, amountInput: amountInput });
    }
    return {
      el: rows,
      readSlots: function () {
        return refs.map(function (r) {
          return { type: r.typeSelect.value || null, amount: parseInt(r.amountInput.value, 10) || 0 };
        });
      },
    };
  }

  function generalPicker(factionId, idPrefix) {
    var generals = Core.availableGenerals(state, factionId);
    return el(
      "select",
      { id: idPrefix + "-general" },
      [el("option", { value: "", text: t("rw_battle_general_none") })].concat(
        generals.map(function (g) {
          return el("option", { value: g.id, text: L(g.name) + "（" + troopName(g.aptitude) + "）" });
        })
      )
    );
  }

  // 出陣前的對陣旗幟：攻方在左、守方在右
  function vsBanner(attackerFid, defenderFid) {
    return el("div", { class: "rw-vs", style: "--rw-atk:" + factionColor(attackerFid) + ";--rw-def:" + factionColor(defenderFid) }, [
      el("span", { class: "rw-vs-side rw-vs-atk", text: factionName(attackerFid) }),
      el("span", { class: "rw-vs-mark", text: "VS" }),
      el("span", { class: "rw-vs-side rw-vs-def", text: factionName(defenderFid) }),
    ]);
  }

  function openInvadeModal(sourceId, targetId) {
    ui.modal = { type: "invade", sourceNodeId: sourceId, targetNodeId: targetId };
    render();
  }

  function renderInvadeModal(modal) {
    var srcNode = state.nodes[modal.sourceNodeId];
    var tgtDef = D.nodeById(modal.targetNodeId);
    var tgtNode = state.nodes[modal.targetNodeId];
    var defaultSlots = D.TROOP_ORDER.slice()
      .sort(function (a, b) {
        return (srcNode.troops[b] || 0) - (srcNode.troops[a] || 0);
      })
      .slice(0, 5)
      .map(function (tid) {
        return { type: tid, amount: Math.floor((srcNode.troops[tid] || 0) * 0.5) };
      });
    var editor = slotEditor(srcNode.troops, defaultSlots);
    var general = generalPicker(state.playerFaction, "rw-battle");

    var body = el("div", { class: "rw-modal" }, [
      vsBanner(state.playerFaction, tgtNode.owner),
      el("h3", { text: t("rw_battle_title", { attacker: factionName(state.playerFaction), defender: factionName(tgtNode.owner), node: L(tgtDef.name) }) }),
      editor.el,
      el("div", { class: "rw-action-row" }, [el("span", { text: t("rw_battle_general") + ":" }), general]),
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: t("rw_battle_confirm"),
          onclick: function () {
            var slots = editor.readSlots();
            var report = Core.playerInvade(state, { sourceNodeId: modal.sourceNodeId, targetNodeId: modal.targetNodeId, slots: slots, generalId: general.value || null });
            if (!report) return;
            ui.modal = { type: "result", kind: "invade", report: report, step: 0 };
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
    return body;
  }

  function renderDefenseModal(modal) {
    var pending = modal.pending;
    var tgtDef = D.nodeById(pending.targetNodeId);
    var tgtNode = state.nodes[pending.targetNodeId];
    var editor = slotEditor(tgtNode.troops, modal.autoSlots);
    var general = generalPicker(state.playerFaction, "rw-defense");

    return el("div", { class: "rw-modal" }, [
      vsBanner(pending.attackerFaction, state.playerFaction),
      el("h3", { text: t("rw_battle_defense_title", { attacker: factionName(pending.attackerFaction), node: L(tgtDef.name) }) }),
      el("p", { class: "rw-muted rw-small", text: t("rw_battle_defense_intro") }),
      editor.el,
      el("div", { class: "rw-action-row" }, [el("span", { text: t("rw_battle_general") + ":" }), general]),
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: t("rw_battle_confirm"),
          onclick: function () {
            var slots = editor.readSlots();
            var report = Core.resolvePlayerDefense(state, slots, general.value || null);
            ui.modal = { type: "result", kind: "defense", report: report, step: 0 };
            persist();
            render();
          },
        }),
      ]),
    ]);
  }

  // 兩邊兵種「模組」互相衝向中間：已翻開的牌顯示完整結果並播放衝撞動畫，未翻開的牌先蓋著
  function clashCard(round, revealed, active) {
    var atkType = round.attackerType ? D.troopType(round.attackerType) : null;
    var defType = round.defenderType ? D.troopType(round.defenderType) : null;
    var classes = "rw-clash-card" + (active ? " rw-clash-active" : "") + (revealed ? "" : " rw-clash-pending");
    return el("div", { class: classes }, [
      el("div", { class: "rw-clash-unit rw-atk" }, [
        el("div", { class: "rw-clash-icon", text: revealed ? (atkType ? atkType.icon : "—") : "❓" }),
        revealed ? el("div", { class: "rw-small", text: atkType ? L(atkType.name) : t("rw_battle_empty_slot") }) : null,
        revealed ? el("div", { class: "rw-small" }, [document.createTextNode(String(round.attackerAmount)), round.attackerLoss ? el("span", { class: "rw-clash-loss", text: " -" + round.attackerLoss }) : null]) : null,
      ]),
      el("div", { class: "rw-clash-spark", text: "⚔️" }),
      el("div", { class: "rw-clash-unit rw-def" }, [
        el("div", { class: "rw-clash-icon", text: revealed ? (defType ? defType.icon : "—") : "❓" }),
        revealed ? el("div", { class: "rw-small", text: defType ? L(defType.name) : t("rw_battle_empty_slot") }) : null,
        revealed ? el("div", { class: "rw-small" }, [document.createTextNode(String(round.defenderAmount)), round.defenderLoss ? el("span", { class: "rw-clash-loss", text: " -" + round.defenderLoss }) : null]) : null,
      ]),
    ]);
  }

  function sumRounds(rounds, key) {
    return rounds.reduce(function (acc, r) {
      return acc + (r[key] || 0);
    }, 0);
  }

  // 合戰場景：step 0 兩軍對陣 → step 1..N 逐張翻牌（兩軍衝鋒交鋒）→ step N+1 終局（攻陷／擊退）
  function battleSceneFor(report, step) {
    var total = report.rounds.length;
    var phase = step === 0 ? "intro" : step <= total ? "round" : "final";
    var playerWon = (report.attackerFaction === state.playerFaction) === !!report.captured;
    return Art.battleScene({
      phase: phase,
      round: phase === "round" ? report.rounds[step - 1] : null,
      rounds: report.rounds,
      captured: report.captured,
      playerWon: playerWon,
      attackerColor: factionColor(report.attackerFaction),
      defenderColor: factionColor(report.defenderFaction),
      attackerName: factionName(report.attackerFaction),
      defenderName: factionName(report.defenderFaction),
      nodeName: nodeName(report.targetNodeId),
      attackerTotal: phase === "final" ? report.attackerRemainingTotal : sumRounds(report.rounds, "attackerAmount"),
      defenderTotal: phase === "final" ? report.defenderNodeRemainingTotal : sumRounds(report.rounds, "defenderAmount"),
      typeName: troopName,
      typeIcon: function (tid) {
        var tt = D.troopType(tid);
        return tt ? tt.icon : "";
      },
      labels: {
        advantage: t("rw_battle_advantage"),
        stampCaptured: t("rw_battle_stamp_captured"),
        stampRepelled: t("rw_battle_stamp_repelled"),
        deployed: t("rw_battle_deployed"),
        troops: t("rw_battle_troops"),
        round: phase === "round" ? t("rw_battle_round_label", { n: step }) : "",
      },
    });
  }

  function renderResultModal(modal) {
    var report = modal.report;
    var total = report.rounds.length;
    var step = modal.step || 0;
    var done = step > total;

    var row = el("div", { class: "rw-clash-row" });
    report.rounds.forEach(function (r, idx) {
      row.appendChild(clashCard(r, idx < step, idx === step - 1));
    });

    var body = el("div", { class: "rw-modal rw-modal-battle" }, [
      el("h3", { text: t("rw_battle_result_title") }),
      el("div", { class: "rw-bt-wrap" }, [battleSceneFor(report, step)]),
      row,
    ]);

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

    body.appendChild(
      el("p", {
        class: report.captured ? "rw-good" : "rw-bad",
        text: report.captured
          ? t("rw_battle_result_captured", { defender: factionName(report.defenderFaction), node: nodeName(report.targetNodeId) })
          : t("rw_battle_result_repelled", { node: nodeName(report.targetNodeId) }),
      })
    );
    body.appendChild(el("p", { class: "rw-small", text: t("rw_battle_result_plunder", { gold: report.plunderGold }) }));
    body.appendChild(
      el("div", { class: "rw-action-row" }, [
        el("button", {
          class: "rw-primary",
          text: t("rw_battle_result_close"),
          onclick: function () {
            var wasDefense = modal.kind === "defense";
            ui.modal = null;
            persist();
            if (wasDefense) {
              var res = Core.continueAiPhase(state);
              handleAiStep(res);
            } else {
              render();
            }
          },
        }),
      ])
    );
    return body;
  }

  function renderGameOverModal() {
    var won = state.gameOver.result === "victory";
    return el("div", { class: "rw-modal" }, [
      el("h3", { text: won ? t("rw_victory_title") : t("rw_defeat_title") }),
      el("p", { text: won ? t("rw_victory_desc", { faction: factionName(state.playerFaction) }) : t("rw_defeat_desc", { faction: factionName(state.playerFaction) }) }),
      el("button", {
        class: "rw-primary",
        text: t("rw_gameover_restart"),
        onclick: function () {
          Core.clearSave();
          state = null;
          ui = { selected: null, tab: "node", modal: null, provokeFrom: null };
          render();
        },
      }),
    ]);
  }

  // ---------------- 事件紀錄 ----------------

  function logPanel() {
    var items = state.log
      .slice(-30)
      .reverse()
      .map(function (entry) {
        return el("div", { class: "rw-log-item" }, [el("span", { class: "rw-muted rw-small", text: "#" + entry.turn + " " }), document.createTextNode(t(entry.key, resolveLogParams(entry.params)))]);
      });
    return el("div", { class: "rw-panel rw-log" }, [el("h3", { text: t("rw_log_title") })].concat(items.length ? items : [el("div", { class: "rw-muted", text: t("rw_log_empty") })]));
  }

  function matchupPanel() {
    var details = el("details", { class: "rw-panel" }, [el("summary", { text: t("rw_matchup_title") })]);
    D.TROOP_ORDER.forEach(function (tid) {
      var tt = D.troopType(tid);
      var beats = D.troopType(tt.beats);
      details.appendChild(
        el("div", { class: "rw-small" }, [
          document.createTextNode(tt.icon + " " + t("rw_matchup_beats", { a: L(tt.name), b: L(beats.name) }) + " " + beats.icon),
        ])
      );
    });
    return details;
  }

  // ---------------- 主渲染 ----------------

  function renderGame() {
    if (state.gameOver && !ui.modal) ui.modal = { type: "gameover" };
    var sidebar = el("div", { class: "rw-sidebar" }, [tabsBar(), ui.tab === "diplomacy" ? diplomacyPanel() : nodePanel()]);
    var mainRow = el("div", { class: "rw-main-row" }, [mapPanel(), sidebar]);
    return el("div", { class: "rw-wrap" }, [topBar(), mainRow, matchupPanel(), logPanel()]);
  }

  function renderModal() {
    var backdrop = el("div", { class: "rw-modal-backdrop" });
    var content;
    if (ui.modal.type === "invade") content = renderInvadeModal(ui.modal);
    else if (ui.modal.type === "defense") content = renderDefenseModal(ui.modal);
    else if (ui.modal.type === "result") content = renderResultModal(ui.modal);
    else if (ui.modal.type === "gameover") content = renderGameOverModal();
    backdrop.appendChild(content);
    return backdrop;
  }

  function render() {
    app.innerHTML = "";
    if (!state) {
      app.appendChild(renderFactionSelect());
      return;
    }
    app.appendChild(renderGame());
    if (ui.modal) app.appendChild(renderModal());
  }

  window.addEventListener("i18n:change", render);
  render();
})();
