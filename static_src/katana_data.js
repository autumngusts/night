// 神前鍛刀對決（katana）靜態資料：材料（含化學成分）、工序說明與注意事項、刀種、選項、砥石、試斬目標、對手刀。
// 純資料，不放計算邏輯（冶金計算全在 katana_core.js）。文字皆為 { ja, zh }；en 依專案慣例 fallback 至 ja。
// 詳見 docs/katana_game_design.md。
(function () {
  "use strict";

  function C(ja, zh) { return { ja: ja, zh: zh }; }

  // ---------------- 材料 ----------------
  // comp：化學成分（wt%）。C 為初始平均含碳量，鍛鍊中由 katana_core.js 的擴散模型追蹤。
  // form：bloom＝鋼塊（要小割・積沸）／stack＝積層坯（要積沸）／bar＝現代棒鋼（不需小割・積沸）／ingot＝坩堝鋼錠（不可折返）
  // spread：小割時各片含碳的離散程度；slag：鐵滓（夾雜物）指標 0〜100；pattern：鍛後可能出現的紋路系統
  // authentic：神前審查視為傳統和鋼；special：特殊材料（設定畫面分組顯示）；maxForge：此溫度以上會熱脆
  var KAWAGANE = [
    { id: "tama1", form: "bloom", authentic: true, pattern: "jihada", spread: 0.18, slag: 18,
      comp: { C: 1.25, Mn: 0.01, Si: 0.02, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.02, S: 0.004 },
      name: C("玉鋼 一級", "玉鋼 一級"),
      desc: C("たたら製鉄で得られる最上の鋼。Mn・Si がほとんど無く焼きが浅いので、冴えた刃文が出る。皮鉄の王道。",
        "踏鞴製鐵所得的最上等鋼。幾乎不含錳、矽，淬透性低，刃文清晰。皮鐵的正統之選。") },
    { id: "tama2", form: "bloom", authentic: true, pattern: "jihada", spread: 0.3, slag: 32,
      comp: { C: 0.9, Mn: 0.01, Si: 0.03, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.025, S: 0.005 },
      name: C("玉鋼 二級", "玉鋼 二級"),
      desc: C("一級よりばらつきと鉄滓が多い。小割りでの選別が腕の見せ所。", "比一級離散度與鐵滓都多，小割分揀的眼力決定成敗。") },
    { id: "oroshi", form: "bloom", authentic: true, pattern: "jihada", spread: 0.35, slag: 28, jiganeBonus: 1,
      comp: { C: 0.8, Mn: 0.05, Si: 0.05, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.04, S: 0.01 },
      name: C("卸し鉄（古鉄）", "卸鐵（古鐵）"),
      desc: C("古釘などの古鉄を火床で卸して炭素量を調整した鋼。地鉄に深い味わいが出るが、ばらつきが大きい。",
        "把古釘等舊鐵在火床中「卸」成鋼並調整含碳量。地鐵別有韻味，但成分不穩。") },
    { id: "meteor", form: "bloom", authentic: true, special: true, pattern: "meteor", spread: 0.3, slag: 26, legend: 1,
      comp: { C: 0.8, Mn: 0.01, Si: 0.02, Ni: 3.5, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.08, S: 0.01 },
      name: C("隕鉄混じり玉鋼（流星刀）", "隕鐵混玉鋼（流星刀）"),
      desc: C("隕鉄（鉄ニッケル合金）を玉鋼に混ぜる。Ni は粘りを増すが焼きを深くし、Ms 点を下げる。リン化物で脆さも出る。",
        "把隕鐵（鐵鎳合金）混入玉鋼。鎳能增韌，但會加深淬透、降低 Ms 點，磷化物也帶來脆性。") },
    { id: "shirogami", form: "bar", special: true, pattern: "none", spread: 0.02, slag: 3,
      comp: { C: 1.3, Mn: 0.25, Si: 0.15, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.02, S: 0.004 },
      name: C("白紙一号（安来鋼）", "白紙一號（安來鋼）"),
      desc: C("玉鋼の流れを汲む高純度炭素鋼。焼きは浅めで刃文も出るが、鍛えても地肌はほぼ出ない。",
        "承襲玉鋼系譜的高純度碳鋼。淬透淺、能出刃文，但鍛了也幾乎沒有地肌。") },
    { id: "aogami", form: "bar", special: true, pattern: "none", spread: 0.02, slag: 3,
      comp: { C: 1.1, Mn: 0.25, Si: 0.15, Ni: 0, Cr: 0.35, W: 1.2, Mo: 0, V: 0, P: 0.02, S: 0.004 },
      name: C("青紙二号", "青紙二號"),
      desc: C("Cr・W 入りで刃持ちがよいが、焼きが深く入るので刃文はぼやけやすい。", "含鉻、鎢，耐磨持久，但淬透深，刃文容易模糊。") },
    { id: "s1095", form: "bar", special: true, pattern: "none", spread: 0.02, slag: 6,
      comp: { C: 0.95, Mn: 0.4, Si: 0.2, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.03, S: 0.03 },
      name: C("SK3 相当（1095 炭素鋼）", "1095 碳鋼（相當 SK3）"),
      desc: C("一般的な工具炭素鋼。Mn がやや多く、玉鋼より焼きが深い。", "常見的工具碳鋼。錳較多，淬透比玉鋼深。") },
    { id: "s1060", form: "bar", special: true, pattern: "none", spread: 0.02, slag: 6,
      comp: { C: 0.6, Mn: 0.75, Si: 0.2, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.03, S: 0.03 },
      name: C("S58C 相当（1060 炭素鋼）", "1060 碳鋼（相當 S58C）"),
      desc: C("炭素が少なめで粘り強い。量産の居合刀によく使われる。Mn が多く焼きは深い。", "含碳較低、韌性好，常用於量產居合刀。錳多所以淬透深。") },
    { id: "damascus", form: "stack", special: true, pattern: "damascus", spread: 0.04, slag: 8, layers: 15,
      comp: { C: 0.8, Mn: 0.5, Si: 0.2, Ni: 1.0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.02, S: 0.01 },
      name: C("積層ダマスカス（1084＋15N20）", "積層大馬士革（1084＋15N20）"),
      desc: C("炭素鋼とニッケル鋼を 15 枚交互に重ねて鍛接する。層の数で模様の細かさが変わる。日本刀の地肌とは別物。",
        "碳鋼與鎳鋼交互疊 15 片鍛接，層數決定紋路粗細。與日本刀地肌是兩回事。") },
    { id: "wootz", form: "ingot", special: true, pattern: "wootz", spread: 0.05, slag: 10, maxForge: 950,
      comp: { C: 1.5, Mn: 0.05, Si: 0.05, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0.01, P: 0.1, S: 0.02 },
      name: C("ウーツ鋼（るつぼ鋼）", "烏茲鋼（坩堝鋼）"),
      desc: C("インドのるつぼ鋼。炭化物の縞模様を持つ。折り返し鍛錬はできず、約 950℃ を超えて鍛えると模様が消え、割れる。",
        "印度坩堝鋼，帶有碳化物條紋。不能折返鍛鍊，超過約 950℃ 鍛打紋路會消失並開裂。") }
  ];

  var SHINGANE = [
    { id: "hocho", slag: 40, comp: { C: 0.12, Mn: 0.02, Si: 0.03, Ni: 0, Cr: 0, P: 0.05 }, name: C("包丁鉄", "包丁鐵"),
      desc: C("炭素の少ない軟らかい鉄。心鉄の定番で、刀に粘りを与える。", "低碳軟鐵，心鐵的標準材料，賦予刀身韌性。") },
    { id: "tama3", slag: 45, comp: { C: 0.3, Mn: 0.01, Si: 0.03, Ni: 0, Cr: 0, P: 0.03 }, name: C("玉鋼 三級", "玉鋼 三級"),
      desc: C("やや炭素が多く、粘りと硬さの中間。", "含碳略高，介於韌與硬之間。") },
    { id: "nan", slag: 30, comp: { C: 0.2, Mn: 0.02, Si: 0.03, Ni: 0, Cr: 0, P: 0.03 }, name: C("卸し鉄（軟）", "卸鐵（軟）"),
      desc: C("卸して炭素を抜いた軟鉄。鉄滓が少なめ。", "卸過去碳的軟鐵，鐵滓較少。") },
    { id: "mild", slag: 2, special: true, comp: { C: 0.18, Mn: 0.7, Si: 0.2, Ni: 0, Cr: 0, P: 0.03 }, name: C("軟鋼（S15C 相当）", "低碳鋼（相當 S15C）"),
      desc: C("現代の低炭素鋼。清浄だが伝統的な心鉄ではない。", "現代低碳鋼。純淨，但不是傳統心鐵。") },
    { id: "none", slag: 0, comp: { C: 0, Mn: 0, Si: 0, Ni: 0, Cr: 0, P: 0 }, name: C("使わない（丸鍛え用）", "不使用（丸鍛用）"),
      desc: C("心鉄を入れない。造込みは丸鍛えのみになる。", "不放心鐵，造込只能選丸鍛。") }
  ];

  // ---------------- 工序 ----------------
  // kind：UI 要畫哪一種面板。tips：注意事項。forms：只有這些材料形態才進行（其他自動略過）
  var STEPS = [
    { id: "material", kind: "material", name: C("材料選び・刀種", "選材・刀種"),
      summary: C("作る刃物の種類と、皮鉄・心鉄の材料と量を決める。", "決定要打造的刃器種類，以及皮鐵、心鐵的材料與用量。"),
      tips: [
        C("仕上がった刀は使った鋼の 1〜2 割ほどしか残らない。打刀なら皮鉄は 5kg 以上が目安。", "完成的刀只剩所用鋼材的一到二成。打刀的皮鐵以 5kg 以上為準。"),
        C("皮鉄は炭素の多い硬い鋼、心鉄は炭素の少ない軟らかい鉄。硬さと粘りを両立させるための組み合わせ。", "皮鐵用高碳硬鋼、心鐵用低碳軟鐵，兩者搭配才能兼顧硬度與韌性。"),
        C("鍛錬のたびに表面から脱炭するので、皮鉄の炭素は最終的に 0.6〜0.7% あたりに落ち着くのが理想。", "每次加熱都會從表面脫碳，皮鐵最終含碳以 0.6〜0.7% 左右最理想。"),
        C("特殊な鋼で日本刀を作ることも、玉鋼で異国の刃を作ることもできる。神前の審査はそれぞれの刃物の本来の姿を基準にする。", "也能用特殊鋼材打日本刀，或用玉鋼打異國刀劍。神前審查會依各刃器本來的樣貌評判。")
      ] },
    { id: "kowari", kind: "kowari", forms: ["bloom"], name: C("水へし・小割り", "水壓・小割"),
      summary: C("玉鋼を熱して薄く打ち延ばし、水で急冷して割り、破面を見て選別する。", "把玉鋼加熱打薄、入水急冷後敲碎，依斷面分揀。"),
      tips: [
        C("炭素の多い部分は焼きが入って脆く、細かく割れる。破面の結晶が細かく銀白色のものは炭素が多い → 皮鉄へ。", "高碳部分淬硬變脆、碎得細。斷面結晶細密、銀白色者含碳高 → 用作皮鐵。"),
        C("結晶が粗くギラギラ光るものは炭素が少ない → 心鉄へ回すとよい。", "結晶粗大、閃閃發亮者含碳低 → 轉作心鐵較好。"),
        C("黒い斑点（鉄滓）が目立つものは捨てる。混ぜると地鉄の傷になる。", "黑斑（鐵滓）明顯者應捨棄，混入會成為地鐵瑕疵。")
      ] },
    { id: "tsumi", kind: "heat", heatId: "tsumi", forms: ["bloom", "stack"], name: C("積み沸かし", "積沸"),
      summary: C("小片（または積層材）をてこ棒の上に積み、和紙で包み藁灰と泥汁をかけて沸かし、一つの塊に鍛接する。", "把碎片（或積層材）堆在槓桿棒上，以和紙包覆、敷稻草灰與泥漿後加熱至沸，鍛接成一塊。"),
      tips: [
        C("鍛接できるのは固相線（鋼が溶け始める温度）のすぐ下。炭素が多いほど固相線は低い：C 1.2% で約 1340℃、C 0.7% で約 1420℃。", "能鍛接的溫度在固相線（鋼開始熔化的溫度）稍下方。含碳越高固相線越低：C 1.2% 約 1340℃、C 0.7% 約 1420℃。"),
        C("色は黄色を越えて白っぽく、小さな火花（沸き花）が出始めたら頃合い。白く激しく火花が散るのは鋼が燃えている証拠。", "顏色越過黃色轉為偏白、開始冒出細小火花（沸花）時正是時候；白光刺眼、火花四濺就是鋼在燃燒。"),
        C("藁灰と泥汁は酸化と脱炭を防ぐ。省くと鋼が減り、炭素も抜ける。", "稻草灰與泥漿可防止氧化與脫碳；省略的話鋼會減少，碳也會流失。")
      ] },
    { id: "shitakitae", kind: "fold", stage: "shita", name: C("下鍛え", "下鍛"),
      summary: C("沸かした塊を打ち延ばし、折り返して重ねる。不純物を叩き出し、炭素を均一にする。", "把沸燒的鋼塊打延、折疊再重疊，敲出雜質並使含碳均勻。"),
      tips: [
        C("折り返しは一般に 6〜8 回。一回ごとに層は倍になり、鉄滓が抜け、表面から脱炭する（炭素の拡散は温度が高いほど速い）。", "折返一般 6〜8 次。每折一次層數加倍、鐵滓被擠出，並從表面脫碳（溫度越高碳擴散越快）。"),
        C("折り返す（鍛接する）なら沸かし温度、ただ延ばすだけなら 950〜1150℃ で十分。", "要折返（鍛接）就得加熱到沸燒溫度；只是延展的話 950〜1150℃ 就夠。"),
        C("約 800℃（赤黒い色）より冷えた鋼を打つと鍛え割れが出る。色が落ちたら沸かし直す。", "鋼冷到約 800℃（暗紅色）以下還打會出現鍛裂，顏色一暗就該重新加熱。"),
        C("ウーツ鋼は折り返せない。950℃ 以下で延ばすだけにする。", "烏茲鋼不能折返，只能在 950℃ 以下延展。")
      ] },
    { id: "uwakitae", kind: "fold", stage: "uwa", name: C("上鍛え", "上鍛"),
      summary: C("さらに数回折り返して仕上げる。折り返しの方向で地肌の模様が決まる。", "再折返數次完成鍛鍊，折返方向決定地肌紋路。"),
      tips: [
        C("上鍛えは 4〜7 回程度。下鍛えと合わせて 12〜16 回、層の数は数千〜数万になる。", "上鍛約 4〜7 次，與下鍛合計 12〜16 次，層數達數千至數萬。"),
        C("鍛えすぎると炭素が抜けて焼きが入らず、鋼も痩せる（鉄が死ぬ）。", "鍛過頭會脫碳到淬不硬，鋼也會變少（「鐵死了」）。"),
        C("一文字に折り返せば板目・杢目、同じ向きに重ね続ければ柾目になる。ダマスカスは層が数百のとき模様が最もはっきりする。", "以一字方向折返形成板目、杢目；始終同向疊合則成柾目。大馬士革在數百層時紋路最分明。")
      ] },
    { id: "tsukurikomi", kind: "construct", heatId: "weld", name: C("造込み", "造込"),
      summary: C("皮鉄と心鉄を組み合わせて沸かし付ける。刀の硬さと粘りの配分が決まる。", "組合皮鐵與心鐵並沸接，決定刀身硬度與韌性的分配。"),
      tips: [
        C("甲伏せは皮鉄で心鉄を包む最も一般的な方法。", "甲伏是以皮鐵包覆心鐵，最普遍的做法。"),
        C("本三枚・四方詰めは棟や側面にも別の鋼を配し、粘り強いが組むのが難しい。", "本三枚、四方詰在刀背與側面另配鋼材，韌性佳但難度高。"),
        C("丸鍛えは一種類の鋼だけ。硬いが折れやすい。両刃の剣は丸鍛えか、刃鉄を挟む「夾鋼」が多い。", "丸鍛只用一種鋼，硬但易折。雙刃劍多為丸鍛，或以中間夾刃鋼的「夾鋼」製成。")
      ] },
    { id: "sunobe", kind: "sunobe", name: C("素延べ", "素延"),
      summary: C("刃物の長さまで棒状に打ち延ばす。", "打延成刃器長度的棒狀。"),
      tips: [
        C("均一に延ばさないと、後で削ったときに心鉄が表に出てしまう。", "延展不均，之後研磨時心鐵會露出表面。"),
        C("鋼が足りない長さは延ばせない。足りなければ重ねが薄くなる。", "鋼量不夠就延不到該長度，硬延會讓重（厚度）變薄。"),
        C("打刀の刃長は二尺三寸（約 70cm）前後が標準。", "打刀刃長以二尺三寸（約 70cm）前後為標準。")
      ] },
    { id: "hizukuri", kind: "hizukuri", name: C("火造り", "火造"),
      summary: C("小槌で形を打ち出す。切先・断面・身幅・重ね・打ち出す反りを決める。", "以小鎚打出外形，決定切先、斷面、身幅、重與鍛出的彎度。"),
      tips: [
        C("日本刀の反りの多くは焼き入れで生まれる（刃のマルテンサイトが膨らむため）。火造りでの反りは控えめに。", "日本刀的反大多在淬火時產生（刃部麻田散鐵膨脹所致），火造時的彎度宜保守。"),
        C("シャムシールのような深い反り、ククリのような内反りは、焼き入れではなく火造りで打ち出す。", "像彎刀那樣的深彎、廓爾喀刀那樣的內彎，是靠火造打出來的，不是淬火。"),
        C("身幅に対して重ねは 2 割強が目安。薄すぎると曲がりやすく、厚すぎると切れない。", "重約為身幅的兩成多。太薄易彎、太厚不利斬切。")
      ] },
    { id: "tsuchioki", kind: "tsuchioki", name: C("焼きならし・土置き", "正常化・置土"),
      summary: C("焼きならしで結晶粒を整え、焼刃土を塗る。土の厚みで冷え方が変わり、刃文になる。", "以正常化細化晶粒，再塗燒刃土。土層厚薄改變冷卻速度，形成刃文。"),
      tips: [
        C("焼きならし（A3 点より少し上まで熱して空冷）を繰り返すと結晶粒が細かくなり、粘りが増し、焼き割れしにくくなる。", "反覆正常化（加熱到略高於 A3 點再空冷）能細化晶粒、增加韌性、降低淬裂風險。"),
        C("刃側は薄く、棟側は厚く塗る。薄い土はかえって冷却を速める（蒸気膜を破る）。厚い土の下は冷えが遅く焼きが入らない。", "刃側薄塗、刀背厚塗。薄土反而會加快冷卻（破壞蒸氣膜），厚土下冷得慢就不會淬硬。"),
        C("Mn・Cr・Ni の多い鋼は焼きが深く入るので、土を置いても刃文がぼやけやすい。", "錳、鉻、鎳多的鋼淬透深，即使置土刃文也容易模糊。"),
        C("両刃の剣は両方の刃に同じように土を置く。左右対称なので反りは出ない。", "雙刃劍兩側刃口置相同的土，左右對稱所以不會彎。")
      ] },
    { id: "yakiire", kind: "heat", heatId: "quench", name: C("焼き入れ", "淬火（燒入）"),
      summary: C("刀全体を均一に熱し、一気に水槽へ入れる。刃が硬くなり、反りが生まれる。", "把整把刀均勻加熱，一口氣浸入水槽。刃部變硬並產生反。"),
      tips: [
        C("亜共析鋼（C 0.77% 未満）は Ac3 点の 30〜50℃ 上、過共析鋼は Ac1 点（約 727℃）の 30〜50℃ 上が適温。暗い所で見ると「赤めた柿色」。", "亞共析鋼（C 未滿 0.77%）的適溫是 Ac3 點以上 30〜50℃；過共析鋼是 Ac1 點（約 727℃）以上 30〜50℃。暗處看是「熟柿般的紅」。"),
        C("熱しすぎると結晶粒が粗くなり、炭素が溶け込みすぎて残留オーステナイトが増え、割れやすくなる。足りないと焼きが入らない。", "加熱過頭晶粒粗大、碳溶入過多使殘留沃斯田鐵增加，也更易裂；不足則淬不硬。"),
        C("水温は秘伝の湯加減。冷水は冷却が速く割れやすい。水温が上がると蒸気膜で冷えが鈍る。油はさらに穏やか。", "水溫是秘傳的「湯加減」。冷水冷得快易裂；水溫越高蒸氣膜越厚、冷卻越慢；油更溫和。"),
        C("明るい所では火色が分かりにくい。夜や暗くした鍛冶場で行う。", "亮處難以分辨火色，因此在夜間或遮暗的鍛冶場進行。")
      ] },
    { id: "aitori", kind: "aitori", name: C("合い取り・反り直し", "回火（合取）・調反"),
      summary: C("低温で焼き戻して粘りを出し、反りを整える。", "低溫回火增加韌性，並調整反。"),
      tips: [
        C("焼き入れ直後のマルテンサイトは硬すぎて脆い。百数十〜二百℃ほどで焼き戻すと粘りが出る。", "淬火後的麻田散鐵過硬而脆，以一百多到兩百度回火可增韌。"),
        C("磨いた面の酸化膜の色で温度が分かる：淡い麦わら色 約 200℃ → 麦わら 220℃ → 茶 255℃ → 紫 270℃ → 青 290〜310℃ → 灰。", "可由磨亮面的氧化膜顏色判斷溫度：淡麥稈色約 200℃ → 麥稈 220℃ → 褐 255℃ → 紫 270℃ → 藍 290〜310℃ → 灰。"),
        C("250〜400℃ は「低温焼き戻し脆性」の温度域。硬さが落ちるのに、かえって脆くなる。", "250〜400℃ 是「回火麻田散鐵脆性」溫區：硬度下降，反而更脆。"),
        C("ばね焼き戻し（約 400〜500℃）は西洋剣の流儀。硬さは落ちるがよくしなる。", "彈簧回火（約 400〜500℃）是西洋劍的做法：硬度降低但富有彈性。"),
        C("反りは棟を熱した銅台に当てて少しずつ直す。大きく動かすと割れることがある。", "反是把刀背壓在加熱的銅塊上一點點調整，調太多可能開裂。")
      ] },
    { id: "togi", kind: "togi", name: C("鍛冶押し・研ぎ", "鍛冶押・研磨"),
      summary: C("荒い砥石から細かい砥石へ順に研ぎ、姿・地鉄・刃文を引き出す。", "由粗到細依序研磨，帶出刀姿、地鐵與刃文。"),
      tips: [
        C("下地研ぎは荒い順：金剛砥 → 備水砥 → 改正砥 → 中名倉砥 → 細名倉砥 → 内曇砥。", "下地研磨由粗到細：金剛砥 → 備水砥 → 改正砥 → 中名倉砥 → 細名倉砥 → 內曇砥。"),
        C("仕上げ研ぎ：刃艶 → 地艶 → 拭い → 刃取り → 磨き。順番を飛ばすと前の傷が消えない。", "仕上研磨：刃艷 → 地艷 → 拭 → 刃取 → 磨。跳過順序前一道的磨痕會消不掉。"),
        C("蛤刃は刃に肉を残して丈夫、肉を落とした平らな刃はよく切れるが欠けやすい。", "蛤刃保留刃肉較耐用；削平刃肉則鋒利但易崩。")
      ] },
    { id: "mei", kind: "mei", name: C("茎仕立て・銘切り", "莖仕立・切銘"),
      summary: C("茎に鑢目を入れ、目釘穴を開け、鏨で銘を切る。", "在刀莖銼出銼紋、開目釘孔，以鏨刻銘。"),
      tips: [
        C("鑢目と茎尻の形は鍛冶ごとの流儀。偽物を防ぐ目印にもなる。", "銼紋與莖尻形狀各家有其流派，也是防偽記號。"),
        C("銘は指表（佩いたとき外側になる面）に切るのが通例。", "刀銘一般刻在佩帶時朝外的一面。")
      ] }
  ];

  // ---------------- 刃物の種類 ----------------
  // family：nihonto（日本刀）／famous（知名武器）／rare（冷門但酷炫，使用者指定 2026-10-20）
  // edges：1 單刃／2 雙刃；ideal：理想刃長（cm）；sori：理想彎度（mm，負值＝內彎・前彎）；width：身幅；kasane：重（mm）
  // ht：理想的熱處理 —— diff（差異淬火：刃硬背軟）／through（整體淬火＋回火）；hrc：刃的理想硬度
  // forgeSori：火造時預設打出的彎度；tsukuri／kissaki／soriType：此刀種相稱的斷面・切先・彎法（審查「姿」用）
  // profile：刀身寬度的變化（taper 漸窄／widen 往前變寬／kukri 腹部鼓起／narrow 細長漸尖）；wave：波刃（count 彎數、amp 振幅 mm）
  var BLADE_TYPES = [
    { id: "tanto", family: "nihonto", edges: 1, min: 18, max: 30, ideal: [24, 28], sori: [-1, 3], width: [22, 28], kasane: [5, 7], ht: "diff", hrc: [58, 64], forgeSori: 0,
      tsukuri: ["hira", "shobu", "kiriha"], kissaki: ["ko", "chu"], soriType: ["muzori"],
      name: C("短刀", "短刀"), desc: C("一尺未満。反りはほぼ無い。", "未滿一尺，幾乎無反。") },
    { id: "wakizashi", family: "nihonto", edges: 1, min: 30, max: 60, ideal: [45, 55], sori: [8, 14], width: [27, 31], kasane: [6, 7.5], ht: "diff", hrc: [58, 64], forgeSori: 2,
      tsukuri: ["shinogi", "hira", "shobu"], kissaki: ["chu", "ko"], soriType: ["torii", "saki"],
      name: C("脇差", "脇差"), desc: C("一尺以上二尺未満。打刀と大小で差す。", "一尺以上未滿二尺，與打刀成對佩帶。") },
    { id: "uchigatana", family: "nihonto", edges: 1, min: 60, max: 80, ideal: [68, 73], sori: [13, 20], width: [29, 33], kasane: [6.5, 8], ht: "diff", hrc: [58, 64], forgeSori: 4,
      tsukuri: ["shinogi"], kissaki: ["chu", "o"], soriType: ["torii", "saki"],
      name: C("打刀", "打刀"), desc: C("刃を上にして腰に差す。二尺三寸前後。", "刃朝上插於腰間，約二尺三寸。") },
    { id: "tachi", family: "nihonto", edges: 1, min: 70, max: 90, ideal: [75, 82], sori: [20, 30], width: [28, 32], kasane: [6.5, 8], ht: "diff", hrc: [58, 64], forgeSori: 8,
      tsukuri: ["shinogi", "kiriha"], kissaki: ["ko", "chu", "ikubi"], soriType: ["koshi", "torii"],
      name: C("太刀", "太刀"), desc: C("刃を下にして佩く。反りが深い。", "刃朝下佩掛，反較深。") },
    { id: "odachi", family: "nihonto", edges: 1, min: 90, max: 120, ideal: [95, 110], sori: [25, 38], width: [33, 38], kasane: [7.5, 9], ht: "diff", hrc: [57, 63], forgeSori: 10,
      tsukuri: ["shinogi"], kissaki: ["o", "ikubi"], soriType: ["koshi", "torii"],
      name: C("大太刀", "大太刀"), desc: C("三尺を超える大刀。奉納刀に多い。", "超過三尺的大刀，多為奉納刀。") },
    { id: "naginata", family: "nihonto", edges: 1, min: 30, max: 65, ideal: [40, 55], sori: [15, 30], width: [30, 38], kasane: [6, 8], ht: "diff", hrc: [57, 63], forgeSori: 12, profile: "widen",
      tsukuri: ["naginata", "shobu"], kissaki: ["o", "chu"], soriType: ["saki"],
      name: C("薙刀", "薙刀"), desc: C("長い柄に付ける刃。先の方で大きく反り、先幅が広い。", "裝在長柄上的刃，靠近刀尖處大幅彎曲，前端較寬。") },
    { id: "nagamaki", family: "nihonto", edges: 1, min: 60, max: 95, ideal: [70, 82], sori: [15, 25], width: [31, 36], kasane: [7, 8.5], ht: "diff", hrc: [57, 63], forgeSori: 8,
      tsukuri: ["naginata", "shinogi"], kissaki: ["o", "chu"], soriType: ["saki", "torii"],
      name: C("長巻", "長卷"), desc: C("太刀の柄を長くした豪壮な武器。", "把太刀柄加長的豪壯武器。") },
    { id: "yari", family: "nihonto", edges: 2, min: 10, max: 45, ideal: [15, 25], sori: [0, 1], width: [20, 30], kasane: [6, 9], ht: "diff", hrc: [57, 62], forgeSori: 0,
      tsukuri: ["ryoshinogi", "sankaku"], kissaki: ["kensaki"], soriType: ["muzori"],
      name: C("槍（穂）", "槍（槍頭）"), desc: C("両刃の穂先。茎が非常に長い。", "雙刃槍頭，莖非常長。") },

    { id: "longsword", family: "famous", edges: 2, min: 85, max: 115, ideal: [90, 100], sori: [0, 1], width: [40, 50], kasane: [5, 7], ht: "through", hrc: [48, 55], forgeSori: 0,
      tsukuri: ["diamond", "fuller"], kissaki: ["kensaki"], soriType: ["muzori"],
      name: C("ロングソード", "長劍（雙手長劍）"), desc: C("中世ヨーロッパの両手剣。全体焼き入れとばね焼き戻し。", "中世紀歐洲的雙手劍。整體淬火加彈簧回火。") },
    { id: "broadsword", family: "famous", edges: 2, min: 70, max: 100, ideal: [78, 88], sori: [0, 1], width: [40, 52], kasane: [4, 6], ht: "through", hrc: [48, 55], forgeSori: 0,
      tsukuri: ["diamond", "fuller"], kissaki: ["kensaki", "round"], soriType: ["muzori"],
      name: C("ブロードソード（西洋両刃剣）", "闊劍（西洋雙刃劍）"), desc: C("真っ直ぐな片手両刃剣。しなやかさが命。", "筆直的單手雙刃劍，柔韌為要。") },
    { id: "zweihander", family: "famous", edges: 2, min: 110, max: 155, ideal: [120, 135], sori: [0, 1], width: [40, 55], kasane: [5, 7], ht: "through", hrc: [47, 53], forgeSori: 0,
      tsukuri: ["diamond", "fuller"], kissaki: ["kensaki", "round"], soriType: ["muzori"],
      name: C("ツヴァイヘンダー", "雙手大劍（Zweihänder）"), desc: C("ドイツ傭兵の巨大な両手剣。鋼が大量に要る。", "德國傭兵的巨大雙手劍，需要大量鋼材。") },
    { id: "rapier", family: "famous", edges: 2, min: 90, max: 120, ideal: [95, 110], sori: [0, 1], width: [14, 24], kasane: [6, 9], ht: "through", hrc: [46, 52], forgeSori: 0, profile: "narrow",
      tsukuri: ["hexa", "diamond"], kissaki: ["kensaki"], soriType: ["muzori"],
      name: C("レイピア", "細劍（Rapier）"), desc: C("細く長い刺突の剣。断面は厚く、よくしなる。", "細長的刺擊用劍，斷面厚而富彈性。") },
    { id: "sabre", family: "famous", edges: 1, min: 75, max: 95, ideal: [82, 88], sori: [30, 50], width: [25, 33], kasane: [6, 8], ht: "through", hrc: [48, 54], forgeSori: 22,
      tsukuri: ["lenticular", "hira"], kissaki: ["needle", "chu"], soriType: ["torii", "saki"],
      name: C("サーベル", "軍刀（Sabre）"), desc: C("騎兵の片刃刀。樋を掻いた軽い刀身。", "騎兵用單刃刀，開槽而輕。") },
    { id: "gladius", family: "famous", edges: 2, min: 45, max: 70, ideal: [50, 60], sori: [0, 1], width: [45, 58], kasane: [5, 7], ht: "through", hrc: [50, 56], forgeSori: 0,
      tsukuri: ["diamond"], kissaki: ["kensaki"], soriType: ["muzori"],
      name: C("グラディウス", "羅馬短劍（Gladius）"), desc: C("ローマ軍団兵の短く幅広い剣。", "羅馬軍團兵的短而寬的劍。") },
    { id: "jian", family: "famous", edges: 2, min: 60, max: 90, ideal: [70, 78], sori: [0, 1], width: [30, 40], kasane: [5, 7], ht: "diff", hrc: [52, 60], forgeSori: 0,
      tsukuri: ["diamond", "fuller"], kissaki: ["kensaki"], soriType: ["muzori"],
      name: C("中国剣（剣）", "中華劍（劍）"), desc: C("真っ直ぐで細身の両刃剣。刃鉄を挟んだ夾鋼で作られることも多い。", "細長筆直的雙刃劍，常以夾鋼製成。") },
    { id: "miaodao", family: "famous", edges: 1, min: 90, max: 130, ideal: [100, 120], sori: [25, 45], width: [28, 34], kasane: [6, 8], ht: "diff", hrc: [56, 61], forgeSori: 15,
      tsukuri: ["shinogi", "lenticular"], kissaki: ["chu", "needle"], soriType: ["torii", "saki"],
      name: C("苗刀", "苗刀"), desc: C("明代の長大な両手刀。倭刀の影響を受けた。", "明代的長大雙手刀，受倭刀影響。") },
    { id: "liuyedao", family: "famous", edges: 1, min: 65, max: 90, ideal: [72, 80], sori: [20, 40], width: [32, 38], kasane: [5, 8], ht: "diff", hrc: [55, 61], forgeSori: 18,
      tsukuri: ["shinogi", "lenticular"], kissaki: ["chu", "o"], soriType: ["torii", "saki"],
      name: C("柳葉刀", "柳葉刀"), desc: C("明・清の中国の片刃刀。ゆるやかに反る。", "明清時代的中國單刃刀，彎度和緩。") },
    { id: "shamshir", family: "famous", edges: 1, min: 70, max: 100, ideal: [80, 90], sori: [45, 80], width: [24, 32], kasane: [5, 7], ht: "through", hrc: [50, 58], forgeSori: 30, profile: "narrow",
      tsukuri: ["hira", "lenticular"], kissaki: ["needle"], soriType: ["saki"],
      name: C("シャムシール（彎刀）", "彎刀（波斯彎刀）"), desc: C("ペルシアの深く反った細身の片刃刀。反りは主に火造りで打ち出す（焼き入れでも反る）。", "波斯的深彎細身單刃刀，彎度主要靠火造打出（淬火也會再彎）。") },
    { id: "kilij", family: "famous", edges: 1, min: 70, max: 90, ideal: [74, 84], sori: [40, 65], width: [33, 42], kasane: [6, 8], ht: "through", hrc: [50, 56], forgeSori: 30, profile: "widen",
      tsukuri: ["lenticular", "hira"], kissaki: ["needle"], soriType: ["saki"],
      name: C("キリジ（トルコ刀）", "土耳其彎刀（Kilij）"), desc: C("先端が幅広く膨らむ（ヤルマン）オスマンの彎刀。", "刀尖段變寬（假刃 Yelman）的鄂圖曼彎刀。") },
    { id: "falchion", family: "famous", edges: 1, min: 60, max: 85, ideal: [70, 80], sori: [5, 20], width: [45, 60], kasane: [5, 7], ht: "through", hrc: [50, 56], forgeSori: 8, profile: "widen",
      tsukuri: ["hira", "lenticular"], kissaki: ["needle"], soriType: ["saki"],
      name: C("ファルシオン", "法爾欽（Falchion）"), desc: C("先にいくほど幅広くなる西洋の片刃刀。", "越往前越寬的西洋單刃刀。") },
    { id: "kukri", family: "famous", edges: 1, min: 25, max: 40, ideal: [28, 34], sori: [-30, -12], width: [45, 60], kasane: [7, 10], ht: "diff", hrc: [56, 60], forgeSori: -20, profile: "kukri",
      tsukuri: ["hira"], kissaki: ["needle"], soriType: ["saki"],
      name: C("ククリ", "廓爾喀彎刀（ククリ）"), desc: C("ネパールの内反りの鉈刀。刃が内側にくる。", "尼泊爾的內彎砍刀，刃在內側。") },

    { id: "khopesh", family: "rare", edges: 1, min: 45, max: 70, ideal: [50, 60], sori: [60, 110], width: [35, 50], kasane: [5, 8], ht: "through", hrc: [45, 52], forgeSori: 70, profile: "widen",
      tsukuri: ["hira"], kissaki: ["round"], soriType: ["saki"],
      name: C("ケペシュ", "鐮形劍（Khopesh）"), desc: C("古代エジプトの鎌形の剣。先の外側の弧で斬る。本来は青銅。", "古埃及的鐮形劍，以前段外弧斬切。原本是青銅製。") },
    { id: "shotel", family: "rare", edges: 2, min: 70, max: 105, ideal: [80, 95], sori: [140, 230], width: [25, 35], kasane: [5, 7], ht: "through", hrc: [48, 54], forgeSori: 180,
      tsukuri: ["diamond"], kissaki: ["kensaki"], soriType: ["torii"],
      name: C("ショテル", "衣索比亞鐮劍（Shotel）"), desc: C("エチオピアの半円に近い両刃の鎌剣。盾越しに相手を引っかけて刺す。", "衣索比亞近乎半圓的雙刃鐮劍，越過盾牌勾刺對手。") },
    { id: "kris", family: "rare", edges: 2, min: 30, max: 55, ideal: [35, 45], sori: [0, 2], width: [30, 45], kasane: [4, 6], ht: "through", hrc: [40, 50], forgeSori: 0, wave: { count: 7, amp: 7 },
      tsukuri: ["diamond"], kissaki: ["kensaki"], soriType: ["muzori"], pamor: true,
      name: C("クリス", "克力士波刃劍（Kris）"), desc: C("ジャワの波打つ短剣。隕鉄由来のニッケルで鍛えた模様（パモール）が尊ばれる。", "爪哇的波刃短劍。以隕鐵鎳鍛出的紋路（Pamor）最受尊崇。") },
    { id: "flamberge", family: "rare", edges: 2, min: 110, max: 155, ideal: [125, 140], sori: [0, 1], width: [40, 55], kasane: [5, 7], ht: "through", hrc: [47, 53], forgeSori: 0, wave: { count: 14, amp: 6 },
      tsukuri: ["diamond", "fuller"], kissaki: ["kensaki"], soriType: ["muzori"],
      name: C("フランベルジュ", "火焰劍（Flamberge）"), desc: C("炎のように波打つ刃の両手剣。", "刃如火焰般起伏的雙手劍。") },
    { id: "urumi", family: "rare", edges: 2, min: 120, max: 180, ideal: [140, 160], sori: [0, 1], width: [15, 25], kasane: [0.6, 1.2], ht: "through", hrc: [42, 48], forgeSori: 0,
      tsukuri: ["flat"], kissaki: ["round"], soriType: ["muzori"],
      name: C("ウルミ", "鞭劍（Urumi）"), desc: C("南インドの鞭のようにしなる剣。極薄の帯鋼で、ばね焼き戻しが必須。", "南印度如鞭般柔軟的劍。極薄的帶狀鋼，必須彈簧回火。") },
    { id: "falcata", family: "rare", edges: 1, min: 45, max: 62, ideal: [48, 55], sori: [-25, -10], width: [45, 60], kasane: [6, 8], ht: "through", hrc: [50, 56], forgeSori: -24, profile: "widen",
      tsukuri: ["hira", "lenticular"], kissaki: ["needle"], soriType: ["saki"],
      name: C("ファルカタ", "法爾卡塔（Falcata）"), desc: C("古代イベリアの前に湾曲した斬撃刀。ローマも恐れた。", "古伊比利亞向前彎曲的斬擊刀，連羅馬人都畏懼。") },
    { id: "yatagan", family: "rare", edges: 1, min: 55, max: 80, ideal: [62, 70], sori: [-25, -10], width: [30, 38], kasane: [6, 8], ht: "through", hrc: [50, 56], forgeSori: -24,
      tsukuri: ["hira", "lenticular"], kissaki: ["needle"], soriType: ["saki"],
      name: C("ヤタガン", "亞達禮彎刀（Yatagan）"), desc: C("オスマンの前反りの刀。柄頭は耳のように開く。", "鄂圖曼的前彎刀，柄頭如耳朵般張開。") }
  ];

  // 斷面造型。edges：適用 1 單刃／2 雙刃；area：斷面積係數（身幅×重×area）；shinogiAt：最厚處距刃口的比例
  var TSUKURI = [
    { id: "shinogi", edges: 1, area: 0.62, shinogiAt: 0.67, cut: 0, sturdy: 4, name: C("鎬造り", "鎬造"), desc: C("鎬筋を立てた最も一般的な造り。", "立起鎬線，最普遍的造型。") },
    { id: "hira", edges: 1, area: 0.55, shinogiAt: 1, cut: 4, sturdy: 0, name: C("平造り", "平造"), desc: C("鎬の無い平らな造り。", "無鎬的平板造型。") },
    { id: "shobu", edges: 1, area: 0.58, shinogiAt: 0.6, cut: 3, sturdy: 1, name: C("菖蒲造り", "菖蒲造"), desc: C("横手の無い、菖蒲の葉のような造り。", "無橫手，形如菖蒲葉。") },
    { id: "kiriha", edges: 1, area: 0.64, shinogiAt: 0.35, cut: 2, sturdy: 3, name: C("切刃造り", "切刃造"), desc: C("刃寄りに鎬を立てた古い造り。", "鎬線靠近刃側的古式造型。") },
    { id: "naginata", edges: 1, area: 0.6, shinogiAt: 0.55, cut: 3, sturdy: 2, name: C("薙刀造り", "薙刀造"), desc: C("横手が無く、先の棟側を削いだ造り。", "無橫手、前段刀背削薄的造型。") },
    { id: "lenticular", edges: 1, area: 0.6, shinogiAt: 0.8, cut: 2, sturdy: 2, name: C("蛤形断面（片刃）", "凸透鏡形斷面（單刃）"), desc: C("ふっくらとした断面。異国の片刃刀に多い。", "飽滿的斷面，多見於異國單刃刀。") },
    { id: "diamond", edges: 2, area: 0.5, shinogiAt: 0.5, cut: 2, sturdy: 3, name: C("菱形断面（両刃）", "菱形斷面（雙刃）"), desc: C("中央に稜線を立てた両刃。剛性が高い。", "中央起脊的雙刃，剛性高。") },
    { id: "fuller", edges: 2, area: 0.44, shinogiAt: 0.5, cut: 3, sturdy: 1, name: C("樋入り両刃", "開血槽雙刃"), desc: C("中央に樋を掻いて軽くした両刃。", "中央開槽減重的雙刃。") },
    { id: "ryoshinogi", edges: 2, area: 0.55, shinogiAt: 0.5, cut: 2, sturdy: 3, name: C("両鎬造り", "兩鎬造"), desc: C("両面に鎬を立てた槍の造り。", "兩面立鎬的槍頭造型。") },
    { id: "sankaku", edges: 2, area: 0.45, shinogiAt: 0.5, cut: 1, sturdy: 4, name: C("三角造り", "三角造"), desc: C("断面が三角形の刺突向きの穂。", "斷面呈三角形、適合刺擊的槍頭。") },
    { id: "hexa", edges: 2, area: 0.72, shinogiAt: 0.45, cut: 0, sturdy: 4, name: C("六角断面", "六角斷面"), desc: C("厚く細い刺突剣の断面。", "細而厚的刺擊劍斷面。") },
    { id: "flat", edges: 2, area: 0.9, shinogiAt: 0.5, cut: 2, sturdy: 0, name: C("薄板（帯鋼）", "薄板（帶鋼）"), desc: C("ほぼ平らな薄い帯。よくしなる。", "近乎平坦的薄帶，非常柔軟。") }
  ];

  // len：切先の長さ（刃長に対する比）；edges：適用刃數
  var KISSAKI = [
    { id: "ko", edges: 1, len: 0.035, name: C("小切先", "小切先"), desc: C("平安・鎌倉初期の優美な姿。", "平安、鎌倉初期的優雅姿態。") },
    { id: "chu", edges: 1, len: 0.05, name: C("中切先", "中切先"), desc: C("最も標準的。", "最標準。") },
    { id: "o", edges: 1, len: 0.075, name: C("大切先", "大切先"), desc: C("南北朝期の豪壮な姿。研ぎ減りに強い。", "南北朝時期的豪壯姿態，耐研磨損耗。") },
    { id: "ikubi", edges: 1, len: 0.045, name: C("猪首切先", "豬首切先"), desc: C("詰まって身幅の広い力強い切先。", "短而寬的強勁切先。") },
    { id: "needle", edges: 1, len: 0.09, name: C("尖り先", "尖鋒"), desc: C("細く鋭く尖った先。突きに向く。", "細而尖銳的刀尖，適合突刺。") },
    { id: "round", edges: 0, len: 0.05, name: C("丸い先", "圓頭"), desc: C("斬撃向きの丸みを帯びた先。", "適合劈砍的圓弧刀尖。") },
    { id: "kensaki", edges: 2, len: 0.07, name: C("剣先（尖頭）", "劍尖（尖鋒）"), desc: C("両刃が一点に集まる尖った先。", "兩刃匯於一點的尖鋒。") }
  ];

  var MUNE = [
    { id: "iori", name: C("庵棟", "庵棟") },
    { id: "mitsu", name: C("三ツ棟", "三棟") },
    { id: "maru", name: C("丸棟", "丸棟") },
    { id: "kaku", name: C("角棟", "角棟") }
  ];

  // 反りの中心位置（0＝元、1＝先）。哪些刀種相稱由 BLADE_TYPES.soriType 宣告
  var SORI_TYPES = [
    { id: "koshi", center: 0.32, name: C("腰反り", "腰反"), desc: C("元寄りで反る。太刀らしい姿。", "彎度中心靠近刀根，太刀的典型姿態。") },
    { id: "torii", center: 0.5, name: C("鳥居反り（中反り）", "鳥居反（中反）"), desc: C("中ほどで反る。", "彎度中心在刀身中段。") },
    { id: "saki", center: 0.66, name: C("先反り", "先反"), desc: C("先の方で反る。", "彎度中心靠近刀尖。") },
    { id: "muzori", center: 0.5, name: C("無反り・内反り", "無反・內反"), desc: C("ほぼ真っ直ぐ。", "幾乎筆直。") }
  ];

  // width：土の切れ目の位置（刃口からの比）；risk：焼き割れ倍率；none＝土を置かず全体に焼き入れ
  var HAMON = [
    { id: "suguha", width: 0.22, risk: 1, potential: 15, name: C("直刃", "直刃"), desc: C("真っ直ぐな刃文。地味だが誤魔化しがきかない。", "筆直的刃文，樸素但無法藏拙。") },
    { id: "konotare", width: 0.27, risk: 1.05, potential: 16, name: C("のたれ", "湾れ（のたれ）"), desc: C("ゆったり波打つ刃文。相州伝に多い。", "舒緩起伏的刃文，多見於相州傳。") },
    { id: "gunome", width: 0.28, risk: 1.1, potential: 17, name: C("互の目", "互目"), desc: C("連続する半円の刃文。", "連續半圓形的刃文。") },
    { id: "choji", width: 0.33, risk: 1.2, potential: 18.5, name: C("丁子", "丁子"), desc: C("丁子の実が連なるような華やかな刃文。備前伝の花形。", "如丁子果實相連的華麗刃文，備前傳的代表。") },
    { id: "hitatsura", width: 0.6, risk: 1.6, potential: 20, name: C("皆焼", "皆燒"), desc: C("地にも焼きが飛ぶ。華やかだが割れやすく脆い。", "連地鐵也淬硬，華麗但易裂且脆。") },
    { id: "none", width: 1, risk: 1.3, potential: 0, name: C("土を置かない（全体焼き入れ）", "不置土（整體淬火）"), desc: C("西洋剣・彎刀の流儀。刃文は無いが全体が硬くなる。", "西洋劍、彎刀的做法。沒有刃文，整體都會硬化。") }
  ];

  // 土の厚み：H 倍率（Grossmann の焼入れ強烈度に掛ける）。薄い土は蒸気膜を破って冷却を速める
  var CLAY_LEVELS = [
    { id: "thin", hMul: 1.5, name: C("薄く", "薄") },
    { id: "mid", hMul: 0.6, name: C("中ほど", "中等") },
    { id: "thick", hMul: 0.25, name: C("厚く", "厚") }
  ];

  // H：Grossmann の焼入れ強烈度（静止水 ≈ 1.0）；bath：浴温（℃，Koistinen–Marburger 式に使う）
  var QUENCH_MEDIA = [
    { id: "brine", H: 1.9, bath: 15, name: C("塩水（約 15℃）", "鹽水（約 15℃）") },
    { id: "cold", H: 1.25, bath: 5, name: C("冷水（約 5℃）", "冷水（約 5℃）") },
    { id: "warm", H: 0.95, bath: 25, name: C("ぬるま湯（約 25℃）", "溫水（約 25℃）") },
    { id: "hot", H: 0.6, bath: 45, name: C("湯（約 45℃）", "熱水（約 45℃）") },
    { id: "oil", H: 0.3, bath: 60, name: C("油（約 60℃）", "油（約 60℃）") }
  ];

  // 焼き戻しの色（酸化膜の干渉色）。回火小遊戲依溫度顯示這些顏色，停火時的溫度＝回火溫度。
  // 實際溫度由 Hollomon–Jaffe 參數（溫度＋時間）計算硬度下降。
  var TEMPER_COLORS = [
    { t: 20, color: "#c9ccd0", name: C("白い鋼肌", "銀白鋼面") },
    { t: 180, color: "#cfccc0", name: C("白い鋼肌", "銀白鋼面") },
    { t: 200, color: "#e6d9a0", name: C("淡い麦わら色", "淡麥稈色") },
    { t: 220, color: "#d9b85a", name: C("麦わら色", "麥稈色") },
    { t: 240, color: "#c8963c", name: C("濃い麦わら色", "深麥稈色") },
    { t: 255, color: "#a8642e", name: C("茶（ブロンズ）", "褐（青銅色）") },
    { t: 270, color: "#7c3f72", name: C("紫", "紫") },
    { t: 290, color: "#2f3f8f", name: C("濃い青", "深藍") },
    { t: 310, color: "#3f6fb0", name: C("青", "藍") },
    { t: 340, color: "#8fa8b8", name: C("薄い青灰", "淡藍灰") },
    { t: 400, color: "#8a8f94", name: C("灰色", "灰色") },
    { t: 600, color: "#6f7378", name: C("灰色", "灰色") }
  ];

  var TEMPER_HOURS = [0.5, 1, 2];

  // 研ぎ：order が正しい順番
  var STONES = [
    { id: "kongo", order: 1, name: C("金剛砥", "金剛砥") },
    { id: "binsui", order: 2, name: C("備水砥", "備水砥") },
    { id: "kaisei", order: 3, name: C("改正砥", "改正砥") },
    { id: "chunagura", order: 4, name: C("中名倉砥", "中名倉砥") },
    { id: "koma", order: 5, name: C("細名倉砥", "細名倉砥") },
    { id: "uchigumori", order: 6, name: C("内曇砥", "內曇砥") },
    { id: "hazuya", order: 7, name: C("刃艶", "刃艷") },
    { id: "jizuya", order: 8, name: C("地艶", "地艷") },
    { id: "nugui", order: 9, name: C("拭い", "拭") },
    { id: "hadori", order: 10, name: C("刃取り", "刃取") },
    { id: "migaki", order: 11, name: C("磨き", "磨") }
  ];

  var EDGE_GEOMETRY = [
    { id: "hamaguri", name: C("蛤刃（肉を残す）", "蛤刃（保留刃肉）"), cut: 0, chip: 0.7, desc: C("丈夫で刃こぼれしにくい。", "堅固不易崩刃。") },
    { id: "standard", name: C("ふつう", "一般"), cut: 4, chip: 1, desc: C("標準的な肉置き。", "標準的刃肉。") },
    { id: "flat", name: C("平肉を落とす", "削平刃肉"), cut: 8, chip: 1.45, desc: C("よく切れるが欠けやすい。", "鋒利但易崩。") }
  ];

  var YASURIME = [
    { id: "kiri", name: C("切り", "切") },
    { id: "katte", name: C("勝手下がり", "勝手下") },
    { id: "sujikai", name: C("筋違い", "筋違") },
    { id: "takanoha", name: C("鷹の羽", "鷹羽") },
    { id: "kesho", name: C("化粧鑢", "化妝銼") }
  ];

  var NAKAGOJIRI = [
    { id: "kuri", name: C("栗尻", "栗尻") },
    { id: "ichimonji", name: C("一文字", "一文字") },
    { id: "kengyo", name: C("剣形", "劍形") },
    { id: "iriyama", name: C("入山形", "入山形") }
  ];

  // ---------------- 試し斬り ----------------
  // difficulty：必要な切れ味；hard：刃への負担（0〜1）
  var TARGETS = [
    { id: "goza1", name: C("畳表 一枚巻き", "榻榻米蓆 一捲"), difficulty: 20, hard: 0.05, points: 1 },
    { id: "goza3", name: C("畳表 三枚巻き", "榻榻米蓆 三捲"), difficulty: 42, hard: 0.15, points: 2 },
    { id: "take", name: C("青竹（芯入り巻藁）", "青竹（內含竹芯的蓆捲）"), difficulty: 55, hard: 0.35, points: 3 },
    { id: "goza5", name: C("畳表 五枚巻き", "榻榻米蓆 五捲"), difficulty: 66, hard: 0.25, points: 4 },
    { id: "kabuto", name: C("兜割り（鉄兜）", "兜割（鐵盔）"), difficulty: 82, hard: 1, points: 6 }
  ];

  // ---------------- 互擊の対手（ひとりでも遊べるように） ----------------
  var NPC_SWORDS = [
    { id: "minarai", name: C("見習いの刀", "學徒之刀"), sharpness: 45, hardness: 57, toughness: 45, mass: 0.9, integrity: 70 },
    { id: "sato", name: C("里の鍛冶の刀", "村中鍛冶之刀"), sharpness: 62, hardness: 60, toughness: 62, mass: 1.0, integrity: 90 },
    { id: "hono", name: C("神前奉納刀", "神前奉納刀"), sharpness: 78, hardness: 62, toughness: 75, mass: 1.05, integrity: 110 }
  ];

  // 審査の等級（total 以上）
  var GRADES = [
    { min: 90, name: C("神品", "神品") },
    { min: 78, name: C("上々作", "上上作") },
    { min: 65, name: C("上作", "上作") },
    { min: 50, name: C("良作", "良作") },
    { min: 35, name: C("並作", "普通作") },
    { min: 0, name: C("鈍刀", "鈍刀") }
  ];

  // 瑕疵
  var FLAWS = {
    fukure: { name: C("ふくれ（鍛着不良）", "膨脹（熔接不良）"), penalty: 4 },
    kitaeware: { name: C("鍛え割れ", "鍛裂"), penalty: 5 },
    burned: { name: C("沸かし過ぎ（鋼の焼損）", "沸過頭（鋼材燒損）"), penalty: 4 },
    hotShort: { name: C("赤熱脆性による割れ", "紅熱脆性開裂"), penalty: 6 },
    shinganeExposed: { name: C("心鉄の露出", "心鐵外露"), penalty: 6 },
    shortSteel: { name: C("鋼不足（重ねが薄い）", "鋼量不足（重過薄）"), penalty: 3 },
    yakiware: { name: C("焼き割れ", "淬裂"), penalty: 12 },
    hagire: { name: C("刃切れ", "刃切（刃口裂紋）"), penalty: 8 },
    soriCrack: { name: C("反り直しの割れ", "調反開裂"), penalty: 5 },
    yakimura: { name: C("焼きむら（フェライト残り）", "淬火不均（殘留肥粒鐵）"), penalty: 3 },
    patternLost: { name: C("模様の消失", "紋路消失"), penalty: 2 }
  };

  window.PriTestKatanaData = {
    KAWAGANE: KAWAGANE,
    SHINGANE: SHINGANE,
    STEPS: STEPS,
    BLADE_TYPES: BLADE_TYPES,
    TSUKURI: TSUKURI,
    KISSAKI: KISSAKI,
    MUNE: MUNE,
    SORI_TYPES: SORI_TYPES,
    HAMON: HAMON,
    CLAY_LEVELS: CLAY_LEVELS,
    QUENCH_MEDIA: QUENCH_MEDIA,
    TEMPER_COLORS: TEMPER_COLORS,
    TEMPER_HOURS: TEMPER_HOURS,
    STONES: STONES,
    EDGE_GEOMETRY: EDGE_GEOMETRY,
    YASURIME: YASURIME,
    NAKAGOJIRI: NAKAGOJIRI,
    TARGETS: TARGETS,
    NPC_SWORDS: NPC_SWORDS,
    GRADES: GRADES,
    FLAWS: FLAWS,
    PATTERNS: [
      { id: "itame", difficulty: 0.1, beauty: 3, name: C("板目肌", "板目肌"), desc: C("木の板目のような最も一般的な肌。", "如木板紋般最普遍的地肌。") },
      { id: "mokume", difficulty: 0.2, beauty: 3.5, name: C("杢目肌", "杢目肌"), desc: C("木の年輪のような丸い模様。", "如年輪般的圓形紋路。") },
      { id: "masame", difficulty: 0.3, beauty: 3.5, name: C("柾目肌", "柾目肌"), desc: C("真っ直ぐに流れる筋。同じ方向に重ね続ける。", "筆直流動的紋路，需始終同向疊合。") },
      { id: "ayasugi", difficulty: 0.45, beauty: 4, name: C("綾杉肌", "綾杉肌"), desc: C("大きく波打つ杉綾模様。月山派の特徴で難度が高い。", "大幅起伏的杉綾紋，月山派特色，難度高。") }
    ],
    CONSTRUCTIONS: [
      { id: "maru", toughness: 0.62, risk: 0, needsShingane: false, coreFrac: 0, name: C("丸鍛え", "丸鍛"), desc: C("一種類の鋼だけで作る。古刀や短刀、両刃剣に多い。", "只用一種鋼製作，多見於古刀、短刀與雙刃劍。") },
      { id: "kobuse", toughness: 1.0, risk: 0.08, needsShingane: true, coreFrac: 0.35, name: C("甲伏せ", "甲伏"), desc: C("U 字の皮鉄で心鉄を包む。最も一般的。", "以 U 形皮鐵包住心鐵，最普遍。") },
      { id: "honsanmai", toughness: 1.1, risk: 0.16, needsShingane: true, coreFrac: 0.4, name: C("本三枚・夾鋼", "本三枚・夾鋼"), desc: C("心鉄を側鉄で挟み、刃に硬い鋼を配する。中国剣の夾鋼も同じ考え方。", "以側鐵夾住心鐵、刃口配硬鋼。中國劍的夾鋼也是同樣思路。") },
      { id: "shihozume", toughness: 1.2, risk: 0.26, needsShingane: true, coreFrac: 0.42, name: C("四方詰め", "四方詰"), desc: C("心鉄の四方を刃鉄・棟鉄・側鉄で囲む。最も手間がかかる。", "心鐵四面以刃鐵、背鐵、側鐵包圍，工序最繁複。") }
    ]
  };
})();
