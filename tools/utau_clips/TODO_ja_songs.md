# 待製作：日本追加曲目（2026-10-19 使用者勾選）

使用者從候選清單中挑出、之後要在**另一台裝置**製作的日本歌（共 56 首）。
目前都**還沒**加進 `static_src/utau_songs.js` 與 `songs.json`。

## 製作步驟

1. 在 `static_src/utau_songs.js` 的日本區塊加入 `S(年份, "歌名", "歌手")`。
   - 年份與分類是建議值，加入前請再確認。
   - 分類：`anime`＝動漫，`screen`＝影視，`pop`＝J-POP，`idol`＝偶像，`net`＝VOCALOID・網路，`classic`＝懷舊・演歌。
2. 用 `find_urls.py` 找 YouTube 官方音源，寫進 `songs.json`（確認 `start` 片段）。
3. `build_pack.py` 重做題庫包。
4. 做完的歌在本清單打勾，全部完成後刪除本檔。

## 曲目

### 動漫・網路

| 完成 | 歌手 | 歌名 | 建議年份 | 建議分類 | 備註 |
|---|---|---|---|---|---|
| [ ] | Folder5 | Believe | 2000 | anime | ONE PIECE OP3 |
| [ ] | Bon-Bon Blanco | BON VOYAGE! | 2003 | anime | ONE PIECE OP4 |
| [ ] | Janne Da Arc | 月光花 | 2005 | anime | ブラック・ジャック |
| [ ] | MAHO堂 | おジャ魔女カーニバル!! | 1999 | anime | |
| [ ] | 美波 | カワキヲアメク | 2019 | anime | ドメスティックな彼女 |
| [ ] | 亜咲花 | SHINY DAYS | 2018 | anime | ゆるキャン△ |
| [ ] | さユり | 花の塔 | 2022 | anime | リコリス・リコイル |
| [ ] | BURNOUT SYNDROMES | ヒカリアレ | 2016 | anime | ハイキュー!! |
| [ ] | BURNOUT SYNDROMES | PHOENIX | 2020 | anime | ハイキュー!! |
| [ ] | 大石昌良 | 君じゃなきゃダメみたい | 2014 | anime | 月刊少女野崎くん |
| [ ] | 玉置成実 | Believe | 2003 | anime | ガンダムSEED。Folder5 也有同名「Believe」，id 是「地區＋歌名」會撞名，需改用不同歌名寫法或擇一 |
| [ ] | 玉置成実 | Realize | 2003 | anime | ガンダムSEED |
| [ ] | 玉置成実 | Reason | 2005 | anime | ガンダムSEED DESTINY |
| [ ] | SIAM SHADE | 1/3の純情な感情 | 1997 | anime | るろうに剣心 |
| [ ] | 岩崎良美 | タッチ | 1985 | anime | |
| [ ] | 馬渡松子 | 微笑みの爆弾 | 1992 | anime | 幽☆遊☆白書 |
| [ ] | 宮崎歩 | brave heart | 1999 | anime | デジモンアドベンチャー |
| [ ] | May'n・中島愛 | ライオン | 2008 | anime | マクロスF |
| [ ] | ReoNa | ANIMA | 2020 | anime | SAO アリシゼーション WoU |
| [ ] | 結束バンド | ギターと孤独と蒼い惑星 | 2022 | anime | ぼっち・ざ・ろっく! |
| [ ] | 羊文学 | more than words | 2023 | anime | 呪術廻戦 渋谷事変 |
| [ ] | 女王蜂 | メフィスト | 2023 | anime | 【推しの子】 |
| [ ] | みきとP | ロキ | 2017 | net | VOCALOID 曲（原方針排除 VOCALOID P，使用者明確選入） |

### J-POP・影視・偶像

| 完成 | 歌手 | 歌名 | 建議年份 | 建議分類 | 備註 |
|---|---|---|---|---|---|
| [ ] | 島谷ひとみ | 亜麻色の髪の乙女 | 2002 | pop | |
| [ ] | 島谷ひとみ | Perseus -ペルセウス- | 2002 | pop | 年份待確認 |
| [ ] | 荻野目洋子 | ダンシング・ヒーロー (Eat You Up) | 1985 | pop | |
| [ ] | 桑田佳祐 | 白い恋人達 | 2001 | pop | |
| [ ] | 桑田佳祐 | 波乗りジョニー | 2001 | pop | |
| [ ] | 桑田佳祐 | 明日晴れるかな | 2007 | screen | ドラマ プロポーズ大作戦 |
| [ ] | wacci | 別の人の彼女になったよ | 2018 | pop | |
| [ ] | 氣志團 | One Night Carnival | 2001 | pop | |
| [ ] | あたらよ | 僕は... | — | pop | 使用者指定（不在原候選中），正式歌名與年份待確認 |
| [ ] | M!LK | 好きすぎて滅! | 2025 | idol | 2026 上半期 Billboard JAPAN #2 |
| [ ] | 倉木麻衣 | Love, Day After Tomorrow | 1999 | pop | |
| [ ] | 倉木麻衣 | Secret of my heart | 2000 | anime | 名探偵コナン |
| [ ] | 倉木麻衣 | Time after time ～花舞う街で～ | 2003 | anime | 名探偵コナン。使用者寫「Secret of my heart ～花舞う街で～」，推定是兩首合併，待確認 |
| [ ] | 倉木麻衣 | 渡月橋 ～君 想ふ～ | 2017 | anime | 名探偵コナン |
| [ ] | ZARD | 負けないで | 1993 | pop | |
| [ ] | ZARD | マイ フレンド | 1996 | anime | SLAM DUNK |
| [ ] | 大黒摩季 | あなただけ見つめてる | 1993 | anime | SLAM DUNK |
| [ ] | 大塚愛 | 金魚花火 | 2004 | pop | |
| [ ] | 浜崎あゆみ | SEASONS | 2000 | pop | |
| [ ] | aiko | カブトムシ | 1999 | pop | |
| [ ] | 久保田利伸 | LA・LA・LA LOVE SONG | 1996 | screen | ドラマ ロングバケーション |
| [ ] | Dreams Come True | 何度でも | 2005 | pop | |
| [ ] | Dreams Come True | 決戦は金曜日 | 1992 | pop | |
| [ ] | HY | 366日 | 2008 | pop | |
| [ ] | Do As Infinity | 深い森 | 2001 | anime | 犬夜叉 |
| [ ] | WANDS | 世界が終るまでは… | 1994 | anime | SLAM DUNK |
| [ ] | flumpool | 君に届け | 2009 | screen | 映画 君に届け，年份待確認 |
| [ ] | flumpool | 星に願いを | 2010 | pop | |
| [ ] | B'z | イチブトゼンブ | 2009 | screen | ドラマ ブザー・ビート |
| [ ] | Mr.Children | Tomorrow never knows | 1994 | screen | ドラマ 若者のすべて |
| [ ] | Mr.Children | HANABI | 2008 | screen | ドラマ コード・ブルー |
| [ ] | ASIAN KUNG-FU GENERATION | 遥か彼方 | 2002 | anime | NARUTO |
| [ ] | ONE OK ROCK | Wherever you are | 2010 | pop | |

## 注意

- 2005 年以前的歌不少；2026-10-17 改版曾拿掉年代較久遠的歌，這批是使用者明確選入。
- **「Believe」撞名**：Folder5 與玉置成実都有，id 規則是「地區＋歌名」（`ja:Believe`），同地區內不能重複，製作時要處理（例如其中一首歌名加註）。
