// 黃牌 Yellow Card：遊戲資料（英雄、卡牌、敵人、遭遇）。規則在 yellow_core.js，畫面在 yellow.js。
// 參考 Hellcard：英雄站在圓形戰場中心面向外，戰場依人數切成等分的扇形區，分內圈（近距離）與外圈（遠距離）。
// 敵人站在誰的扇形區就攻擊誰；英雄可以攻擊任何扇形區的敵人，只受內外圈射程限制。（使用者指定 2026-10-22）
//
// 英雄固定 8 位（開局選定後整局不換），各有起始牌組（8 張）與三條成長方向（path，每條 5 張獎勵卡）。
// 卡牌效果 fx 是結構化的 op 清單，說明文字由 yellow.js 依 op 自動產生（zh / ja / en），這裡只寫名稱的三語。
//   rng（射程）：near＝只能打內圈；far＝只能打外圈；any＝內外圈都可以
//   near / far：打到內圈或外圈的目標時「另外」套用的效果（近遠效果不同的卡），先於共通 fx 執行
//   tgt（目標）：enemy／ally（任一存活英雄含自己）／down（倒下的英雄）／self／none
//   範圍 op（dmgAll / stAll / pushAll…）用 r 指定內圈、外圈或全部
(function () {
  "use strict";

  function N(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // ---------------- 英雄 ----------------
  // passive：開戰時放進 h.pw 的能力（spiritStart 是開戰時的精靈數）
  var HEROES = [
    { id: "paladin", name: N("聖戰士", "聖騎士", "Paladin"), icon: "🛡️", hp: 80, color: "#d9a21b",
      desc: N("堅固的前線。替隊友擋傷害、以聖光治療，也能把護盾化為審判。", "堅牢な前衛。仲間を庇い、聖光で癒し、盾を裁きに変える。", "A sturdy frontliner who shields allies, heals with holy light and turns block into judgement."),
      passive: { p: "plate", n: 3 },
      paths: [{ id: "guard", name: N("守護", "守護", "Guardian") }, { id: "light", name: N("聖光", "聖光", "Radiance") }, { id: "judge", name: N("審判", "審判", "Judgement") }],
      start: ["pal_strike", "pal_strike", "pal_hook", "pal_defend", "pal_defend", "pal_defend", "pal_smite", "pal_taunt"] },
    { id: "berserker", name: N("狂戰士", "狂戦士", "Berserker"), icon: "🪓", hp: 90, color: "#c8402f",
      desc: N("以血換力。生命越低越危險，擅長近距離範圍攻擊與斬殺。", "血を力に変える。生命が減るほど危険で、近距離の範囲攻撃と処刑が得意。", "Trades blood for power: deadlier when hurt, great at close-range sweeps and executions."),
      passive: { p: "frenzy", n: 3 },
      paths: [{ id: "blood", name: N("怒血", "怒血", "Bloodrage") }, { id: "whirl", name: N("旋風", "旋風", "Whirlwind") }, { id: "exec", name: N("處決", "処刑", "Execution") }],
      start: ["ber_chop", "ber_chop", "ber_chop", "ber_axe", "ber_block", "ber_block", "ber_roar", "ber_charge"] },
    { id: "ranger", name: N("遊俠", "レンジャー", "Ranger"), icon: "🏹", hp: 70, color: "#3c9a5a",
      desc: N("外圈的獵人。遠距離狙擊、設陷阱、擊退靠近的敵人。", "外周の狩人。遠距離狙撃、罠、近づいた敵の押し返し。", "Hunter of the outer ring: long shots, traps, and kicking back anything that gets close."),
      passive: { p: "far", n: 1 },
      paths: [{ id: "snipe", name: N("狙擊", "狙撃", "Sniper") }, { id: "trap", name: N("陷阱", "罠", "Trapper") }, { id: "volley", name: N("連射", "連射", "Volley") }],
      start: ["ran_shot", "ran_shot", "ran_shot", "ran_dodge", "ran_dodge", "ran_dodge", "ran_kick", "ran_pierce"] },
    { id: "mage", name: N("法師", "魔術師", "Mage"), icon: "🔮", hp: 60, color: "#4a6fd0",
      desc: N("內外圈都打得到的法術。火焰燃燒、冰霜控場、奧術爆發。", "内外どちらにも届く魔法。炎の燃焼、氷の制圧、秘術の爆発。", "Spells that reach either ring: burning fire, controlling frost, explosive arcana."),
      passive: { p: "burnPlus", n: 1 },
      paths: [{ id: "fire", name: N("火焰", "火炎", "Fire") }, { id: "frost", name: N("冰霜", "氷霜", "Frost") }, { id: "arcane", name: N("奧術", "秘術", "Arcane") }],
      start: ["mag_bolt", "mag_bolt", "mag_bolt", "mag_barrier", "mag_barrier", "mag_barrier", "mag_fireball", "mag_frost"] },
    { id: "priest", name: N("祭司", "司祭", "Priest"), icon: "✨", hp: 70, color: "#3aa8b5",
      desc: N("隊伍的支柱。治療、替隊友加護盾與力量，也能降下神罰。", "隊の支柱。回復、仲間への防御と筋力付与、そして神罰。", "The party's anchor: heals, shields and empowers allies, and calls down divine wrath."),
      passive: { p: "healAll", n: 1 },
      paths: [{ id: "heal", name: N("治療", "治癒", "Healing") }, { id: "ward", name: N("庇護", "加護", "Warding") }, { id: "wrath", name: N("神罰", "神罰", "Wrath") }],
      start: ["pri_smite", "pri_smite", "pri_smite", "pri_bless", "pri_bless", "pri_bless", "pri_heal", "pri_holy"] },
    { id: "witch", name: N("女巫", "魔女", "Witch"), icon: "🧹", hp: 62, color: "#8a45b5",
      desc: N("慢慢折磨敵人。劇毒、削弱敵人的詛咒，以及以血換命的血祭。", "じわじわ蝕む。猛毒、弱体の呪い、血を代償にした血祭。", "Wears enemies down with poison, crippling hexes and blood magic."),
      passive: { p: "poisonPlus", n: 1 },
      paths: [{ id: "venom", name: N("劇毒", "猛毒", "Venom") }, { id: "hex", name: N("詛咒", "呪詛", "Hex") }, { id: "blood", name: N("血祭", "血祭", "Blood Rite") }],
      start: ["wit_curse", "wit_curse", "wit_curse", "wit_mist", "wit_mist", "wit_mist", "wit_poison", "wit_wither"] },
    { id: "summoner", name: N("召喚師", "召喚士", "Summoner"), icon: "🦉", hp: 64, color: "#a8683a",
      desc: N("帶著精靈作戰。精靈在回合結束時各自攻擊；可以增加數量、強化，或獻祭換取爆發。", "精霊と戦う。精霊はターン終了時にそれぞれ攻撃。数を増やす、強化する、生贄にして爆発させる。", "Fights alongside spirits that each strike at end of turn — grow the swarm, empower it, or sacrifice it."),
      passive: { p: "spiritStart", n: 2 },
      paths: [{ id: "swarm", name: N("群聚", "群れ", "Swarm") }, { id: "empower", name: N("強化", "強化", "Empower") }, { id: "sacrifice", name: N("獻祭", "生贄", "Sacrifice") }],
      start: ["sum_call", "sum_call", "sum_staff", "sum_staff", "sum_staff", "sum_charm", "sum_charm", "sum_burst"] },
    { id: "bard", name: N("吟遊詩人", "吟遊詩人", "Bard"), icon: "🎻", hp: 66, color: "#d4609a",
      desc: N("累積旋律，再用終曲一口氣轉成全隊的力量、治療或音爆。", "旋律を溜め、終曲で一気に仲間の筋力・回復・音撃へ変える。", "Builds Melody, then spends it all in a finale for party-wide strength, healing or a sonic blast."),
      passive: { p: "melTurn", n: 2 },
      paths: [{ id: "war", name: N("戰歌", "戦歌", "War Song") }, { id: "requiem", name: N("安魂", "鎮魂", "Requiem") }, { id: "discord", name: N("不協和", "不協和", "Discord") }],
      start: ["bar_rapier", "bar_rapier", "bar_rapier", "bar_step", "bar_step", "bar_prelude", "bar_prelude", "bar_finale"] }
  ];

  // ---------------- 卡牌 ----------------
  // rar：basic（起始）／common／uncommon／rare／token（敵人塞進來的）；path：起始卡為 null
  // type：atk／skl／pow（能力：打出後離開牌堆，效果持續整場戰鬥）
  function card(id, hero, path, rar, type, cost, tgt, rng, fx, name, extra) {
    var c = { id: id, cls: hero, path: path, rar: rar, type: type, cost: cost, tgt: tgt, rng: rng, fx: fx, name: name };
    Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
    return c;
  }
  function dmg(n, h) { return h ? { o: "dmg", n: n, h: h } : { o: "dmg", n: n }; }
  function st(s, n) { return { o: "st", s: s, n: n }; }
  function blk(n) { return { o: "blk", n: n }; }

  var CARDS = [
    // ===== 聖戰士 =====
    card("pal_strike", "paladin", null, "basic", "atk", 1, "enemy", "near", [dmg(7)], N("斬擊", "斬撃", "Strike")),
    card("pal_defend", "paladin", null, "basic", "skl", 1, "self", null, [blk(6)], N("防禦", "防御", "Defend")),
    card("pal_smite", "paladin", null, "basic", "atk", 1, "enemy", "any", [], N("聖光擊", "聖光撃", "Holy Strike"), { near: [dmg(8)], far: [dmg(5)] }),
    card("pal_hook", "paladin", null, "basic", "atk", 1, "enemy", "far", [{ o: "pull" }, dmg(4)], N("聖光鎖鏈", "聖光の鎖", "Chain of Light")),
    card("pal_taunt", "paladin", null, "basic", "skl", 1, "self", null, [blk(4), { o: "taunt" }], N("挑釁", "挑発", "Taunt")),
    card("pal_wall", "paladin", "guard", "common", "skl", 2, "self", null, [blk(12)], N("盾牆", "盾の壁", "Shield Wall")),
    card("pal_guard", "paladin", "guard", "common", "skl", 1, "ally", null, [{ o: "blkAlly", n: 8 }], N("守護", "かばう", "Guard")),
    card("pal_hold", "paladin", "guard", "uncommon", "skl", 2, "self", null, [blk(11), { o: "taunt" }], N("堅守", "堅守", "Hold the Line")),
    card("pal_bash", "paladin", "guard", "uncommon", "atk", 1, "enemy", "near", [{ o: "dmgBlock", n: 1 }], N("盾擊", "盾打ち", "Shield Bash")),
    card("pal_bastion", "paladin", "guard", "rare", "pow", 2, "self", null, [{ o: "pow", p: "plate", n: 4 }], N("不落城牆", "不落の城壁", "Bastion")),
    card("pal_ray", "paladin", "light", "common", "atk", 1, "enemy", "any", [], N("聖光彈", "聖光弾", "Holy Ray"), { near: [dmg(5)], far: [dmg(8)] }),
    card("pal_touch", "paladin", "light", "common", "skl", 1, "ally", null, [{ o: "heal", n: 7 }], N("治癒之觸", "癒しの手", "Healing Touch")),
    card("pal_radiance", "paladin", "light", "uncommon", "atk", 1, "none", "near", [{ o: "dmgAll", n: 5, r: "near" }, { o: "healAll", n: 2 }], N("光輝", "光輝", "Radiance")),
    card("pal_oath", "paladin", "light", "uncommon", "skl", 1, "none", null, [{ o: "strAll", n: 1 }], N("神聖誓約", "聖なる誓い", "Sacred Oath"), { exhaust: true }),
    card("pal_dawn", "paladin", "light", "rare", "atk", 3, "none", "any", [{ o: "dmgAll", n: 9, r: "any" }, { o: "healAll", n: 3 }], N("黎明", "黎明", "Dawn"), { exhaust: true }),
    card("pal_condemn", "paladin", "judge", "common", "atk", 1, "enemy", "any", [dmg(3), st("vuln", 2)], N("定罪", "断罪", "Condemn")),
    card("pal_fist", "paladin", "judge", "common", "atk", 1, "enemy", "near", [dmg(9)], N("鐵拳", "鉄拳", "Iron Fist")),
    card("pal_hammer", "paladin", "judge", "uncommon", "atk", 2, "enemy", "near", [dmg(14), st("weak", 1)], N("審判之錘", "裁きの鎚", "Hammer of Justice")),
    card("pal_chain", "paladin", "judge", "uncommon", "atk", 1, "enemy", "far", [{ o: "pull" }, dmg(6)], N("聖鎖", "聖鎖", "Holy Chain")),
    card("pal_verdict", "paladin", "judge", "rare", "atk", 2, "enemy", "any", [{ o: "dmgExec", n: 14 }], N("最終審判", "最後の審判", "Final Verdict"), { exhaust: true, up: { exhaust: false } }),

    // ===== 狂戰士 =====
    card("ber_chop", "berserker", null, "basic", "atk", 1, "enemy", "near", [dmg(8)], N("劈砍", "叩き斬り", "Chop")),
    card("ber_block", "berserker", null, "basic", "skl", 1, "self", null, [blk(5)], N("格擋", "受け流し", "Parry")),
    card("ber_roar", "berserker", null, "basic", "skl", 0, "self", null, [{ o: "lose", n: 2 }, { o: "str", n: 1 }], N("怒吼", "咆哮", "Roar")),
    card("ber_axe", "berserker", null, "basic", "atk", 1, "enemy", "any", [], N("飛斧", "投げ斧", "Throwing Axe"), { near: [dmg(5)], far: [dmg(7)] }),
    card("ber_charge", "berserker", null, "basic", "atk", 1, "enemy", "any", [], N("衝撞", "突進", "Charge"), { near: [dmg(8)], far: [{ o: "pull" }, dmg(4)] }),
    card("ber_frenzy", "berserker", "blood", "common", "skl", 0, "self", null, [{ o: "lose", n: 3 }, { o: "mana", n: 2 }], N("血之狂暴", "血の狂乱", "Blood Frenzy"), { up: { fx: [{ o: "lose", n: 2 }, { o: "mana", n: 2 }] } }),
    card("ber_pain", "berserker", "blood", "common", "skl", 1, "self", null, [{ o: "lose", n: 4 }, { o: "str", n: 2 }], N("痛覺轉換", "痛みの転化", "Pain to Power")),
    card("ber_vengeance", "berserker", "blood", "uncommon", "atk", 1, "enemy", "near", [{ o: "dmgMissing", n: 5, k: 3 }], N("以血還血", "血には血を", "Blood for Blood")),
    card("ber_undying", "berserker", "blood", "uncommon", "skl", 1, "self", null, [{ o: "heal", n: 8 }, blk(6)], N("不死之身", "不死身", "Undying"), { exhaust: true }),
    card("ber_rage", "berserker", "blood", "rare", "pow", 2, "self", null, [{ o: "pow", p: "rage", n: 1 }], N("狂怒", "激怒", "Rage")),
    card("ber_whirl", "berserker", "whirl", "common", "atk", 1, "none", "near", [{ o: "dmgAll", n: 6, r: "near" }], N("旋風斬", "旋風斬", "Whirl")),
    card("ber_sweep", "berserker", "whirl", "common", "atk", 1, "none", "near", [{ o: "dmgAll", n: 3, r: "near" }, { o: "pushAll" }], N("橫掃踢", "薙ぎ蹴り", "Sweeping Kick")),
    card("ber_cyclone", "berserker", "whirl", "uncommon", "atk", 2, "none", "near", [{ o: "dmgAll", n: 5, h: 2, r: "near" }], N("颶風", "颶風", "Cyclone")),
    card("ber_warcry", "berserker", "whirl", "uncommon", "skl", 1, "none", "near", [{ o: "stAll", s: "weak", n: 2, r: "near" }, blk(4)], N("戰吼", "鬨の声", "War Cry")),
    card("ber_storm", "berserker", "whirl", "rare", "atk", 2, "none", "any", [{ o: "dmgAll", n: 12, r: "any" }, { o: "lose", n: 5 }], N("血肉風暴", "血肉の嵐", "Carnage")),
    card("ber_cleave", "berserker", "exec", "common", "atk", 2, "enemy", "near", [dmg(15)], N("重劈", "重撃", "Cleave")),
    card("ber_sunder", "berserker", "exec", "common", "atk", 1, "enemy", "near", [dmg(6), st("vuln", 2)], N("破甲", "鎧砕き", "Sunder")),
    card("ber_behead", "berserker", "exec", "uncommon", "atk", 2, "enemy", "near", [{ o: "dmgExec", n: 12 }], N("斬首", "断頭", "Behead")),
    card("ber_hunt", "berserker", "exec", "uncommon", "atk", 1, "enemy", "any", [], N("追擊", "追撃", "Run Down"), { near: [dmg(10)], far: [{ o: "pull" }, dmg(7)] }),
    card("ber_slaughter", "berserker", "exec", "rare", "atk", 2, "enemy", "near", [dmg(6, 3)], N("屠戮", "殺戮", "Slaughter")),

    // ===== 遊俠 =====
    card("ran_shot", "ranger", null, "basic", "atk", 1, "enemy", "any", [], N("射擊", "射撃", "Shot"), { near: [dmg(3)], far: [dmg(7)] }),
    card("ran_dodge", "ranger", null, "basic", "skl", 1, "self", null, [blk(5)], N("閃避", "回避", "Dodge")),
    card("ran_kick", "ranger", null, "basic", "atk", 0, "enemy", "near", [dmg(3), { o: "push" }], N("踢退", "蹴り飛ばし", "Kick")),
    card("ran_pierce", "ranger", null, "basic", "atk", 1, "enemy", "far", [dmg(5), st("vuln", 1)], N("穿刺箭", "貫通矢", "Piercing Arrow")),
    card("ran_aim", "ranger", "snipe", "common", "skl", 1, "enemy", "any", [st("vuln", 2), { o: "draw", n: 1 }], N("瞄準", "照準", "Take Aim")),
    card("ran_longbow", "ranger", "snipe", "common", "atk", 1, "enemy", "far", [dmg(11)], N("長弓", "長弓", "Longbow")),
    card("ran_snipe", "ranger", "snipe", "uncommon", "atk", 2, "enemy", "far", [dmg(20)], N("狙擊", "狙撃", "Snipe")),
    card("ran_eagle", "ranger", "snipe", "uncommon", "pow", 1, "self", null, [{ o: "pow", p: "far", n: 3 }], N("鷹眼", "鷹の目", "Eagle Eye")),
    card("ran_deadeye", "ranger", "snipe", "rare", "atk", 2, "enemy", "far", [{ o: "dmgExec", n: 16 }], N("致命一擊", "致命の一矢", "Deadeye")),
    card("ran_snare", "ranger", "trap", "common", "skl", 1, "self", null, [{ o: "trap", n: 4 }, blk(5)], N("捕獸夾", "トラバサミ", "Snare")),
    card("ran_flip", "ranger", "trap", "common", "skl", 1, "self", null, [blk(6), { o: "pushAll" }], N("後空翻", "バク転", "Backflip")),
    card("ran_trip", "ranger", "trap", "uncommon", "atk", 1, "enemy", "near", [{ o: "push" }, st("weak", 2)], N("絆索", "足払い", "Tripwire")),
    card("ran_mines", "ranger", "trap", "uncommon", "skl", 2, "self", null, [{ o: "trap", n: 8 }], N("地雷陣", "地雷原", "Minefield")),
    card("ran_lure", "ranger", "trap", "rare", "skl", 1, "none", "far", [{ o: "pullSec" }, blk(5)], N("誘捕", "誘い込み", "Lure")),
    card("ran_volley", "ranger", "volley", "common", "atk", 1, "enemy", "any", [], N("連射", "連射", "Volley"), { near: [dmg(2, 2)], far: [dmg(3, 3)] }),
    card("ran_quick", "ranger", "volley", "common", "skl", 1, "self", null, [blk(4), { o: "draw", n: 2 }], N("疾步", "疾走", "Quickstep")),
    card("ran_rain", "ranger", "volley", "uncommon", "atk", 2, "none", "far", [{ o: "dmgAll", n: 6, r: "far" }], N("箭雨", "矢の雨", "Arrow Rain")),
    card("ran_cloud", "ranger", "volley", "uncommon", "atk", 1, "enemy", "far", [dmg(6), { o: "draw", n: 1 }], N("穿雲箭", "雲穿ち", "Cloudpiercer")),
    card("ran_thousand", "ranger", "volley", "rare", "atk", 3, "none", "far", [{ o: "dmgAll", n: 5, h: 3, r: "far" }], N("千箭", "千本矢", "Thousand Arrows")),

    // ===== 法師 =====
    card("mag_bolt", "mage", null, "basic", "atk", 1, "enemy", "any", [dmg(5)], N("魔彈", "魔弾", "Magic Bolt")),
    card("mag_barrier", "mage", null, "basic", "skl", 1, "self", null, [blk(5)], N("屏障", "障壁", "Barrier")),
    card("mag_fireball", "mage", null, "basic", "atk", 2, "enemy", "any", [dmg(8), st("burn", 3)], N("火球", "火球", "Fireball")),
    card("mag_frost", "mage", null, "basic", "atk", 1, "enemy", "any", [dmg(4), st("weak", 2)], N("冰錐", "氷柱", "Frost Spike")),
    card("mag_ignite", "mage", "fire", "common", "skl", 1, "enemy", "any", [st("burn", 6)], N("點燃", "着火", "Ignite")),
    card("mag_flame", "mage", "fire", "common", "atk", 1, "none", "near", [{ o: "dmgAll", n: 3, r: "near" }, { o: "stAll", s: "burn", n: 3, r: "near" }], N("火焰噴射", "火炎放射", "Flamethrower")),
    card("mag_firestorm", "mage", "fire", "uncommon", "skl", 2, "none", "any", [{ o: "stAll", s: "burn", n: 5, r: "any" }], N("烈焰風暴", "炎の嵐", "Firestorm")),
    card("mag_combust", "mage", "fire", "uncommon", "atk", 1, "enemy", "any", [{ o: "detonate", n: 3 }], N("引爆", "起爆", "Combust")),
    card("mag_aura", "mage", "fire", "rare", "pow", 2, "self", null, [{ o: "pow", p: "burnAll", n: 2 }], N("元素光環", "元素の環", "Elemental Aura")),
    card("mag_freeze", "mage", "frost", "common", "skl", 1, "enemy", "any", [st("stun", 1)], N("冰凍", "凍結", "Freeze"), { exhaust: true, up: { cost: 0 } }),
    card("mag_icearmor", "mage", "frost", "common", "skl", 1, "self", null, [blk(9)], N("寒冰護甲", "氷の鎧", "Ice Armor")),
    card("mag_blizzard", "mage", "frost", "uncommon", "atk", 2, "none", "any", [{ o: "dmgAll", n: 4, r: "any" }, { o: "stAll", s: "weak", n: 1, r: "any" }], N("暴風雪", "吹雪", "Blizzard")),
    card("mag_icewall", "mage", "frost", "uncommon", "skl", 1, "self", null, [blk(6), { o: "pushAll" }], N("冰牆", "氷壁", "Ice Wall")),
    card("mag_zero", "mage", "frost", "rare", "skl", 3, "none", "any", [{ o: "stAll", s: "stun", n: 1, r: "any" }], N("絕對零度", "絶対零度", "Absolute Zero"), { exhaust: true }),
    card("mag_surge", "mage", "arcane", "common", "skl", 0, "self", null, [{ o: "mana", n: 2 }, { o: "draw", n: 1 }], N("魔力湧泉", "魔力の泉", "Mana Surge"), { exhaust: true }),
    card("mag_intel", "mage", "arcane", "common", "skl", 1, "self", null, [{ o: "draw", n: 2 }, { o: "mana", n: 1 }], N("奧術智慧", "秘術の知恵", "Arcane Intellect")),
    card("mag_chain", "mage", "arcane", "uncommon", "atk", 2, "enemy", "any", [{ o: "dmgSec", n: 11 }], N("連鎖閃電", "連鎖雷", "Chain Lightning")),
    card("mag_gravity", "mage", "arcane", "uncommon", "skl", 1, "enemy", "any", [], N("引力反轉", "引力反転", "Gravity Flip"), { near: [{ o: "push" }, st("weak", 2)], far: [{ o: "pull" }, st("vuln", 2)] }),
    card("mag_meteor", "mage", "arcane", "rare", "atk", 3, "enemy", "any", [dmg(24), st("burn", 5)], N("隕石", "隕石", "Meteor")),

    // ===== 祭司 =====
    card("pri_smite", "priest", null, "basic", "atk", 1, "enemy", "any", [dmg(5)], N("懲擊", "懲罰", "Smite")),
    card("pri_bless", "priest", null, "basic", "skl", 1, "ally", null, [{ o: "blkAlly", n: 6 }], N("祝福護盾", "祝福の盾", "Blessed Shield")),
    card("pri_heal", "priest", null, "basic", "skl", 1, "ally", null, [{ o: "heal", n: 6 }], N("治療", "治癒", "Heal")),
    card("pri_holy", "priest", null, "basic", "atk", 2, "none", "any", [{ o: "dmgAll", n: 3, r: "any" }, { o: "healAll", n: 2 }], N("聖光", "聖光", "Holy Light")),
    card("pri_renew", "priest", "heal", "common", "skl", 1, "ally", null, [{ o: "regen", n: 4 }], N("再生", "再生", "Renew")),
    card("pri_prayer", "priest", "heal", "common", "skl", 1, "ally", null, [{ o: "heal", n: 4 }, { o: "draw", n: 1 }], N("祈禱", "祈り", "Prayer")),
    card("pri_mass", "priest", "heal", "uncommon", "skl", 2, "none", null, [{ o: "healAll", n: 6 }], N("群體治療", "全体治癒", "Mass Heal"), { exhaust: true }),
    card("pri_purify", "priest", "heal", "uncommon", "skl", 0, "ally", null, [{ o: "cleanse" }, { o: "draw", n: 1 }], N("淨化", "浄化", "Purify")),
    card("pri_revive", "priest", "heal", "rare", "skl", 2, "down", null, [{ o: "revive", n: 40 }], N("復甦", "蘇生", "Resurrect"), { exhaust: true }),
    card("pri_aegis", "priest", "ward", "common", "skl", 1, "none", null, [{ o: "blkAll", n: 4 }], N("聖壁", "聖壁", "Aegis")),
    card("pri_light", "priest", "ward", "common", "skl", 1, "ally", null, [{ o: "blkAlly", n: 9 }], N("守護之光", "守りの光", "Guiding Light")),
    card("pri_sanct", "priest", "ward", "uncommon", "skl", 2, "none", null, [{ o: "blkAll", n: 7 }], N("聖域", "聖域", "Sanctuary")),
    card("pri_might", "priest", "ward", "uncommon", "skl", 1, "ally", null, [{ o: "strAlly", n: 2 }], N("神聖之力", "神聖な力", "Divine Might"), { exhaust: true }),
    card("pri_halo", "priest", "ward", "rare", "skl", 1, "none", null, [{ o: "cleanseAll" }, { o: "blkAll", n: 5 }], N("光環", "光輪", "Halo")),
    card("pri_chain", "priest", "wrath", "common", "atk", 1, "enemy", "far", [{ o: "pull" }, dmg(5)], N("光之鎖鏈", "光の鎖", "Chain of Light")),
    card("pri_judge", "priest", "wrath", "common", "atk", 2, "enemy", "any", [dmg(11), st("weak", 2)], N("審判", "審判", "Judgment")),
    card("pri_wrath", "priest", "wrath", "uncommon", "atk", 2, "none", "any", [{ o: "dmgAll", n: 6, r: "any" }, { o: "stAll", s: "vuln", n: 1, r: "any" }], N("神罰", "神罰", "Divine Wrath")),
    card("pri_fire", "priest", "wrath", "uncommon", "atk", 1, "enemy", "any", [st("burn", 2)], N("聖火", "聖火", "Sacred Flame"), { near: [dmg(9)], far: [dmg(5)] }),
    card("pri_doom", "priest", "wrath", "rare", "atk", 3, "none", "any", [{ o: "dmgAll", n: 14, r: "any" }], N("天罰之日", "天罰の日", "Day of Wrath"), { exhaust: true }),

    // ===== 女巫 =====
    card("wit_curse", "witch", null, "basic", "atk", 1, "enemy", "any", [dmg(3), st("poison", 1)], N("詛咒彈", "呪弾", "Hex Bolt")),
    card("wit_mist", "witch", null, "basic", "skl", 1, "self", null, [blk(5)], N("黑霧", "黒い霧", "Dark Mist")),
    card("wit_poison", "witch", null, "basic", "skl", 1, "enemy", "any", [st("poison", 4)], N("毒藥", "毒薬", "Poison")),
    card("wit_wither", "witch", null, "basic", "skl", 1, "enemy", "any", [st("weak", 2), st("vuln", 1)], N("枯萎", "枯死", "Wither")),
    card("wit_miasma", "witch", "venom", "common", "skl", 2, "none", "any", [{ o: "stAll", s: "poison", n: 3, r: "any" }], N("毒霧", "毒霧", "Miasma")),
    card("wit_envenom", "witch", "venom", "common", "skl", 1, "enemy", "any", [st("poison", 6)], N("淬毒", "毒塗り", "Envenom")),
    card("wit_catalyst", "witch", "venom", "uncommon", "skl", 1, "enemy", "any", [{ o: "poisonX", n: 2 }], N("毒素催化", "毒の触媒", "Catalyst"), { exhaust: true, up: { exhaust: false } }),
    card("wit_bog", "witch", "venom", "uncommon", "skl", 1, "none", "near", [blk(5), { o: "stAll", s: "poison", n: 3, r: "near" }], N("瘴氣沼澤", "瘴気の沼", "Fetid Bog")),
    card("wit_plague", "witch", "venom", "rare", "pow", 2, "self", null, [{ o: "pow", p: "poisonAll", n: 2 }], N("瘟疫", "疫病", "Plague")),
    card("wit_weaken", "witch", "hex", "common", "skl", 1, "none", "any", [{ o: "stAll", s: "weak", n: 1, r: "any" }, { o: "stAll", s: "vuln", n: 1, r: "any" }], N("衰弱詛咒", "衰弱の呪い", "Enfeeble")),
    card("wit_flaw", "witch", "hex", "common", "skl", 1, "enemy", "any", [st("vuln", 3)], N("破綻", "綻び", "Expose")),
    card("wit_dread", "witch", "hex", "uncommon", "skl", 1, "enemy", "any", [], N("恐懼", "恐怖", "Dread"), { near: [{ o: "push" }, st("weak", 2)], far: [st("weak", 3)] }),
    card("wit_doom", "witch", "hex", "uncommon", "skl", 2, "none", "any", [{ o: "stAll", s: "vuln", n: 2, r: "any" }, { o: "stAll", s: "poison", n: 2, r: "any" }], N("厄運", "厄運", "Doom")),
    card("wit_bind", "witch", "hex", "rare", "atk", 1, "enemy", "any", [{ o: "hexDmg", n: 7 }], N("咒縛", "呪縛", "Hexbind")),
    card("wit_leech", "witch", "blood", "common", "atk", 1, "enemy", "near", [{ o: "lifesteal", n: 6 }], N("吸血", "吸血", "Leech")),
    card("wit_pact", "witch", "blood", "common", "skl", 0, "self", null, [{ o: "lose", n: 3 }, { o: "draw", n: 2 }], N("血之契約", "血の契約", "Blood Pact")),
    card("wit_drain", "witch", "blood", "uncommon", "atk", 2, "enemy", "any", [{ o: "lifesteal", n: 9 }], N("生命汲取", "生命吸収", "Drain Life")),
    card("wit_bloodhex", "witch", "blood", "uncommon", "skl", 1, "none", "any", [{ o: "lose", n: 4 }, { o: "stAll", s: "poison", n: 3, r: "any" }, { o: "stAll", s: "weak", n: 1, r: "any" }], N("血咒", "血の呪い", "Blood Hex")),
    card("wit_moon", "witch", "blood", "rare", "pow", 2, "self", null, [{ o: "pow", p: "leech", n: 2 }], N("血月", "血の月", "Blood Moon")),

    // ===== 召喚師 =====
    card("sum_call", "summoner", null, "basic", "skl", 1, "self", null, [{ o: "summon", n: 1 }, blk(3)], N("召喚精靈", "精霊召喚", "Call Spirit")),
    card("sum_staff", "summoner", null, "basic", "atk", 1, "enemy", "any", [], N("杖擊", "杖打ち", "Staff Strike"), { near: [dmg(6)], far: [dmg(3)] }),
    card("sum_charm", "summoner", null, "basic", "skl", 1, "self", null, [blk(5)], N("護身符", "お守り", "Ward Charm")),
    card("sum_burst", "summoner", null, "basic", "atk", 1, "enemy", "any", [{ o: "dmgSpirit", n: 2 }], N("精靈衝擊", "精霊衝撃", "Spirit Burst")),
    card("sum_flock", "summoner", "swarm", "common", "skl", 1, "self", null, [{ o: "summon", n: 3 }], N("精靈群", "精霊の群れ", "Flock")),
    card("sum_escort", "summoner", "swarm", "common", "skl", 1, "self", null, [{ o: "summon", n: 1 }, blk(6)], N("召喚護衛", "護衛召喚", "Escort")),
    card("sum_breed", "summoner", "swarm", "uncommon", "skl", 2, "self", null, [{ o: "summon", n: 4 }, blk(4)], N("繁衍", "増殖", "Multiply")),
    card("sum_wall", "summoner", "swarm", "uncommon", "skl", 1, "self", null, [{ o: "blkSpirit", n: 3 }], N("精靈之牆", "精霊の壁", "Spirit Wall")),
    card("sum_legion", "summoner", "swarm", "rare", "pow", 2, "self", null, [{ o: "pow", p: "spiritTurn", n: 1 }], N("萬靈", "万霊", "Legion")),
    card("sum_frenzy", "summoner", "empower", "common", "skl", 1, "self", null, [{ o: "spiritsAct", n: 1 }], N("精靈狂熱", "精霊の熱狂", "Spirit Frenzy")),
    card("sum_fang", "summoner", "empower", "common", "pow", 1, "self", null, [{ o: "pow", p: "spirit", n: 1 }], N("銳利之牙", "鋭い牙", "Sharp Fangs")),
    card("sum_link", "summoner", "empower", "uncommon", "atk", 1, "enemy", "any", [{ o: "dmgSpirit", n: 3 }], N("靈魂連結", "魂の絆", "Soul Link")),
    card("sum_assault", "summoner", "empower", "uncommon", "skl", 2, "self", null, [{ o: "spiritsAct", n: 2 }], N("精靈突擊", "精霊突撃", "Spirit Assault")),
    card("sum_king", "summoner", "empower", "rare", "pow", 3, "self", null, [{ o: "pow", p: "spirit", n: 3 }], N("精靈王", "精霊王", "Spirit King")),
    card("sum_sacblk", "summoner", "sacrifice", "common", "skl", 0, "self", null, [{ o: "sac", k: "blk", n: 5 }, { o: "summon", n: 1 }], N("獻祭護盾", "生贄の盾", "Sacrificial Ward")),
    card("sum_sacdmg", "summoner", "sacrifice", "common", "atk", 1, "enemy", "any", [{ o: "sac", k: "dmg", n: 7 }, { o: "summon", n: 1 }], N("靈魂爆發", "魂の爆発", "Soul Blast")),
    card("sum_reap", "summoner", "sacrifice", "uncommon", "skl", 1, "self", null, [{ o: "sac", k: "draw", n: 1 }, { o: "mana", n: 1 }], N("靈魂收割", "魂の刈り取り", "Soul Harvest")),
    card("sum_sacheal", "summoner", "sacrifice", "uncommon", "skl", 1, "none", null, [{ o: "sac", k: "healAll", n: 3 }, { o: "summon", n: 2 }], N("獻祭治療", "生贄の癒し", "Life Offering")),
    card("sum_gate", "summoner", "sacrifice", "rare", "atk", 2, "none", "any", [{ o: "sac", k: "dmgAll", n: 6 }, { o: "summon", n: 2 }], N("冥府之門", "冥府の門", "Underworld Gate")),

    // ===== 吟遊詩人 =====
    card("bar_rapier", "bard", null, "basic", "atk", 1, "enemy", "any", [], N("刺劍", "細剣", "Rapier"), { near: [dmg(7)], far: [dmg(4)] }),
    card("bar_step", "bard", null, "basic", "skl", 1, "self", null, [blk(5)], N("輕步", "軽業", "Light Step")),
    card("bar_prelude", "bard", null, "basic", "skl", 1, "self", null, [{ o: "mel", n: 2 }, blk(4)], N("序曲", "序曲", "Prelude")),
    card("bar_finale", "bard", null, "basic", "skl", 1, "none", null, [{ o: "finale", k: "blkAll", n: 3 }], N("終曲・守護", "終曲・守護", "Finale: Guard")),
    card("bar_march", "bard", "war", "common", "skl", 1, "self", null, [{ o: "mel", n: 2 }, { o: "draw", n: 1 }], N("進行曲", "行進曲", "March")),
    card("bar_drums", "bard", "war", "common", "skl", 1, "none", null, [{ o: "finale", k: "strAll", n: 1, per: 2 }], N("終曲・戰鼓", "終曲・戦太鼓", "Finale: War Drums")),
    card("bar_ode", "bard", "war", "uncommon", "skl", 1, "none", null, [{ o: "strAll", n: 1 }, { o: "mel", n: 2 }], N("英雄頌", "英雄頌", "Heroic Ode"), { exhaust: true }),
    card("bar_triumph", "bard", "war", "uncommon", "skl", 1, "none", null, [{ o: "blkAll", n: 4 }, { o: "mel", n: 2 }], N("凱歌", "凱歌", "Triumph")),
    card("bar_anthem", "bard", "war", "rare", "pow", 2, "self", null, [{ o: "pow", p: "melTurn", n: 2 }], N("戰神讚歌", "軍神賛歌", "Anthem of War")),
    card("bar_lullaby", "bard", "requiem", "common", "skl", 1, "none", null, [{ o: "healAll", n: 2 }, { o: "mel", n: 1 }], N("搖籃曲", "子守歌", "Lullaby")),
    card("bar_requiem", "bard", "requiem", "common", "skl", 1, "none", null, [{ o: "finale", k: "healAll", n: 1 }], N("終曲・安魂", "終曲・鎮魂", "Finale: Requiem")),
    card("bar_chord", "bard", "requiem", "uncommon", "skl", 2, "none", null, [{ o: "blkAll", n: 6 }, { o: "mel", n: 1 }], N("守護和弦", "守りの和音", "Guarding Chord")),
    card("bar_calm", "bard", "requiem", "uncommon", "skl", 1, "none", null, [{ o: "cleanseAll" }, { o: "mel", n: 2 }], N("寧靜", "静寂", "Serenity")),
    card("bar_heaven", "bard", "requiem", "rare", "skl", 2, "none", null, [{ o: "healAll", n: 5 }, { o: "blkAll", n: 5 }], N("天籟", "天籟", "Heavenly Voice"), { exhaust: true }),
    card("bar_shriek", "bard", "discord", "common", "atk", 1, "enemy", "any", [dmg(4), { o: "mel", n: 1 }], N("刺耳音", "金切り声", "Shriek")),
    card("bar_jar", "bard", "discord", "common", "skl", 1, "none", "any", [{ o: "stAll", s: "weak", n: 1, r: "any" }, { o: "mel", n: 1 }], N("不協和音", "不協和音", "Dissonance")),
    card("bar_boom", "bard", "discord", "uncommon", "atk", 2, "none", "any", [{ o: "finale", k: "dmgAll", n: 2 }], N("終曲・音爆", "終曲・音撃", "Finale: Sonic Boom")),
    card("bar_resonate", "bard", "discord", "uncommon", "atk", 1, "enemy", "any", [{ o: "dmgMel", n: 2 }], N("共振", "共振", "Resonance")),
    card("bar_collapse", "bard", "discord", "rare", "atk", 2, "enemy", "any", [{ o: "finale", k: "dmg", n: 5 }], N("終曲・崩壞", "終曲・崩壊", "Finale: Collapse")),

    // ===== 敵人塞進牌組的卡 =====
    card("t_wound", "token", null, "token", "curse", 0, "none", null, [], N("傷口", "傷", "Wound"), { unplayable: true }),
    card("t_daze", "token", null, "token", "curse", 0, "none", null, [], N("暈眩", "眩暈", "Daze"), { unplayable: true, ethereal: true }),
    // 地獄裁判的黃牌：手上同時有 2 張就變紅牌（結束回合時受 RED_CARD_DMG 傷害）；花 1 魔力打出可以申訴移除
    card("t_yellow", "token", null, "token", "curse", 1, "self", null, [{ o: "appeal" }], N("黃牌", "イエローカード", "Yellow Card"), { exhaust: true })
  ];

  // ---------------- 敵人 ----------------
  // kind：melee（在外圈只能前進）／ranged（在內圈只能後退）／boss（不會被擊退或拉近）
  // spawn：出生在內圈 near 或外圈 far（預設外圈）
  // pat：行動清單（每項是一回合的 acts），loop 依序循環，rand 隨機（不連續重複）
  // acts：atk{n,h,tgt:"lane"(預設：自己扇形區的英雄)/"all"/"low"/"rand"}／blk{n,all}／buff{str,all}／debuff{s,n,tgt}／
  //       curse{card,n,tgt}／summon{id,n}／heal{n,all}／yellow{tgt}
  var ENEMIES = [
    // ---- 第一幕：墓地 ----
    { id: "skel", name: N("骷髏兵", "骸骨兵", "Skeleton"), icon: "💀", kind: "melee", hp: [12, 15], pat: [[{ k: "atk", n: 6 }], [{ k: "blk", n: 4 }, { k: "atk", n: 4 }]], cyc: "loop" },
    { id: "archer", name: N("骷髏弓手", "骸骨弓兵", "Skeleton Archer"), icon: "🏹", kind: "ranged", hp: [10, 12], pat: [[{ k: "atk", n: 5 }], [{ k: "atk", n: 3, h: 2 }]], cyc: "rand" },
    { id: "ghoul", name: N("食屍鬼", "グール", "Ghoul"), icon: "🧟", kind: "melee", hp: [18, 22], pat: [[{ k: "atk", n: 7 }], [{ k: "atk", n: 4 }, { k: "debuff", s: "weak", n: 1 }], [{ k: "buff", str: 2 }]], cyc: "rand" },
    { id: "bats", name: N("蝙蝠群", "蝙蝠の群れ", "Bat Swarm"), icon: "🦇", kind: "melee", spawn: "near", hp: [8, 10], pat: [[{ k: "atk", n: 2, h: 2 }]], cyc: "loop" },
    { id: "cultist", name: N("邪教徒", "邪教徒", "Cultist"), icon: "🕯️", kind: "ranged", hp: [24, 28], pat: [[{ k: "buff", str: 3 }], [{ k: "atk", n: 5 }], [{ k: "atk", n: 5 }]], cyc: "loop" },
    { id: "slime", name: N("腐泥", "腐泥", "Ooze"), icon: "🟢", kind: "melee", hp: [16, 19], pat: [[{ k: "atk", n: 5 }, { k: "curse", card: "t_wound", n: 1 }], [{ k: "blk", n: 7 }]], cyc: "loop" },
    { id: "knight", name: N("墓穴騎士", "墓所の騎士", "Grave Knight"), icon: "⚔️", kind: "melee", elite: true, hp: [52, 58], pat: [[{ k: "atk", n: 12 }], [{ k: "blk", n: 10 }, { k: "buff", str: 2 }], [{ k: "atk", n: 5, h: 3 }]], cyc: "loop" },
    { id: "witch", name: N("沼地女巫", "沼の魔女", "Bog Witch"), icon: "🧙", kind: "ranged", elite: true, hp: [40, 46], pat: [[{ k: "debuff", s: "vuln", n: 2, tgt: "all" }], [{ k: "atk", n: 9 }], [{ k: "summon", id: "bats", n: 1 }], [{ k: "atk", n: 6 }, { k: "curse", card: "t_daze", n: 1, tgt: "all" }]], cyc: "loop" },
    { id: "giant", name: N("腐化巨人", "腐敗の巨人", "Rot Giant"), icon: "👹", kind: "boss", boss: true, hp: [95, 95], pat: [[{ k: "atk", n: 8, tgt: "all" }], [{ k: "buff", str: 2 }, { k: "blk", n: 15 }], [{ k: "atk", n: 18, tgt: "low" }], [{ k: "summon", id: "slime", n: 2 }]], cyc: "loop" },

    // ---- 第二幕：熔岩地獄 ----
    { id: "imp", name: N("小惡魔", "インプ", "Imp"), icon: "😈", kind: "ranged", hp: [16, 19], pat: [[{ k: "atk", n: 5 }, { k: "debuff", s: "burn", n: 2 }], [{ k: "atk", n: 7 }]], cyc: "rand" },
    { id: "hound", name: N("地獄犬", "ヘルハウンド", "Hellhound"), icon: "🐺", kind: "melee", spawn: "near", hp: [22, 26], pat: [[{ k: "atk", n: 5, h: 2 }], [{ k: "atk", n: 9 }]], cyc: "rand" },
    { id: "guard", name: N("惡魔守衛", "悪魔の衛兵", "Demon Guard"), icon: "🗿", kind: "melee", hp: [32, 36], pat: [[{ k: "blk", n: 8, all: true }], [{ k: "atk", n: 10 }], [{ k: "atk", n: 6 }, { k: "blk", n: 6 }]], cyc: "loop" },
    { id: "succubus", name: N("魅魔", "サキュバス", "Succubus"), icon: "💋", kind: "ranged", hp: [24, 28], pat: [[{ k: "debuff", s: "vuln", n: 2 }, { k: "atk", n: 4 }], [{ k: "atk", n: 8 }], [{ k: "heal", n: 8, all: true }]], cyc: "loop" },
    { id: "salamander", name: N("火蜥蜴", "サラマンダー", "Salamander"), icon: "🦎", kind: "melee", hp: [26, 30], pat: [[{ k: "atk", n: 6 }, { k: "debuff", s: "burn", n: 3 }], [{ k: "buff", str: 2 }, { k: "blk", n: 6 }]], cyc: "loop" },
    { id: "brute", name: N("炎魔", "炎魔", "Balrog"), icon: "🔥", kind: "melee", elite: true, hp: [80, 88], pat: [[{ k: "atk", n: 16 }], [{ k: "atk", n: 6, h: 2 }, { k: "debuff", s: "burn", n: 3 }], [{ k: "buff", str: 3 }, { k: "blk", n: 12 }]], cyc: "loop" },
    { id: "warlock", name: N("深淵術士", "深淵の術士", "Abyss Warlock"), icon: "🌀", kind: "ranged", elite: true, hp: [64, 70], pat: [[{ k: "atk", n: 7, tgt: "all" }], [{ k: "summon", id: "imp", n: 1 }], [{ k: "debuff", s: "weak", n: 2, tgt: "all" }, { k: "blk", n: 10 }]], cyc: "loop" },
    { id: "lord", name: N("深淵領主", "深淵の領主", "Abyss Lord"), icon: "👿", kind: "boss", boss: true, hp: [160, 160], pat: [[{ k: "atk", n: 10, tgt: "all" }], [{ k: "summon", id: "hound", n: 2 }], [{ k: "atk", n: 6, h: 3, tgt: "low" }], [{ k: "buff", str: 3 }, { k: "debuff", s: "vuln", n: 2, tgt: "all" }], [{ k: "atk", n: 24, tgt: "rand" }]], cyc: "loop" },

    // ---- 第三幕：審判之庭 ----
    { id: "lineman", name: N("巡邊員", "線審", "Linesman"), icon: "🚩", kind: "ranged", hp: [30, 34], pat: [[{ k: "atk", n: 8 }], [{ k: "debuff", s: "weak", n: 2 }, { k: "atk", n: 5 }]], cyc: "rand" },
    { id: "hooligan", name: N("暴徒", "暴徒", "Hooligan"), icon: "🤬", kind: "melee", spawn: "near", hp: [34, 38], pat: [[{ k: "atk", n: 11 }], [{ k: "atk", n: 4, h: 3 }], [{ k: "buff", str: 2 }]], cyc: "rand" },
    { id: "shade", name: N("怨靈", "怨霊", "Shade"), icon: "👻", kind: "ranged", hp: [26, 30], pat: [[{ k: "curse", card: "t_wound", n: 2 }], [{ k: "atk", n: 9 }], [{ k: "atk", n: 6 }, { k: "debuff", s: "vuln", n: 1 }]], cyc: "loop" },
    { id: "golem", name: N("審判石像", "審判の石像", "Judgement Golem"), icon: "🗽", kind: "melee", hp: [44, 50], pat: [[{ k: "blk", n: 14 }], [{ k: "atk", n: 14 }], [{ k: "atk", n: 8 }, { k: "blk", n: 8 }]], cyc: "loop" },
    { id: "var", name: N("影像判官", "ビデオ判定官", "VAR Seer"), icon: "📺", kind: "ranged", elite: true, hp: [90, 96], pat: [[{ k: "yellow", tgt: "all" }], [{ k: "atk", n: 10, tgt: "all" }], [{ k: "heal", n: 15, all: true }, { k: "blk", n: 12 }]], cyc: "loop" },
    { id: "captain", name: N("黑衣隊長", "黒衣の主将", "Dark Captain"), icon: "🦹", kind: "melee", elite: true, hp: [100, 110], pat: [[{ k: "atk", n: 20 }], [{ k: "buff", str: 3, all: true }], [{ k: "atk", n: 7, h: 3 }]], cyc: "loop" },
    { id: "referee", name: N("地獄裁判長", "地獄の主審", "Hell Referee"), icon: "🟨", kind: "boss", boss: true, hp: [220, 220], pat: [[{ k: "yellow", tgt: "all" }, { k: "blk", n: 15 }], [{ k: "atk", n: 12, tgt: "all" }], [{ k: "summon", id: "lineman", n: 2 }], [{ k: "atk", n: 8, h: 2, tgt: "low" }, { k: "buff", str: 2 }], [{ k: "yellow", tgt: "rand" }, { k: "atk", n: 30, tgt: "rand" }]], cyc: "loop" }
  ];

  // ---------------- 遺物（2026-10-22 使用者指定：遺物、金幣、商店一同實作） ----------------
  // 英雄持有、整局有效的被動。rar：common／uncommon／rare／boss（Boss 戰後三選一，強但有代價）
  // fx 欄位（core 依名稱加總）：
  //   maxHp（取得時）／battleBlk（每場開戰護盾）／partyBlk（開戰全隊護盾）／battleStr（開戰力量）／
  //   firstMana・firstDraw（第一回合）／handPlus（每回合多抽）／manaTurn（每回合魔力）／
  //   killHeal（擊倒敵人時回復）／endHeal（戰鬥勝利時回復）／goldMult（金幣倍率，加總）／restHeal（營火多回復的 %）／
  //   enemyWeak（開戰時所有敵人虛弱）／spiritStart（開戰精靈）／redHalf（紅牌傷害減半）／revive（每場一次倒下時以 25% 復活）／
  //   pw：{ 能力名: 值 }（開戰時加進 h.pw，例如 thorns、far、near、poisonPlus、burnPlus、plate）
  var RELICS = [
    { id: "iron_charm", rar: "common", icon: "🧿", fx: { battleBlk: 8 }, name: N("鐵護符", "鉄の護符", "Iron Charm"), desc: N("每場戰鬥開始時獲得 8 護盾。", "戦闘開始時に防御 8。", "Gain 8 block at the start of each battle.") },
    { id: "war_banner", rar: "common", icon: "🚩", fx: { battleStr: 1 }, name: N("戰旗", "軍旗", "War Banner"), desc: N("每場戰鬥開始時獲得 1 力量。", "戦闘開始時に筋力 +1。", "Gain 1 Strength at the start of each battle.") },
    { id: "mana_crystal", rar: "common", icon: "🔷", fx: { firstMana: 1 }, name: N("魔力水晶", "魔力結晶", "Mana Crystal"), desc: N("每場戰鬥第一回合魔力 +1。", "戦闘の最初のターン、魔力 +1。", "+1 mana on the first turn of each battle.") },
    { id: "quill", rar: "common", icon: "🪶", fx: { firstDraw: 2 }, name: N("預言之羽", "予言の羽", "Prophet's Quill"), desc: N("每場戰鬥第一回合多抽 2 張。", "戦闘の最初のターン、2 枚多く引く。", "Draw 2 extra cards on the first turn of each battle.") },
    { id: "old_boots", rar: "common", icon: "🥾", fx: { maxHp: 10 }, name: N("旅人的舊靴", "旅人の古靴", "Traveller's Boots"), desc: N("最大生命 +10。", "最大生命 +10。", "+10 max HP.") },
    { id: "blood_vial", rar: "common", icon: "🩸", fx: { endHeal: 6 }, name: N("血瓶", "血の小瓶", "Blood Vial"), desc: N("戰鬥勝利時回復 6 生命。", "戦闘勝利時に生命 6 回復。", "Heal 6 HP after winning a battle.") },
    { id: "coin_pouch", rar: "common", icon: "👛", fx: { goldMult: 0.5 }, name: N("金幣袋", "金貨袋", "Coin Pouch"), desc: N("戰鬥得到的金幣 +50%。", "戦闘で得る金貨 +50%。", "+50% gold from battles.") },
    { id: "whistle", rar: "common", icon: "📯", fx: { redHalf: 1, battleBlk: 3 }, name: N("裁判的哨子", "審判の笛", "Referee's Whistle"), desc: N("紅牌傷害減半。每場戰鬥開始時獲得 3 護盾。", "レッドカードのダメージ半減。戦闘開始時に防御 3。", "Red card damage is halved. Gain 3 block at the start of each battle.") },
    { id: "fang", rar: "uncommon", icon: "🦷", fx: { killHeal: 3 }, name: N("吸血牙", "吸血の牙", "Vampire Fang"), desc: N("你的攻擊擊倒敵人時回復 3 生命。", "攻撃で敵を倒すと生命 3 回復。", "Heal 3 HP whenever your attack defeats an enemy.") },
    { id: "thorn_ring", rar: "uncommon", icon: "🌹", fx: { pw: { thorns: 3 } }, name: N("荊棘戒指", "茨の指輪", "Thorn Ring"), desc: N("被攻擊時反彈 3 傷害。", "攻撃を受けると 3 ダメージを返す。", "Deal 3 damage back when attacked.") },
    { id: "hunter_eye", rar: "uncommon", icon: "🎯", fx: { pw: { far: 2 } }, name: N("獵人之眼", "狩人の目", "Hunter's Eye"), desc: N("打外圈的攻擊傷害 +2。", "外周への攻撃ダメージ +2。", "Attacks on the outer ring deal +2.") },
    { id: "knuckles", rar: "uncommon", icon: "🥊", fx: { pw: { near: 2 } }, name: N("指虎", "ナックル", "Knuckledusters"), desc: N("打內圈的攻擊傷害 +2。", "内周への攻撃ダメージ +2。", "Attacks on the inner ring deal +2.") },
    { id: "venom_sac", rar: "uncommon", icon: "🧪", fx: { pw: { poisonPlus: 1 } }, name: N("毒囊", "毒袋", "Venom Sac"), desc: N("施加中毒時多 1 層。", "毒を付与するとき +1。", "Poison you apply is +1.") },
    { id: "ember", rar: "uncommon", icon: "🔥", fx: { pw: { burnPlus: 1 } }, name: N("不滅火種", "不滅の火種", "Undying Ember"), desc: N("施加燃燒時多 1 層。", "燃焼を付与するとき +1。", "Burn you apply is +1.") },
    { id: "spirit_bell", rar: "uncommon", icon: "🔔", fx: { spiritStart: 1 }, name: N("精靈鈴", "精霊の鈴", "Spirit Bell"), desc: N("每場戰鬥開始時召喚 1 隻精靈（回合結束時攻擊）。", "戦闘開始時に精霊を 1 体召喚（ターン終了時に攻撃）。", "Summon 1 spirit at the start of each battle (it attacks at end of turn).") },
    { id: "badge", rar: "rare", icon: "🎖️", fx: { partyBlk: 5 }, name: N("隊長徽章", "隊長の徽章", "Captain's Badge"), desc: N("每場戰鬥開始時全隊獲得 5 護盾。", "戦闘開始時に味方全員に防御 5。", "All allies gain 5 block at the start of each battle.") },
    { id: "healing_stone", rar: "rare", icon: "💎", fx: { restHeal: 20, endHeal: 3 }, name: N("治癒之石", "癒しの石", "Healing Stone"), desc: N("營火休息多回復 20%。戰鬥勝利時回復 3 生命。", "焚き火で 20% 多く回復。戦闘勝利時に生命 3 回復。", "Resting heals 20% more. Heal 3 HP after winning a battle.") },
    { id: "smoke", rar: "rare", icon: "💨", fx: { enemyWeak: 1 }, name: N("煙霧彈", "煙玉", "Smoke Bomb"), desc: N("每場戰鬥開始時所有敵人虛弱 1 回合。", "戦闘開始時に敵全体に脱力 1。", "All enemies are Weak for 1 turn at the start of each battle.") },
    { id: "phoenix", rar: "rare", icon: "🪶", fx: { revive: 1 }, name: N("鳳凰羽", "不死鳥の羽", "Phoenix Feather"), desc: N("每場戰鬥第一次倒下時，以 25% 生命站起來。", "各戦闘で最初に倒れたとき、生命 25% で立ち上がる。", "The first time you fall in each battle, get back up with 25% HP.") },
    { id: "energy_core", rar: "boss", icon: "⚙️", fx: { manaTurn: 1, handPlus: -1 }, name: N("能量核心", "エネルギー核", "Energy Core"), desc: N("每回合魔力 +1，但每回合少抽 1 張。", "毎ターン魔力 +1。ただし手札が 1 枚減る。", "+1 mana each turn, but draw 1 fewer card.") },
    { id: "seer_eye", rar: "boss", icon: "👁️", fx: { handPlus: 1, maxHp: -8 }, name: N("先知之眼", "先見の眼", "Seer's Eye"), desc: N("每回合多抽 1 張。最大生命 −8。", "毎ターン 1 枚多く引く。最大生命 −8。", "Draw 1 extra card each turn. −8 max HP.") },
    { id: "crown", rar: "boss", icon: "👑", fx: { battleStr: 2, goldMult: -1 }, name: N("暴君之冠", "暴君の冠", "Tyrant's Crown"), desc: N("每場戰鬥開始時獲得 2 力量。不再從戰鬥得到金幣。", "戦闘開始時に筋力 +2。戦闘で金貨を得られなくなる。", "Gain 2 Strength at the start of each battle. You no longer earn gold from battles.") },
    { id: "golden_heart", rar: "boss", icon: "💛", fx: { maxHp: 25, firstMana: -1 }, name: N("黃金之心", "黄金の心臓", "Golden Heart"), desc: N("最大生命 +25。每場戰鬥第一回合魔力 −1。", "最大生命 +25。戦闘の最初のターン、魔力 −1。", "+25 max HP. −1 mana on the first turn of each battle.") }
  ];

  // 商店價格與開局金幣（使用者指定一同實作；初版的價格讓第一幕的商店什麼都買不起，2026-10-22 調降並加開局金幣）
  var SHOP = { card: { common: 40, uncommon: 60, rare: 90 }, relic: { common: 90, uncommon: 120, rare: 160 }, remove: 50, removeStep: 25, startGold: 60 };
  // 戰鬥金幣：[最少, 最多]
  var GOLD = { battle: [20, 28], elite: [38, 46], boss: [75, 75], treasure: [35, 35] };

  // ---------------- 遭遇 ----------------
  // 一般戰鬥：每個扇形區各抽一組 pack；菁英：放進隨機一區，其他區抽 pack；Boss：隨機一區的外圈＋每區一隻小兵
  var ACTS = [
    { name: N("第一幕・亡者墓地", "第一幕・亡者の墓地", "Act I — Graveyard"),
      packs: [["skel"], ["skel", "archer"], ["ghoul"], ["bats", "archer"], ["slime"], ["cultist"], ["skel", "bats"]],
      elites: ["knight", "witch"], boss: "giant", minion: "skel" },
    { name: N("第二幕・熔岩地獄", "第二幕・溶岩地獄", "Act II — Inferno"),
      packs: [["imp", "hound"], ["guard"], ["succubus", "imp"], ["salamander"], ["hound", "hound"], ["guard", "imp"]],
      elites: ["brute", "warlock"], boss: "lord", minion: "imp" },
    { name: N("第三幕・審判之庭", "第三幕・審判の庭", "Act III — Court of Judgement"),
      packs: [["lineman", "hooligan"], ["shade", "hooligan"], ["golem"], ["shade", "lineman"], ["golem", "lineman"]],
      elites: ["var", "captain"], boss: "referee", minion: "hooligan" }
  ];

  // 每幕的樓層：0 固定戰鬥，1～2 二選一，3 營火，4 Boss
  var FLOORS = ["battle", "choice", "choice", "rest", "boss"];
  var NODE_WEIGHTS = { battle: 4, elite: 2, rest: 1, treasure: 1.2, shop: 1.5 };

  function index(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }

  window.PriTestYellowData = {
    CLASSES: HEROES, CLASS: index(HEROES),
    CARDS: CARDS, CARD: index(CARDS),
    ENEMIES: ENEMIES, ENEMY: index(ENEMIES),
    RELICS: RELICS, RELIC: index(RELICS), SHOP: SHOP, GOLD: GOLD,
    ACTS: ACTS, FLOORS: FLOORS, NODE_WEIGHTS: NODE_WEIGHTS,
    HAND_SIZE: 5, MANA: 3, RED_CARD_DMG: 12, MAX_SEATS: 4, MAX_SPIRITS: 8, MAX_MELODY: 10
  };
})();
