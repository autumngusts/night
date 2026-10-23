// 黃牌 Yellow Card：遊戲資料（英雄、卡牌、敵人、遭遇）。規則在 yellow_core.js，畫面在 yellow.js。
// 參考 Hellcard：英雄站在圓形戰場中心面向外，戰場依人數切成等分的扇形區，分內圈（近距離）與外圈（遠距離）。
// 敵人站在誰的扇形區就攻擊誰；英雄可以攻擊任何扇形區的敵人，只受內外圈射程限制。（使用者指定 2026-10-22）
//
// 英雄固定 8 位（開局選定後整局不換），各有起始牌組（8 張）與三條成長方向（path，每條 5 張獎勵卡）。
// 卡牌效果 fx 是結構化的 op 清單，說明文字由 yellow.js 依 op 自動產生（zh / ja / en），這裡只寫名稱的三語。
//   rng（射程）：near＝只能打內圈；far＝只能打外圈；any＝內外圈都可以
//   near / far：打到內圈或外圈的目標時「另外」套用的效果（近遠效果不同的卡），先於共通 fx 執行
//   tgt（目標）：enemy／ally（任一存活英雄含自己）／down（倒下的英雄）／self／none／area
//   範圍 op（dmgAll / stAll / pushAll…）用 r 指定內圈、外圈或全部（全範圍：拖到戰場上即可，不看位置）
//   tgt:"area"＝指定範圍卡（使用者指定 2026-10-22）：把範圍圈放在戰場上，ar（AREA_R 的 s/m/l）是圈的半徑，
//     dmgAll / stAll 等範圍 op 改成只作用在「判定圓與範圍圈重疊、而且在射程 rng 內」的敵人
(function () {
  "use strict";

  function N(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // ---------------- 英雄 ----------------
  // passive：開戰時放進 h.pw 的能力（spiritStart 是開戰時的精靈數）
  var HEROES = [
    { id: "paladin", name: N("聖戰士", "聖騎士", "Paladin"), icon: "🛡️", hp: 80, color: "#d9a21b",
      desc: N("堅固的前線。替隊友擋傷害、以聖光治療，也能把護盾化為審判。", "堅牢な前衛。仲間を庇い、聖光で癒し、盾を裁きに変える。", "A sturdy frontliner who shields allies, heals with holy light and turns block into judgement."),
      passive: { p: "plate", n: 3 }, perk: 2,
      paths: [{ id: "guard", name: N("守護", "守護", "Guardian") }, { id: "light", name: N("聖光", "聖光", "Radiance") }, { id: "judge", name: N("審判", "審判", "Judgement") }],
      start: ["pal_strike", "pal_strike", "pal_hook", "pal_defend", "pal_defend", "pal_defend", "pal_smite", "pal_taunt"] },
    { id: "berserker", name: N("狂戰士", "狂戦士", "Berserker"), icon: "🪓", hp: 90, color: "#c8402f",
      desc: N("以血換力。生命越低越危險，擅長近距離範圍攻擊與斬殺。", "血を力に変える。生命が減るほど危険で、近距離の範囲攻撃と処刑が得意。", "Trades blood for power: deadlier when hurt, great at close-range sweeps and executions."),
      passive: { p: "frenzy", n: 3 }, perk: 2,
      paths: [{ id: "blood", name: N("怒血", "怒血", "Bloodrage") }, { id: "whirl", name: N("旋風", "旋風", "Whirlwind") }, { id: "exec", name: N("處決", "処刑", "Execution") }],
      start: ["ber_chop", "ber_chop", "ber_chop", "ber_axe", "ber_block", "ber_block", "ber_roar", "ber_charge"] },
    { id: "ranger", name: N("遊俠", "レンジャー", "Ranger"), icon: "🏹", hp: 70, color: "#3c9a5a",
      desc: N("外圈的獵人。遠距離狙擊、設陷阱、擊退靠近的敵人。", "外周の狩人。遠距離狙撃、罠、近づいた敵の押し返し。", "Hunter of the outer ring: long shots, traps, and kicking back anything that gets close."),
      passive: { p: "far", n: 1 }, perk: 1,
      paths: [{ id: "snipe", name: N("狙擊", "狙撃", "Sniper") }, { id: "trap", name: N("陷阱", "罠", "Trapper") }, { id: "volley", name: N("連射", "連射", "Volley") }],
      start: ["ran_shot", "ran_shot", "ran_shot", "ran_dodge", "ran_dodge", "ran_dodge", "ran_kick", "ran_pierce"] },
    { id: "mage", name: N("法師", "魔術師", "Mage"), icon: "🔮", hp: 60, color: "#4a6fd0",
      desc: N("內外圈都打得到的法術。火焰燃燒、冰霜控場、奧術爆發。", "内外どちらにも届く魔法。炎の燃焼、氷の制圧、秘術の爆発。", "Spells that reach either ring: burning fire, controlling frost, explosive arcana."),
      passive: { p: "burnPlus", n: 1 }, perk: 1,
      paths: [{ id: "fire", name: N("火焰", "火炎", "Fire") }, { id: "frost", name: N("冰霜", "氷霜", "Frost") }, { id: "arcane", name: N("奧術", "秘術", "Arcane") }],
      start: ["mag_bolt", "mag_bolt", "mag_bolt", "mag_barrier", "mag_barrier", "mag_barrier", "mag_fireball", "mag_frost"] },
    { id: "priest", name: N("祭司", "司祭", "Priest"), icon: "✨", hp: 70, color: "#3aa8b5",
      desc: N("隊伍的支柱。治療、替隊友加護盾與力量，也能降下神罰。", "隊の支柱。回復、仲間への防御と筋力付与、そして神罰。", "The party's anchor: heals, shields and empowers allies, and calls down divine wrath."),
      passive: { p: "healAll", n: 1 }, perk: 1,
      paths: [{ id: "heal", name: N("治療", "治癒", "Healing") }, { id: "ward", name: N("庇護", "加護", "Warding") }, { id: "wrath", name: N("神罰", "神罰", "Wrath") }],
      start: ["pri_smite", "pri_smite", "pri_smite", "pri_bless", "pri_bless", "pri_bless", "pri_heal", "pri_holy"] },
    { id: "witch", name: N("女巫", "魔女", "Witch"), icon: "🧹", hp: 62, color: "#8a45b5",
      desc: N("慢慢折磨敵人。劇毒、削弱敵人的詛咒，以及以血換命的血祭。", "じわじわ蝕む。猛毒、弱体の呪い、血を代償にした血祭。", "Wears enemies down with poison, crippling hexes and blood magic."),
      passive: { p: "poisonPlus", n: 1 }, perk: 1,
      paths: [{ id: "venom", name: N("劇毒", "猛毒", "Venom") }, { id: "hex", name: N("詛咒", "呪詛", "Hex") }, { id: "blood", name: N("血祭", "血祭", "Blood Rite") }],
      start: ["wit_curse", "wit_curse", "wit_curse", "wit_mist", "wit_mist", "wit_mist", "wit_poison", "wit_wither"] },
    { id: "summoner", name: N("召喚師", "召喚士", "Summoner"), icon: "🦉", hp: 64, color: "#a8683a",
      desc: N("帶著精靈作戰。精靈在回合結束時各自攻擊；可以增加數量、強化，或獻祭換取爆發。", "精霊と戦う。精霊はターン終了時にそれぞれ攻撃。数を増やす、強化する、生贄にして爆発させる。", "Fights alongside spirits that each strike at end of turn — grow the swarm, empower it, or sacrifice it."),
      passive: { p: "spiritStart", n: 2 }, perk: 1,
      paths: [{ id: "swarm", name: N("群聚", "群れ", "Swarm") }, { id: "empower", name: N("強化", "強化", "Empower") }, { id: "sacrifice", name: N("獻祭", "生贄", "Sacrifice") }],
      start: ["sum_call", "sum_call", "sum_staff", "sum_staff", "sum_staff", "sum_charm", "sum_charm", "sum_burst"] },
    { id: "bard", name: N("吟遊詩人", "吟遊詩人", "Bard"), icon: "🎻", hp: 66, color: "#d4609a",
      desc: N("累積旋律，再用終曲一口氣轉成全隊的力量、治療或音爆。", "旋律を溜め、終曲で一気に仲間の筋力・回復・音撃へ変える。", "Builds Melody, then spends it all in a finale for party-wide strength, healing or a sonic blast."),
      passive: { p: "melTurn", n: 2 }, perk: 1,
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
    card("pal_hook", "paladin", null, "basic", "atk", 1, "enemy", "far", [{ o: "pull" }, { o: "toMe" }, dmg(4)], N("聖光鎖鏈", "聖光の鎖", "Chain of Light")),
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
    card("ber_charge", "berserker", null, "basic", "atk", 1, "enemy", "any", [{ o: "toMe" }], N("衝撞", "突進", "Charge"), { near: [dmg(8)], far: [{ o: "pull" }, dmg(4)] }),
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
    card("ber_leap", "berserker", "whirl", "uncommon", "atk", 1, "area", "near", [{ o: "dmgAll", n: 8, r: "near" }], N("躍斬", "跳躍斬り", "Leaping Cleave"), { ar: "m" }),
    card("ber_cleave", "berserker", "exec", "common", "atk", 2, "enemy", "near", [dmg(15)], N("重劈", "重撃", "Cleave")),
    card("ber_sunder", "berserker", "exec", "common", "atk", 1, "enemy", "near", [dmg(6), st("vuln", 2)], N("破甲", "鎧砕き", "Sunder")),
    card("ber_behead", "berserker", "exec", "uncommon", "atk", 2, "enemy", "near", [{ o: "dmgExec", n: 12 }], N("斬首", "断頭", "Behead")),
    card("ber_hunt", "berserker", "exec", "uncommon", "atk", 1, "enemy", "any", [], N("追擊", "追撃", "Run Down"), { near: [dmg(10)], far: [{ o: "pull" }, dmg(7)] }),
    card("ber_slaughter", "berserker", "exec", "rare", "atk", 2, "enemy", "near", [dmg(6, 3)], N("屠戮", "殺戮", "Slaughter")),

    // ===== 遊俠 =====
    card("ran_shot", "ranger", null, "basic", "atk", 1, "enemy", "any", [], N("射擊", "射撃", "Shot"), { near: [dmg(3)], far: [dmg(7)] }),
    card("ran_dodge", "ranger", null, "basic", "skl", 1, "self", null, [blk(5)], N("閃避", "回避", "Dodge")),
    card("ran_kick", "ranger", null, "basic", "atk", 0, "enemy", "near", [dmg(3), { o: "push" }, { o: "shove" }], N("踢退", "蹴り飛ばし", "Kick")),
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
    card("ran_blast", "ranger", "volley", "common", "atk", 1, "area", "far", [{ o: "dmgAll", n: 7, r: "far" }], N("爆裂箭", "炸裂矢", "Blast Arrow"), { ar: "s" }),

    // ===== 法師 =====
    card("mag_bolt", "mage", null, "basic", "atk", 1, "enemy", "any", [dmg(5)], N("魔彈", "魔弾", "Magic Bolt")),
    card("mag_barrier", "mage", null, "basic", "skl", 1, "self", null, [blk(5)], N("屏障", "障壁", "Barrier")),
    card("mag_fireball", "mage", null, "basic", "atk", 2, "enemy", "any", [dmg(8), st("burn", 3)], N("火球", "火球", "Fireball")),
    card("mag_frost", "mage", null, "basic", "atk", 1, "enemy", "any", [dmg(4), st("weak", 2)], N("冰錐", "氷柱", "Frost Spike")),
    card("mag_ignite", "mage", "fire", "common", "skl", 1, "enemy", "any", [st("burn", 6)], N("點燃", "着火", "Ignite")),
    card("mag_flame", "mage", "fire", "common", "atk", 1, "none", "near", [{ o: "dmgAll", n: 3, r: "near" }, { o: "stAll", s: "burn", n: 3, r: "near" }], N("火焰噴射", "火炎放射", "Flamethrower")),
    card("mag_firestorm", "mage", "fire", "uncommon", "skl", 2, "none", "any", [{ o: "stAll", s: "burn", n: 5, r: "any" }], N("烈焰風暴", "炎の嵐", "Firestorm")),
    card("mag_firebomb", "mage", "fire", "uncommon", "atk", 2, "area", "any", [{ o: "dmgAll", n: 9, r: "any" }, { o: "stAll", s: "burn", n: 2, r: "any" }], N("火焰炸彈", "火炎爆弾", "Fire Bomb"), { ar: "m" }),
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
    card("mag_gravity", "mage", "arcane", "uncommon", "skl", 1, "enemy", "any", [], N("引力反轉", "引力反転", "Gravity Flip"), { near: [{ o: "gather" }, { o: "push" }, st("weak", 2)], far: [{ o: "gather" }, { o: "pull" }, st("vuln", 2)] }),
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
    card("pri_chain", "priest", "wrath", "common", "atk", 1, "enemy", "far", [{ o: "pull" }, { o: "toMe" }, dmg(5)], N("光之鎖鏈", "光の鎖", "Chain of Light")),
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
    card("wit_flask", "witch", "venom", "common", "skl", 1, "area", "any", [{ o: "stAll", s: "poison", n: 4, r: "any" }], N("毒瓶", "毒瓶", "Poison Flask"), { ar: "m" }),
    card("wit_envenom", "witch", "venom", "common", "skl", 1, "enemy", "any", [st("poison", 6)], N("淬毒", "毒塗り", "Envenom")),
    card("wit_catalyst", "witch", "venom", "uncommon", "skl", 1, "enemy", "any", [{ o: "poisonX", n: 2 }], N("毒素催化", "毒の触媒", "Catalyst"), { exhaust: true, up: { exhaust: false } }),
    card("wit_bog", "witch", "venom", "uncommon", "skl", 1, "none", "near", [blk(5), { o: "stAll", s: "poison", n: 3, r: "near" }], N("瘴氣沼澤", "瘴気の沼", "Fetid Bog")),
    card("wit_plague", "witch", "venom", "rare", "pow", 2, "self", null, [{ o: "pow", p: "poisonAll", n: 2 }], N("瘟疫", "疫病", "Plague")),
    card("wit_weaken", "witch", "hex", "common", "skl", 1, "none", "any", [{ o: "stAll", s: "weak", n: 1, r: "any" }, { o: "stAll", s: "vuln", n: 1, r: "any" }], N("衰弱詛咒", "衰弱の呪い", "Enfeeble")),
    card("wit_flaw", "witch", "hex", "common", "skl", 1, "enemy", "any", [st("vuln", 3)], N("破綻", "綻び", "Expose")),
    card("wit_dread", "witch", "hex", "uncommon", "skl", 1, "enemy", "any", [{ o: "shove" }], N("恐懼", "恐怖", "Dread"), { near: [{ o: "push" }, st("weak", 2)], far: [st("weak", 3)] }),
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
    // 苦痛等級 4：起始牌組多一張（無法打出、不會自己消失；可以在賢者／商店刪掉）
    card("t_regret", "token", null, "token", "curse", 0, "none", null, [], N("悔恨", "悔恨", "Regret"), { unplayable: true }),
    // 地獄裁判的黃牌：手上同時有 2 張就變紅牌（結束回合時受 RED_CARD_DMG 傷害）；花 1 魔力打出可以申訴移除
    card("t_yellow", "token", null, "token", "curse", 1, "self", null, [{ o: "appeal" }], N("黃牌", "イエローカード", "Yellow Card"), { exhaust: true })
  ];

  // ---------------- 擴充卡牌（2026-10-22 使用者指定：每條成長方向約普通 3／進階 5／高階 4） ----------------
  // 只用既有的 op（說明文字由 yellow.js 依 op 自動產生）；指定範圍卡（tgt:"area"）的 ar 見 AREA_R
  var CARDS_EXTRA = [
    // ===== 聖戰士・守護 =====
    card("pal_brace", "paladin", "guard", "common", "skl", 1, "self", null, [blk(7), { o: "draw", n: 1 }], N("穩固架勢", "構え直し", "Brace")),
    card("pal_aegis", "paladin", "guard", "uncommon", "skl", 2, "none", null, [{ o: "blkAll", n: 6 }], N("鐵壁庇護", "鉄壁の加護", "Iron Aegis")),
    card("pal_riposte", "paladin", "guard", "uncommon", "pow", 1, "self", null, [{ o: "pow", p: "thorns", n: 3 }], N("反擊架勢", "反撃の構え", "Riposte Stance")),
    card("pal_charge", "paladin", "guard", "uncommon", "atk", 2, "enemy", "near", [blk(8), dmg(8)], N("盾衝", "盾突進", "Shield Charge")),
    card("pal_unbreak", "paladin", "guard", "rare", "skl", 2, "self", null, [blk(20), { o: "taunt" }], N("絕對防禦", "絶対防御", "Unbreakable"), { exhaust: true, up: { exhaust: false } }),
    card("pal_fortress", "paladin", "guard", "rare", "pow", 3, "self", null, [{ o: "pow", p: "plate", n: 6 }], N("要塞化身", "要塞の化身", "Living Fortress")),
    card("pal_retort", "paladin", "guard", "rare", "atk", 2, "enemy", "any", [{ o: "dmgBlock", n: 1 }, st("weak", 2)], N("聖盾審判", "聖盾の裁き", "Shield of Judgement")),
    // ===== 聖戰士・聖光 =====
    card("pal_glimmer", "paladin", "light", "common", "skl", 1, "none", null, [{ o: "healAll", n: 3 }], N("微光", "微光", "Glimmer")),
    card("pal_sunburst", "paladin", "light", "uncommon", "atk", 2, "area", "any", [{ o: "dmgAll", n: 8, r: "any" }, { o: "healAll", n: 2 }], N("聖光審判", "聖光の裁き", "Sunburst"), { ar: "m" }),
    card("pal_blessing", "paladin", "light", "uncommon", "skl", 1, "ally", null, [{ o: "blkAlly", n: 6 }, { o: "heal", n: 4 }], N("聖光加護", "聖光の加護", "Blessing of Light")),
    card("pal_devotion", "paladin", "light", "uncommon", "pow", 2, "self", null, [{ o: "pow", p: "healAll", n: 1 }], N("虔誠光環", "敬虔の光輪", "Devotion Aura")),
    card("pal_avatar", "paladin", "light", "rare", "pow", 2, "self", null, [{ o: "pow", p: "plate", n: 3 }, { o: "pow", p: "healAll", n: 1 }], N("光之化身", "光の化身", "Avatar of Light")),
    card("pal_grace", "paladin", "light", "rare", "skl", 2, "none", null, [{ o: "healAll", n: 8 }, { o: "cleanseAll" }], N("聖光普照", "聖光遍照", "Radiant Grace"), { exhaust: true }),
    card("pal_crusade", "paladin", "light", "rare", "skl", 1, "none", null, [{ o: "strAll", n: 2 }], N("十字軍", "十字軍", "Crusade"), { exhaust: true }),
    // ===== 聖戰士・審判 =====
    card("pal_scold", "paladin", "judge", "common", "atk", 1, "enemy", "any", [], N("斥責", "叱責", "Rebuke"), { near: [dmg(9)], far: [dmg(6)] }),
    card("pal_binding", "paladin", "judge", "uncommon", "atk", 2, "enemy", "far", [{ o: "pull" }, dmg(10), st("vuln", 1)], N("裁決之鏈", "裁きの鎖", "Binding Verdict")),
    card("pal_sentence", "paladin", "judge", "uncommon", "skl", 1, "enemy", "any", [st("vuln", 3), st("weak", 1)], N("宣判", "宣告", "Sentence")),
    card("pal_sanction", "paladin", "judge", "uncommon", "atk", 2, "enemy", "near", [{ o: "dmgExec", n: 10 }], N("制裁", "制裁", "Sanction")),
    card("pal_wrath", "paladin", "judge", "rare", "atk", 3, "enemy", "near", [dmg(26), st("weak", 2)], N("神怒之錘", "神怒の鎚", "Wrath Hammer")),
    card("pal_zeal", "paladin", "judge", "rare", "pow", 2, "self", null, [{ o: "pow", p: "near", n: 3 }], N("狂熱信念", "狂信", "Zeal")),
    card("pal_tribunal", "paladin", "judge", "rare", "atk", 2, "enemy", "any", [{ o: "dmgSec", n: 12 }], N("審判庭", "審判廷", "Tribunal")),

    // ===== 狂戰士・怒血 =====
    card("ber_bleed", "berserker", "blood", "common", "skl", 0, "self", null, [{ o: "lose", n: 2 }, { o: "draw", n: 2 }], N("放血", "瀉血", "Bloodletting")),
    card("ber_reckless", "berserker", "blood", "uncommon", "atk", 1, "enemy", "near", [{ o: "lose", n: 3 }, dmg(14)], N("捨身一擊", "捨て身", "Reckless Blow")),
    card("ber_bloodlust", "berserker", "blood", "uncommon", "atk", 1, "enemy", "near", [{ o: "lifesteal", n: 7 }], N("嗜血", "血への渇望", "Bloodlust")),
    card("ber_seethe", "berserker", "blood", "uncommon", "skl", 1, "self", null, [{ o: "lose", n: 5 }, { o: "str", n: 3 }], N("怒火中燒", "怒髪天", "Seething")),
    card("ber_berserk", "berserker", "blood", "rare", "pow", 1, "self", null, [{ o: "pow", p: "frenzy", n: 4 }], N("狂暴化", "狂暴化", "Berserk")),
    card("ber_deathwish", "berserker", "blood", "rare", "atk", 2, "enemy", "near", [{ o: "dmgMissing", n: 10, k: 2 }], N("以命相搏", "命懸け", "Death Wish")),
    card("ber_bloodbath", "berserker", "blood", "rare", "skl", 1, "self", null, [{ o: "lose", n: 6 }, { o: "mana", n: 2 }, { o: "str", n: 2 }], N("血浴", "血浴", "Bloodbath"), { exhaust: true }),
    // ===== 狂戰士・旋風 =====
    card("ber_spin", "berserker", "whirl", "common", "atk", 1, "none", "near", [{ o: "dmgAll", n: 4, r: "near" }, blk(3)], N("迴旋斬", "回転斬り", "Spin")),
    card("ber_quake", "berserker", "whirl", "uncommon", "atk", 2, "none", "near", [{ o: "dmgAll", n: 7, r: "near" }, { o: "stAll", s: "weak", n: 1, r: "near" }], N("震地", "地震", "Earthshaker")),
    card("ber_dash", "berserker", "whirl", "uncommon", "atk", 1, "area", "near", [{ o: "dmgAll", n: 11, r: "near" }], N("迴旋突進", "旋回突撃", "Whirling Dash"), { ar: "s" }),
    card("ber_bladestorm", "berserker", "whirl", "rare", "atk", 3, "none", "near", [{ o: "dmgAll", n: 6, h: 3, r: "near" }], N("劍刃風暴", "剣刃の嵐", "Bladestorm")),
    card("ber_tornado", "berserker", "whirl", "rare", "atk", 2, "none", "any", [{ o: "dmgAll", n: 8, r: "any" }, { o: "pushAll" }], N("龍捲", "竜巻", "Tornado")),
    card("ber_warlord", "berserker", "whirl", "rare", "pow", 2, "self", null, [{ o: "pow", p: "near", n: 2 }, { o: "pow", p: "plate", n: 2 }], N("戰場主宰", "戦場の覇者", "Warlord")),
    // ===== 狂戰士・處決 =====
    card("ber_hack", "berserker", "exec", "common", "atk", 1, "enemy", "near", [dmg(5, 2)], N("猛砍", "乱撃", "Hack")),
    card("ber_mark", "berserker", "exec", "uncommon", "skl", 1, "enemy", "any", [st("vuln", 3)], N("死亡標記", "死の刻印", "Death Mark")),
    card("ber_crush", "berserker", "exec", "uncommon", "atk", 2, "enemy", "near", [dmg(18)], N("粉碎", "粉砕", "Crush")),
    card("ber_guillotine", "berserker", "exec", "uncommon", "atk", 1, "enemy", "near", [{ o: "dmgExec", n: 8 }], N("斷頭台", "断頭台", "Guillotine")),
    card("ber_headsman", "berserker", "exec", "rare", "atk", 3, "enemy", "any", [{ o: "dmgExec", n: 22 }], N("處刑人", "処刑人", "Executioner"), { exhaust: true, up: { exhaust: false } }),
    card("ber_deathblow", "berserker", "exec", "rare", "atk", 2, "enemy", "near", [dmg(12), st("vuln", 2), st("weak", 2)], N("絕命斬", "絶命斬", "Deathblow")),
    card("ber_reaper", "berserker", "exec", "rare", "pow", 2, "self", null, [{ o: "pow", p: "frenzy", n: 3 }, { o: "pow", p: "leech", n: 2 }], N("收割者", "刈り取る者", "Reaper")),

    // ===== 遊俠・狙擊 =====
    card("ran_steady", "ranger", "snipe", "common", "atk", 1, "enemy", "far", [dmg(8), blk(3)], N("穩定射擊", "安定射撃", "Steady Shot")),
    card("ran_headshot", "ranger", "snipe", "uncommon", "atk", 2, "enemy", "far", [{ o: "dmgExec", n: 13 }], N("爆頭", "ヘッドショット", "Headshot")),
    card("ran_mark", "ranger", "snipe", "uncommon", "skl", 0, "enemy", "any", [st("vuln", 2)], N("獵人印記", "狩人の印", "Hunter's Mark"), { exhaust: true }),
    card("ran_power", "ranger", "snipe", "uncommon", "atk", 2, "enemy", "any", [], N("強弓", "剛弓", "Power Shot"), { near: [dmg(8)], far: [dmg(17)] }),
    card("ran_ballista", "ranger", "snipe", "rare", "atk", 3, "enemy", "far", [dmg(34)], N("破城弩", "破城弩", "Ballista")),
    card("ran_falcon", "ranger", "snipe", "rare", "pow", 2, "self", null, [{ o: "pow", p: "far", n: 2 }, { o: "draw", n: 2 }], N("獵鷹之眼", "鷹匠の目", "Falconer's Eye")),
    card("ran_assassin", "ranger", "snipe", "rare", "atk", 1, "enemy", "far", [dmg(9), st("vuln", 3), { o: "draw", n: 1 }], N("暗殺箭", "暗殺の矢", "Assassin's Arrow")),
    // ===== 遊俠・陷阱 =====
    card("ran_caltrops", "ranger", "trap", "common", "skl", 1, "self", null, [{ o: "trap", n: 3 }, { o: "draw", n: 1 }], N("鐵蒺藜", "撒き菱", "Caltrops")),
    card("ran_net", "ranger", "trap", "uncommon", "atk", 1, "enemy", "near", [dmg(4), { o: "push" }, st("weak", 1)], N("網箭", "網矢", "Net Arrow")),
    card("ran_pit", "ranger", "trap", "uncommon", "skl", 1, "self", null, [{ o: "trap", n: 6 }], N("陷坑", "落とし穴", "Pitfall")),
    card("ran_bait", "ranger", "trap", "uncommon", "skl", 1, "enemy", "far", [{ o: "pull" }, st("vuln", 2)], N("誘餌", "囮", "Bait")),
    card("ran_chainmines", "ranger", "trap", "rare", "skl", 2, "self", null, [{ o: "trap", n: 10 }, blk(6)], N("連環地雷", "連鎖地雷", "Chain Mines")),
    card("ran_trapmaster", "ranger", "trap", "rare", "pow", 2, "self", null, [{ o: "pow", p: "thorns", n: 3 }, { o: "trap", n: 5 }], N("陷阱大師", "罠の名手", "Trapmaster")),
    card("ran_gale", "ranger", "trap", "rare", "atk", 0, "none", "near", [{ o: "dmgAll", n: 5, r: "near" }, { o: "pushAll" }, { o: "draw", n: 1 }], N("疾風踢擊", "疾風蹴り", "Gale Kick")),
    // ===== 遊俠・連射 =====
    card("ran_barrage", "ranger", "volley", "uncommon", "atk", 2, "enemy", "any", [], N("彈幕", "弾幕", "Barrage"), { near: [dmg(3, 3)], far: [dmg(4, 4)] }),
    card("ran_scatter", "ranger", "volley", "uncommon", "atk", 1, "area", "far", [{ o: "dmgAll", n: 5, r: "far" }], N("散射", "散射", "Scattershot"), { ar: "m" }),
    card("ran_reload", "ranger", "volley", "uncommon", "skl", 0, "self", null, [{ o: "draw", n: 2 }], N("快速裝填", "速装填", "Quick Reload"), { exhaust: true }),
    card("ran_storm", "ranger", "volley", "rare", "atk", 2, "none", "any", [{ o: "dmgAll", n: 4, h: 2, r: "any" }], N("箭之風暴", "矢の嵐", "Arrow Storm")),
    card("ran_focus", "ranger", "volley", "rare", "pow", 1, "self", null, [{ o: "pow", p: "mana", n: 1 }], N("專注", "集中", "Focus")),
    card("ran_rapid", "ranger", "volley", "rare", "atk", 1, "enemy", "any", [dmg(3, 4)], N("疾射", "速射", "Rapid Fire")),

    // ===== 法師・火焰 =====
    card("mag_spark", "mage", "fire", "common", "atk", 0, "enemy", "any", [dmg(3), st("burn", 2)], N("火花", "火花", "Spark")),
    card("mag_inferno", "mage", "fire", "uncommon", "atk", 2, "none", "any", [{ o: "dmgAll", n: 5, r: "any" }, { o: "stAll", s: "burn", n: 3, r: "any" }], N("煉獄", "煉獄", "Inferno")),
    card("mag_flashfire", "mage", "fire", "uncommon", "atk", 1, "enemy", "any", [st("burn", 4), { o: "detonate", n: 2 }], N("爆燃", "爆燃", "Flashfire")),
    card("mag_phoenix", "mage", "fire", "rare", "atk", 3, "area", "any", [{ o: "dmgAll", n: 14, r: "any" }, { o: "stAll", s: "burn", n: 4, r: "any" }], N("鳳凰", "不死鳥", "Phoenix"), { ar: "l" }),
    card("mag_flameheart", "mage", "fire", "rare", "pow", 1, "self", null, [{ o: "pow", p: "burnPlus", n: 2 }], N("烈焰之心", "炎の心", "Heart of Flame")),
    card("mag_hellfire", "mage", "fire", "rare", "atk", 2, "enemy", "any", [st("burn", 10), { o: "detonate", n: 2 }], N("地獄火", "獄炎", "Hellfire"), { exhaust: true }),
    // ===== 法師・冰霜 =====
    card("mag_chill", "mage", "frost", "common", "atk", 1, "enemy", "any", [dmg(6), st("weak", 1)], N("寒氣", "冷気", "Chill")),
    card("mag_nova", "mage", "frost", "uncommon", "skl", 1, "none", "near", [{ o: "stAll", s: "weak", n: 2, r: "near" }, { o: "pushAll" }], N("冰霜新星", "霜の新星", "Frost Nova")),
    card("mag_glacier", "mage", "frost", "uncommon", "skl", 2, "self", null, [blk(15)], N("冰川", "氷河", "Glacier")),
    card("mag_shatter", "mage", "frost", "uncommon", "atk", 1, "enemy", "any", [dmg(7), st("stun", 1)], N("碎冰", "砕氷", "Shatter"), { exhaust: true }),
    card("mag_winter", "mage", "frost", "rare", "pow", 2, "self", null, [{ o: "pow", p: "plate", n: 4 }, { o: "pow", p: "thorns", n: 2 }], N("永冬", "永冬", "Endless Winter")),
    card("mag_icestorm", "mage", "frost", "rare", "atk", 2, "area", "any", [{ o: "dmgAll", n: 8, r: "any" }, { o: "stAll", s: "stun", n: 1, r: "any" }], N("冰風暴", "氷嵐", "Ice Storm"), { ar: "m", exhaust: true }),
    card("mag_comet", "mage", "frost", "rare", "atk", 3, "enemy", "any", [dmg(22), st("weak", 3)], N("寒冰彗星", "氷彗星", "Ice Comet")),
    // ===== 法師・奧術 =====
    card("mag_missiles", "mage", "arcane", "common", "atk", 1, "enemy", "any", [dmg(3, 3)], N("奧術飛彈", "秘術弾", "Arcane Missiles")),
    card("mag_meditate", "mage", "arcane", "uncommon", "skl", 1, "self", null, [{ o: "draw", n: 3 }], N("冥想", "瞑想", "Meditate")),
    card("mag_blink", "mage", "arcane", "uncommon", "skl", 0, "self", null, [blk(4), { o: "draw", n: 1 }], N("閃現", "瞬間移動", "Blink")),
    card("mag_overload", "mage", "arcane", "uncommon", "atk", 2, "enemy", "any", [dmg(16)], N("超載", "過負荷", "Overload")),
    card("mag_archmage", "mage", "arcane", "rare", "pow", 2, "self", null, [{ o: "pow", p: "mana", n: 1 }, { o: "draw", n: 1 }], N("大法師", "大魔導", "Archmage")),
    card("mag_singularity", "mage", "arcane", "rare", "atk", 3, "area", "any", [{ o: "dmgAll", n: 12, r: "any" }], N("奇點", "特異点", "Singularity"), { ar: "l" }),
    card("mag_timewarp", "mage", "arcane", "rare", "skl", 2, "self", null, [{ o: "mana", n: 3 }, { o: "draw", n: 2 }], N("時間扭曲", "時間歪曲", "Time Warp"), { exhaust: true }),

    // ===== 祭司・治療 =====
    card("pri_mend", "priest", "heal", "common", "skl", 1, "ally", null, [{ o: "heal", n: 5 }, { o: "blkAlly", n: 3 }], N("癒合", "癒合", "Mend")),
    card("pri_wellspring", "priest", "heal", "uncommon", "skl", 2, "none", null, [{ o: "healAll", n: 5 }], N("生命之泉", "生命の泉", "Wellspring")),
    card("pri_grace", "priest", "heal", "uncommon", "skl", 1, "ally", null, [{ o: "regen", n: 3 }, { o: "cleanse" }], N("恩典", "恩寵", "Grace")),
    card("pri_vigil", "priest", "heal", "uncommon", "pow", 2, "self", null, [{ o: "pow", p: "healAll", n: 1 }], N("守夜", "不寝番", "Vigil")),
    card("pri_miracle", "priest", "heal", "rare", "skl", 3, "none", null, [{ o: "healAll", n: 12 }, { o: "cleanseAll" }], N("奇蹟", "奇跡", "Miracle"), { exhaust: true }),
    card("pri_angel", "priest", "heal", "rare", "pow", 3, "self", null, [{ o: "pow", p: "healAll", n: 2 }, { o: "pow", p: "plate", n: 3 }], N("天使降臨", "天使降臨", "Angelic Descent")),
    card("pri_lifebond", "priest", "heal", "rare", "skl", 1, "ally", null, [{ o: "heal", n: 10 }, { o: "regen", n: 3 }], N("生命連結", "生命の絆", "Lifebond"), { exhaust: true }),
    // ===== 祭司・庇護 =====
    card("pri_shield", "priest", "ward", "common", "skl", 1, "ally", null, [{ o: "blkAlly", n: 7 }, { o: "draw", n: 1 }], N("護盾術", "防護術", "Shield Spell")),
    card("pri_faith", "priest", "ward", "uncommon", "skl", 1, "ally", null, [{ o: "blkAlly", n: 6 }, { o: "strAlly", n: 1 }], N("堅定信仰", "堅き信仰", "Steadfast Faith")),
    card("pri_wall", "priest", "ward", "uncommon", "skl", 2, "none", null, [{ o: "blkAll", n: 6 }, { o: "draw", n: 1 }], N("光之壁", "光の壁", "Wall of Light")),
    card("pri_bulwark", "priest", "ward", "uncommon", "pow", 2, "self", null, [{ o: "pow", p: "plate", n: 4 }], N("神聖壁壘", "聖なる砦", "Holy Bulwark")),
    card("pri_divine", "priest", "ward", "rare", "skl", 2, "none", null, [{ o: "blkAll", n: 12 }], N("神之盾", "神の盾", "Divine Shield"), { exhaust: true }),
    card("pri_inspire", "priest", "ward", "rare", "skl", 2, "none", null, [{ o: "strAll", n: 2 }, { o: "blkAll", n: 4 }], N("鼓舞", "鼓舞", "Inspire"), { exhaust: true }),
    card("pri_martyr", "priest", "ward", "rare", "skl", 1, "ally", null, [{ o: "lose", n: 6 }, { o: "blkAlly", n: 20 }], N("殉道", "殉教", "Martyrdom")),
    // ===== 祭司・神罰 =====
    card("pri_spark", "priest", "wrath", "common", "atk", 1, "enemy", "any", [dmg(7)], N("聖光火花", "聖なる火花", "Holy Spark")),
    card("pri_pillar", "priest", "wrath", "uncommon", "atk", 2, "area", "any", [{ o: "dmgAll", n: 13, r: "any" }], N("光柱", "光柱", "Pillar of Light"), { ar: "s" }),
    card("pri_chastise", "priest", "wrath", "uncommon", "atk", 1, "enemy", "any", [dmg(6), st("vuln", 2)], N("懲戒", "懲戒", "Chastise")),
    card("pri_hymn", "priest", "wrath", "uncommon", "atk", 2, "none", "any", [{ o: "dmgAll", n: 5, r: "any" }, { o: "healAll", n: 2 }], N("憤怒讚美詩", "怒りの賛歌", "Wrathful Hymn")),
    card("pri_armageddon", "priest", "wrath", "rare", "atk", 3, "none", "any", [{ o: "dmgAll", n: 10, r: "any" }, { o: "stAll", s: "weak", n: 2, r: "any" }], N("末日審判", "終末の審判", "Armageddon"), { exhaust: true }),
    card("pri_zealot", "priest", "wrath", "rare", "pow", 2, "self", null, [{ o: "pow", p: "burnAll", n: 2 }], N("狂信者", "狂信者", "Zealot")),
    card("pri_purge", "priest", "wrath", "rare", "atk", 2, "enemy", "any", [dmg(12), st("burn", 5)], N("淨罪之火", "浄罪の炎", "Purging Fire")),

    // ===== 女巫・劇毒 =====
    card("wit_toxin", "witch", "venom", "uncommon", "skl", 1, "enemy", "any", [st("poison", 5), st("weak", 1)], N("神經毒", "神経毒", "Neurotoxin")),
    card("wit_contagion", "witch", "venom", "uncommon", "skl", 2, "none", "any", [{ o: "stAll", s: "poison", n: 4, r: "any" }], N("毒擴散", "毒の拡散", "Contagion")),
    card("wit_sting", "witch", "venom", "uncommon", "atk", 1, "enemy", "any", [dmg(4), st("poison", 3)], N("毒刺", "毒針", "Sting")),
    card("wit_virulence", "witch", "venom", "rare", "pow", 1, "self", null, [{ o: "pow", p: "poisonPlus", n: 2 }], N("猛毒精華", "猛毒の精髄", "Virulence")),
    card("wit_cauldron", "witch", "venom", "rare", "skl", 2, "area", "any", [{ o: "stAll", s: "poison", n: 8, r: "any" }], N("沸騰毒釜", "煮えたぎる毒釜", "Bubbling Cauldron"), { ar: "m" }),
    card("wit_necrosis", "witch", "venom", "rare", "skl", 1, "enemy", "any", [{ o: "poisonX", n: 3 }], N("壞死", "壊死", "Necrosis"), { exhaust: true }),
    // ===== 女巫・詛咒 =====
    card("wit_jinx", "witch", "hex", "common", "skl", 0, "enemy", "any", [st("weak", 1), st("vuln", 1)], N("厄咒", "不運の呪い", "Jinx")),
    card("wit_agony", "witch", "hex", "uncommon", "atk", 1, "enemy", "any", [{ o: "hexDmg", n: 5 }], N("痛苦詛咒", "苦悶の呪い", "Agony")),
    card("wit_malice", "witch", "hex", "uncommon", "skl", 1, "none", "any", [{ o: "stAll", s: "vuln", n: 2, r: "any" }], N("惡意", "悪意", "Malice")),
    card("wit_spite", "witch", "hex", "uncommon", "skl", 1, "area", "any", [{ o: "stAll", s: "weak", n: 2, r: "any" }, { o: "stAll", s: "vuln", n: 2, r: "any" }], N("咒怨之環", "呪怨の輪", "Ring of Spite"), { ar: "m" }),
    card("wit_hexblast", "witch", "hex", "rare", "atk", 2, "enemy", "any", [{ o: "hexDmg", n: 11 }], N("咒爆", "呪爆", "Hexblast")),
    card("wit_shroud", "witch", "hex", "rare", "pow", 2, "self", null, [{ o: "pow", p: "burnAll", n: 1 }, { o: "pow", p: "poisonAll", n: 1 }], N("厄運纏身", "厄の纏い", "Shroud of Misfortune")),
    card("wit_eclipse", "witch", "hex", "rare", "skl", 2, "none", "any", [{ o: "stAll", s: "weak", n: 3, r: "any" }, { o: "stAll", s: "vuln", n: 1, r: "any" }, { o: "stAll", s: "poison", n: 2, r: "any" }], N("日蝕", "日蝕", "Eclipse"), { exhaust: true }),
    // ===== 女巫・血祭 =====
    card("wit_price", "witch", "blood", "common", "skl", 0, "self", null, [{ o: "lose", n: 2 }, { o: "mana", n: 1 }], N("血之代價", "血の代償", "Blood Price")),
    card("wit_siphon", "witch", "blood", "uncommon", "atk", 1, "enemy", "any", [{ o: "lifesteal", n: 5 }, st("poison", 2)], N("虹吸", "吸い上げ", "Siphon")),
    card("wit_crimson", "witch", "blood", "uncommon", "skl", 1, "self", null, [{ o: "lose", n: 5 }, { o: "draw", n: 3 }], N("緋紅契約", "緋色の契約", "Crimson Pact")),
    card("wit_kiss", "witch", "blood", "uncommon", "atk", 2, "enemy", "near", [{ o: "lifesteal", n: 12 }], N("吸血鬼之吻", "吸血鬼の口づけ", "Vampiric Kiss")),
    card("wit_bloodrain", "witch", "blood", "rare", "atk", 2, "none", "any", [{ o: "lose", n: 5 }, { o: "dmgAll", n: 10, r: "any" }], N("血雨", "血の雨", "Blood Rain")),
    card("wit_feast", "witch", "blood", "rare", "pow", 2, "self", null, [{ o: "pow", p: "rage", n: 1 }, { o: "pow", p: "leech", n: 1 }], N("血之盛宴", "血の饗宴", "Sanguine Feast")),
    card("wit_heart", "witch", "blood", "rare", "skl", 1, "self", null, [{ o: "lose", n: 8 }, { o: "mana", n: 3 }, { o: "draw", n: 2 }], N("心臟獻祭", "心臓の生贄", "Heart Offering"), { exhaust: true }),

    // ===== 召喚師・群聚 =====
    card("sum_wisp", "summoner", "swarm", "common", "skl", 0, "self", null, [{ o: "summon", n: 1 }], N("小精靈", "小精霊", "Wisp")),
    card("sum_horde", "summoner", "swarm", "uncommon", "skl", 2, "self", null, [{ o: "summon", n: 3 }, { o: "blkSpirit", n: 1 }], N("大群", "大群", "Horde")),
    card("sum_guard", "summoner", "swarm", "uncommon", "skl", 1, "self", null, [{ o: "summon", n: 1 }, blk(8)], N("精靈守衛", "精霊の守り", "Spirit Guard")),
    card("sum_cloud", "summoner", "swarm", "uncommon", "atk", 1, "area", "any", [{ o: "dmgAll", n: 5, r: "any" }, { o: "summon", n: 1 }], N("精靈雲", "精霊の雲", "Spirit Cloud"), { ar: "m" }),
    card("sum_army", "summoner", "swarm", "rare", "skl", 3, "self", null, [{ o: "summon", n: 6 }], N("精靈大軍", "精霊軍団", "Spirit Army")),
    card("sum_nest", "summoner", "swarm", "rare", "pow", 2, "self", null, [{ o: "pow", p: "spiritTurn", n: 1 }, { o: "summon", n: 2 }], N("精靈之巢", "精霊の巣", "Spirit Nest")),
    card("sum_manyshield", "summoner", "swarm", "rare", "skl", 2, "self", null, [{ o: "blkSpirit", n: 5 }], N("萬靈之盾", "万霊の盾", "Aegis of Many")),
    // ===== 召喚師・強化 =====
    card("sum_command", "summoner", "empower", "common", "skl", 0, "self", null, [{ o: "spiritsAct", n: 1 }], N("號令", "号令", "Command"), { exhaust: true }),
    card("sum_resonance", "summoner", "empower", "uncommon", "atk", 2, "enemy", "any", [{ o: "dmgSpirit", n: 5 }], N("靈魂共鳴", "魂の共鳴", "Soul Resonance")),
    card("sum_nurture", "summoner", "empower", "uncommon", "skl", 1, "self", null, [{ o: "pow", p: "spirit", n: 1 }, { o: "summon", n: 1 }], N("餵養", "餌付け", "Nurture")),
    card("sum_rally", "summoner", "empower", "uncommon", "skl", 1, "self", null, [{ o: "spiritsAct", n: 1 }, blk(5)], N("精靈集結", "精霊集結", "Rally Spirits")),
    card("sum_alpha", "summoner", "empower", "rare", "pow", 2, "self", null, [{ o: "pow", p: "spirit", n: 2 }, { o: "pow", p: "spiritTurn", n: 1 }], N("精靈首領", "精霊の長", "Alpha Spirit")),
    card("sum_stampede", "summoner", "empower", "rare", "skl", 3, "self", null, [{ o: "spiritsAct", n: 3 }], N("萬靈奔騰", "万霊奔流", "Stampede"), { exhaust: true }),
    card("sum_avatar", "summoner", "empower", "rare", "atk", 2, "enemy", "any", [{ o: "dmgSpirit", n: 6 }], N("精靈化身", "精霊の化身", "Spirit Avatar")),
    // ===== 召喚師・獻祭 =====
    card("sum_offering", "summoner", "sacrifice", "common", "skl", 1, "self", null, [{ o: "sac", k: "blk", n: 4 }, { o: "summon", n: 2 }], N("供品", "供物", "Offering")),
    card("sum_detonate", "summoner", "sacrifice", "uncommon", "atk", 2, "enemy", "any", [{ o: "sac", k: "dmg", n: 10 }, { o: "summon", n: 1 }], N("精靈自爆", "精霊自爆", "Spirit Detonation")),
    card("sum_ritual", "summoner", "sacrifice", "uncommon", "skl", 1, "self", null, [{ o: "sac", k: "draw", n: 1 }, { o: "summon", n: 2 }], N("儀式", "儀式", "Ritual")),
    card("sum_soulfire", "summoner", "sacrifice", "uncommon", "atk", 1, "enemy", "any", [{ o: "sac", k: "dmg", n: 5 }, { o: "summon", n: 3 }], N("靈魂之火", "魂の炎", "Soulfire")),
    card("sum_apocalypse", "summoner", "sacrifice", "rare", "atk", 3, "none", "any", [{ o: "sac", k: "dmgAll", n: 10 }, { o: "summon", n: 3 }], N("靈魂天啟", "魂の黙示", "Soul Apocalypse"), { exhaust: true }),
    card("sum_rebirth", "summoner", "sacrifice", "rare", "pow", 2, "self", null, [{ o: "pow", p: "spiritTurn", n: 2 }], N("輪迴", "輪廻", "Reincarnation")),
    card("sum_lifetap", "summoner", "sacrifice", "rare", "skl", 1, "none", null, [{ o: "sac", k: "healAll", n: 5 }, { o: "summon", n: 2 }], N("生命虹吸", "命の吸い上げ", "Life Tap")),

    // ===== 吟遊詩人・戰歌 =====
    card("bar_wardrum", "bard", "war", "common", "skl", 1, "self", null, [{ o: "mel", n: 3 }], N("陣太鼓", "陣太鼓", "War Drum")),
    card("bar_rallycall", "bard", "war", "uncommon", "skl", 1, "none", null, [{ o: "strAll", n: 1 }, { o: "mel", n: 1 }], N("集結號", "集結の喇叭", "Rally Call"), { exhaust: true }),
    card("bar_valor", "bard", "war", "uncommon", "skl", 2, "none", null, [{ o: "blkAll", n: 5 }, { o: "mel", n: 3 }], N("勇氣進行曲", "勇気の行進", "March of Valor")),
    card("bar_fanfare", "bard", "war", "uncommon", "skl", 1, "self", null, [{ o: "mel", n: 2 }, { o: "mana", n: 1 }], N("號角", "ファンファーレ", "Fanfare")),
    card("bar_crescendo", "bard", "war", "rare", "pow", 2, "self", null, [{ o: "pow", p: "melTurn", n: 3 }], N("漸強", "クレッシェンド", "Crescendo")),
    card("bar_warsong", "bard", "war", "rare", "skl", 2, "none", null, [{ o: "finale", k: "strAll", n: 2, per: 3 }], N("戰神之歌", "軍神の歌", "Warsong")),
    card("bar_epic", "bard", "war", "rare", "skl", 2, "none", null, [{ o: "strAll", n: 2 }, { o: "blkAll", n: 5 }], N("英雄史詩", "英雄叙事詩", "Heroic Epic"), { exhaust: true }),
    // ===== 吟遊詩人・安魂 =====
    card("bar_hum", "bard", "requiem", "common", "skl", 1, "none", null, [{ o: "blkAll", n: 3 }, { o: "mel", n: 1 }], N("低吟", "口ずさみ", "Hum")),
    card("bar_elegy", "bard", "requiem", "uncommon", "skl", 1, "none", null, [{ o: "healAll", n: 3 }, { o: "mel", n: 2 }], N("輓歌", "哀歌", "Elegy")),
    card("bar_chant", "bard", "requiem", "uncommon", "skl", 2, "ally", null, [{ o: "heal", n: 8 }, { o: "regen", n: 3 }], N("聖詠", "聖詠", "Chant")),
    card("bar_soothe", "bard", "requiem", "uncommon", "skl", 1, "none", null, [{ o: "cleanseAll" }, { o: "healAll", n: 2 }], N("撫慰之歌", "慰めの歌", "Soothing Song")),
    card("bar_mass", "bard", "requiem", "rare", "skl", 2, "none", null, [{ o: "finale", k: "healAll", n: 2 }], N("安魂彌撒", "鎮魂ミサ", "Requiem Mass"), { exhaust: true }),
    card("bar_choir", "bard", "requiem", "rare", "pow", 2, "self", null, [{ o: "pow", p: "healAll", n: 2 }], N("天使合唱", "天使の合唱", "Angelic Choir")),
    card("bar_sanctsong", "bard", "requiem", "rare", "skl", 2, "none", null, [{ o: "finale", k: "blkAll", n: 4 }], N("聖所之歌", "聖域の歌", "Song of Sanctuary")),
    // ===== 吟遊詩人・不協和 =====
    card("bar_sharp", "bard", "discord", "common", "atk", 1, "enemy", "any", [dmg(3, 2), { o: "mel", n: 1 }], N("尖音", "鋭音", "Sharp Note")),
    card("bar_sonic", "bard", "discord", "uncommon", "atk", 1, "area", "any", [{ o: "dmgAll", n: 6, r: "any" }, { o: "mel", n: 1 }], N("音波炸裂", "音波炸裂", "Sonic Burst"), { ar: "m" }),
    card("bar_echo", "bard", "discord", "uncommon", "atk", 1, "enemy", "any", [{ o: "dmgMel", n: 3 }], N("回聲", "残響", "Echo")),
    card("bar_cacophony", "bard", "discord", "uncommon", "skl", 1, "none", "any", [{ o: "stAll", s: "vuln", n: 1, r: "any" }, { o: "mel", n: 2 }], N("噪音", "騒音", "Cacophony")),
    card("bar_scale", "bard", "discord", "rare", "atk", 2, "enemy", "any", [{ o: "finale", k: "dmg", n: 8 }], N("破碎音階", "砕けた音階", "Shattered Scale")),
    card("bar_ruin", "bard", "discord", "rare", "atk", 3, "none", "any", [{ o: "finale", k: "dmgAll", n: 3 }], N("毀滅和弦", "破滅の和音", "Chord of Ruin")),
    card("bar_maestro", "bard", "discord", "rare", "pow", 2, "self", null, [{ o: "pow", p: "melTurn", n: 2 }, { o: "pow", p: "thorns", n: 2 }], N("大師", "巨匠", "Maestro"))
  ];
  CARDS = CARDS.concat(CARDS_EXTRA);

  // ---------------- 新英雄（2026-10-22 使用者選定：武僧、德魯伊、時空術士、鍊金術師、賭徒） ----------------
  // 新機制的 op（規則在 yellow_core.js）：
  //   chi（獲得氣）／chiIf（消耗 c 氣才發動 fx）、form（變身：bear／wolf／hawk；卡的 forms 欄位＝在該姿態時的加成）、
  //   delay（fx 延到下回合開始）／recall（從棄牌堆拿回最近的 n 張）、brew（把藥水牌放進自己或隊友的手牌）、
  //   roll（擲骰：骰子 × n；k＝dmg／dmgAll／blk／blkAll／heal／healAll；a＝擲兩次取高）／gamble（擲 4 以上 win，否則 lose）
  function chiIf(c, fx) { return { o: "chiIf", c: c, fx: fx }; }
  function later(fx) { return { o: "delay", fx: fx }; }
  function roll(k, n, a) { return a ? { o: "roll", k: k, n: n, a: 1 } : { o: "roll", k: k, n: n }; }
  function gamble(win, lose) { return { o: "gamble", win: win, lose: lose || [] }; }
  function form(f) { return { o: "form", f: f }; }
  function brewC(c, n, ally) { var x = { o: "brew", c: c, n: n || 1 }; if (ally) x.ally = true; return x; }
  function pw(p, n) { return { o: "pow", p: p, n: n }; }

  HEROES = HEROES.concat([
    { id: "monk", name: N("武僧", "武僧", "Monk"), icon: "🥋", hp: 72, color: "#e07b39",
      desc: N("以拳腳近身作戰。打攻擊牌累積「氣」，再消耗氣打出更強的招式、治療或銅牆鐵壁。", "拳と蹴りで戦う。攻撃で「気」を溜め、気を使って強力な技・回復・鉄壁を繰り出す。", "Fights with fists and feet. Attacks build Chi, which powers stronger strikes, healing or an iron body."),
      passive: { p: "chiAtk", n: 1 }, perk: 1,
      paths: [{ id: "fist", name: N("拳法", "拳法", "Fists") }, { id: "zen", name: N("禪定", "禅定", "Zen") }, { id: "iron", name: N("金鐘罩", "金剛身", "Iron Body") }],
      start: ["mon_palm", "mon_palm", "mon_palm", "mon_guard", "mon_guard", "mon_breath", "mon_kick", "mon_flurry"] },
    { id: "druid", name: N("德魯伊", "ドルイド", "Druid"), icon: "🌿", hp: 76, color: "#7a8f2a",
      desc: N("在熊、狼、鷹三種姿態之間變身。熊每回合得到護盾、狼擅長內圈、鷹擅長外圈，許多牌在對應姿態有額外效果。", "熊・狼・鷹の三つの姿に変身する。熊は毎ターン防御、狼は内周、鷹は外周が得意。多くのカードは対応する姿で追加効果。", "Shifts between Bear, Wolf and Hawk. Bear gains block each turn, Wolf excels at the inner ring, Hawk at the outer; many cards gain extra effects in the matching form."),
      passive: { p: "formDraw", n: 1 }, perk: 1,
      paths: [{ id: "bear", name: N("熊", "熊", "Bear") }, { id: "wolf", name: N("狼", "狼", "Wolf") }, { id: "hawk", name: N("鷹", "鷹", "Hawk") }],
      start: ["dru_claw", "dru_claw", "dru_bark", "dru_bark", "dru_thorn", "dru_bear", "dru_wolf", "dru_hawk"] },
    { id: "chrono", name: N("時空術士", "時空術士", "Chronomancer"), icon: "⏳", hp: 66, color: "#6d5bd0",
      desc: N("操弄時間。延遲到下回合才發動的強力效果、把剛打出的牌拿回來，或讓敵人停滯。每回合累積「時能」，戰鬥拖得越久魔力越多。", "時を操る。次のターンに発動する強力な効果、使ったカードの回収、敵の停滞。毎ターン「時能」が溜まり、長引くほど魔力が増える。", "Bends time: powerful effects delayed to next turn, recalling cards you just played, and freezing enemies in place. Flux builds every turn, so the longer the fight, the more mana."),
      // 2026-10-23 重做（仿 Hellcard Tinkerer 的累積型資源）：時能每回合累積，每 3 點每回合多 1 魔力；原本的「每回合多抽 1 張」改放 extra
      passive: { p: "flux", n: 1 }, perk: 1, extra: { drawTurn: 1 },
      paths: [{ id: "haste", name: N("加速", "加速", "Haste") }, { id: "stasis", name: N("停滯", "停滞", "Stasis") }, { id: "fore", name: N("預知", "予知", "Foresight") }],
      start: ["chr_bolt", "chr_bolt", "chr_bolt", "chr_ward", "chr_ward", "chr_ward", "chr_slow", "chr_rewind"] },
    { id: "alchemist", name: N("鍊金術師", "錬金術師", "Alchemist"), icon: "⚗️", hp: 70, color: "#1f8f6f",
      desc: N("製作藥水。把 0 費、用完就消失的藥水牌放進自己或隊友的手牌：炸藥、治療、力量、護盾、毒藥。每打 3 張牌，累積的材料會自動做出一瓶藥水。", "薬を作る。0コストの使い切り薬カードを自分や仲間の手札に入れる：爆薬・回復・筋力・防御・毒。カードを3枚使うごとに素材から薬が1本できる。", "Brews potions: free, single-use potion cards added to your or an ally's hand — bombs, healing, strength, armor, poison. Every 3 cards played, gathered reagents brew a potion automatically."),
      // 2026-10-23 重做：每打出 3 張牌，累積的材料自動做出一瓶隨機藥水（extra.reagent＝需要幾張）
      passive: { p: "potionStart", n: 2 }, perk: 1, extra: { reagent: 3 },
      paths: [{ id: "bomb", name: N("爆破", "爆破", "Bombs") }, { id: "elixir", name: N("強化", "強化", "Elixirs") }, { id: "toxin", name: N("毒劑", "毒薬", "Toxins") }],
      start: ["alc_toss", "alc_toss", "alc_toss", "alc_coat", "alc_coat", "alc_coat", "alc_brew", "alc_flask"] },
    { id: "gambler", name: N("賭徒", "ギャンブラー", "Gambler"), icon: "🎲", hp: 72, color: "#b8336a",
      desc: N("一切交給骰子。擲骰決定威力、擲 4 以上大贏，輸了就要付出代價。", "すべてはサイコロ次第。出目で威力が決まり、4以上なら大当たり、外れれば代償を払う。", "Leaves it all to the dice: rolls decide the power, a 4 or higher wins big, and losing has a price."),
      passive: { p: "luck", n: 1 }, perk: 1,
      paths: [{ id: "luck", name: N("好運", "幸運", "Fortune") }, { id: "rig", name: N("老千", "イカサマ", "Loaded Dice") }, { id: "allin", name: N("全押", "全賭け", "All In") }],
      start: ["gam_coin", "gam_coin", "gam_coin", "gam_chip", "gam_chip", "gam_chip", "gam_bet", "gam_dice"] }
  ]);

  // 德魯伊的姿態：熊＝每回合開始時護盾；狼／鷹＝打內圈／外圈的攻擊加成
  var FORMS = { bear: { icon: "🐻", blk: 4 }, wolf: { icon: "🐺", ring: "near", n: 2 }, hawk: { icon: "🦅", ring: "far", n: 2 } };
  // 鍊金術師的藥水（rar:"token"，不會出現在獎勵與商店）
  var POTIONS = ["alc_p_fire", "alc_p_heal", "alc_p_str", "alc_p_poison", "alc_p_guard", "alc_p_swift"];

  CARDS = CARDS.concat([
    // ===== 武僧 =====
    card("mon_palm", "monk", null, "basic", "atk", 1, "enemy", "near", [dmg(6)], N("掌擊", "掌打", "Palm Strike")),
    card("mon_guard", "monk", null, "basic", "skl", 1, "self", null, [blk(5)], N("架式", "構え", "Stance")),
    card("mon_breath", "monk", null, "basic", "skl", 1, "self", null, [{ o: "chi", n: 2 }, blk(3)], N("調息", "調息", "Breathe")),
    // 飛踢：任何射程（起始牌組唯一打得到外圈的牌；全部近戰時單人遇到外圈的遠程敵人會打不完，2026-10-22 檢查發現）
    card("mon_kick", "monk", null, "basic", "atk", 1, "enemy", "any", [dmg(5), chiIf(2, [dmg(6)])], N("飛踢", "飛び蹴り", "Flying Kick")),
    card("mon_flurry", "monk", null, "basic", "atk", 1, "enemy", "near", [dmg(3, 2)], N("連打", "連打", "Flurry")),
    // 拳法
    card("mon_chain", "monk", "fist", "common", "atk", 1, "enemy", "near", [dmg(4, 2)], N("連環拳", "連環拳", "Chain Punch")),
    card("mon_crush", "monk", "fist", "common", "atk", 1, "enemy", "near", [dmg(7), chiIf(2, [dmg(7)])], N("崩拳", "崩拳", "Crushing Fist")),
    card("mon_inch", "monk", "fist", "common", "atk", 0, "enemy", "near", [dmg(4), chiIf(1, [dmg(4)])], N("寸勁", "寸勁", "One-Inch Punch")),
    card("mon_hundred", "monk", "fist", "uncommon", "atk", 2, "enemy", "near", [dmg(3, 5)], N("百裂拳", "百裂拳", "Hundred Fists")),
    card("mon_mountain", "monk", "fist", "uncommon", "atk", 2, "enemy", "near", [dmg(12), chiIf(3, [st("vuln", 2), dmg(6)])], N("破山", "山崩し", "Mountain Breaker")),
    card("mon_sweep", "monk", "fist", "uncommon", "atk", 1, "none", "near", [{ o: "dmgAll", n: 5, r: "near" }, chiIf(2, [{ o: "pushAll" }])], N("掃堂腿", "足払い", "Leg Sweep")),
    card("mon_qiball", "monk", "fist", "uncommon", "atk", 1, "enemy", "any", [dmg(6), chiIf(2, [dmg(8)])], N("氣功彈", "気功弾", "Chi Blast")),
    card("mon_whirl", "monk", "fist", "uncommon", "atk", 1, "area", "near", [{ o: "dmgAll", n: 7, r: "near" }], N("旋風腿", "旋風脚", "Whirlwind Kick"), { ar: "m" }),
    card("mon_heaven", "monk", "fist", "rare", "atk", 3, "enemy", "near", [dmg(20), chiIf(5, [dmg(20)])], N("天崩拳", "天崩拳", "Heavenfall Fist")),
    card("mon_shadow", "monk", "fist", "rare", "atk", 2, "enemy", "near", [dmg(4, 4), chiIf(3, [dmg(4, 2)])], N("無影拳", "無影拳", "Shadow Fists")),
    card("mon_intent", "monk", "fist", "rare", "pow", 2, "self", null, [pw("near", 3)], N("拳意", "拳意", "Fist Intent")),
    card("mon_burst", "monk", "fist", "rare", "atk", 1, "none", "any", [{ o: "dmgAll", n: 4, r: "any" }, chiIf(5, [{ o: "dmgAll", n: 14, r: "any" }])], N("氣爆", "気爆", "Chi Burst")),
    // 禪定
    card("mon_meditate", "monk", "zen", "common", "skl", 1, "self", null, [{ o: "chi", n: 3 }], N("入定", "入定", "Center")),
    card("mon_calm", "monk", "zen", "common", "skl", 1, "self", null, [{ o: "draw", n: 2 }, chiIf(1, [{ o: "heal", n: 4 }])], N("靜心", "静心", "Calm Mind")),
    card("mon_inhale", "monk", "zen", "common", "skl", 0, "self", null, [{ o: "chi", n: 1 }, { o: "draw", n: 1 }], N("吐納", "吐納", "Inhale")),
    card("mon_sit", "monk", "zen", "uncommon", "skl", 1, "self", null, [blk(6), { o: "chi", n: 2 }], N("坐禪", "坐禅", "Zazen")),
    card("mon_flow", "monk", "zen", "uncommon", "skl", 1, "self", null, [blk(4), chiIf(2, [{ o: "heal", n: 8 }])], N("氣血循環", "気血循環", "Circulation")),
    card("mon_clarity", "monk", "zen", "uncommon", "skl", 1, "self", null, [{ o: "draw", n: 3 }], N("澄心", "澄心", "Clarity")),
    card("mon_inner", "monk", "zen", "uncommon", "pow", 1, "self", null, [pw("chiAtk", 1)], N("內觀", "内観", "Insight")),
    card("mon_eye", "monk", "zen", "uncommon", "skl", 1, "enemy", "any", [st("vuln", 2), { o: "chi", n: 2 }], N("心眼", "心眼", "Mind's Eye")),
    card("mon_nirvana", "monk", "zen", "rare", "skl", 2, "none", null, [{ o: "chi", n: 2 }, chiIf(6, [{ o: "healAll", n: 8 }, { o: "cleanseAll" }])], N("涅槃", "涅槃", "Nirvana")),
    card("mon_satori", "monk", "zen", "rare", "skl", 1, "self", null, [{ o: "mana", n: 2 }, { o: "chi", n: 3 }], N("頓悟", "悟り", "Satori"), { exhaust: true }),
    card("mon_sea", "monk", "zen", "rare", "pow", 2, "self", null, [pw("chiTurn", 2)], N("氣海", "気海", "Sea of Chi")),
    card("mon_selfless", "monk", "zen", "rare", "skl", 2, "none", null, [{ o: "blkAll", n: 4 }, chiIf(4, [{ o: "strAll", n: 2 }])], N("無我", "無我", "Selflessness")),
    // 金鐘罩
    card("mon_cloth", "monk", "iron", "common", "skl", 1, "self", null, [blk(8)], N("鐵布衫", "鉄布衫", "Iron Shirt")),
    card("mon_deflect", "monk", "iron", "common", "skl", 1, "self", null, [blk(5), { o: "chi", n: 1 }], N("卸力", "受け流し", "Deflect")),
    card("mon_counter", "monk", "iron", "common", "atk", 1, "enemy", "near", [blk(4), dmg(5)], N("反手", "返し手", "Counterblow")),
    card("mon_bell", "monk", "iron", "uncommon", "skl", 2, "self", null, [blk(10), chiIf(2, [blk(8)])], N("金鐘罩", "金鐘罩", "Golden Bell")),
    card("mon_still", "monk", "iron", "uncommon", "skl", 1, "self", null, [blk(7), { o: "taunt" }], N("不動", "不動", "Immovable")),
    card("mon_rebound", "monk", "iron", "uncommon", "pow", 1, "self", null, [pw("thorns", 3)], N("反震", "反震", "Rebound")),
    card("mon_hardqi", "monk", "iron", "uncommon", "skl", 1, "self", null, [blk(6), chiIf(3, [{ o: "str", n: 1 }])], N("硬氣功", "硬気功", "Hard Chi")),
    card("mon_shelter", "monk", "iron", "uncommon", "skl", 1, "ally", null, [{ o: "blkAlly", n: 7 }, { o: "chi", n: 1 }], N("護體", "護体", "Shelter")),
    card("mon_diamond", "monk", "iron", "rare", "skl", 2, "self", null, [blk(18), chiIf(4, [blk(12)])], N("金剛不壞", "金剛不壊", "Diamond Body")),
    card("mon_arhat", "monk", "iron", "rare", "pow", 2, "self", null, [pw("plate", 4), pw("thorns", 2)], N("羅漢陣", "羅漢陣", "Arhat Formation")),
    card("mon_stillness", "monk", "iron", "rare", "atk", 2, "enemy", "near", [{ o: "dmgBlock", n: 1 }, chiIf(3, [st("weak", 3)])], N("以靜制動", "静を以て動を制す", "Stillness Strikes")),
    card("mon_bone", "monk", "iron", "rare", "pow", 2, "self", null, [pw("plate", 3), { o: "chi", n: 4 }], N("鐵骨", "鉄骨", "Iron Bones")),

    // ===== 德魯伊 =====
    card("dru_claw", "druid", null, "basic", "atk", 1, "enemy", "any", [dmg(6)], N("爪擊", "爪撃", "Claw"), { forms: { wolf: [dmg(3)] } }),
    card("dru_bark", "druid", null, "basic", "skl", 1, "self", null, [blk(6)], N("樹皮", "樹皮", "Barkskin"), { forms: { bear: [blk(3)] } }),
    card("dru_thorn", "druid", null, "basic", "atk", 1, "enemy", "far", [dmg(7)], N("荊棘", "茨", "Thorns"), { forms: { hawk: [dmg(3)] } }),
    card("dru_bear", "druid", null, "basic", "skl", 1, "self", null, [form("bear"), blk(5)], N("熊形", "熊の姿", "Bear Form")),
    card("dru_wolf", "druid", null, "basic", "atk", 1, "enemy", "near", [form("wolf"), dmg(6)], N("狼形", "狼の姿", "Wolf Form")),
    card("dru_hawk", "druid", null, "basic", "atk", 1, "enemy", "far", [form("hawk"), dmg(6)], N("鷹形", "鷹の姿", "Hawk Form")),
    // 熊
    card("dru_maul", "druid", "bear", "common", "atk", 1, "enemy", "near", [dmg(6)], N("熊掌", "熊掌", "Maul"), { forms: { bear: [blk(5)] } }),
    card("dru_hide", "druid", "bear", "common", "skl", 1, "self", null, [blk(7)], N("厚皮", "厚い毛皮", "Thick Hide"), { forms: { bear: [blk(4)] } }),
    card("dru_roar", "druid", "bear", "common", "skl", 1, "self", null, [form("bear"), { o: "taunt" }, blk(3)], N("咆哮", "咆哮", "Roar")),
    card("dru_hibernate", "druid", "bear", "uncommon", "skl", 2, "self", null, [form("bear"), { o: "heal", n: 6 }, blk(8)], N("冬眠", "冬眠", "Hibernate")),
    card("dru_hug", "druid", "bear", "uncommon", "atk", 2, "enemy", "near", [{ o: "dmgBlock", n: 1 }], N("熊抱", "ベアハッグ", "Bear Hug"), { forms: { bear: [st("weak", 2)] } }),
    card("dru_earth", "druid", "bear", "uncommon", "pow", 1, "self", null, [pw("plate", 2)], N("大地之力", "大地の力", "Strength of Earth")),
    card("dru_daunt", "druid", "bear", "uncommon", "skl", 1, "none", "near", [{ o: "stAll", s: "weak", n: 2, r: "near" }], N("震懾吼", "威嚇の咆哮", "Daunting Roar"), { forms: { bear: [blk(6)] } }),
    card("dru_grove", "druid", "bear", "uncommon", "skl", 1, "ally", null, [{ o: "blkAlly", n: 7 }], N("守林", "森の守り", "Grove Ward"), { forms: { bear: [{ o: "blkAlly", n: 5 }] } }),
    card("dru_ursa", "druid", "bear", "rare", "pow", 2, "self", null, [form("bear"), pw("plate", 3), pw("thorns", 2)], N("巨熊", "巨熊", "Great Bear")),
    card("dru_fury", "druid", "bear", "rare", "atk", 2, "enemy", "near", [dmg(10)], N("熊怒", "熊の怒り", "Ursine Fury"), { forms: { bear: [{ o: "dmgBlock", n: 1 }] } }),
    card("dru_forest", "druid", "bear", "rare", "skl", 2, "none", null, [{ o: "blkAll", n: 7 }], N("森林守護", "森の守護", "Forest Guardian"), { forms: { bear: [{ o: "healAll", n: 3 }] } }),
    card("dru_oak", "druid", "bear", "rare", "skl", 2, "self", null, [blk(20)], N("不朽橡樹", "不朽の樫", "Undying Oak"), { exhaust: true, forms: { bear: [{ o: "str", n: 2 }] } }),
    // 狼
    card("dru_bite", "druid", "wolf", "common", "atk", 1, "enemy", "near", [dmg(7)], N("撕咬", "噛みつき", "Bite"), { forms: { wolf: [st("vuln", 1)] } }),
    card("dru_pounce", "druid", "wolf", "common", "atk", 1, "enemy", "far", [{ o: "pull" }, { o: "toMe" }, dmg(4)], N("撲擊", "飛びかかり", "Pounce"), { forms: { wolf: [dmg(4)] } }),
    card("dru_prey", "druid", "wolf", "common", "atk", 1, "enemy", "near", [form("wolf"), dmg(3, 2)], N("獵食", "捕食", "Prey")),
    card("dru_pack", "druid", "wolf", "uncommon", "skl", 1, "self", null, [form("wolf"), { o: "draw", n: 2 }], N("狼群", "群れ", "Pack Call")),
    card("dru_rend", "druid", "wolf", "uncommon", "atk", 1, "enemy", "near", [dmg(5), st("poison", 3)], N("撕裂", "引き裂き", "Rend"), { forms: { wolf: [st("poison", 3)] } }),
    card("dru_stampede", "druid", "wolf", "uncommon", "atk", 2, "none", "near", [{ o: "dmgAll", n: 6, r: "near" }], N("狂奔", "暴走", "Stampede"), { forms: { wolf: [{ o: "dmgAll", n: 4, r: "near" }] } }),
    card("dru_kill", "druid", "wolf", "uncommon", "atk", 2, "enemy", "near", [{ o: "dmgExec", n: 10 }], N("獵殺", "仕留め", "Take Down"), { forms: { wolf: [dmg(5)] } }),
    card("dru_instinct", "druid", "wolf", "uncommon", "pow", 1, "self", null, [pw("frenzy", 3)], N("嗜血本能", "血の本能", "Blood Instinct")),
    card("dru_alpha", "druid", "wolf", "rare", "pow", 2, "self", null, [form("wolf"), pw("near", 3)], N("頭狼", "群れの長", "Alpha")),
    card("dru_howl", "druid", "wolf", "rare", "skl", 1, "none", null, [{ o: "strAll", n: 1 }], N("月夜狂嚎", "月夜の遠吠え", "Moonlit Howl"), { exhaust: true, forms: { wolf: [{ o: "strAll", n: 1 }] } }),
    card("dru_savage", "druid", "wolf", "rare", "atk", 2, "enemy", "near", [dmg(6, 3)], N("血腥撕裂", "血塗れの爪", "Savage Rend"), { forms: { wolf: [{ o: "lifesteal", n: 6 }] } }),
    card("dru_hunt", "druid", "wolf", "rare", "atk", 2, "area", "near", [{ o: "dmgAll", n: 9, r: "near" }], N("群狼戰術", "群狼戦術", "Pack Hunt"), { ar: "m", forms: { wolf: [{ o: "dmgAll", n: 5, r: "near" }] } }),
    // 鷹
    card("dru_talon", "druid", "hawk", "common", "atk", 1, "enemy", "far", [dmg(7)], N("鷹爪", "鷹の爪", "Talon"), { forms: { hawk: [dmg(3)] } }),
    card("dru_circle", "druid", "hawk", "common", "skl", 1, "self", null, [form("hawk"), blk(4), { o: "draw", n: 1 }], N("盤旋", "旋回", "Circle")),
    card("dru_dive", "druid", "hawk", "common", "atk", 1, "enemy", "any", [], N("俯衝", "急降下", "Dive"), { near: [dmg(4)], far: [dmg(8)] }),
    card("dru_sight", "druid", "hawk", "uncommon", "skl", 0, "enemy", "any", [st("vuln", 2)], N("銳目", "鋭い目", "Keen Sight"), { forms: { hawk: [{ o: "draw", n: 1 }] } }),
    card("dru_gust", "druid", "hawk", "uncommon", "atk", 2, "none", "far", [{ o: "dmgAll", n: 6, r: "far" }], N("疾風", "疾風", "Gust"), { forms: { hawk: [{ o: "dmgAll", n: 3, r: "far" }] } }),
    card("dru_feather", "druid", "hawk", "uncommon", "atk", 1, "enemy", "far", [dmg(4, 2)], N("羽刃", "羽刃", "Feather Blades"), { forms: { hawk: [dmg(4)] } }),
    card("dru_ride", "druid", "hawk", "uncommon", "skl", 1, "self", null, [{ o: "draw", n: 2 }, { o: "mana", n: 1 }], N("乘風", "風乗り", "Ride the Wind"), { forms: { hawk: [{ o: "draw", n: 1 }] } }),
    card("dru_squall", "druid", "hawk", "uncommon", "atk", 1, "area", "far", [{ o: "dmgAll", n: 9, r: "far" }], N("驟雨", "驟雨", "Squall"), { ar: "s" }),
    card("dru_sky", "druid", "hawk", "rare", "pow", 2, "self", null, [form("hawk"), pw("far", 3)], N("天空霸主", "空の覇者", "Lord of the Sky")),
    card("dru_tempest", "druid", "hawk", "rare", "atk", 3, "none", "any", [{ o: "dmgAll", n: 8, r: "any" }, { o: "pushAll" }], N("暴風翼", "嵐の翼", "Tempest Wings"), { forms: { hawk: [{ o: "dmgAll", n: 4, r: "any" }] } }),
    card("dru_thunderbird", "druid", "hawk", "rare", "atk", 2, "enemy", "far", [dmg(18)], N("雷鳥", "雷鳥", "Thunderbird"), { exhaust: true, forms: { hawk: [st("stun", 1)] } }),
    card("dru_spirit", "druid", "hawk", "rare", "skl", 1, "self", null, [{ o: "mana", n: 2 }, { o: "draw", n: 1 }], N("萬象", "万象", "All Things"), { exhaust: true, forms: { hawk: [{ o: "draw", n: 1 }] } }),

    // ===== 時空術士 =====
    card("chr_bolt", "chrono", null, "basic", "atk", 1, "enemy", "any", [dmg(7)], N("時之箭", "時の矢", "Time Bolt")),
    card("chr_ward", "chrono", null, "basic", "skl", 1, "self", null, [blk(6)], N("時間屏障", "時の障壁", "Time Ward")),
    card("chr_slow", "chrono", null, "basic", "atk", 1, "enemy", "any", [dmg(4), st("weak", 2), later([st("weak", 1)])], N("緩慢", "緩慢", "Slow")),
    card("chr_rewind", "chrono", null, "basic", "skl", 1, "self", null, [{ o: "recall", n: 1 }, { o: "draw", n: 1 }], N("倒轉", "巻き戻し", "Rewind")),
    // 加速
    card("chr_haste", "chrono", "haste", "common", "skl", 0, "self", null, [{ o: "mana", n: 1 }], N("加速", "加速", "Hasten"), { exhaust: true }),
    card("chr_ff", "chrono", "haste", "common", "atk", 1, "enemy", "any", [dmg(5), { o: "draw", n: 1 }], N("快轉", "早送り", "Fast Forward")),
    card("chr_quick", "chrono", "haste", "common", "atk", 1, "enemy", "any", [dmg(3, 2), { o: "draw", n: 1 }], N("疾時打擊", "疾時打", "Quick Strike")),
    card("chr_loop", "chrono", "haste", "uncommon", "skl", 1, "self", null, [{ o: "recall", n: 2 }], N("時間迴路", "時間ループ", "Time Loop")),
    card("chr_overclock", "chrono", "haste", "uncommon", "skl", 1, "self", null, [{ o: "mana", n: 2 }, { o: "lose", n: 3 }], N("超頻", "オーバークロック", "Overclock")),
    card("chr_chain", "chrono", "haste", "uncommon", "skl", 2, "self", null, [{ o: "draw", n: 3 }, { o: "mana", n: 1 }], N("連續施法", "連続詠唱", "Chain Cast")),
    card("chr_step", "chrono", "haste", "uncommon", "atk", 0, "enemy", "any", [dmg(4)], N("瞬擊", "瞬撃", "Blink Strike")),
    card("chr_borrow", "chrono", "haste", "uncommon", "skl", 0, "self", null, [{ o: "mana", n: 2 }, later([{ o: "lose", n: 4 }])], N("預支時間", "時間の前借り", "Borrowed Time")),
    card("chr_mastery", "chrono", "haste", "rare", "pow", 2, "self", null, [pw("mana", 1)], N("時間掌控", "時の支配", "Time Mastery")),
    card("chr_accel", "chrono", "haste", "rare", "pow", 2, "self", null, [pw("drawTurn", 1)], N("時光加速", "時の加速", "Acceleration")),
    card("chr_double", "chrono", "haste", "rare", "skl", 2, "self", null, [{ o: "mana", n: 3 }, { o: "draw", n: 3 }], N("雙重時間", "二重時間", "Double Time"), { exhaust: true }),
    card("chr_eternal", "chrono", "haste", "rare", "atk", 2, "enemy", "any", [dmg(4, 4)], N("時之連擊", "時の連撃", "Time Barrage")),
    // 停滯
    card("chr_drag", "chrono", "stasis", "common", "skl", 1, "enemy", "any", [st("weak", 2), { o: "draw", n: 1 }], N("遲緩", "遅延", "Drag")),
    card("chr_freeze", "chrono", "stasis", "common", "skl", 2, "enemy", "any", [st("stun", 1)], N("凍結時間", "時間凍結", "Freeze Time"), { exhaust: true, up: { cost: 1 } }),
    card("chr_anchor", "chrono", "stasis", "common", "atk", 1, "enemy", "any", [dmg(6), st("weak", 1)], N("時間錨", "時の錨", "Time Anchor")),
    card("chr_field", "chrono", "stasis", "uncommon", "skl", 2, "none", "any", [{ o: "stAll", s: "weak", n: 2, r: "any" }], N("停滯力場", "停滞の場", "Stasis Field")),
    card("chr_cage", "chrono", "stasis", "uncommon", "skl", 1, "area", "any", [{ o: "stAll", s: "stun", n: 1, r: "any" }], N("時間牢籠", "時の檻", "Time Cage"), { ar: "s", exhaust: true }),
    card("chr_zone", "chrono", "stasis", "uncommon", "skl", 1, "none", "near", [{ o: "stAll", s: "weak", n: 1, r: "near" }, { o: "pushAll" }], N("減速領域", "減速領域", "Slow Zone")),
    card("chr_stop", "chrono", "stasis", "uncommon", "atk", 2, "enemy", "any", [dmg(10), st("stun", 1)], N("時停一擊", "時止めの一撃", "Stopped Strike"), { exhaust: true }),
    card("chr_age", "chrono", "stasis", "uncommon", "skl", 1, "enemy", "any", [st("vuln", 2), st("poison", 3)], N("老化", "老化", "Age")),
    card("chr_world", "chrono", "stasis", "rare", "skl", 3, "none", "any", [{ o: "stAll", s: "stun", n: 1, r: "any" }], N("世界靜止", "世界の静止", "The World Stops"), { exhaust: true }),
    card("chr_entropy", "chrono", "stasis", "rare", "pow", 2, "self", null, [pw("weakAll", 1)], N("熵增", "エントロピー", "Entropy")),
    card("chr_rift", "chrono", "stasis", "rare", "atk", 2, "enemy", "any", [{ o: "dmgExec", n: 12 }, st("weak", 2)], N("時間斷層", "時の断層", "Time Rift")),
    card("chr_permafrost", "chrono", "stasis", "rare", "skl", 2, "enemy", "any", [st("stun", 1), st("vuln", 3)], N("永凍", "永久凍結", "Permafrost")),
    // 預知
    card("chr_omen", "chrono", "fore", "common", "skl", 1, "self", null, [blk(4), later([blk(8)])], N("預兆", "予兆", "Omen")),
    card("chr_bomb", "chrono", "fore", "common", "atk", 1, "enemy", "any", [later([dmg(14)])], N("延時炸彈", "時限爆弾", "Time Bomb")),
    card("chr_echo", "chrono", "fore", "common", "atk", 1, "enemy", "any", [dmg(5), later([dmg(5)])], N("時間回響", "時の残響", "Time Echo")),
    card("chr_shell", "chrono", "fore", "uncommon", "atk", 2, "none", "any", [later([{ o: "dmgAll", n: 9, r: "any" }])], N("時之彈", "時の弾", "Chrono Shell")),
    card("chr_prophecy", "chrono", "fore", "uncommon", "skl", 1, "self", null, [{ o: "draw", n: 1 }, later([{ o: "draw", n: 2 }, { o: "mana", n: 1 }])], N("預言", "予言", "Prophecy")),
    card("chr_aegis", "chrono", "fore", "uncommon", "skl", 1, "none", null, [later([{ o: "blkAll", n: 9 }])], N("未來護盾", "未来の盾", "Future Shield")),
    card("chr_wound", "chrono", "fore", "uncommon", "atk", 1, "enemy", "any", [dmg(4), later([dmg(10)])], N("過去之傷", "過去の傷", "Old Wound")),
    card("chr_mend", "chrono", "fore", "uncommon", "skl", 1, "ally", null, [{ o: "heal", n: 5 }, later([{ o: "heal", n: 5 }])], N("回到過去", "過去へ", "Turn Back")),
    card("chr_doom", "chrono", "fore", "rare", "atk", 3, "none", "any", [later([{ o: "dmgAll", n: 22, r: "any" }])], N("末日時鐘", "終末時計", "Doomsday Clock"), { exhaust: true }),
    card("chr_fate", "chrono", "fore", "rare", "pow", 2, "self", null, [pw("drawTurn", 1), pw("plate", 2)], N("宿命", "宿命", "Fate")),
    card("chr_cycle", "chrono", "fore", "rare", "skl", 1, "self", null, [{ o: "recall", n: 2 }, { o: "mana", n: 1 }], N("時之輪", "時の輪", "Wheel of Time"), { exhaust: true }),
    card("chr_paradox", "chrono", "fore", "rare", "atk", 2, "enemy", "any", [dmg(12), later([dmg(12)])], N("時間悖論", "タイムパラドックス", "Paradox")),

    // ===== 鍊金術師 =====
    card("alc_toss", "alchemist", null, "basic", "atk", 1, "enemy", "any", [dmg(6)], N("投擲", "投擲", "Toss")),
    card("alc_coat", "alchemist", null, "basic", "skl", 1, "self", null, [blk(6)], N("防護塗層", "防護被膜", "Coating")),
    card("alc_brew", "alchemist", null, "basic", "skl", 1, "self", null, [brewC("rand", 1), blk(3)], N("調製", "調合", "Brew")),
    card("alc_flask", "alchemist", null, "basic", "atk", 1, "area", "any", [{ o: "dmgAll", n: 7, r: "any" }], N("爆裂瓶", "炸裂瓶", "Bursting Flask"), { ar: "s" }),
    // 藥水（token）
    card("alc_p_fire", "alchemist", null, "token", "atk", 0, "area", "any", [{ o: "dmgAll", n: 8, r: "any" }], N("爆炸藥水", "爆薬", "Bomb Potion"), { ar: "s", exhaust: true }),
    card("alc_p_heal", "alchemist", null, "token", "skl", 0, "self", null, [{ o: "heal", n: 8 }], N("治療藥水", "回復薬", "Healing Potion"), { exhaust: true }),
    card("alc_p_str", "alchemist", null, "token", "skl", 0, "self", null, [{ o: "str", n: 2 }], N("力量藥水", "筋力薬", "Strength Potion"), { exhaust: true }),
    card("alc_p_poison", "alchemist", null, "token", "skl", 0, "enemy", "any", [st("poison", 6)], N("毒藥瓶", "毒瓶", "Poison Vial"), { exhaust: true }),
    card("alc_p_guard", "alchemist", null, "token", "skl", 0, "self", null, [blk(10)], N("鐵皮藥水", "鉄皮薬", "Ironskin Potion"), { exhaust: true }),
    card("alc_p_swift", "alchemist", null, "token", "skl", 0, "self", null, [{ o: "draw", n: 2 }], N("迅捷藥水", "俊敏薬", "Swiftness Potion"), { exhaust: true }),
    // 爆破
    card("alc_molotov", "alchemist", "bomb", "common", "atk", 1, "area", "any", [{ o: "dmgAll", n: 5, r: "any" }, { o: "stAll", s: "burn", n: 3, r: "any" }], N("燃燒瓶", "火炎瓶", "Molotov"), { ar: "s" }),
    card("alc_mkbomb", "alchemist", "bomb", "common", "skl", 1, "self", null, [brewC("alc_p_fire", 1), blk(3)], N("製作炸藥", "爆薬作り", "Make Bomb")),
    card("alc_shrapnel", "alchemist", "bomb", "common", "atk", 1, "enemy", "any", [dmg(4, 2)], N("碎片彈", "破片弾", "Shrapnel")),
    card("alc_chainbomb", "alchemist", "bomb", "uncommon", "atk", 2, "area", "any", [{ o: "dmgAll", n: 9, r: "any" }], N("連環爆破", "連鎖爆破", "Chain Blast"), { ar: "m" }),
    card("alc_satchel", "alchemist", "bomb", "uncommon", "skl", 1, "self", null, [brewC("alc_p_fire", 2)], N("炸藥包", "爆薬包", "Satchel")),
    card("alc_acid", "alchemist", "bomb", "uncommon", "atk", 1, "area", "any", [{ o: "dmgAll", n: 3, r: "any" }, { o: "stAll", s: "vuln", n: 2, r: "any" }], N("酸液", "酸液", "Acid Splash"), { ar: "m" }),
    card("alc_flash", "alchemist", "bomb", "uncommon", "atk", 1, "area", "any", [{ o: "stAll", s: "stun", n: 1, r: "any" }], N("震撼彈", "閃光弾", "Flashbang"), { ar: "s", exhaust: true }),
    card("alc_smoke", "alchemist", "bomb", "uncommon", "skl", 1, "none", "near", [{ o: "pushAll" }, { o: "stAll", s: "weak", n: 1, r: "near" }, { o: "shoveAll" }], N("煙霧彈", "煙玉", "Smoke Bomb")),
    card("alc_bigbang", "alchemist", "bomb", "rare", "atk", 3, "area", "any", [{ o: "dmgAll", n: 16, r: "any" }, { o: "stAll", s: "burn", n: 4, r: "any" }], N("大爆炸", "大爆発", "Big Bang"), { ar: "l" }),
    card("alc_demo", "alchemist", "bomb", "rare", "pow", 2, "self", null, [pw("burnPlus", 2), brewC("alc_p_fire", 1)], N("爆破專家", "爆破の達人", "Demolitionist")),
    card("alc_stone", "alchemist", "bomb", "rare", "pow", 2, "self", null, [pw("potionTurn", 1)], N("賢者之石", "賢者の石", "Philosopher's Stone")),
    card("alc_reaction", "alchemist", "bomb", "rare", "atk", 2, "enemy", "any", [{ o: "dmgSec", n: 10 }, st("burn", 3)], N("連鎖反應", "連鎖反応", "Chain Reaction")),
    // 強化
    card("alc_pass", "alchemist", "elixir", "common", "skl", 1, "ally", null, [brewC("alc_p_heal", 1, true), { o: "blkAlly", n: 2 }], N("遞藥", "薬渡し", "Pass a Potion")),
    card("alc_tonic", "alchemist", "elixir", "common", "skl", 1, "ally", null, [brewC("alc_p_str", 1, true), { o: "blkAlly", n: 3 }], N("強身劑", "強壮剤", "Tonic")),
    card("alc_mix", "alchemist", "elixir", "common", "skl", 1, "self", null, [brewC("rand", 2)], N("調配", "調剤", "Mix")),
    card("alc_supply", "alchemist", "elixir", "uncommon", "skl", 2, "none", null, [{ o: "healAll", n: 4 }, brewC("rand", 1)], N("補給包", "補給品", "Supplies")),
    card("alc_ironskin", "alchemist", "elixir", "uncommon", "skl", 1, "ally", null, [brewC("alc_p_guard", 1, true), { o: "blkAlly", n: 4 }], N("鐵皮劑", "鉄皮剤", "Ironskin Draught")),
    card("alc_stim", "alchemist", "elixir", "uncommon", "skl", 1, "ally", null, [{ o: "strAlly", n: 1 }, brewC("alc_p_swift", 1, true)], N("興奮劑", "興奮剤", "Stimulant")),
    card("alc_panacea", "alchemist", "elixir", "uncommon", "skl", 1, "ally", null, [{ o: "cleanse" }, { o: "heal", n: 5 }], N("萬能藥", "万能薬", "Panacea")),
    card("alc_firstaid", "alchemist", "elixir", "uncommon", "skl", 0, "ally", null, [{ o: "heal", n: 4 }], N("急救", "応急手当", "First Aid"), { exhaust: true }),
    card("alc_elixir", "alchemist", "elixir", "rare", "skl", 2, "ally", null, [{ o: "heal", n: 15 }, { o: "regen", n: 4 }], N("不老藥", "不老薬", "Elixir of Life"), { exhaust: true }),
    card("alc_master", "alchemist", "elixir", "rare", "pow", 2, "self", null, [pw("potionTurn", 1), pw("healAll", 1)], N("藥劑大師", "薬師の極意", "Master Brewer")),
    card("alc_rage", "alchemist", "elixir", "rare", "skl", 1, "ally", null, [{ o: "strAlly", n: 3 }, brewC("alc_p_str", 1, true)], N("狂暴藥劑", "狂暴薬", "Rage Draught"), { exhaust: true }),
    card("alc_mass", "alchemist", "elixir", "rare", "skl", 2, "none", null, [{ o: "strAll", n: 1 }, { o: "blkAll", n: 5 }], N("群體強化", "全体強化", "Mass Enhancement"), { exhaust: true }),
    // 毒劑
    card("alc_fog", "alchemist", "toxin", "common", "skl", 1, "area", "any", [{ o: "stAll", s: "poison", n: 3, r: "any" }], N("毒霧瓶", "毒霧瓶", "Fog Flask"), { ar: "m" }),
    card("alc_blade", "alchemist", "toxin", "common", "atk", 1, "enemy", "any", [dmg(4), st("poison", 3)], N("淬毒刃", "毒の刃", "Poisoned Blade")),
    card("alc_mkpoison", "alchemist", "toxin", "common", "skl", 1, "self", null, [brewC("alc_p_poison", 1), blk(3)], N("製毒", "毒作り", "Make Poison")),
    card("alc_corrode", "alchemist", "toxin", "uncommon", "skl", 1, "enemy", "any", [st("poison", 5), st("vuln", 1)], N("腐蝕液", "腐食液", "Corrosive")),
    card("alc_gas", "alchemist", "toxin", "uncommon", "skl", 2, "none", "any", [{ o: "stAll", s: "poison", n: 4, r: "any" }], N("毒氣彈", "毒ガス弾", "Gas Bomb")),
    card("alc_recipe", "alchemist", "toxin", "uncommon", "skl", 1, "self", null, [brewC("alc_p_poison", 2)], N("劇毒配方", "猛毒の調合", "Toxic Recipe")),
    card("alc_nerve", "alchemist", "toxin", "uncommon", "skl", 1, "enemy", "any", [st("poison", 4), st("weak", 2)], N("神經毒素", "神経毒素", "Nerve Agent")),
    card("alc_catalyst", "alchemist", "toxin", "uncommon", "skl", 1, "enemy", "any", [{ o: "poisonX", n: 2 }], N("毒性催化", "毒性触媒", "Toxic Catalyst"), { exhaust: true }),
    card("alc_plague", "alchemist", "toxin", "rare", "pow", 2, "self", null, [pw("poisonAll", 2)], N("瘟疫之源", "疫病の源", "Plague Source")),
    card("alc_perfect", "alchemist", "toxin", "rare", "skl", 2, "enemy", "any", [st("poison", 15)], N("完美毒藥", "完全な毒", "Perfect Poison")),
    card("alc_cloud", "alchemist", "toxin", "rare", "skl", 2, "area", "any", [{ o: "stAll", s: "poison", n: 7, r: "any" }], N("毒雲", "毒雲", "Toxic Cloud"), { ar: "l" }),
    card("alc_venom", "alchemist", "toxin", "rare", "pow", 1, "self", null, [pw("poisonPlus", 2)], N("劇毒專精", "猛毒の極意", "Venom Mastery")),

    // ===== 賭徒 =====
    card("gam_coin", "gambler", null, "basic", "atk", 1, "enemy", "any", [dmg(4), roll("dmg", 1)], N("擲硬幣", "コイントス", "Coin Toss")),
    card("gam_chip", "gambler", null, "basic", "skl", 1, "self", null, [blk(4), roll("blk", 1)], N("籌碼盾", "チップの盾", "Chip Shield")),
    card("gam_bet", "gambler", null, "basic", "skl", 1, "self", null, [gamble([{ o: "mana", n: 2 }, { o: "draw", n: 1 }], [{ o: "draw", n: 1 }])], N("小賭一把", "小さな賭け", "Small Bet")),
    card("gam_dice", "gambler", null, "basic", "atk", 1, "enemy", "any", [roll("dmg", 2)], N("擲骰", "サイコロ", "Roll the Dice")),
    // 好運
    card("gam_lucky", "gambler", "luck", "common", "skl", 0, "self", null, [roll("blk", 1), { o: "draw", n: 1 }], N("幸運硬幣", "幸運のコイン", "Lucky Coin")),
    card("gam_clover", "gambler", "luck", "common", "pow", 1, "self", null, [pw("luck", 1)], N("四葉草", "四つ葉", "Four-Leaf Clover")),
    card("gam_knife", "gambler", "luck", "common", "atk", 1, "enemy", "any", [roll("dmg", 2)], N("擲刀", "投げナイフ", "Knife Throw")),
    card("gam_streak", "gambler", "luck", "uncommon", "atk", 1, "enemy", "any", [roll("dmg", 1), roll("dmg", 1)], N("好運連連", "ツキの連続", "Lucky Streak")),
    card("gam_windfall", "gambler", "luck", "uncommon", "skl", 1, "self", null, [gamble([{ o: "mana", n: 1 }, { o: "draw", n: 2 }], [{ o: "draw", n: 1 }])], N("天降橫財", "棚ぼた", "Windfall")),
    card("gam_star", "gambler", "luck", "uncommon", "pow", 1, "self", null, [pw("luck", 1), { o: "draw", n: 1 }], N("幸運星", "ラッキースター", "Lucky Star")),
    card("gam_omen", "gambler", "luck", "uncommon", "skl", 1, "none", null, [roll("blkAll", 1)], N("吉兆", "吉兆", "Good Omen")),
    card("gam_charm", "gambler", "luck", "uncommon", "skl", 1, "self", null, [roll("blk", 2)], N("護身骰", "お守りの賽", "Dice Charm")),
    card("gam_chosen", "gambler", "luck", "rare", "pow", 2, "self", null, [pw("luck", 2)], N("天選之人", "選ばれし者", "The Chosen")),
    card("gam_jackpot", "gambler", "luck", "rare", "atk", 2, "none", "any", [roll("dmgAll", 3)], N("頭獎", "大当たり", "Jackpot")),
    card("gam_lady", "gambler", "luck", "rare", "skl", 1, "none", null, [roll("healAll", 1), { o: "strAll", n: 1 }], N("好運女神", "幸運の女神", "Lady Luck"), { exhaust: true }),
    card("gam_777", "gambler", "luck", "rare", "atk", 3, "enemy", "any", [roll("dmg", 6)], N("七七七", "スリーセブン", "Triple Seven")),
    // 老千
    card("gam_reroll", "gambler", "rig", "common", "atk", 1, "enemy", "any", [roll("dmg", 2, true)], N("重擲", "振り直し", "Reroll")),
    card("gam_again", "gambler", "rig", "common", "skl", 1, "self", null, [roll("blk", 2, true)], N("再來一次", "もう一回", "One More Time")),
    card("gam_loaded", "gambler", "rig", "common", "skl", 0, "self", null, [blk(2), { o: "draw", n: 1 }], N("灌鉛骰", "鉛入りの賽", "Loaded Die")),
    card("gam_cheat", "gambler", "rig", "uncommon", "pow", 1, "self", null, [pw("adv", 1)], N("出老千", "イカサマ師", "Cheater")),
    card("gam_twin", "gambler", "rig", "uncommon", "atk", 2, "enemy", "any", [roll("dmg", 2), roll("dmg", 2)], N("雙骰", "ダブルダイス", "Twin Dice")),
    card("gam_read", "gambler", "rig", "uncommon", "skl", 1, "enemy", "any", [st("vuln", 2), roll("blk", 1)], N("看穿", "見破り", "Read the Table")),
    card("gam_sure", "gambler", "rig", "uncommon", "skl", 1, "self", null, [gamble([{ o: "draw", n: 3 }], [{ o: "draw", n: 1 }])], N("穩賺", "堅い勝ち", "Sure Thing")),
    card("gam_swap", "gambler", "rig", "uncommon", "skl", 1, "self", null, [{ o: "recall", n: 1 }, { o: "draw", n: 1 }], N("偷天換日", "すり替え", "Switcheroo")),
    card("gam_house", "gambler", "rig", "rare", "pow", 2, "self", null, [pw("adv", 1), pw("luck", 1)], N("莊家", "胴元", "The House")),
    card("gam_system", "gambler", "rig", "rare", "skl", 1, "self", null, [{ o: "mana", n: 1 }, gamble([{ o: "mana", n: 1 }, { o: "draw", n: 2 }], [{ o: "draw", n: 1 }])], N("必勝法", "必勝法", "The System")),
    card("gam_storm", "gambler", "rig", "rare", "atk", 2, "none", "any", [roll("dmgAll", 2, true)], N("骰子風暴", "サイコロの嵐", "Dice Storm")),
    card("gam_ace", "gambler", "rig", "rare", "atk", 2, "enemy", "any", [roll("dmg", 5, true)], N("袖裡王牌", "袖の切り札", "Ace Up the Sleeve")),
    // 全押
    card("gam_last", "gambler", "allin", "common", "atk", 1, "enemy", "near", [gamble([dmg(16)], [dmg(4)])], N("孤注一擲", "一か八か", "Last Stand")),
    card("gam_stake", "gambler", "allin", "common", "skl", 0, "self", null, [{ o: "lose", n: 3 }, roll("blk", 2)], N("押上身家", "身代を賭ける", "Stake It All")),
    card("gam_blood", "gambler", "allin", "common", "atk", 1, "enemy", "any", [{ o: "lose", n: 2 }, roll("dmg", 3)], N("賭命", "命懸けの賭け", "Blood Wager")),
    card("gam_showhand", "gambler", "allin", "uncommon", "atk", 2, "enemy", "any", [gamble([dmg(28)], [{ o: "lose", n: 5 }])], N("梭哈", "ショーハンド", "Show Hand")),
    card("gam_highroll", "gambler", "allin", "uncommon", "skl", 1, "self", null, [gamble([{ o: "str", n: 2 }, { o: "draw", n: 1 }], [{ o: "lose", n: 3 }])], N("豪賭", "大博打", "High Roller")),
    card("gam_roulette", "gambler", "allin", "uncommon", "atk", 1, "enemy", "any", [gamble([dmg(20)], [{ o: "lose", n: 6 }])], N("俄羅斯輪盤", "ロシアンルーレット", "Roulette")),
    card("gam_double", "gambler", "allin", "uncommon", "skl", 1, "self", null, [gamble([{ o: "str", n: 3 }], [{ o: "lose", n: 4 }])], N("雙倍下注", "倍賭け", "Double Down")),
    card("gam_fever", "gambler", "allin", "uncommon", "pow", 1, "self", null, [pw("rage", 1)], N("賭徒之血", "博徒の血", "Gambler's Blood")),
    card("gam_allin", "gambler", "allin", "rare", "atk", 3, "none", "any", [gamble([{ o: "dmgAll", n: 20, r: "any" }], [{ o: "dmgAll", n: 6, r: "any" }])], N("全押", "全賭け", "All In")),
    card("gam_rich", "gambler", "allin", "rare", "skl", 1, "self", null, [gamble([{ o: "mana", n: 3 }, { o: "draw", n: 3 }], [{ o: "draw", n: 1 }])], N("一夜致富", "一攫千金", "Overnight Fortune"), { exhaust: true }),
    card("gam_undying", "gambler", "allin", "rare", "pow", 2, "self", null, [pw("frenzy", 4), pw("luck", 1)], N("不死賭徒", "不死身の博徒", "Undying Gambler")),
    card("gam_wheel", "gambler", "allin", "rare", "skl", 2, "none", null, [gamble([{ o: "strAll", n: 2 }, { o: "healAll", n: 6 }], [{ o: "blkAll", n: 6 }])], N("命運之輪", "運命の輪", "Wheel of Fortune"), { exhaust: true })
  ]);

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
    { id: "bats", size: "s", name: N("蝙蝠群", "蝙蝠の群れ", "Bat Swarm"), icon: "🦇", kind: "melee", spawn: "near", hp: [8, 10], pat: [[{ k: "atk", n: 2, h: 2 }]], cyc: "loop" },
    { id: "cultist", name: N("邪教徒", "邪教徒", "Cultist"), icon: "🕯️", kind: "ranged", hp: [24, 28], pat: [[{ k: "buff", str: 3 }], [{ k: "atk", n: 5 }], [{ k: "atk", n: 5 }]], cyc: "loop" },
    { id: "slime", name: N("腐泥", "腐泥", "Ooze"), icon: "🟢", kind: "melee", hp: [16, 19], pat: [[{ k: "atk", n: 5 }, { k: "curse", card: "t_wound", n: 1 }], [{ k: "blk", n: 7 }]], cyc: "loop" },
    { id: "knight", thorns: 2, name: N("墓穴騎士", "墓所の騎士", "Grave Knight"), icon: "⚔️", kind: "melee", elite: true, hp: [52, 58], pat: [[{ k: "atk", n: 12 }], [{ k: "blk", n: 10 }, { k: "buff", str: 2 }], [{ k: "atk", n: 5, h: 3 }]], cyc: "loop" },
    { id: "witch", name: N("沼地女巫", "沼の魔女", "Bog Witch"), icon: "🧙", kind: "ranged", elite: true, hp: [40, 46], pat: [[{ k: "debuff", s: "vuln", n: 2, tgt: "all" }], [{ k: "atk", n: 9 }], [{ k: "summon", id: "bats", n: 1 }], [{ k: "atk", n: 6 }, { k: "curse", card: "t_daze", n: 1, tgt: "all" }]], cyc: "loop" },
    { id: "giant", name: N("腐化巨人", "腐敗の巨人", "Rot Giant"), icon: "👹", kind: "boss", boss: true, hp: [95, 95], pat: [[{ k: "atk", n: 8, tgt: "all" }], [{ k: "buff", str: 2 }, { k: "blk", n: 15 }], [{ k: "atk", n: 18, tgt: "low" }], [{ k: "summon", id: "slime", n: 2 }]], cyc: "loop" },

    // ---- 第二幕：熔岩地獄 ----
    { id: "imp", size: "s", name: N("小惡魔", "インプ", "Imp"), icon: "😈", kind: "ranged", hp: [16, 19], pat: [[{ k: "atk", n: 5 }, { k: "debuff", s: "burn", n: 2 }], [{ k: "atk", n: 7 }]], cyc: "rand" },
    { id: "hound", name: N("地獄犬", "ヘルハウンド", "Hellhound"), icon: "🐺", kind: "melee", spawn: "near", hp: [22, 26], pat: [[{ k: "atk", n: 5, h: 2 }], [{ k: "atk", n: 9 }]], cyc: "rand" },
    { id: "guard", thorns: 2, name: N("惡魔守衛", "悪魔の衛兵", "Demon Guard"), icon: "🗿", kind: "melee", hp: [32, 36], pat: [[{ k: "blk", n: 8, all: true }], [{ k: "atk", n: 10 }], [{ k: "atk", n: 6 }, { k: "blk", n: 6 }]], cyc: "loop" },
    { id: "succubus", name: N("魅魔", "サキュバス", "Succubus"), icon: "💋", kind: "ranged", hp: [24, 28], pat: [[{ k: "debuff", s: "vuln", n: 2 }, { k: "atk", n: 4 }], [{ k: "atk", n: 8 }], [{ k: "heal", n: 8, all: true }]], cyc: "loop" },
    { id: "salamander", thorns: 1, name: N("火蜥蜴", "サラマンダー", "Salamander"), icon: "🦎", kind: "melee", hp: [26, 30], pat: [[{ k: "atk", n: 6 }, { k: "debuff", s: "burn", n: 3 }], [{ k: "buff", str: 2 }, { k: "blk", n: 6 }]], cyc: "loop" },
    { id: "brute", thorns: 3, name: N("炎魔", "炎魔", "Balrog"), icon: "🔥", kind: "melee", elite: true, hp: [80, 88], pat: [[{ k: "atk", n: 16 }], [{ k: "atk", n: 6, h: 2 }, { k: "debuff", s: "burn", n: 3 }], [{ k: "buff", str: 3 }, { k: "blk", n: 12 }]], cyc: "loop" },
    { id: "warlock", name: N("深淵術士", "深淵の術士", "Abyss Warlock"), icon: "🌀", kind: "ranged", elite: true, hp: [64, 70], pat: [[{ k: "atk", n: 7, tgt: "all" }], [{ k: "summon", id: "imp", n: 1 }], [{ k: "debuff", s: "weak", n: 2, tgt: "all" }, { k: "blk", n: 10 }]], cyc: "loop" },
    { id: "lord", thorns: 2, name: N("深淵領主", "深淵の領主", "Abyss Lord"), icon: "👿", kind: "boss", boss: true, hp: [160, 160], pat: [[{ k: "atk", n: 10, tgt: "all" }], [{ k: "summon", id: "hound", n: 2 }], [{ k: "atk", n: 6, h: 3, tgt: "low" }], [{ k: "buff", str: 3 }, { k: "debuff", s: "vuln", n: 2, tgt: "all" }], [{ k: "atk", n: 24, tgt: "rand" }]], cyc: "loop" },

    // ---- 第三幕：審判之庭 ----
    { id: "lineman", name: N("巡邊員", "線審", "Linesman"), icon: "🚩", kind: "ranged", hp: [30, 34], pat: [[{ k: "atk", n: 8 }], [{ k: "debuff", s: "weak", n: 2 }, { k: "atk", n: 5 }]], cyc: "rand" },
    { id: "hooligan", name: N("暴徒", "暴徒", "Hooligan"), icon: "🤬", kind: "melee", spawn: "near", hp: [34, 38], pat: [[{ k: "atk", n: 11 }], [{ k: "atk", n: 4, h: 3 }], [{ k: "buff", str: 2 }]], cyc: "rand" },
    { id: "shade", size: "s", name: N("怨靈", "怨霊", "Shade"), icon: "👻", kind: "ranged", hp: [26, 30], pat: [[{ k: "curse", card: "t_wound", n: 2 }], [{ k: "atk", n: 9 }], [{ k: "atk", n: 6 }, { k: "debuff", s: "vuln", n: 1 }]], cyc: "loop" },
    { id: "golem", thorns: 3, size: "l", name: N("審判石像", "審判の石像", "Judgement Golem"), icon: "🗽", kind: "melee", hp: [44, 50], pat: [[{ k: "blk", n: 14 }], [{ k: "atk", n: 14 }], [{ k: "atk", n: 8 }, { k: "blk", n: 8 }]], cyc: "loop" },
    { id: "var", name: N("影像判官", "ビデオ判定官", "VAR Seer"), icon: "📺", kind: "ranged", elite: true, hp: [90, 96], pat: [[{ k: "yellow", tgt: "all" }], [{ k: "atk", n: 10, tgt: "all" }], [{ k: "heal", n: 15, all: true }, { k: "blk", n: 12 }]], cyc: "loop" },
    { id: "captain", thorns: 3, name: N("黑衣隊長", "黒衣の主将", "Dark Captain"), icon: "🦹", kind: "melee", elite: true, hp: [100, 110], pat: [[{ k: "atk", n: 20 }], [{ k: "buff", str: 3, all: true }], [{ k: "atk", n: 7, h: 3 }]], cyc: "loop" },
    { id: "referee", name: N("地獄裁判長", "地獄の主審", "Hell Referee"), icon: "🟨", kind: "boss", boss: true, hp: [220, 220], pat: [[{ k: "yellow", tgt: "all" }, { k: "blk", n: 15 }], [{ k: "atk", n: 12, tgt: "all" }], [{ k: "summon", id: "lineman", n: 2 }], [{ k: "atk", n: 8, h: 2, tgt: "low" }, { k: "buff", str: 2 }], [{ k: "yellow", tgt: "rand" }, { k: "atk", n: 30, tgt: "rand" }]], cyc: "loop" }
  ];

  // ---------------- 遺物（2026-10-22 使用者指定：遺物、金幣、商店一同實作） ----------------
  // 英雄持有、整局有效的被動。rar：common／uncommon／rare／boss（Boss 戰後三選一，強但有代價）
  // fx 欄位（core 依名稱加總）：
  //   maxHp（取得時）／battleBlk（每場開戰護盾）／partyBlk（開戰全隊護盾）／battleStr（開戰力量）／
  //   firstMana・firstDraw（第一回合）／handPlus（每回合多抽）／manaTurn（每回合魔力）／
  //   killHeal（擊倒敵人時回復）／endHeal（戰鬥勝利時回復）／rareUp（卡牌獎勵的稀有機率，加總）／restHeal（營火多回復的 %，負數＝少回復）／
  //   enemyWeak（開戰時所有敵人虛弱）／spiritStart（開戰精靈）／redHalf（紅牌傷害減半）／revive（每場一次倒下時以 25% 復活）／
  //   pw：{ 能力名: 值 }（開戰時加進 h.pw，例如 thorns、far、near、poisonPlus、burnPlus、plate）
  //   2026-10-23 影響隊友的遺物（team: true，單人不會出現）：shareHeal（被敵人打掉生命時其他人回復一半，最多 4）／
  //   partyStr（開戰全隊力量）／allyBlk（自己回合開始時生命最低的其他隊友護盾）／relayHeal（擊倒別人區域的敵人時那位隊友回復）／
  //   allyDownStr（隊友倒下時自己力量 +n、回復 8）／partyEndHeal（戰鬥勝利時其他隊友回復）
  var RELICS = [
    { id: "iron_charm", rar: "common", icon: "🧿", fx: { battleBlk: 8 }, name: N("鐵護符", "鉄の護符", "Iron Charm"), desc: N("每場戰鬥開始時獲得 8 護盾。", "戦闘開始時に防御 8。", "Gain 8 block at the start of each battle.") },
    { id: "war_banner", rar: "common", icon: "🚩", fx: { battleStr: 1 }, name: N("戰旗", "軍旗", "War Banner"), desc: N("每場戰鬥開始時獲得 1 力量。", "戦闘開始時に筋力 +1。", "Gain 1 Strength at the start of each battle.") },
    { id: "mana_crystal", rar: "common", icon: "🔷", fx: { firstMana: 1 }, name: N("魔力水晶", "魔力結晶", "Mana Crystal"), desc: N("每場戰鬥第一回合魔力 +1。", "戦闘の最初のターン、魔力 +1。", "+1 mana on the first turn of each battle.") },
    { id: "quill", rar: "common", icon: "🪶", fx: { firstDraw: 2 }, name: N("預言之羽", "予言の羽", "Prophet's Quill"), desc: N("每場戰鬥第一回合多抽 2 張。", "戦闘の最初のターン、2 枚多く引く。", "Draw 2 extra cards on the first turn of each battle.") },
    { id: "old_boots", rar: "common", icon: "🥾", fx: { maxHp: 10 }, name: N("旅人的舊靴", "旅人の古靴", "Traveller's Boots"), desc: N("最大生命 +10。", "最大生命 +10。", "+10 max HP.") },
    { id: "blood_vial", rar: "common", icon: "🩸", fx: { endHeal: 6 }, name: N("血瓶", "血の小瓶", "Blood Vial"), desc: N("戰鬥勝利時回復 6 生命。", "戦闘勝利時に生命 6 回復。", "Heal 6 HP after winning a battle.") },
    { id: "lucky_charm", rar: "common", icon: "🍀", fx: { rareUp: 0.15 }, name: N("幸運符", "幸運のお守り", "Lucky Charm"), desc: N("卡牌獎勵出現稀有卡的機率 +15%。", "カード報酬でレアが出る確率 +15%。", "+15% chance of rare cards in card rewards.") },
    { id: "whistle", rar: "common", icon: "📯", fx: { redHalf: 1, battleBlk: 3 }, name: N("裁判的哨子", "審判の笛", "Referee's Whistle"), desc: N("紅牌傷害減半。每場戰鬥開始時獲得 3 護盾。", "レッドカードのダメージ半減。戦闘開始時に防御 3。", "Red card damage is halved. Gain 3 block at the start of each battle.") },
    { id: "war_drum", rar: "common", team: true, icon: "🥁", fx: { partyStr: 1 }, name: N("戰鼓", "陣太鼓", "War Drum"), desc: N("每場戰鬥開始時全隊獲得 1 力量。", "戦闘開始時に味方全員の筋力 +1。", "All allies gain 1 Strength at the start of each battle.") },
    { id: "shared_cup", rar: "common", team: true, icon: "🍵", fx: { partyEndHeal: 4 }, name: N("分享杯", "分かち合いの杯", "Shared Cup"), desc: N("戰鬥勝利時，其他隊友各回復 4 生命。", "戦闘勝利時、他の仲間がそれぞれ生命 4 回復。", "After winning a battle, each other ally heals 4 HP.") },
    { id: "seashell", rar: "uncommon", team: true, icon: "🐚", fx: { shareHeal: 1 }, name: N("三枚貝殼", "三つの貝殻", "Three Seashells"), desc: N("你被敵人打掉生命時，其他隊友各回復失去量的一半（最多 4）。", "敵の攻撃で生命を失うと、他の仲間がその半分（最大 4）回復。", "When an enemy makes you lose HP, each other ally heals half that amount (max 4).") },
    { id: "guard_ring", rar: "uncommon", team: true, icon: "💍", fx: { allyBlk: 4 }, name: N("守護戒指", "守りの指輪", "Guardian Ring"), desc: N("你的回合開始時，生命最低的其他隊友獲得 4 護盾。", "自分のターン開始時、生命が最も低い他の仲間に防御 4。", "At the start of your turn, the other ally with the lowest HP gains 4 block.") },
    { id: "relay_flag", rar: "uncommon", team: true, icon: "🏳️", fx: { relayHeal: 3 }, name: N("接力旗", "リレーの旗", "Relay Flag"), desc: N("你擊倒位在其他隊友區域的敵人時，那位隊友回復 3 生命。", "他の仲間のエリアにいる敵を倒すと、その仲間が生命 3 回復。", "When you defeat an enemy in another ally's zone, that ally heals 3 HP.") },
    { id: "bond_locket", rar: "rare", team: true, icon: "📿", fx: { allyDownStr: 3 }, name: N("羈絆項鍊", "絆のロケット", "Bond Locket"), desc: N("隊友倒下時，你獲得 3 力量並回復 8 生命。", "仲間が倒れると、筋力 +3 し生命 8 回復。", "When an ally falls, gain 3 Strength and heal 8 HP.") },
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
    { id: "crown", rar: "boss", icon: "👑", fx: { battleStr: 2, restHeal: -100 }, name: N("暴君之冠", "暴君の冠", "Tyrant's Crown"), desc: N("每場戰鬥開始時獲得 2 力量。營火不能再回復生命。", "戦闘開始時に筋力 +2。焚き火で生命を回復できなくなる。", "Gain 2 Strength at the start of each battle. Campfires no longer heal you.") },
    { id: "golden_heart", rar: "boss", icon: "💛", fx: { maxHp: 25, firstMana: -1 }, name: N("黃金之心", "黄金の心臓", "Golden Heart"), desc: N("最大生命 +25。每場戰鬥第一回合魔力 −1。", "最大生命 +25。戦闘の最初のターン、魔力 −1。", "+25 max HP. −1 mana on the first turn of each battle.") }
  ];

  // 2026-10-23 使用者指定：原版（Hellcard）沒有商店，拿掉商店與金幣；拿卡或遺物全看岔路選了哪一種地區
  // 祭壇：獻上多少最大生命換一件遺物
  var ALTAR_HP = 8;

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

  // 每幕的樓層（2026-10-22 使用者指定，仿 Hellcard）：前三層是一般戰鬥、第四層是 Boss，一局 3 幕 × 4 層＝12 層、3 場 Boss 戰。
  // 一般層開戰前，每位英雄各自從兩個「目的地」選一個：所選的目的地決定自己扇形區的敵人（foe），打贏後各自領目的地的獎勵。
  // 2026-10-23 使用者指定（仿 Hellcard）：打贏不再固定選卡，卡牌、遺物、回復、升級、刪卡都只從目的地拿。
  var FLOORS = ["dest", "dest", "dest", "boss"];
  // foe：light 較弱（血量 ×0.75）／normal／strong 較強（×1.3）／elite 該區換成菁英；w 是出現的權重
  var DESTS = [
    { id: "spoils", icon: "🎴", w: 3.5, foe: "normal" },   // 戰利品：卡牌三選一（或改成升級一張）
    { id: "camp", icon: "🔥", w: 2, foe: "light" },        // 營火：回復 30% 或升級一張
    { id: "smithy", icon: "🔨", w: 2, foe: "normal" },     // 鍛造所：升級兩張卡
    { id: "altar", icon: "🕯️", w: 1.6, foe: "normal" },   // 祭壇：移除一張卡，或獻上最大生命換一件遺物
    { id: "treasure", icon: "🎁", w: 1.4, foe: "strong" }, // 寶物庫：遺物三選一
    { id: "elite", icon: "💀", w: 1.6, foe: "elite" },     // 菁英：該區是菁英；最大生命 +5、一件遺物、較好的卡三選一
    // 2026-10-23 使用者指定（仿 Hellcard）：
    { id: "sanctum", icon: "🌟", w: 1.2, foe: "strong" },  // 職業聖地：永久強化自己的被動（最多 MAX_PERK 次），或兩張本職業稀有卡選一張
    { id: "shrine", icon: "⛲", w: 0, foe: "normal" }      // 復活神殿：不會隨機出現；有隊友倒下時一定是選項之一，打贏後倒下的英雄以 SHRINE_PCT% 生命復活
  ];
  // 職業聖地最多強化幾次被動；復活神殿復活時的生命 %
  var MAX_PERK = 3;
  var SHRINE_PCT = 50;
  // 祭壇的種類（2026-10-23 使用者指定，Hellcard 的祭壇：每種都是付出代價換好處，部分效果延續到下一場戰鬥）
  //   blood：獻上 ALTAR_HP 最大生命換一件遺物／purify：移除最多兩張卡／trade：移除一張卡換最大生命 +trade／
  //   pact：下一場戰鬥魔力不夠時每少 1 點改付 pact 生命，開戰力量 +1／war：現在失去 war 生命，下一場戰鬥開戰力量 +warStr
  var ALTARS = [
    { id: "blood", icon: "🩸", w: 1.2 },
    { id: "purify", icon: "🕊️", w: 1 },
    { id: "trade", icon: "⚖️", w: 1 },
    { id: "pact", icon: "📜", w: 0.8 },
    { id: "war", icon: "⚔️", w: 0.8 }
  ];
  var ALTAR_NUM = { trade: 6, pact: 3, war: 6, warStr: 3 };
  var FOE_HP = { light: 0.75, normal: 1, strong: 1.3 };

  // 苦痛等級（2026-10-23 使用者指定，Hellcard 的苦痛等級）：選第 n 級時 1～n 級的效果全部套用；效果寫在 yellow_core.js 的 tor()
  var TORMENTS = [
    { n: 1, name: N("敵人血量 +10%", "敵の生命 +10%", "Enemy HP +10%") },
    { n: 2, name: N("敵人傷害 +10%", "敵の与ダメージ +10%", "Enemy damage +10%") },
    { n: 3, name: N("菁英血量再 +25%", "エリートの生命さらに +25%", "Elite HP +25% more") },
    { n: 4, name: N("起始牌組多一張「悔恨」", "初期デッキに「悔恨」1 枚", "Start with a Regret curse") },
    { n: 5, name: N("營火只回復 20%", "焚き火の回復が 20% に", "Resting heals only 20%") },
    { n: 6, name: N("英雄最大生命 −10%", "英雄の最大生命 −10%", "Hero max HP −10%") },
    { n: 7, name: N("Boss 血量 +20%", "ボスの生命 +20%", "Boss HP +20%") },
    { n: 8, name: N("卡牌獎勵只剩兩個選項", "カード報酬の候補が 2 枚に", "Card rewards offer only two choices") },
    { n: 9, name: N("復活的英雄只有 1 生命", "復活した英雄は生命 1", "Revived heroes have only 1 HP") },
    { n: 10, name: N("每場戰鬥第一回合魔力 −1", "各戦闘の 1 ターン目のマナ −1", "−1 mana on the first turn of each battle") }
  ];

  // 無盡模式的苦痛修正（2026-10-23 使用者指定，Hellcard 1.0 的無盡模式）：第四幕起每 2 層全隊三選一，
  // 強度 pw 隨機 1～3、持續隨機 2～4 層；效果值＝n × pw（hp／dmg：%，blk：開戰護盾，thorns：荊棘，str：開戰力量）
  var TMODS = [
    { id: "hp", icon: "❤️", n: 10 },
    { id: "dmg", icon: "🗡️", n: 8 },
    { id: "blk", icon: "🛡️", n: 4 },
    { id: "thorns", icon: "🌵", n: 1 },
    { id: "str", icon: "💪", n: 1 }
  ];

  // ---- 局外進度（2026-10-23 使用者指定，Hellcard 的解鎖）：存在這台裝置的 localStorage（yellow.js），core 只吃開局時的等級與出發遺物 ----
  // 英雄等級需要的經驗（一局的經驗＝推進的層數，通關再 +6）
  var LEVEL_XP = [0, 6, 14, 26, 40];
  // 出發遺物：全部英雄等級加總到 need 就解鎖，開局前每位英雄可以裝一件
  var STARTERS = [
    { id: "old_boots", need: 1 }, { id: "iron_charm", need: 2 }, { id: "quill", need: 4 }, { id: "blood_vial", need: 6 },
    { id: "war_banner", need: 9 }, { id: "mana_crystal", need: 12 }, { id: "lucky_charm", need: 16 }, { id: "whistle", need: 20 }
  ];
  // 卡牌的解鎖等級（c.lv）：每條方向的進階卡第 4、5 張要 Lv1／Lv3，高階卡第 3、4 張要 Lv2／Lv4（其他一開始就有）
  var UNLOCK_LV = { uncommon: [0, 0, 0, 1, 3], rare: [0, 0, 2, 4] };
  (function () {
    var seen = {};
    CARDS.forEach(function (c) {
      var tbl = UNLOCK_LV[c.rar];
      if (!tbl || !c.path) return;
      var k = c.cls + "/" + c.path + "/" + c.rar;
      var i = seen[k] || 0;
      seen[k] = i + 1;
      if (tbl[i]) c.lv = tbl[i];
    });
  })();

  function index(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }

  window.PriTestYellowData = {
    CLASSES: HEROES, CLASS: index(HEROES),
    CARDS: CARDS, CARD: index(CARDS),
    ENEMIES: ENEMIES, ENEMY: index(ENEMIES),
    RELICS: RELICS, RELIC: index(RELICS), ALTAR_HP: ALTAR_HP,
    ACTS: ACTS, FLOORS: FLOORS, DESTS: DESTS, DEST: index(DESTS), FOE_HP: FOE_HP,
    MAX_PERK: MAX_PERK, SHRINE_PCT: SHRINE_PCT, ALTARS: ALTARS, ALTAR: index(ALTARS), ALTAR_NUM: ALTAR_NUM,
    TMODS: TMODS, TMOD: index(TMODS), LEVEL_XP: LEVEL_XP, STARTERS: STARTERS, MAX_FLUX: 10,
    // 敵人判定圓的半徑（戰場座標：圓形戰場直徑 100）；size 沒寫時菁英＝l、Boss＝boss、其他＝m
    // （2026-10-22 使用者指定再縮小一半）
    ENEMY_R: { s: 1.5, m: 1.9, l: 2.5, boss: 4 },
    // 指定範圍卡（tgt:"area"）範圍圈的半徑
    AREA_R: { s: 7, m: 10, l: 13 },
    FORMS: FORMS, POTIONS: POTIONS, MAX_CHI: 10,
    HAND_SIZE: 5, MANA: 3, RED_CARD_DMG: 12, MAX_SEATS: 4, MAX_SPIRITS: 8, MAX_MELODY: 10,
    // 手牌上限（Hellcard 同為 10，2026-10-23 使用者指定）：滿了就不再抽（牌留在抽牌堆），加進手牌的藥水改進棄牌堆
    HAND_MAX: 10,
    TORMENTS: TORMENTS,
    // 無盡模式：第三幕之後每多一幕，敵人血量／傷害再乘上的倍率（每幕累加）
    ENDLESS: { hp: 0.5, dmg: 0.25 }
  };
})();
