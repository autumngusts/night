(function () {
  // Split out of weapons.js (weapon category rulebook data) to keep file sizes manageable.
  // See weapons.js for the merge point, WEAPONS/SKILLS export, and lookup API.
  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  window.PriTestWeaponsCategories = [
    {
      id: "dagger",
      name: C("短剣", "短劍"),
      note: C(
        "レア度「L」を引いた場合、この表には専用のL枠武器が存在しない。R表で再抽選し、R⑥に黒名刃が出た場合はそのまま黒名刃を獲得する。",
        "抽到稀有度「L」時，此表無專屬L等級武器。改於R表重新抽選，若抽中R⑥的黑名刃，則直接獲得黑名刃。"
      ),
      randomSkillTable: [
        { roll: "1", id: "art_quickstep" },
        { roll: "2", id: "art_poison_moth" },
        { roll: "3", id: "art_blood_blade" },
        { roll: "4", id: "art_frost_step" },
        { roll: "5", id: "art_flame_strike" },
        { roll: "6", id: "art_assassin_method" },
      ],
      basicStats: {
        attackCost: C("1Hit：①／2Hit：①①", "1Hit：①／2Hit：①①"),
        weaponPower: 5,
        powerMod: C("技量（※一部の武器は例外あり）", "技巧（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("属性＋2", "屬性＋2"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し属性蓄積値が加算されるとき「蓄積値：＋2」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成屬性蓄積值，則「蓄積值：＋2」。"
          ),
        },
        {
          name: C("状態異常＋1", "異常狀態＋1"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し状態異常蓄積値が加算されるとき「蓄積値：＋1」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成異常狀態蓄積值，則「蓄積值：＋1」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "dagger_crit_up",
          name: C("致命の一撃＋20", "致命一擊＋20"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「致命の一撃」を発生させたとき、そのダメージを「＋20」する。",
            "使用此裝備發動遺物效果「致命一擊」時，將該傷害「＋20」。"
          ),
        },
        {
          id: "dagger_parry",
          name: C("パリィ", "格擋"),
          kind: "Defense",
          body: C(
            "コスト：ゾロ（2個）　対象：自身　隊列：前衛・後衛どちらでも使用可能　効果：「ガード」の代わりに使用可能。効果を完全に無効化し、追加効果も無効化する。次のターン開始時にスタミナダイスを1個追加する。",
            "消耗：豹子（2個）　對象：自身　編隊：前衛・後衛皆可使用　效果：可代替「防禦」使用。完全無效化該次傷害，追加效果也一併無效化。下一回合開始，追加1個體力骰。"
          ),
        },
        {
          id: "dagger_step",
          name: C("魔ダガーステップ", "魔匕首步"),
          kind: "Action",
          body: C(
            "コスト：②／FP■　対象：エネミー　隊列：前衛・後衛どちらでも使用可能　威力：0＋戦技威力　効果：対象に【総合ダメージ：威力】と「魔：2D」を与える。ターン終了まで、この装備品は属性「魔」を帯びる。",
            "消耗：②／FP■　對象：敵人　編隊：前衛・後衛皆可使用　威力：0＋戰技威力　效果：對敵人造成【總合傷害：威力】與「魔：2D」。到回合結束為止武器附帶屬性（魔）。"
          ),
        },
      ],
    },
    {
      id: "straightsword",
      name: C("直剣", "直劍"),
      randomSkillTable: [
        { roll: "1", id: "art_stance" },
        { roll: "2", id: "art_boulder_stance" },
        { roll: "3", id: "art_double_slash" },
        { roll: "4", id: "art_storm_blade" },
        { roll: "5", id: "art_carian_greatsword" },
        { roll: "6", id: "art_lightning_slash" },
      ],
      basicStats: {
        attackCost: C("1Hit：③／2Hit：③③", "1Hit：③／2Hit：③③"),
        weaponPower: 15,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("総合＆復帰ダメージ＋10", "總合＆復歸傷害＋10"),
          body: C(
            "この装備品での全ての2Hitアタックによる総合ダメージと復帰ダメージを「＋10」する。",
            "此裝備所有的2Hit攻擊所造成的總合傷害與復歸傷害「＋10」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "straightsword_2hit_bonus",
          name: C("2Hitダメージ＋10", "2Hit傷害＋10"),
          kind: "Passive",
          body: C(
            "この装備品での全ての2Hitアタックにより発生するダメージを「＋10」する。",
            "此裝備的所有2Hit攻擊所造成的傷害「＋10」。"
          ),
        },
        {
          id: "straightsword_no_swap_cost",
          name: C("持ち替えコストなし", "無需替換消耗"),
          kind: "Passive",
          body: C(
            "1ターンに1度だけ、「この装備品への装備変更」または「別の装備品への装備変更」を行うとき、ダイスコストを必要としない。",
            "1回合限1次，進行「變更為此裝備品」或「變更為別的裝備品」時，不需要消耗骰子。"
          ),
        },
        {
          id: "straightsword_dual_wield",
          name: C("二本差し", "二本差"),
          kind: "Passive",
          body: C(
            "他の武器（刀・杖・聖印）を装備状態にしておらず、この装備品を装備状態なら、この装備品のダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器（刀・杖・聖印）且裝備狀態為此裝備品時，此裝備品的傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "straightsword_night_and_flame",
          name: C("夜と炎の加護", "夜與焰之加護"),
          kind: "Passive",
          body: C(
            "この装備品で効果「魔力の光線」を使用したアクション後、エンドフェイズまで、この装備品にスキル「属性｜魔」を追加する。この装備品で効果「炎の雑払い」を使用したアクション後、エンドフェイズまで、この装備品にスキル「属性｜炎」を追加する。",
            "此裝備品使用效果「魔力的光線」的動作後，直到結束階段為止，此裝備品追加技能「屬性｜魔」。此裝備品使用效果「炎的雜清」的動作後，直到結束階段為止，此裝備品追加技能「屬性｜炎」。"
          ),
        },
      ],
    },
    {
      id: "greatsword",
      name: C("大剣", "大劍"),
      randomSkillTable: [
        { roll: "1", id: "art_lunge" },
        { roll: "2", id: "art_lion_slash" },
        { roll: "3", id: "art_gravitas" },
        { roll: "4", id: "art_red_lion_flame" },
        { roll: "5", id: "art_great_carian" },
        { roll: "6", id: "art_lightning_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：⑤／2Hit：⑤⑤", "1Hit：⑤／2Hit：⑤⑤"),
        weaponPower: 25,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("総合＆復帰ダメージ＋20", "總合＆復歸傷害＋20"),
          body: C(
            "この装備品での全ての2Hitアタックによる総合ダメージと復帰ダメージを「＋20」する。",
            "此裝備所有的2Hit攻擊所造成的總合傷害與復歸傷害「＋20」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "greatsword_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且裝備此裝備品時，攻擊的傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "greatsword_marais_grace",
          name: C("マレー家の加護", "馬雷家的加護"),
          kind: "Passive",
          body: C(
            "エネミーを撃破したとき、この装備品が装備状態なら、その日の終了までこの装備品を「武器威力：＋5」する。この効果は累積しない。",
            "擊破敵人時，若此裝備品為裝備狀態，直到當天結束為止，此裝備品「武器威力：＋5」。此效果不會累積。"
          ),
        },
        {
          id: "greatsword_blasphemous_grace",
          name: C("冒涜の加護", "冒瀆的加護"),
          kind: "Passive",
          body: C(
            "エネミーを撃破したとき、この装備品が装備状態なら自身に「HP回復：□□」を適用。モブHPに損害を与えた場合は、さらに追加で「HP回復：□□」を適用。",
            "擊破敵人時，若此裝備品為裝備狀態，自身獲得「HP回復：□□」。若對雜兵HP造成損害，額外再獲得「HP回復：□□」。"
          ),
        },
        {
          id: "greatsword_golden_order_grace",
          name: C("黄金律の加護", "黃金律的加護"),
          kind: "Passive",
          body: C(
            "この装備品でアタックした後、この装備品の装備者に蓄積している、自身に対するすべての「状態異常蓄積値」が0になる。",
            "此裝備品進行攻擊後，此裝備品裝備者身上累積的、針對自身的所有「異常狀態蓄積值」歸零。"
          ),
        },
        {
          id: "greatsword_dark_moon_grace",
          name: C("暗月の加護", "闇月的加護"),
          kind: "Passive",
          body: C(
            "この装備品を装備状態にしているとき、自身からエネミーへの「属性蓄積値｜魔」の上限値を「－1」する（属性損害が発生しやすくなる）。",
            "裝備此裝備品時，自身對敵人的「屬性蓄積值｜魔」上限值「－1」（更容易發生屬性損害）。"
          ),
        },
        {
          id: "greatsword_great_grace",
          name: C("大いなる加護", "偉大之加護"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「タメ攻撃」を行うとき、「聖：1D」を追加。",
            "此裝備品進行遺物效果「蓄力攻擊」時，追加「聖：1D」。"
          ),
        },
      ],
    },
    {
      id: "colossal",
      name: C("特大剣", "特大劍"),
      randomSkillTable: [
        { roll: "1", id: "art_lunge" },
        { roll: "2", id: "art_lion_slash" },
        { roll: "3", id: "art_gravitas" },
        { roll: "4", id: "art_red_lion_flame" },
        { roll: "5", id: "art_great_carian" },
        { roll: "6", id: "art_lightning_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：⑥／2Hit：⑥⑥", "1Hit：⑥／2Hit：⑥⑥"),
        weaponPower: 30,
        powerMod: C("筋力", "力量"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での全ての2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備所有的2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "colossal_vengeance_grace",
          name: C("復讐の加護", "復讐的加護"),
          kind: "Passive",
          body: C(
            "エネミーを撃破したとき、この装備品が装備状態なら、シナリオ終了までこの装備品を「武器威力：＋1」する。この効果は累積する。",
            "擊破敵人時，若此裝備品為裝備狀態，直到劇本結束為止，此裝備品「武器威力：＋1」。此效果會累積。"
          ),
        },
        {
          id: "colossal_collapse_grace",
          name: C("崩壊の加護", "崩壞的加護"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「タメ攻撃」を行うとき、ダメージに「＋10」する。",
            "此裝備品進行遺物效果「蓄力攻擊」時，傷害「＋10」。"
          ),
        },
        {
          id: "colossal_starcrusher_grace",
          name: C("星砕きの加護", "碎星的加護"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品が装備状態なら、アタックでのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且裝備此裝備品時，攻擊的傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "colossal_fate_of_death_grace",
          name: C("運命の死の加護", "命運之死的加護"),
          kind: "Passive",
          body: C(
            "この装備品を装備状態のとき、アクションフェイズ開始時直後のスタミナダイスの出目に「□□□」が含まれている場合、即座にエネミーに「HP損害：■」の効果。",
            "裝備此裝備品時，行動階段開始後獲得的體力骰出目若包含「□□□」，立即對敵人施加「HP損害：■」的效果。"
          ),
        },
        {
          id: "colossal_vow_of_vengeance",
          name: C("復讐の誓い", "復仇的誓言"),
          kind: "Action",
          body: C(
            "コスト：FP■■　対象：自身　隊列：前衛・後衛どちらでも使用可能　効果：対象にスタミナダイスを1個追加。このアクション後、エンドフェイズまで、対象を「最大HP：＋□□」する（現在HPは回復しない）。このスキルの効果は重複しない。",
            "消耗：FP■■　對象：自身　編隊：前衛・後衛皆可使用　效果：對象追加1個體力骰。此動作後，直到結束階段為止，對象「最大HP：＋□□」（現在HP不回復）。此技能的效果不重複。"
          ),
        },
        {
          id: "colossal_collapse_wave",
          name: C("崩壊波", "崩壞波"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■■　対象：エネミー・モブ　隊列：前衛・後衛どちらでも使用可能　威力：45＋戦技威力　効果：モブに「HP損害：□」、エネミーに【総合ダメージ：威力】と「魔：2」を与える。",
            "消耗：豹子（2個）／FP■■■　對象：敵人・雜兵　編隊：前衛・後衛皆可使用　威力：45＋戰技威力　效果：對雜兵造成「HP損害：□」，對敵人造成【總合傷害：威力】與「魔：2」。"
          ),
        },
        {
          id: "colossal_star_call",
          name: C("星呼び", "呼星"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（3個）／FP■■　対象：エネミー・モブ　隊列：前衛のとき使用可能　威力：25＋戦技威力　効果：モブに「HP損害：□□」、エネミーに【総合ダメージ：威力＋▲】と「魔：3」を与える。",
            "消耗：豹子（3個）／FP■■　對象：敵人・雜兵　編隊：前衛時可使用　威力：25＋戰技威力　效果：對雜兵造成「HP損害：□□」，對敵人造成【總合傷害：威力＋▲】與「魔：3」。"
          ),
        },
        {
          id: "colossal_fate_of_death",
          name: C("運命の死", "命運之死"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー　隊列：前衛のとき使用可能　威力：55＋戦技威力　効果：対象に【総合ダメージ：威力】と「聖：1D」を与える。",
            "消耗：豹子（2個）／FP■■　對象：敵人　編隊：前衛時可使用　威力：55＋戰技威力　效果：對敵人造成【總合傷害：威力】與「聖：1D」。"
          ),
        },
      ],
    },
    {
      id: "rapier",
      name: C("刺剣", "刺劍"),
      randomSkillTable: [
        { roll: "1", id: "art_piercing_thrust" },
        { roll: "2", id: "art_consecutive_thrust" },
        { roll: "3", id: "art_glintstone_pebble" },
        { roll: "4", id: "art_blood_toll" },
        { roll: "5", id: "art_holy_blade" },
        { roll: "6", id: "art_assassin_method" },
      ],
      basicStats: {
        attackCost: C("1Hit：②／2Hit：②②", "1Hit：②／2Hit：②②"),
        weaponPower: 10,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("スタミナダイス1追加", "體力骰1點追加"),
          body: C(
            "この装備品での2Hitアタックの後、自身のスタミナダイスに1点を追加する。",
            "此裝備進行2Hit攻擊後，於自身的體力骰追加一顆1點。"
          ),
        },
      ],
      innateSkills: [],
    },
    {
      id: "heavy_rapier",
      name: C("重刺剣", "重刺劍"),
      randomSkillTable: [
        { roll: "1", id: "art_piercing_thrust" },
        { roll: "2", id: "art_consecutive_thrust" },
        { roll: "3", id: "art_glintstone_pebble" },
        { roll: "4", id: "art_blood_toll" },
        { roll: "5", id: "art_holy_blade" },
        { roll: "6", id: "art_assassin_method" },
      ],
      basicStats: {
        attackCost: C("1Hit：④／2Hit：④④", "1Hit：④／2Hit：④④"),
        weaponPower: 20,
        powerMod: C("バランス", "平衡"),
      },
      twoHitBonus: [
        {
          name: C("スタミナダイス2追加", "體力骰2點追加"),
          body: C(
            "この装備品での2Hitアタックの後、自身のスタミナダイスに2点を追加する。",
            "此裝備進行2Hit攻擊後，於自身的體力骰追加一顆2點。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "heavy_rapier_dragon_grace",
          name: C("竜王の加護", "龍王之加護"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「ジャンプ攻撃」を行うとき、ダメージに「雷：1D」を追加する。",
            "此裝備品進行遺物效果「跳躍攻擊」時，對傷害追加「雷：1D」。"
          ),
        },
        {
          id: "heavy_rapier_dynasty_art",
          name: C("王朝剣技", "王朝劍技"),
          kind: "Action",
          body: C(
            "コスト：連番（2個）／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：30＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】を与える。この装備品がスキル「属性／状態異常｜X（154頁）」を持つ場合、エネミーに対するそれらの属性と状態異常を「蓄積値：＋3」する。",
            "消耗：連號（2個）／FP■　對象：敵人　編隊：前衛時可使用　威力：30＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】。此裝備品持有技能「屬性／狀態異常｜X（154頁）」的話，對敵人的該屬性與狀態異常「蓄積值：＋3」。"
          ),
        },
        {
          id: "heavy_rapier_thunderclad",
          name: C("雷雲の姿", "雷雲之姿"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー　隊列：後衛のとき使用可能　威力：20＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】と「雷：4」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：豹子（2個）／FP■■　對象：敵人　編隊：後衛時可使用　威力：20＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】與「雷：4」。此動作後，自身移動至前衛區域。"
          ),
        },
      ],
    },
    {
      id: "curved_sword",
      name: C("曲剣", "曲劍"),
      randomSkillTable: [
        { roll: "1", id: "art_sword_dance" },
        { roll: "2", id: "art_fog_falcon" },
        { roll: "3", id: "art_vacuum_slash" },
        { roll: "4", id: "art_holy_blade" },
        { roll: "5", id: "art_blood_slash" },
        { roll: "6", id: "art_cold_mist" },
      ],
      basicStats: {
        attackCost: C("1Hit：③／2Hit：③③", "1Hit：③／2Hit：③③"),
        weaponPower: 15,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("属性蓄積値＋2", "屬性蓄積值＋2"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し属性蓄積値が加算されるとき「蓄積値：＋2」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成屬性蓄積值，則「蓄積值：＋2」。"
          ),
        },
        {
          name: C("状態異常蓄積値＋1", "異常狀態蓄積值＋1"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し状態異常蓄積値が加算されるとき「蓄積値：＋1」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成異常狀態蓄積值，則「蓄積值：＋1」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "curved_sword_2hit_bonus",
          name: C("2Hitダメージ＋10", "2Hit傷害＋10"),
          kind: "Passive",
          body: C(
            "この装備品での全ての2Hitアタックで発生するダメージを「＋10」する。",
            "此裝備的所有2Hit攻擊所造成的傷害「＋10」。"
          ),
        },
        {
          id: "curved_sword_power_mod_up",
          name: C("威力補正（技量）＋5", "威力補正（技巧）＋5"),
          kind: "Passive",
          body: C(
            "この装備品を装備状態のとき、自身に威力補正「技量：＋5」する。",
            "此裝備品為裝備狀態時，自身獲得威力補正「技巧：＋5」。"
          ),
        },
        {
          id: "curved_sword_heal_up",
          name: C("HP回復効果アップ", "HP回復效果提升"),
          kind: "Passive",
          body: C(
            "この装備品を装備状態のとき、自身に適用される「HP回復」の効果を「＋□」する。",
            "此裝備品為裝備狀態時，自身獲得的「HP回復」效果「＋□」。"
          ),
        },
        {
          id: "curved_sword_despair_grace",
          name: C("絶望の加護", "絕望的加護"),
          kind: "Passive",
          body: C(
            "この装備品を装備状態のとき、アクションフェイズ開始時直後のスタミナダイスの出目に「◎◎」が含まれている場合、即座にエネミーに「HP損害：■」を与える。",
            "此裝備品為裝備狀態時，行動階段開始後的耐力骰出目若包含「◎◎」，立即對敵人造成「HP損害：■」。"
          ),
        },
      ],
    },
    {
      id: "great_curved_sword",
      name: C("大曲剣", "大曲劍"),
      randomSkillTable: [
        { roll: "1", id: "art_sword_dance" },
        { roll: "2", id: "art_fog_falcon" },
        { roll: "3", id: "art_vacuum_slash" },
        { roll: "4", id: "art_holy_blade" },
        { roll: "5", id: "art_blood_slash" },
        { roll: "6", id: "art_cold_mist" },
      ],
      basicStats: {
        attackCost: C("1Hit：⑤／2Hit：⑤⑤", "1Hit：⑤／2Hit：⑤⑤"),
        weaponPower: 25,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("属性蓄積値＋2", "屬性蓄積值＋2"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し属性蓄積値が加算されるとき「蓄積値：＋2」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成屬性蓄積值，則「蓄積值：＋2」。"
          ),
        },
        {
          name: C("状態異常蓄積値＋1", "異常狀態蓄積值＋1"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し状態異常蓄積値が加算されるとき「蓄積値：＋1」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成異常狀態蓄積值，則「蓄積值：＋1」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "great_curved_sword_hound_volley",
          name: C("猟犬の剣技", "獵犬的劍技"),
          kind: "Action",
          body: C(
            "コスト：ソロ（2個）／FP■　対象：エネミー　隊列：後衛のとき使用可能　威力：10＋戦技威力　効果：対象に【総合ダメージ：威力＋◆】を与える。",
            "消耗：豹子（2個）／FP■　對象：敵人　編隊：後衛時可使用　威力：10＋戰技威力　效果：對敵人造成【總合傷害：威力＋◆】。"
          ),
        },
        {
          id: "great_curved_sword_black_king_repel",
          name: C("黒王の斥力波", "黑王的斥力波"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■■　対象：エネミー・モブ　隊列：前衛のとき使用可能　威力：10＋戦技威力　効果：モブに「HP損害：■■」、エネミーに【総合ダメージ：威力】と「魔：4」を与える。",
            "消耗：②②／FP■■　對象：敵人・雜兵　編隊：前衛時可使用　威力：10＋戰技威力　效果：對雜兵造成「HP損害：■■」、對敵人造成【總合傷害：威力】與「魔：4」。"
          ),
        },
        {
          id: "great_curved_sword_lava_guillotine",
          name: C("溶岩ギロチン", "熔岩斷頭台"),
          kind: "Action",
          body: C(
            "コスト：ソロ（2個）／FP■　対象：エネミー　隊列：後衛のとき使用可能　威力：15＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】と「火：1D」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：豹子（2個）／FP■　對象：敵人　編隊：後衛時可使用　威力：15＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】與「火：1D」。此動作後，自身移動至前衛區域。"
          ),
        },
        {
          id: "great_curved_sword_cursed_blood_slash",
          name: C("呪血の斬撃", "咒血斬擊"),
          kind: "Action",
          body: C(
            "コスト：連番（2個）／FP■　対象：エネミー　隊列：後衛のとき使用可能　威力：30＋戦技威力　効果：対象に【総合ダメージ：威力】と「出血：1D」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：連號（2個）／FP■　對象：敵人　編隊：後衛時可使用　威力：30＋戰技威力　效果：對敵人造成【總合傷害：威力】與「出血：1D」。此動作後，自身移動至前衛區域。"
          ),
        },
        {
          id: "great_curved_sword_king_of_woe_grace",
          name: C("忌み王の加護", "忌王之加護"),
          kind: "Passive",
          body: C(
            "このスキルを持つ武器で遺物効果「致命の一撃」を行ったとき、発生するダメージに「炎：2D」を追加する。",
            "此技能持有的武器進行遺物效果「致命一擊」時，對發生的傷害追加「炎：2D」。"
          ),
        },
      ],
    },
    {
      id: "katana",
      name: C("刀", "刀"),
      randomSkillTable: [
        { roll: "1", id: "art_iai" },
        { roll: "2", id: "art_seppuku" },
        { roll: "3", id: "art_fang_thrust" },
        { roll: "4", id: "art_katana_double_slash" },
        { roll: "5", id: "art_blood_toll" },
        { roll: "6", id: "art_fog_falcon" },
      ],
      basicStats: {
        attackCost: C("1Hit：③／2Hit：③③", "1Hit：③／2Hit：③③"),
        weaponPower: 10,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("総合＆復帰ダメージ＋10", "總合＆復歸傷害＋10"),
          body: C(
            "この装備品での全ての2Hitアタックによる総合ダメージと復帰ダメージを「＋10」する。",
            "此裝備所有的2Hit攻擊所造成的總合傷害與復歸傷害「＋10」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "katana_power_up5",
          name: C("武器威力＋5", "武器威力＋5"),
          kind: "Passive",
          body: C(
            "この装備品の「武器威力」を「＋5」する。",
            "此裝備的「武器威力」「＋5」。"
          ),
        },
        {
          id: "katana_power_up10",
          name: C("武器威力＋10", "武器威力＋10"),
          kind: "Passive",
          body: C(
            "この装備品の「武器威力」を「＋10」する。",
            "此裝備的「武器威力」「＋10」。"
          ),
        },
        {
          id: "katana_unbroken_grace",
          name: C("不敗の加護", "不敗之加護"),
          kind: "Passive",
          body: C(
            "この装備品で総合ダメージを発生させたとき、自身に「HP回復：□」を適用する。この効果は1ターンに1回しか発揮されない。",
            "此裝備品造成總合傷害時，自身獲得「HP回復：□」。此效果1回合只發揮1次。"
          ),
        },
        {
          id: "katana_moment_of_moonlight",
          name: C("束の間の月影", "須臾的月影"),
          kind: "Action",
          body: C(
            "コスト：ソロ（2個）／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：30＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】を与える。",
            "消耗：豹子（2個）／FP■　對象：敵人　編隊：前衛時可使用　威力：30＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】。"
          ),
        },
        {
          id: "katana_countless_corpses",
          name: C("死屍累々", "死屍累累"),
          kind: "Action",
          body: C(
            "コスト：①①／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：10＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】と「魔：3」を与える。",
            "消耗：①①／FP■　對象：敵人　編隊：前衛時可使用　威力：10＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】與「魔：3」。"
          ),
        },
        {
          id: "katana_ice_thunder_kill",
          name: C("氷雷刹", "冰雷剎"),
          kind: "Action",
          body: C(
            "コスト：①②③／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：10＋戦技威力　効果：対象に【総合ダメージ：威力】と「凍傷：2」と「雷：2」を与える。このアクション後、エンドフェイズまで、この装備品にスキル「属性｜雷（154頁）」と「状態異常｜凍傷（154頁）」を追加する。",
            "消耗：①②③／FP■　對象：敵人　編隊：前衛時可使用　威力：10＋戰技威力　效果：對敵人造成【總合傷害：威力】與「凍傷：2」與「雷：2」。此動作後，直到結束階段為止，此裝備品追加技能「屬性｜雷（154頁）」與「狀態異常｜凍傷（154頁）」。"
          ),
        },
        {
          id: "katana_water_bird_dance",
          name: C("水鳥乱舞", "水鳥亂舞"),
          kind: "Action",
          body: C(
            "コスト：連番（2〜3個）／FP■■■　対象：エネミー　隊列：前衛・後衛どちらでも使用可能　威力：40＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】を与える。コストが「3個」の場合、ダメージを「＋10＋▲」する。このアクション後、自身は前衛エリアに移動する。",
            "消耗：連號（2〜3個）／FP■■■　對象：敵人　編隊：前衛・後衛皆可使用　威力：40＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】。若消耗為「3個」，傷害「＋10＋▲」。此動作後，自身移動至前衛區域。"
          ),
        },
      ],
    },
    {
      id: "twinblade",
      name: C("両刃剣", "兩刃劍"),
      randomSkillTable: [
        { roll: "1", id: "art_sword_dance_twinblade" },
        { roll: "2", id: "art_spin_slash" },
        { roll: "3", id: "art_phantom_of_union_strike" },
        { roll: "4", id: "art_black_flame_vortex" },
        { roll: "5", id: "art_blood_slash_twinblade" },
        { roll: "6", id: "art_ice_lance" },
      ],
      basicStats: {
        attackCost: C("1Hit：②／2Hit：②②", "1Hit：②／2Hit：②②"),
        weaponPower: 20,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("武器威力＋10", "武器威力＋10"),
          body: C(
            "他の武器（盾・杖・聖印状態のものを含む）を装備状態にしておらず、この装備品を装備状態なら、2Hitのアタックのダメージを「＋10」する。",
            "未將其他武器（含盾・杖・聖印狀態）裝備狀態化，且此裝備為裝備狀態時，2Hit攻擊的傷害「＋10」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "twinblade_power_down5",
          name: C("武器威力－5", "武器威力－5"),
          kind: "Passive",
          body: C(
            "この装備品の「武器威力」を「－5」する。",
            "此裝備的「武器威力」「－5」。"
          ),
        },
      ],
    },
    {
      id: "mace",
      name: C("槌", "槌"),
      randomSkillTable: [
        { roll: "1", id: "art_war_cry" },
        { roll: "2", id: "art_endure" },
        { roll: "3", id: "art_hoarah_loux_shake" },
        { roll: "4", id: "art_rampage" },
        { roll: "5", id: "art_holy_law" },
        { roll: "6", id: "art_prayer_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：③／2Hit：③③", "1Hit：③／2Hit：③③"),
        weaponPower: 10,
        powerMod: C("筋力（※一部の武器は例外あり）", "力量（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "mace_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且此裝備為裝備狀態時，攻擊傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "mace_power_up5",
          name: C("武器威力＋5", "武器威力＋5"),
          kind: "Passive",
          body: C("この装備品の「武器威力」を「＋5」する。", "此裝備的「武器威力」「＋5」。"),
        },
        {
          id: "mace_oracle_bubble",
          name: C("神託のシャボン", "神諭的泡沫"),
          kind: "Action",
          body: C(
            "コスト：連番（2個）／FP■　対象：エネミー＋モブ　隊列：後衛のとき使用可能　威力：25＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力】と「魔：1D」を与える。",
            "消耗：連號（2個）／FP■　對象：敵人＋雜兵　編隊：後衛時可使用　威力：25＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力】與「魔：1D」。"
          ),
        },
        {
          id: "mace_fluidize",
          name: C("流体化", "流體化"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■　対象：エネミー＋モブ　隊列：後衛のとき使用可能　威力：20＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力＋▲】を与える。",
            "消耗：②②／FP■　對象：敵人＋雜兵　編隊：後衛時可使用　威力：20＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力＋▲】。"
          ),
        },
        {
          id: "mace_flick",
          name: C("爪弾き", "彈指"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：10＋戦技威力　効果：対象に【総合ダメージ：威力＋◆】を与える。",
            "消耗：②②／FP■　對象：敵人　編隊：前衛時可使用　威力：10＋戰技威力　效果：對敵人造成【總合傷害：威力＋◆】。"
          ),
        },
        {
          id: "mace_hyakuchi_world",
          name: C("百智の世界", "百智的世界"),
          kind: "Action",
          body: C(
            "コスト：①／FP■　対象：PC全員　隊列：前衛のとき使用可能　威力：20＋戦技威力　効果：PC全員は、フェイズ終了まで、エネミーに対する「属性：魔／聖」の蓄積値が2倍になる。この効果は重複しない。",
            "消耗：①／FP■　對象：全體PC　編隊：前衛時可使用　威力：20＋戰技威力　效果：全體PC直到階段結束為止，對敵人的「屬性：魔／聖」蓄積值變為2倍。此效果不重複。"
          ),
        },
        {
          id: "mace_golden_crush",
          name: C("黄金砕き", "黃金碎"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー＋モブ　隊列：後衛のとき使用可能　威力：10＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力＋▲】と「聖：3」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：豹子（2個）／FP■■　對象：敵人＋雜兵　編隊：後衛時可使用　威力：10＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力＋▲】與「聖：3」。此動作後，自身移動至前衛區域。"
          ),
        },
        {
          id: "mace_queens_protection",
          name: C("女王の加護", "女王的加護"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「タメ攻撃」を行うとき、「聖：1D」を追加する。",
            "以此裝備發動遺物效果「蓄力攻擊」時，追加「聖：1D」。"
          ),
        },
      ],
    },
    {
      id: "axe",
      name: C("斧", "斧"),
      randomSkillTable: [
        { roll: "1", id: "art_war_cry" },
        { roll: "2", id: "art_endure" },
        { roll: "3", id: "art_hoarah_loux_shake" },
        { roll: "4", id: "art_rampage" },
        { roll: "5", id: "art_holy_law" },
        { roll: "6", id: "art_prayer_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：④／2Hit：④④", "1Hit：④／2Hit：④④"),
        weaponPower: 20,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("総合＆復帰ダメージ＋10", "總合＆復歸傷害＋10"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージと復帰ダメージを「＋10」する。",
            "此裝備2Hit攻擊所造成的總合傷害與復歸傷害「＋10」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "axe_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且此裝備為裝備狀態時，攻擊傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "axe_thunder_storm",
          name: C("雷嵐", "雷嵐"),
          kind: "Action",
          body: C(
            "コスト：①③／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：45＋戦技威力　効果：対象に【総合ダメージ：威力】と「雷：3」を与える。このアクション後、エンドフェイズまで、この装備品に「属性｜雷（154頁）」を追加する。",
            "消耗：①③／FP■　對象：敵人　編隊：前衛時可使用　威力：45＋戰技威力　效果：對敵人造成【總合傷害：威力】與「雷：3」。此動作後，直到結束階段為止，此裝備追加「屬性｜雷（154頁）」。"
          ),
        },
      ],
    },
    {
      // 斧ページと同様、写真の情報密度が高く判読の確信度は短剣／直剣より低いカテゴリ。
      id: "flail",
      name: C("フレイル", "連枷"),
      basicStats: {
        attackCost: C("1Hit：④／2Hit：④④", "1Hit：④／2Hit：④④"),
        weaponPower: 15,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "flail_dark_grace",
          name: C("暗黒の加護", "暗黑的加護"),
          kind: "Passive",
          body: C(
            "この装備品での2Hitアタックを行ったとき、ダイスコストに「出目：6」が含まれているなら、ダメージを「＋15」する。",
            "以此裝備進行2Hit攻擊時，若骰子費用中包含「出目：6」，則傷害「＋15」。"
          ),
        },
        {
          id: "flail_chain_swing",
          name: C("鎖回し", "鎖迴旋"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：35＋戦技威力　効果：対象に【総合ダメージ：威力】を与える。この装備品にスキル「属性／状態異常｜X（154頁）」またはスキル「X／－5（154頁）」がある場合、ダメージに「＋25」する。",
            "消耗：②②／FP■　對象：敵人　編隊：前衛時可使用　威力：35＋戰技威力　效果：對敵人造成【總合傷害：威力】。若此裝備持有技能「屬性／狀態異常｜X（154頁）」或技能「X／－5（154頁）」，傷害「＋25」。"
          ),
        },
        {
          id: "flail_family_wail",
          name: C("家族の怨霊", "家族的怨靈"),
          kind: "Action",
          body: C(
            "コスト：③③／FP■■　対象：エネミー　隊列：後衛のとき使用可能　威力：60＋戦技威力　効果：対象に【総合ダメージ：威力】と「魔：1D」を与える。",
            "消耗：③③／FP■■　對象：敵人　編隊：後衛時可使用　威力：60＋戰技威力　效果：對敵人造成【總合傷害：威力】與「魔：1D」。"
          ),
        },
        {
          id: "flail_stardust",
          name: C("星雲", "星雲"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■　対象：エネミー＋モブ　隊列：後衛のとき使用可能　威力：15＋戦技威力　効果：モブに「HP損害：■■」、エネミーに【総合ダメージ：威力】と「魔：2」を与える。エネミーが「サイズ：LL」の場合、ダメージを「＋15」する。",
            "消耗：②②／FP■　對象：敵人＋雜兵　編隊：後衛時可使用　威力：15＋戰技威力　效果：對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：威力】與「魔：2」。若敵人「體型：LL」，傷害「＋15」。"
          ),
        },
      ],
    },
    {
      id: "greatmace",
      name: C("大槌", "大槌"),
      randomSkillTable: [
        { roll: "1", id: "art_war_cry" },
        { roll: "2", id: "art_endure" },
        { roll: "3", id: "art_dark_wave" },
        { roll: "4", id: "art_lava_eruption" },
        { roll: "5", id: "art_bishop_charge" },
        { roll: "6", id: "art_prayer_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：⑥／2Hit：⑥⑥", "1Hit：⑥／2Hit：⑥⑥"),
        weaponPower: 30,
        powerMod: C("筋力", "力量"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "greatmace_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且此裝備為裝備狀態時，攻擊傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "greatmace_desecration_grace",
          name: C("冒瀆の加護", "冒瀆的加護"),
          kind: "Passive",
          body: C(
            "エネミーを撃破したとき、この装備品が装備状態なら自身に「HP回復：□」を適用。モブがいた場合は、さらに「HP回復：□□」を追加。",
            "擊破敵人時，若此裝備為裝備狀態，則對自身套用「HP回復：□」。若有雜兵，則再追加「HP回復：□□」。"
          ),
        },
        {
          id: "greatmace_bubble_shower",
          name: C("降り注ぐシャボン", "降注的泡沫"),
          kind: "Action",
          body: C(
            "コスト：連番（3個）／FP■■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：70＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力】と「魔：1D」を与える。",
            "消耗：連號（3個）／FP■■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：70＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力】與「魔：1D」。"
          ),
        },
        {
          id: "greatmace_erupting_faith",
          name: C("噴き上がる信仰", "噴湧的信仰"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：25＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力】と「炎：2」を与える。このアクション後、フェイズ終了まで、このスキルはコストが「②／FP■」になる（ダイスコストの②が減少する）。",
            "消耗：②②／FP■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：25＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力】與「炎：2」。此動作後，直到階段結束為止，此技能消耗變為「②／FP■」（骰子費用的②減少）。"
          ),
        },
        {
          id: "greatmace_beast_king_claw",
          name: C("獣王の爪", "獸王之爪"),
          kind: "Action",
          body: C(
            "コスト：②②／FP■　対象：エネミー＋モブ　隊列：前衛・後衛どちらでも使用可能　威力：10＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力＋▲】を与える。",
            "消耗：②②／FP■　對象：敵人＋雜兵　編隊：前衛・後衛皆可使用　威力：10＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力＋▲】。"
          ),
        },
        {
          id: "greatmace_world_eater",
          name: C("世界喰らい", "吞噬世界"),
          kind: "Action",
          body: C(
            "コスト：④④／FP■■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：10＋戦技威力　効果：モブに「HP損害：■■」、エネミーに【総合ダメージ：威力】と「炎：4」を与える。このアクション後、自身に「HP回復：□」。",
            "消耗：④④／FP■■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：10＋戰技威力　效果：對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：威力】與「炎：4」。此動作後，對自身「HP回復：□」。"
          ),
        },
      ],
    },
    {
      id: "greataxe",
      name: C("大斧", "大斧"),
      randomSkillTable: [
        { roll: "1", id: "art_war_cry" },
        { roll: "2", id: "art_endure" },
        { roll: "3", id: "art_dark_wave" },
        { roll: "4", id: "art_lava_eruption" },
        { roll: "5", id: "art_bishop_charge" },
        { roll: "6", id: "art_prayer_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：⑤／2Hit：⑤⑤", "1Hit：⑤／2Hit：⑤⑤"),
        weaponPower: 20,
        powerMod: C("筋力", "力量"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "greataxe_crit_up20",
          name: C("致命の一撃＋20", "致命一擊＋20"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「致命の一撃」を発生させたとき、そのダメージを「＋20」する。",
            "使用此裝備發動遺物效果「致命一擊」時，將該傷害「＋20」。"
          ),
        },
        {
          id: "greataxe_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且此裝備為裝備狀態時，攻擊傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "greataxe_golden_lineage_grace",
          name: C("黄金の一族の加護", "黃金一族的加護"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「タメ攻撃」を行うとき、ダメージに「＋▲」する。",
            "以此裝備發動遺物效果「蓄力攻擊」時，傷害「＋▲」。"
          ),
        },
        {
          id: "greataxe_ghost_affliction_call",
          name: C("霊障招き", "靈障招喚"),
          kind: "Action",
          body: C(
            "コスト：④／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：なし　効果：フェイズ終了まで、対象を「HP価値：－10」する。この効果は重複しない。",
            "消耗：④／FP■　對象：敵人　編隊：前衛時可使用　威力：無　效果：直到階段結束為止，將對象視為「HP價值：－10」。此效果不重複。"
          ),
        },
        {
          id: "greataxe_kneel_before_me",
          name: C("地に伏せよ！", "臣服於地！"),
          kind: "Action",
          body: C(
            "コスト：③③／FP■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：25＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力＋▲】を与える。",
            "消耗：③③／FP■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：25＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力＋▲】。"
          ),
        },
      ],
    },
    {
      id: "great_weapon",
      name: C("特大武器", "特大武器"),
      note: C(
        "この装備品の武器威力に含まれる「▲」は、2Hitアタック時には2倍になり「◆」として扱う点に注意。",
        "此裝備武器威力中的「▲」，在2Hit攻擊時會變為2倍，視為「◆」，請注意。"
      ),
      randomSkillTable: [
        { roll: "1", id: "art_war_cry" },
        { roll: "2", id: "art_endure" },
        { roll: "3", id: "art_dark_wave" },
        { roll: "4", id: "art_lava_eruption" },
        { roll: "5", id: "art_bishop_charge" },
        { roll: "6", id: "art_prayer_strike" },
      ],
      basicStats: {
        attackCost: C("1Hit：⑦／2Hit：⑦⑦", "1Hit：⑦／2Hit：⑦⑦"),
        weaponPower: "45＋▲",
        powerMod: C("筋力", "力量"),
      },
      twoHitBonus: [],
      innateSkills: [
        {
          id: "great_weapon_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "未裝備其他武器・盾・杖・聖印，且此裝備為裝備狀態時，攻擊傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "great_weapon_first_king_grace",
          name: C("最初の王の加護", "最初之王的加護"),
          kind: "Passive",
          body: C(
            "この装備品で遺物効果「タメ攻撃」を行うとき、ダメージに「＋15」する。",
            "以此裝備發動遺物效果「蓄力攻擊」時，傷害「＋15」。"
          ),
        },
        {
          id: "great_weapon_pilgrims_staff_magic",
          name: C("錫杖の魔術", "錫杖的魔術"),
          kind: "Action",
          body: C(
            "コスト：③③／FP■■　対象：エネミー　隊列：前衛・後衛どちらでも使用可能　威力：45＋戦技威力　効果：対象に【総合ダメージ：威力】と「魔：4」を与える。",
            "消耗：③③／FP■■　對象：敵人　編隊：前衛・後衛皆可使用　威力：45＋戰技威力　效果：對敵人造成【總合傷害：威力】與「魔：4」。"
          ),
        },
        {
          id: "great_weapon_golden_tree_slam",
          name: C("黄金樹の尻撃", "黃金樹的尻擊"),
          kind: "Action",
          body: C(
            "コスト：②②②／FP■■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：5＋戦技威力　効果：モブに「HP損害：■■」、エネミーに【総合ダメージ：威力＋▲】と「聖：4」を与える。",
            "消耗：②②②／FP■■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：5＋戰技威力　效果：對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：威力＋▲】與「聖：4」。"
          ),
        },
        {
          id: "great_weapon_oracle_great_bubble",
          name: C("神託の大シャボン", "神諭的大泡沫"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー　隊列：後衛のとき使用可能　威力：40＋戦技威力　効果：対象に【総合ダメージ：威力】と「魔：1D＋2」を与える。",
            "消耗：豹子（2個）／FP■■　對象：敵人　編隊：後衛時可使用　威力：40＋戰技威力　效果：對敵人造成【總合傷害：威力】與「魔：1D＋2」。"
          ),
        },
        {
          id: "great_weapon_wheel_spin",
          name: C("車輪回転", "車輪迴轉"),
          kind: "Action",
          body: C(
            "コスト：連番（2〜3個）／FP■■　対象：エネミー　隊列：前衛のとき使用可能　威力：20＋戦技威力　効果：対象に【総合ダメージ：威力】と「出血：1D」を与える。ダイスコストが「3個」の場合、発生するダメージを「＋10」し、追加効果を「出血：2D」に変更する。",
            "消耗：連號（2〜3個）／FP■■　對象：敵人　編隊：前衛時可使用　威力：20＋戰技威力　效果：對敵人造成【總合傷害：威力】與「出血：1D」。若骰子費用為「3個」，發生的傷害「＋10」，並將追加效果變更為「出血：2D」。"
          ),
        },
        {
          id: "great_weapon_gravity_thunder",
          name: C("重力雷", "重力雷"),
          kind: "Action",
          body: C(
            "コスト：④／FP■　対象：エネミー　隊列：前衛・後衛どちらでも使用可能　威力：0＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】と「魔：2」を与える。",
            "消耗：④／FP■　對象：敵人　編隊：前衛・後衛皆可使用　威力：0＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】與「魔：2」。"
          ),
        },
        {
          id: "great_weapon_kings_roar",
          name: C("王の雄叫び", "王的咆哮"),
          kind: "Action",
          body: C(
            "コスト：①①／FP■　対象：エネミー＋モブ　隊列：前衛・後衛どちらでも使用可能　威力：15＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力】を与える。このアクション後、エンドフェイズまで、この装備品での2Hitアタックによる総合ダメージを「＋5＋▲」する。自身がタリスマン「咆哮のメダリオン（201頁）」を装備状態なら、総合ダメージにさらに「＋5（合計＋10＋▲）」する。",
            "消耗：①①／FP■　對象：敵人＋雜兵　編隊：前衛・後衛皆可使用　威力：15＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力】。此動作後，直到結束階段為止，此裝備2Hit攻擊造成的總合傷害「＋5＋▲」。若自身裝備狀態下持有護符「咆哮的勳章（201頁）」，總合傷害再「＋5（合計＋10＋▲）」。"
          ),
        },
      ],
    },
    {
      id: "spear",
      name: C("槍", "槍"),
      randomSkillTable: [
        { roll: "1", id: "art_charge" },
        { roll: "2", id: "art_spin_slash" },
        { roll: "3", id: "art_giant_hunt" },
        { roll: "4", id: "art_phantom_spear" },
        { roll: "5", id: "art_loretta_slash" },
        { roll: "6", id: "art_frost_spear" },
      ],
      basicStats: {
        attackCost: C("1Hit：②／2Hit：②②", "1Hit：②／2Hit：②②"),
        weaponPower: 10,
        powerMod: C("バランス", "平衡"),
      },
      twoHitBonus: [
        {
          name: C("スタミナダイス1追加", "體力骰1點追加"),
          body: C(
            "この装備品での2Hitアタックの後、自身のスタミナダイスに1点を追加する。",
            "此裝備進行2Hit攻擊後，於自身的體力骰追加一顆1點。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "spear_backline_attack",
          name: C("後衛アタック可能", "後衛可攻擊"),
          kind: "Passive",
          body: C("この装備品は、後衛エリアでもアタックを実行できる。", "此裝備即使在後衛區域也能進行攻擊。"),
        },
      ],
    },
    {
      id: "great_spear",
      name: C("大槍", "大槍"),
      randomSkillTable: [
        { roll: "1", id: "art_charge" },
        { roll: "2", id: "art_spin_slash" },
        { roll: "3", id: "art_giant_hunt" },
        { roll: "4", id: "art_phantom_spear" },
        { roll: "5", id: "art_loretta_slash" },
        { roll: "6", id: "art_frost_spear" },
      ],
      basicStats: {
        attackCost: C("1Hit：④／2Hit：④④", "1Hit：④／2Hit：④④"),
        weaponPower: 20,
        powerMod: C("バランス", "平衡"),
      },
      twoHitBonus: [
        {
          name: C("スタミナダイス2追加", "體力骰2點追加"),
          body: C(
            "この装備品での2Hitアタックの後、自身のスタミナダイスに2点を追加する。",
            "此裝備進行2Hit攻擊後，於自身的體力骰追加一顆2點。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "great_spear_blood_lord_grace",
          name: C("血の君主の加護", "血之君主的加護"),
          kind: "Passive",
          body: C(
            "この装備品が装備状態ではなく、準備状態でも効果を発揮する。自身、他のPC1人、エネミーのいずれかに「状態異常：出血」の蓄積値が上限まで蓄積したとき効果を発揮。戦闘終了まで、自身の総合ダメージに「＋10」する。この効果は重複しない。",
            "此裝備即使不是裝備狀態，處於準備狀態時也會發揮效果。當自身、其他1名PC、敵人任一方的「異常狀態：出血」蓄積值達到上限時發揮效果。直到戰鬥結束為止，自身的總合傷害「＋10」。此效果不重複。"
          ),
        },
        {
          id: "great_spear_serpent_hunt",
          name: C("大蛇狩り", "獵大蛇"),
          kind: "Action",
          body: C(
            "コスト：④④／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：50＋戦技威力　効果：対象に【総合ダメージ：威力＋▲】を与える。",
            "消耗：④④／FP■　對象：敵人　編隊：前衛時可使用　威力：50＋戰技威力　效果：對敵人造成【總合傷害：威力＋▲】。"
          ),
        },
        {
          id: "great_spear_ciriria_vortex",
          name: C("シルリアの渦", "西琉里亞的漩渦"),
          kind: "Action",
          body: C(
            "コスト：②③／FP■■　対象：エネミー　隊列：前衛のとき使用可能　威力：60＋戦技威力　効果：対象に【総合ダメージ：威力】と「聖：1D」を与える。",
            "消耗：②③／FP■■　對象：敵人　編隊：前衛時可使用　威力：60＋戰技威力　效果：對敵人造成【總合傷害：威力】與「聖：1D」。"
          ),
        },
        {
          id: "great_spear_mad_flame_thrust",
          name: C("狂い火突き", "狂焰突刺"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー　隊列：後衛のとき使用可能　威力：5＋戦技威力　効果：対象に【総合ダメージ：威力】と「炎：4」と「発狂：1D」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：豹子（2個）／FP■■　對象：敵人　編隊：後衛時可使用　威力：5＋戰技威力　效果：對敵人造成【總合傷害：威力】與「炎：4」與「發狂：1D」。此動作後，自身移動至前衛區域。"
          ),
        },
        {
          id: "great_spear_blood_gifting_rite",
          name: C("血授の儀", "授血之儀"),
          kind: "Action",
          body: C(
            "コスト：連番（3個）／FP■■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：0＋戦技威力　効果：モブに「HP損害：■■」、エネミーに【総合ダメージ：威力】と「炎：1D」と「出血：1D」を与える。",
            "消耗：連號（3個）／FP■■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：0＋戰技威力　效果：對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：威力】與「炎：1D」與「出血：1D」。"
          ),
        },
      ],
    },
    {
      id: "halberd",
      name: C("斧槍", "斧槍"),
      basicStats: {
        attackCost: C("1Hit：⑤／2Hit：⑤⑤", "1Hit：⑤／2Hit：⑤⑤"),
        weaponPower: 25,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("スタミナダイス3追加", "體力骰3點追加"),
          body: C(
            "この装備品での2Hitアタックの後、自身のスタミナダイスに3点を追加する。",
            "此裝備進行2Hit攻擊後，於自身的體力骰追加一顆3點。"
          ),
        },
      ],
      randomSkillTable: [
        { roll: "1", id: "art_charge" },
        { roll: "2", id: "art_spin_strike" },
        { roll: "3", id: "art_black_flame_vortex" },
        { roll: "4", id: "art_storm_assault" },
        { roll: "5", id: "art_loretta_slash" },
        { roll: "6", id: "art_flame_strike_halberd" },
      ],
      innateSkills: [
        {
          id: "halberd_two_handed_bonus",
          name: C("両手持ちダメージ＋", "雙手持傷害＋"),
          kind: "Passive",
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、アタックのダメージを「1Hit：＋5／2Hit：＋10」する。",
            "若未裝備其他武器・盾・杖・聖印，且裝備此裝備品，則攻擊傷害「1Hit：＋5／2Hit：＋10」。"
          ),
        },
        {
          id: "halberd_under_the_banner",
          name: C("軍旗の下に", "軍旗之下"),
          kind: "Action",
          body: C(
            "コスト：③／FP■■　対象：エネミー　隊列：前衛・後衛どちらでも使用可能　効果：対象に【総合ダメージ：（このフェイズ中に、総合ダメージを1度でも発生させたPCの人数）×20】を与える。",
            "消耗：③／FP■■　對象：敵人　編隊：前衛・後衛皆可使用　效果：對敵人造成【總合傷害：（此階段中，曾造成過一次以上總合傷害的PC人數）×20】。"
          ),
        },
      ],
    },
    {
      id: "scythe",
      name: C("鎌", "鐮"),
      basicStats: {
        attackCost: C("1Hit：④／2Hit：④④", "1Hit：④／2Hit：④④"),
        weaponPower: 15,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("属性蓄積値＋2", "屬性蓄積值＋2"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し属性蓄積値が加算されるとき「蓄積値：＋2」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成屬性蓄積值，則「蓄積值：＋2」。"
          ),
        },
        {
          name: C("状態異常蓄積値＋1", "異常狀態蓄積值＋1"),
          body: C(
            "この装備品での2Hitアタックで、エネミーに対し状態異常蓄積値が加算されるとき「蓄積値：＋1」する。",
            "此裝備使用2Hit攻擊時，若對敵人造成異常狀態蓄積值，則「蓄積值：＋1」。"
          ),
        },
      ],
      randomSkillTable: [
        { roll: "1", id: "art_holy_halo" },
        { roll: "2", id: "art_spin_strike" },
        { roll: "3", id: "art_black_flame_vortex" },
        { roll: "4", id: "art_loretta_slash" },
        { roll: "5", id: "art_cold_mist" },
        { roll: "6", id: "art_poison_mist" },
      ],
      innateSkills: [
        {
          id: "scythe_miquella_halo",
          name: C("ミケラの光輪", "米凱拉的光輪"),
          kind: "Action",
          body: C(
            "コスト：③／FP■　対象：エネミー　隊列：後衛のとき使用可能　威力：25＋戦技威力　効果：対象に【総合ダメージ：威力】と「聖：2」を与える。このアクション後、フェイズ終了まで、このスキルは「コスト：③」に変更される（FPコスト不要になる）。",
            "消耗：③／FP■　對象：敵人　編隊：後衛時可使用　威力：25＋戰技威力　效果：對敵人造成【總合傷害：威力】與「聖：2」。此動作後，直到階段結束為止，此技能變更為「消耗：③」（不需要FP消耗）。"
          ),
        },
        {
          id: "scythe_angel_wing",
          name: C("天使の翼", "天使之翼"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー　隊列：後衛のとき使用可能　威力：65＋戦技威力　効果：対象に【総合ダメージ：威力】と「聖：2」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：豹子（2個）／FP■■　對象：敵人　編隊：後衛時可使用　威力：65＋戰技威力　效果：對敵人造成【總合傷害：威力】與「聖：2」。此動作後，自身移動至前衛區域。"
          ),
        },
      ],
    },
    {
      id: "whip",
      name: C("鞭", "鞭"),
      basicStats: {
        attackCost: C("1Hit：②／2Hit：②②", "1Hit：②／2Hit：②②"),
        weaponPower: 5,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      randomSkillTable: [
        { roll: "1", id: "art_holy_law_share" },
        { roll: "2", id: "art_endure" },
        { roll: "3", id: "art_hound_step" },
        { roll: "4", id: "art_red_lion_flame" },
        { roll: "5", id: "art_frost_step" },
        { roll: "6", id: "art_white_shadow_invite" },
      ],
      innateSkills: [
        {
          id: "whip_lava_sea",
          name: C("溶岩の海", "熔岩之海"),
          kind: "Action",
          body: C(
            "コスト：②／FP■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：0＋戦技威力　効果：モブに「HP損害：■」、エネミーに【総合ダメージ：威力】と「炎：2」を与える。このアクション後、フェイズ終了まで、このスキルは「コスト：②」に変更される（FPコスト不要になる）。",
            "消耗：②／FP■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：0＋戰技威力　效果：對雜兵造成「HP損害：■」，對敵人造成【總合傷害：威力】與「炎：2」。此動作後，直到階段結束為止，此技能變更為「消耗：②」（不需要FP消耗）。"
          ),
        },
        {
          id: "whip_flame_dance",
          name: C("炎の舞", "炎之舞"),
          kind: "Action",
          body: C(
            "コスト：③／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：25＋戦技威力　効果：対象に【総合ダメージ：威力】と「炎：2」を与える。ダイスコストに「⚅」が含まれているなら、「炎：2」を追加する。このアクション後、フェイズ終了まで、このスキルは「コスト：③」に変更される（FPコスト不要になる）。",
            "消耗：③／FP■　對象：敵人　編隊：前衛時可使用　威力：25＋戰技威力　效果：對敵人造成【總合傷害：威力】與「炎：2」。若骰子費用包含「⚅」，追加「炎：2」。此動作後，直到階段結束為止，此技能變更為「消耗：③」（不需要FP消耗）。"
          ),
        },
      ],
    },
    {
      id: "fist",
      name: C("拳", "拳"),
      basicStats: {
        attackCost: C("1Hit：①①／2Hit：②②", "1Hit：①①／2Hit：②②"),
        weaponPower: 10,
        powerMod: C("バランス（※一部の武器は例外あり）", "平衡（※部分武器有例外）"),
      },
      twoHitBonus: [
        {
          name: C("この装備品だけ装備時ダメージ＋10", "僅裝備此裝備品時傷害＋10"),
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、2Hitアタックのダメージを「＋10」する。",
            "若未裝備其他武器・盾・杖・聖印，且裝備此裝備品，則2Hit攻擊傷害「＋10」。"
          ),
        },
      ],
      randomSkillTable: [
        { roll: "1〜2", id: "art_kick" },
        { roll: "3", id: "art_hip_drop" },
        { roll: "4", id: "art_savage_roar" },
        { roll: "5", id: "art_hound_step" },
        { roll: "6", id: "art_thunder_sheep" },
      ],
      innateSkills: [
        {
          id: "fist_dragon_grace",
          name: C("飛竜の加護", "飛龍之加護"),
          kind: "Passive",
          body: C(
            "このスキルを持つ武器で遺物効果「致命の一撃」を行ったとき、発生するダメージに「炎：2D」を追加する。",
            "此技能所屬武器發動遺物效果「致命一擊」時，發生的傷害追加「炎：2D」。"
          ),
        },
        {
          id: "fist_life_reaping_fist",
          name: C("命奪拳", "奪命拳"),
          kind: "Action",
          body: C(
            "コスト：連番（2個）／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：60＋戦技威力　効果：対象に【総合ダメージ：威力】を与える。このアクション後、自身に「HP回復：□」。",
            "消耗：連號（2個）／FP■　對象：敵人　編隊：前衛時可使用　威力：60＋戰技威力　效果：對敵人造成【總合傷害：威力】。此動作後，自身「HP回復：□」。"
          ),
        },
        {
          id: "fist_storm_kick",
          name: C("嵐蹴撃", "嵐蹴擊"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■　対象：エネミー　隊列：後衛のとき使用可能　威力：40＋戦技威力　効果：対象に【総合ダメージ：威力】と「雷：4」を与える。このアクション後、自身は前衛エリアに移動する。",
            "消耗：豹子（2個）／FP■　對象：敵人　編隊：後衛時可使用　威力：40＋戰技威力　效果：對敵人造成【總合傷害：威力】與「雷：4」。此動作後，自身移動至前衛區域。"
          ),
        },
        {
          id: "fist_behold",
          name: C("ご照覧あれい！", "請鑒察吧！"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP■■　対象：エネミー＋モブ　隊列：前衛のとき使用可能　威力：15＋戦技威力　効果：モブに「HP損害：■■」、対象に【総合ダメージ：威力】と「炎：1D」を与える。",
            "消耗：豹子（2個）／FP■■　對象：敵人＋雜兵　編隊：前衛時可使用　威力：15＋戰技威力　效果：對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：威力】與「炎：1D」。"
          ),
        },
      ],
    },
    {
      id: "claw",
      name: C("爪", "爪"),
      basicStats: {
        attackCost: C("1Hit：①②／2Hit：②③", "1Hit：①②／2Hit：②③"),
        weaponPower: 15,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("この装備品だけ装備時ダメージ＋10", "僅裝備此裝備品時傷害＋10"),
          body: C(
            "他の武器・盾・杖・聖印を装備状態にしておらず、この装備品を装備状態なら、2Hitアタックのダメージを「＋10」する。",
            "若未裝備其他武器・盾・杖・聖印，且裝備此裝備品，則2Hit攻擊傷害「＋10」。"
          ),
        },
      ],
      randomSkillTable: [
        { roll: "1〜2", id: "art_kick" },
        { roll: "3", id: "art_hip_drop" },
        { roll: "4", id: "art_savage_roar" },
        { roll: "5", id: "art_hound_step" },
        { roll: "6", id: "art_thunder_sheep" },
      ],
    },
    {
      id: "bow",
      isRanged: true,
      name: C("弓", "弓"),
      randomSkillTable: [
        { roll: "1", id: "art_strong_shot" },
        { roll: "2", id: "art_piercing_shot" },
        { roll: "3", id: "art_continuous_shot" },
        { roll: "4", id: "art_empty_shot" },
        { roll: "5", id: "art_stormhawk_shot" },
        { roll: "6", id: "art_arrow_rain" },
      ],
      basicStats: {
        attackCost: C("1Hit：③／2Hit：③③", "1Hit：③／2Hit：③③"),
        weaponPower: 10,
        powerMod: C("技量", "技巧"),
      },
      twoHitBonus: [
        {
          name: C("総合＆復帰ダメージ＋10", "總合＆復歸傷害＋10"),
          body: C(
            "この装備品での全ての2Hitアタックによる総合ダメージと復帰ダメージを「＋10」する。",
            "此裝備所有的2Hit攻擊所造成的總合傷害與復歸傷害「＋10」。"
          ),
        },
      ],
      innateSkills: [],
    },
    {
      id: "greatbow",
      isRanged: true,
      name: C("大弓", "大弓"),
      basicStats: {
        attackCost: C("1Hit：⑤／2Hit：⑤⑤", "1Hit：⑤／2Hit：⑤⑤"),
        weaponPower: 15,
        powerMod: C("バランス", "平衡"),
      },
      twoHitBonus: [
        {
          name: C("総合ダメージ＋▲", "總合傷害＋▲"),
          body: C(
            "この装備品での2Hitアタックによる総合ダメージを「＋▲」する。",
            "此裝備2Hit攻擊所造成的總合傷害「＋▲」。"
          ),
        },
      ],
      innateSkills: [
        {
          id: "greatbow_general_grace",
          name: C("将軍の加護", "將軍之加護"),
          kind: "Passive",
          body: C(
            "この装備品での2Hitアタックを行ったとき、ダイスコストに「図」が含まれるなら、ダメージを「＋15」する。",
            "使用此裝備進行2Hit攻擊時，若骰子消耗中含有「圖」，則傷害「＋15」。"
          ),
        },
        {
          id: "greatbow_radahn_downpour",
          name: C("ラダーンの驟雨", "拉塔恩的驟雨"),
          kind: "Action",
          body: C(
            "コスト：④④／FP■　対象：エネミー・モブ　隊列：後衛のとき使用可能　威力：50　効果：モブに「HP損害：■■」、エネミーに【総合ダメージ：威力】を与える。エネミーが「サイズ：LL」の場合、ダメージを「＋15」する。",
            "消耗：④④／FP■　對象：敵人・雜兵　編隊：後衛時可使用　威力：50　效果：對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：威力】。敵人「體型：LL」時，傷害「＋15」。"
          ),
        },
      ],
    },
    {
      id: "crossbow",
      isRanged: true,
      name: C("クロスボウ", "弩"),
      basicStats: {
        attackCost: C("1Hit：⑤", "1Hit：⑤"),
        weaponPower: 35,
        powerMod: C("なし", "無"),
      },
      twoHitBonus: [],
      innateSkills: [
        {
          id: "crossbow_kick",
          name: C("キック", "踢擊"),
          kind: "Action",
          body: C(
            "コスト：①　対象：エネミー　隊列：前衛のとき使用可能　効果：対象に「▲」を与える。このスキルは1ターンの間にPC1人ごとに1度しか使用できない。",
            "消耗：①　對象：敵人　編隊：前衛時可使用　效果：對敵人造成「▲」。此技能於1回合內每名PC限用1次。"
          ),
        },
      ],
    },
    {
      id: "ballista",
      isRanged: true,
      name: C("バリスタ", "弩砲"),
      basicStats: {
        attackCost: C("1Hit：⑦", "1Hit：⑦"),
        weaponPower: "40＋▲",
        powerMod: C("なし", "無"),
      },
      twoHitBonus: [],
      innateSkills: [],
    },
    // ▼盾（小盾／中盾／大盾）：武器と異なりガードコスト／レア度別ガード時HP価値を持ち、
    // 装備品スキル欄も「付随効果」と「逆手の戦技（ガード時戦技）」の2種類に分かれる（isShield: true）。
    // 種類決定表は写真の情報密度が非常に高く（各カテゴリ15種以上）、現時点ではC帯を中心とした
    // 部分的な収録にとどめている。続報の写真があれば拡充する。
    {
      id: "small_shield",
      isShield: true,
      name: C("小盾", "小盾"),
      basicStats: {
        guardCost: C("①", "①"),
        guardHpCU: 50,
        guardHpRL: 60,
        powerMod: C("バランス", "平衡"),
      },
      randomSkillTable: [
        { roll: "1", id: "art_shield_invincible" },
        { roll: "2", id: "art_shield_parry" },
        { roll: "3", id: "art_sanctuary" },
        { roll: "4", id: "art_shield_bash" },
        { roll: "5", id: "art_charging_bash" },
        { roll: "6", id: "art_stalwart_shield" },
      ],
      innateSkills: [
        {
          id: "small_shield_reverse_parry",
          name: C("バックラーパリィ", "巴克勒格擋"),
          kind: "Defense",
          body: C(
            "コスト：連番（2個）　対象：自身　隊列：前衛・後衛どちらでも使用可能　効果：「ガード」の代わりに使用できる。自身に適用されるダメージ1回分を完全に無効化し、追加効果も無効化する。その後、次のアクションフェイズ開始時のスタミナダイスを1個追加する。",
            "消耗：連號（2個）　對象：自身　編隊：前衛・後衛皆可使用　效果：可代替「防禦」使用。完全無效化自身承受的1次傷害，追加效果也一併無效化。之後下個行動階段開始時追加1個體力骰。"
          ),
        },
        {
          id: "small_shield_poison_bite",
          name: C("毒蛇の噛みつき", "毒蛇之噬咬"),
          kind: "Action",
          body: C(
            "コスト：⑤／FP■　対象：エネミー　隊列：前衛のとき使用可能　威力：10　効果：対象に【総合ダメージ：威力】と「毒：1D」を与える。",
            "消耗：⑤／FP■　對象：敵人　編隊：前衛時可使用　威力：10　效果：對敵人造成【總合傷害：威力】與「毒：1D」。"
          ),
        },
      ],
    },
    {
      id: "medium_shield",
      isShield: true,
      name: C("中盾", "中盾"),
      basicStats: {
        guardCost: C("②", "②"),
        guardHpCU: 70,
        guardHpRL: 80,
        powerMod: C("筋力", "力量"),
      },
      randomSkillTable: [
        { roll: "1", id: "art_shield_invincible" },
        { roll: "2", id: "art_shield_parry" },
        { roll: "3", id: "art_sanctuary" },
        { roll: "4", id: "art_shield_bash" },
        { roll: "5", id: "art_charging_bash" },
        { roll: "6", id: "art_stalwart_shield" },
      ],
      innateSkills: [],
    },
    {
      id: "large_shield",
      isShield: true,
      name: C("大盾", "大盾"),
      randomSkillTable: [
        { roll: "1", id: "art_shield_invincible" },
        { roll: "2", id: "art_shield_parry" },
        { roll: "3", id: "art_sanctuary" },
        { roll: "4", id: "art_shield_bash" },
        { roll: "5", id: "art_charging_bash" },
        { roll: "6", id: "art_stalwart_shield" },
      ],
      basicStats: {
        guardCost: C("③", "③"),
        guardHpCU: 90,
        guardHpRL: 100,
        powerMod: C("筋力", "力量"),
      },
      innateSkills: [
        {
          id: "large_shield_golden_retribution",
          name: C("黄金の返報", "黃金的回報"),
          kind: "Defense",
          body: C(
            "コスト：ゾロ（2個）　対象：自身　隊列：前衛・後衛どちらでも使用可能　効果：「ガード」の代わりに使用できる。自身に適用されるダメージ1回分を完全に無効化し、追加効果も無効化する。このディフェンス後、無効化したエネミーのダメージに「属性」が含まれていた場合、自分が与えたこととして、エネミーに対して同じだけの属性を蓄積する（跳ね返す）。",
            "消耗：豹子（2個）　對象：自身　編隊：前衛・後衛皆可使用　效果：可代替「防禦」使用。完全無效化自身承受的1次傷害，追加效果也一併無效化。此防禦後，若被無效化的敵人傷害含有「屬性」，則視為由自身造成，對敵人累積相同數值的該屬性（反彈）。"
          ),
        },
        {
          id: "large_shield_flame_belch",
          name: C("火炎舌", "火焰舌"),
          kind: "Action",
          body: C(
            "コスト：連番（2〜3個）／FP　対象：エネミー　隊列：前衛のとき使用可能　威力：35　効果：対象に【総合ダメージ：威力】と「炎：1D」を与える。コストが「3個」の場合、発生するダメージを「＋10」し、追加効果を「炎：2D」に変更する。",
            "消耗：連號（2～3個）／FP　對象：敵人　編隊：前衛時可使用　威力：35　效果：對敵人造成【總合傷害：威力】與「炎：1D」。花費為「3個」時，發生的傷害「＋10」，追加效果變更為「炎：2D」。"
          ),
        },
        {
          id: "large_shield_flame_spit",
          name: C("炎の唾", "炎之唾"),
          kind: "Action",
          body: C(
            "コスト：ゾロ（2個）／FP　対象：エネミー　隊列：後衛のとき使用可能　威力：10　効果：対象に【総合ダメージ：威力＋▲】と「炎：4」を与える。",
            "消耗：豹子（2個）／FP　對象：敵人　編隊：後衛時可使用　威力：10　效果：對敵人造成【總合傷害：威力＋▲】與「炎：4」。"
          ),
        },
        {
          id: "large_shield_contagious_fury",
          name: C("伝染する怒り", "傳染的憤怒"),
          kind: "Action",
          body: C(
            "コスト：FP　対象：自身　隊列：前衛・後衛どちらでも使用可能　効果：自身が装備状態の武器を任意に1つ選ぶ。フェイズ終了まで、選んだ武器から発生する、アタックのダメージを「1Hit：＋5／2Hit：＋10」し、戦技のダメージを「＋5」する。この効果は重複しない。",
            "消耗：FP　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到階段結束為止，所選武器造成的攻擊傷害「1Hit：＋5／2Hit：＋10」，戰技傷害「＋5」。此效果不重複。"
          ),
        },
      ],
    },
    // 杖（staff）：他の武器と異なり、装備品スキル欄は「魔術」（戦技とは別の呪文体系、154頁ではなく
    // 185〜190頁を参照）を指す。杖自体にアタックコスト／武器威力は存在しない（威力補正のみ影響）。
    // ランダム魔術決定表はA1〜A6・B1〜B6の12グループ×各6種＝計72種と非常に広大なため、
    // 固有魔術（各杖が個別に参照する魔術）を中心に収録し、ランダム枠は基本的に random 扱いとした。
    {
      id: "staff",
      name: C("杖", "杖"),
      basicStats: {
        attackCost: C("なし", "無"),
        weaponPower: 0,
        powerMod: C("知力", "智力"),
      },
      innateSkills: [],
      namedSkillTables: [
        {
          title: C("ランダム魔術（A）決定表", "隨機魔術（A）決定表"),
          rows: [
            { roll: "1・2／1", id: "spell_quick_pebble" },
            { roll: "1・2／2", id: "spell_greater_pebble" },
            { roll: "1・2／3", id: "spell_comet" },
            { roll: "1・2／4", id: "spell_glintstone_stars" },
            { roll: "1・2／5", id: "spell_swirling_pebble" },
            { roll: "1・2／6", id: "spell_glintstone_arc" },
            { roll: "3／1", id: "spell_haimas_ordnance" },
            { roll: "3／2", id: "spell_haimas_greathammer" },
            { roll: "3／3", id: "spell_magic_weapon" },
            { roll: "3／4", id: "spell_magic_shield" },
            { roll: "3／5", id: "spell_thops_barrier" },
            { roll: "3／6", id: "spell_stars_of_ruin" },
            { roll: "4／1", id: "spell_crystal_release" },
            { roll: "4／2", id: "spell_crystal_burst" },
            { roll: "4／3", id: "spell_lorettas_greatbow" },
            { roll: "4／4", id: "spell_lorettas_mastery" },
            { roll: "4／5", id: "spell_ranis_dark_moon" },
            { roll: "4／6", id: "spell_carian_retaliation" },
            { roll: "5／1", id: "spell_briars_of_sin" },
            { roll: "5／2", id: "spell_thorns_of_punishment" },
            { roll: "5／3", id: "spell_rock_sling" },
            { roll: "5／4", id: "spell_stoneblast" },
            { roll: "5／5", id: "spell_night_shard" },
            { roll: "5／6", id: "spell_night_comet" },
            { roll: "6／1", id: "spell_royal_carian_glintblade" },
            { roll: "6／2", id: "spell_glintblade_arc" },
            { roll: "6／3", id: "spell_carian_arc" },
            { roll: "6／4", id: "spell_shattering_crystal" },
            { roll: "6／5", id: "spell_released_crystal" },
            { roll: "6／6", id: "spell_crystal_release_full" },
          ],
        },
        {
          title: C("ランダム魔術（B）決定表", "隨機魔術（B）決定表"),
          rows: [
            { roll: "1・2／1", id: "spell_quick_pebble" },
            { roll: "1・2／2", id: "spell_greater_pebble" },
            { roll: "1・2／3", id: "spell_comet" },
            { roll: "1・2／4", id: "spell_glintstone_stars" },
            { roll: "1・2／5", id: "spell_swirling_pebble" },
            { roll: "1・2／6", id: "spell_glintstone_arc" },
            { roll: "3／1", id: "spell_carian_slicer" },
            { roll: "3／2", id: "spell_carian_greatsword" },
            { roll: "3／3", id: "spell_carian_piercer" },
            { roll: "3／4", id: "spell_adulas_moonblade" },
            { roll: "3／5", id: "spell_night_maidens_mist" },
            { roll: "3／6", id: "spell_eternal_darkness" },
            { roll: "4／1", id: "spell_lava_bolt" },
            { roll: "4／2", id: "spell_boiling_lava" },
            { roll: "4／3", id: "spell_gelmirs_fury" },
            { roll: "4／4", id: "spell_rykards_rancor" },
            { roll: "4／5", id: "spell_oracle_bubbles" },
            { roll: "4／6", id: "spell_oracle_bubble_giant" },
            { roll: "5／1", id: "spell_gravity_bolt" },
            { roll: "5／2", id: "spell_star_shatter" },
            { roll: "5／3", id: "spell_rock_blast" },
            { roll: "5／4", id: "spell_meteorite" },
            { roll: "5／5", id: "spell_astel_meteor" },
            { roll: "5／6", id: "spell_tibias_call" },
            { roll: "6／1", id: "spell_glintstone_icecrag" },
            { roll: "6／2", id: "spell_frost_mist" },
            { roll: "6／3", id: "spell_frozen_armament" },
            { roll: "6／4", id: "spell_zamors_hail" },
            { roll: "6／5", id: "spell_ancient_death_rancor" },
            { roll: "6／6", id: "spell_bursting_spiritflame" },
          ],
        },
      ],
    },
    // 聖印（sacred_seal）：杖と同様、装備品スキル欄は祈祷（191〜199頁）を参照する。杖の魔術以上に
    // ページ数・種類（A1〜A6／B1〜B6／C1〜C3の計15グループ×各6種）が多く、今回は判読できた
    // 祈祷を中心とした部分収録。
    {
      id: "sacred_seal",
      name: C("聖印", "聖印"),
      basicStats: {
        attackCost: C("なし", "無"),
        weaponPower: 0,
        powerMod: C("信仰", "信仰"),
      },
      innateSkills: [],
      namedSkillTables: [
        {
          title: C("ランダム祈祷（A）決定表", "隨機祈禱（A）決定表"),
          rows: [
            { roll: "1／1", id: "prayer_urgent_heal" },
            { roll: "1／2", id: "prayer_heal" },
            { roll: "1／3", id: "prayer_great_heal" },
            { roll: "1／4", id: "prayer_kings_heal" },
            { roll: "1／5", id: "prayer_shadow_sending" },
            { roll: "1／6", id: "prayer_darkness" },
            { roll: "2／1", id: "prayer_magic_barrier" },
            { roll: "2／2", id: "prayer_holy_barrier" },
            { roll: "2／3", id: "prayer_flame_barrier" },
            { roll: "2／4", id: "prayer_lightning_barrier" },
            { roll: "2／5・6", id: "prayer_kings_holy_barrier" },
            { roll: "3／1", id: "prayer_erdtree_vow" },
            { roll: "3／2", id: "prayer_golden_magic_barrier" },
            { roll: "3／3", id: "prayer_golden_lightning_barrier" },
            { roll: "3／4", id: "prayer_erdtree_protection" },
            { roll: "3／5", id: "prayer_erdtree_heal" },
            { roll: "3／6", id: "prayer_erdtree_bounty" },
            { roll: "4／1", id: "prayer_crucible_aspect_gullet" },
            { roll: "4／2", id: "prayer_crucible_aspect_tail" },
            { roll: "4／3", id: "prayer_crucible_aspect_horns" },
            { roll: "4／4", id: "prayer_erdstar" },
            { roll: "4／5", id: "prayer_black_blade" },
            { roll: "4／6", id: "prayer_death_correcting_edict" },
            { roll: "5／1", id: "prayer_law_of_regression_blade" },
            { roll: "5／2", id: "prayer_unchanging_shield" },
            { roll: "5／3", id: "prayer_regression" },
            { roll: "5／4", id: "prayer_golden_order_fundamentalism_halo" },
            { roll: "5／5", id: "prayer_triple_rings_of_light" },
            { roll: "5／6", id: "prayer_radagons_rings_of_light" },
            { roll: "6／1", id: "prayer_lightning_spear" },
            { roll: "6／2", id: "prayer_lightning_strike" },
            { roll: "6／3", id: "prayer_aimed_lightning_strike" },
            { roll: "6／4", id: "prayer_ancient_dragon_lightning_spear" },
            { roll: "6／5", id: "prayer_lansseaxs_glaive" },
            { roll: "6／6", id: "prayer_fortissaxs_lightning_spear" },
          ],
        },
        {
          title: C("ランダム祈祷（B）決定表", "隨機祈禱（B）決定表"),
          rows: [
            { roll: "1／1", id: "prayer_urgent_heal" },
            { roll: "1／2", id: "prayer_heal" },
            { roll: "1／3", id: "prayer_great_heal" },
            { roll: "1／4", id: "prayer_kings_heal" },
            { roll: "1／5", id: "prayer_shadow_sending" },
            { roll: "1／6", id: "prayer_darkness" },
            { roll: "2／1", id: "prayer_frozen_lightning_spear" },
            { roll: "2／2", id: "prayer_deadly_lightning_strike" },
            { roll: "2／3", id: "prayer_lightning_weapon" },
            { roll: "2／4", id: "prayer_dragon_lightning_blessing" },
            { roll: "2／5", id: "prayer_poison_mist" },
            { roll: "2／6", id: "prayer_poison_blade" },
            { roll: "3／1", id: "prayer_fire_exclaim" },
            { roll: "3／2", id: "prayer_firebomb" },
            { roll: "3／3", id: "prayer_giants_flame_take_this" },
            { roll: "3／4", id: "prayer_fire_fall_upon" },
            { roll: "3／5", id: "prayer_flame_of_the_fell_god" },
            { roll: "3／6", id: "prayer_fire_giant_scorn" },
            { roll: "4／1", id: "prayer_black_flame" },
            { roll: "4／2", id: "prayer_black_flame_sweep" },
            { roll: "4／3", id: "prayer_black_flame_ritual" },
            { roll: "4／4", id: "prayer_black_flame_blade" },
            { roll: "4／5", id: "prayer_black_flame_protection" },
            { roll: "4／6", id: "prayer_noble_presence" },
            { roll: "5／1・2", id: "prayer_beast_claw" },
            { roll: "5／3", id: "prayer_beast_stone" },
            { roll: "5／4", id: "prayer_gurranqs_beast_claw" },
            { roll: "5／5", id: "prayer_gurranqs_boulder" },
            { roll: "5／6", id: "prayer_beast_vitality" },
            { roll: "6／1", id: "prayer_wax_swarm" },
            { roll: "6／2", id: "prayer_bloodflame_talons" },
            { roll: "6／3", id: "prayer_blood_blessing" },
            { roll: "6／4", id: "prayer_bloodflame_blade" },
            { roll: "6／5", id: "prayer_worm_thread" },
            { roll: "6／6", id: "prayer_scarlet_aeonia" },
          ],
        },
        {
          title: C("ランダム祈祷（C）決定表", "隨機祈禱（C）決定表"),
          rows: [
            { roll: "1／1・2", id: "prayer_frenzied_flame" },
            { roll: "1／3・4", id: "prayer_unbearable_frenzied_flame" },
            { roll: "1／5", id: "prayer_rupturing_frenzied_flame" },
            { roll: "1／6", id: "prayer_howl_of_shabriri" },
            { roll: "2／1", id: "prayer_dragon_feast" },
            { roll: "2／2", id: "prayer_lava_breath" },
            { roll: "2／3", id: "prayer_glintstone_breath" },
            { roll: "2／4", id: "prayer_rot_breath" },
            { roll: "2／5", id: "prayer_dragon_ice_breath" },
            { roll: "2／6", id: "prayer_dragon_claw" },
            { roll: "3／1", id: "prayer_agheels_flame" },
            { roll: "3／2", id: "prayer_theodorix_lava" },
            { roll: "3／3", id: "prayer_smarags_glintstone" },
            { roll: "3／4", id: "prayer_ekzykes_decay" },
            { roll: "3／5", id: "prayer_borealis_mist" },
            { roll: "3／6", id: "prayer_greyolls_roar" },
            { roll: "4／1", id: "prayer_black_flame" },
            { roll: "4／2", id: "prayer_black_flame_sweep" },
            { roll: "4／3", id: "prayer_black_flame_ritual" },
            { roll: "4／4", id: "prayer_black_flame_blade" },
            { roll: "4／5", id: "prayer_black_flame_protection" },
            { roll: "4／6", id: "prayer_noble_presence" },
            { roll: "5／1・2", id: "prayer_beast_claw" },
            { roll: "5／3", id: "prayer_beast_stone" },
            { roll: "5／4", id: "prayer_gurranqs_beast_claw" },
            { roll: "5／5", id: "prayer_gurranqs_boulder" },
            { roll: "5／6", id: "prayer_beast_vitality" },
            { roll: "6／1", id: "prayer_lightning_spear" },
            { roll: "6／2", id: "prayer_lightning_strike" },
            { roll: "6／3", id: "prayer_aimed_lightning_strike" },
            { roll: "6／4", id: "prayer_ancient_dragon_lightning_spear" },
            { roll: "6／5", id: "prayer_lansseaxs_glaive" },
            { roll: "6／6", id: "prayer_fortissaxs_lightning_spear" },
          ],
        },
      ],
    },
  ];
})();
