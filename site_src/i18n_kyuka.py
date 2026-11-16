"""九華（kyuka）的 UI 字串（zh / ja / en）。由 i18n_data.py 合併；generate.py 依 ky_ 前綴輸出成 static/i18n/kyuka.js。
角色名稱、固有技能、標籤名稱放在 static_src/kyuka_data.js（{zh, ja, en}）；81 型名目前只有中文。"""

from __future__ import annotations

_ROWS: tuple[tuple[str, str, str, str], ...] = (
    ("ky_title", "九華招募", "九華招募", "Kyuka Recruit"),
    ("ky_gacha_lede", "每位新人的九華（九項能力）都是隨機的。稀有度越低，一開始看得到的花瓣越少，提升親密度才會綻放。", "新人の九華（九つの能力）はすべてランダム。レアリティが低いほど最初に見える花びらが少なく、親密度を上げると開いていきます。", "Every recruit rolls nine random stats. Lower rarities start with fewer petals visible; raise affection to make them bloom."),
    ("ky_gacha_empty", "按下招募，看看會遇見誰。", "招募を押して、誰に出会えるか見てみましょう。", "Recruit to see who you meet."),
    ("ky_pull1", "招募 1 次", "1 回招募", "Recruit ×1"),
    ("ky_pull10", "招募 10 次", "10 回招募", "Recruit ×10"),
    ("ky_pull10_note", "10 次招募必定有一位 SR 以上。試作版免費，可以無限招募。", "10 回招募は SR 以上が 1 人確定。試作版は無料で何度でも引けます。", "A ×10 recruit guarantees at least one SR. Free and unlimited in this prototype."),
    ("ky_all", "全部", "すべて", "All"),
    ("ky_sort_rarity", "稀有度", "レアリティ", "Rarity"),
    ("ky_sort_level", "等級", "レベル", "Level"),
    ("ky_sort_new", "最新", "新しい順", "Newest"),
    ("ky_count", "共 {n} 位", "全 {n} 人", "{n} recruits"),
    ("ky_coll_empty", "這個條件下還沒有人。", "この条件ではまだ誰もいません。", "No one matches yet."),
    ("ky_reset", "清空收藏", "コレクションを消去", "Clear collection"),
    ("ky_reset_confirm", "確定清空？再按一次", "本当に消去？もう一度押す", "Really clear? Tap again"),
    ("ky_locked_at", "親密度 {n} 綻放", "親密度 {n} で開花", "Blooms at affection {n}"),
    ("ky_type_pure", "主：{main}（純粹型）", "主：{main}（純粋型）", "Main: {main} (pure)"),
    ("ky_type_ms", "主：{main}　副：{sub}", "主：{main}　副：{sub}", "Main: {main}  Sub: {sub}"),
    ("ky_affection", "親密度", "親密度", "Affection"),
    ("ky_next_unlock", "下一片在 {n}", "次の開花は {n}", "Next bloom at {n}"),
    ("ky_all_open", "九華全開", "九華すべて開花", "All nine in bloom"),
    ("ky_level", "等級", "レベル", "Level"),
    ("ky_growth_rate", "每級每項成長率 {p}%", "レベルごとの成長率 {p}%", "{p}% growth per stat per level"),
    ("ky_lv_up", "升 1 級", "1 レベル上げる", "Level up"),
    ("ky_lv_max", "升到滿級", "最大まで上げる", "Max level"),
    ("ky_skill", "固有技能", "固有スキル", "Unique Skill"),
    ("ky_tags", "標籤", "タグ", "Tags"),
    ("ky_tags_note", "新增玩法時會追加新的標籤。標籤由個體的種子決定，不會改變。", "新しい遊びを追加するとタグが増えます。タグは個体ごとに決まり、変わりません。", "New game modes add new tags. Tags are fixed per recruit."),
    ("ky_release", "送別", "見送る", "Let go"),
    ("ky_release_confirm", "確定要讓她離開公會嗎？", "本当にギルドから見送りますか？", "Let her leave the guild?"),
    ("ky_cancel", "取消", "キャンセル", "Cancel"),
    ("ky_close", "關閉", "閉じる", "Close"),
    ("ky_unlocked", "{g}的花瓣綻放了！", "{g}の花びらが開いた！", "The {g} petals bloomed!"),
    ("ky_grew", "Lv {a} → {b}：{list}", "Lv {a} → {b}：{list}", "Lv {a} → {b}: {list}"),
    ("ky_no_growth", "這次沒有成長", "今回は成長なし", "no growth this time"),
    ("ky_type_changed", "型改變了：{a} → {b}", "型が変わった：{a} → {b}", "Type changed: {a} → {b}"),
    ("ky_tab_gacha", "招募", "招募", "Recruit"),
    ("ky_tab_coll", "收藏（{n}）", "コレクション（{n}）", "Collection ({n})"),
    ("ky_tab_rules", "說明", "説明", "Guide"),
    ("ky_main_sub", "主＼副", "主＼副", "Main\\Sub"),
    ("ky_sample", "花紋範例", "花紋の例", "Crest example"),
    ("ky_sample_note", "灰色的花苞＝還沒綻放的三華", "灰色のつぼみ＝まだ開いていない三華", "Grey buds are petals not yet in bloom"),
    ("ky_rule_1", "九華＝美・瑟・聲（魅）、柔・速・剛（身）、心・智・緣（心）九項，每項 1～99 隨機。", "九華＝美・瑟・聲（魅）、柔・速・剛（身）、心・智・縁（心）の九項目。各 1～99 のランダム。", "Nine stats in three blooms: Charm, Body and Heart, each 1–99 at random."),
    ("ky_rule_2", "花瓣越長數值越高；顏色是所屬的三華。", "花びらが長いほど数値が高く、色は所属する三華を表します。", "Longer petals mean higher stats; colours show the bloom."),
    ("ky_rule_3", "N、R 一開始只看得到一華，親密度 33 第二華、66 全部綻放；SR 一開始兩華，33 全部；SSR、UR 一開始全部看得到。先看到的是她最強的那一華。", "N・R は最初一華のみ、親密度 33 で二華目、66 ですべて開花。SR は最初二華、33 ですべて。SSR・UR は最初からすべて見えます。最初に見えるのは一番強い華。", "N/R start with one bloom visible, a second at affection 33 and all at 66. SR starts with two and opens fully at 33. SSR/UR show everything. Her strongest bloom shows first."),
    ("ky_rule_4", "最高的一項＝主、第二高＝副，決定她的型（81 種）。主比副高 25 以上時是純粹型。型在抽到時就會顯示。", "一番高い項目＝主、二番目＝副で型（81 種）が決まります。主が副より 25 以上高いと純粋型。型は引いた時点で表示されます。", "Her highest stat is the main and the second the sub; together they set one of 81 types (pure type when the main leads by 25+). The type shows as soon as she is drawn."),
    ("ky_rule_5", "等級 1～50。每升一級，九項各自依稀有度的機率 +1，升滿只會微幅到小幅成長。", "レベル 1～50。上がるたびに九項目それぞれがレアリティ別の確率で +1。上げきっても成長は小幅です。", "Levels 1–50. Each level, every stat has a rarity-based chance of +1, so growth stays modest."),
    ("ky_rule_6", "標籤（才藝、跑法、職業⋯⋯）會隨新玩法增加，給同一位新人在不同玩法中的特色。", "タグ（特技・脚質・職業⋯⋯）は新しい遊びとともに増え、同じ新人に遊びごとの個性を与えます。", "Tags (talent, running style, role…) grow with new game modes and give each recruit a role there."),
)

KYUKA_ZH: dict[str, str] = {k: zh for k, zh, _ja, _en in _ROWS}
KYUKA_JA: dict[str, str] = {k: ja for k, _zh, ja, _en in _ROWS}
KYUKA_EN: dict[str, str] = {k: en for k, _zh, _ja, en in _ROWS}

KYUKA_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_kyuka_name": "九華", "project_kyuka_desc": "冒險者公會的招募試作：N～UR 稀有度、九項隨機能力以櫻瓣花紋呈現，親密度讓花瓣綻放，九九八十一型的個性稱呼"},
    "ja": {"project_kyuka_name": "九華", "project_kyuka_desc": "冒険者ギルドの招募試作：N～UR のレアリティ、九つのランダム能力を桜の花紋で表示し、親密度で花びらが開く。九九八十一型の性格名つき"},
    "en": {"project_kyuka_name": "Kyuka", "project_kyuka_desc": "Adventurer guild recruiting prototype: N–UR rarities, nine random stats drawn as a cherry-petal crest that blooms with affection, and 81 personality types"},
}
