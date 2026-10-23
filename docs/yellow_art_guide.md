# 黃牌 Yellow Card 美術指南

2026-10-23 建立（使用者要求：美術風格的建議、尺寸與提示詞）。
放圖的位置與程式的對應寫在最後一節；換圖只要覆蓋同名檔案，不用改程式。

## 1. 風格建議：剪紙風（紙片美術）

建議全部統一成**剪紙風**，理由：

- 現有的戰場小人（13 位英雄 × 四方向，下表的角色描述是照這批小人寫的）和聖戰士／法師／遊俠／狂戰士的選角大圖已經是剪紙風，改另一種風格要全部重畫。
- 設計文件一開始就訂了「紙片美術」；Hellcard 本身也是紙片、手繪紙偶的質感，和「圓形戰場上的棋子」很搭。
- 剪紙風色塊大、輪廓清楚，縮到戰場上 40～60px 也認得出是誰；細緻的動畫 Q 版縮小後細節會糊掉。

2026-10-23 放進去的 9 張動畫 Q 版大圖（祭司、魔女、武僧、德魯伊、時空術士、召喚師、吟遊詩人、鍊金術師、賭徒）是**暫時版**，之後用本指南重畫覆蓋。

### 風格規則（每張圖都一樣）

| 項目 | 規則 |
| --- | --- |
| 材質 | 厚卡紙剪出來疊在一起：每個色塊是一張紙，邊緣有一點點紙纖維與白色切邊，色塊之間有淡淡的投影 |
| 線條 | 不畫黑色描線；靠色塊的明暗區分形狀 |
| 上色 | 平塗，每個色塊最多兩階明暗；不用漸層、不用寫實光影 |
| 比例 | 大頭 Q 版，頭身比約 1：2；眼睛是簡單的黑色圓點或橢圓（參考 `mage_portrait.png`） |
| 色彩 | 每位英雄以代表色為主色（`yellow_data.js` 的 `color`），金色當點綴；敵人用偏暗、偏灰的配色，首領加一個鮮明的主色 |
| 背景 | 透明（PNG alpha），不要格子底、不要地面陰影以外的背景 |
| 角度 | 選角大圖：正面偏 3/4；戰場小人：見第 3 節 |

## 2. 尺寸一覽

| 類別 | 檔名 | 輸出尺寸 | 建議生成尺寸 | 畫面上的大小 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 選角大圖 | `heroes/<id>_portrait.png` | 512×640 | 1024×1280 | 選角資訊卡左側約 6～8rem 寬 | 全身、腳底到下緣留約 16px |
| 戰場小人 | `heroes/<id>_<n/e/s/w>.png` | 160×192 | 640×768（正交、同一張參考圖） | 戰場上約 40～60px 高 | 南＝面向畫面；東／西只畫一張，另一邊程式左右翻轉 |
| 敵人棋子（小／中／大） | `enemies/<id>.png`（尚未接上程式） | 128×128 | 512×512 | 判定圓直徑約戰場的 3～5% | 主體放在中央圓形內，四周留透明 |
| 首領棋子 | `enemies/<id>.png`（尚未接上程式） | 256×256 | 1024×1024 | 判定圓直徑約戰場的 8% | 同上 |
| 卡面插圖 | `cards/<path>.png`（尚未接上程式） | 480×200 | 1200×500 | 卡面上方約 120×50px | 一條成長方向一張就夠（39 張） |
| 地區／遺物圖示 | `icons/<id>.png`（尚未接上程式） | 128×128 | 512×512 | 約 1.5～2rem | 目前是 emoji |

戰場上的東西都很小，**生成時用大尺寸、輸出時縮小**，邊緣才不會鋸齒。縮圖請用 Lanczos。

## 3. 戰場小人（四方向）的作法

1. 先生成**正面（s）**定稿，當作之後所有方向的參考圖（image-to-image／參考圖功能）。
2. 用同一張參考圖生成**背面（n）**、**側面（w，面向左）**；側面只要一張，東邊程式自己翻轉。
3. 四張的腳底要在同一個高度（圖的下緣往上約 8px），頭頂不超過上緣，才不會在轉向時跳動。
4. 去背後檢查邊緣沒有白邊或格子殘留（深色背景上看最明顯）。

## 4. 提示詞

圖像模型用英文提示詞效果最好。每張圖＝**共通風格**＋**角色描述**＋**構圖**，負面提示詞每張都加。

### 共通風格（每張都接在最前面）

```
layered papercraft cut-out illustration, chibi proportions (big head, 1:2 head-to-body),
thick cardstock paper layers with subtle paper fiber texture and tiny white cut edges,
soft drop shadows between paper layers, flat colors with at most two tones per shape,
no black outlines, simple dot eyes, clean silhouette, centered, transparent background
```

### 負面提示詞

```
checkerboard background, transparent-pattern background, watermark, text, signature, frame,
realistic shading, gradient, glossy, 3d render, anime cel shading, thick black outline,
cropped feet, extra limbs, multiple characters, busy background, floor, scenery
```

### 構圖

- 選角大圖：`full body, standing, three-quarter front view, slight heroic pose, portrait 4:5`
- 戰場小人正面：`full body, orthographic front view, standing idle, game sprite, 5:6`
- 背面：`full body, orthographic back view, same character, game sprite, 5:6`
- 側面：`full body, orthographic side view facing left, same character, game sprite, 5:6`
- 敵人／首領棋子：`single creature, front view, fits inside a circle, game token, square`

### 英雄（代表色見 `yellow_data.js`）

| 英雄 | 角色描述 |
| --- | --- |
| 聖戰士 paladin | `young blond holy knight, silver plate armor with blue tabard and gold trim, blue shield with a gold cross, short sword` |
| 狂戰士 berserker | `viking berserker, horned iron helmet, red hair, fur and leather armor, an axe in each hand` |
| 遊俠 ranger | `forest ranger, green hooded cloak, leather armor, longbow and quiver, calm eyes` |
| 法師 mage | `young mage, deep blue pointed hat and robe with gold trim, wooden staff with a blue crystal, long silver hair` |
| 祭司 priest | `gentle priestess, white and teal robes, tall mitre-like hood, golden staff with a glowing star` |
| 魔女 witch | `witch with a wide purple hat, purple robe with gold trim, staff topped with a crescent moon and a purple gem, long silver hair` |
| 召喚師 summoner | `summoner in a brown hooded robe, staff topped with a purple crystal, two small round spirit companions floating beside` |
| 吟遊詩人 bard | `cheerful bard, pink feathered hat, short cape, lute in hands, musical notes cut from paper` |
| 武僧 monk | `martial artist monk, orange headband and sash, simple black gi, wrapped fists, fighting stance` |
| 德魯伊 druid | `druid with deer antlers on a green hood, leaf cloak, wooden staff with a green orb, small owl on shoulder` |
| 時空術士 chronomancer | `chronomancer in a purple-blue hooded robe with gold clock motifs, golden gear rings floating around the hands, silver hair` |
| 鍊金術師 alchemist | `alchemist with brass goggles on a green hood, leather satchel, colorful potion flasks on a belt` |
| 賭徒 gambler | `stylish gambler, black top hat with red band, red tailcoat, playing cards and dice in hand` |

### 敵人與首領（2026-10-23 新增的放前面）

| 敵人 | 角色描述 |
| --- | --- |
| 骨龍 bonedragon（第一幕首領） | `skeletal dragon made of bone-white paper, glowing green eye sockets, tattered wings` |
| 巫妖 lich（第一幕首領） | `lich sorcerer, skull face, dark purple robe, floating crown, staff with a skull` |
| 腐化巨人 giant（第一幕首領） | `hulking rotten giant, moss and slime, one big eye, stitched body` |
| 熔岩巨像 colossus（第二幕首領） | `colossus of cracked black rock with glowing lava seams, massive fists` |
| 炎之女王 queen（第二幕首領） | `fire queen, flame hair, crimson gown, burning crown, haughty pose` |
| 深淵領主 lord（第二幕首領） | `abyss demon lord, curved horns, dark red skin, spiked armor` |
| 黑哨王 whistler（第三幕首領） | `corrupt referee king, black-and-white striped coat, golden whistle, smug grin` |
| 審判天平 scales（第三幕首領） | `giant floating golden scales of judgement with a blindfolded mask in the center` |
| 地獄裁判長 referee（第三幕首領） | `hell referee, horns, striped referee shirt, holding up a yellow card` |
| 裂殖腐泥 bigslime／小腐泥 slimelet | `round green slime blob, simple face` / `tiny green slime droplet` |
| 吸血鬼 vampire | `pale vampire with high collar cape, red eyes` |
| 熔岩泥 lavaslime／火花 spark | `orange molten slime blob` / `tiny living ember spark` |
| 惡魔祭司 priestess | `demon priestess with purple veil, glowing orb` |
| 噓聲觀眾 heckler | `angry spectator with a megaphone, scarf` |
| 紀律官 enforcer | `stern enforcer in a dark uniform with a baton` |

其他既有敵人（骷髏兵、食屍鬼、地獄犬…）照名稱描述即可，記得加共通風格。

## 5. 放圖的位置與程式的對應

| 類別 | 位置 | 程式 |
| --- | --- | --- |
| 選角大圖、戰場小人 | `static_src/images/yellow/heroes/` | `static_src/yellow.js` 的 `HERO_ART`（`dirs`＝有哪些方向、`portrait`＝有沒有大圖） |
| 敵人、卡面、圖示 | 建議 `static_src/images/yellow/enemies/`、`cards/`、`icons/` | 尚未接上：目前敵人與地區用 emoji、卡面用職業圖示。圖做好後再加讀圖的程式（沒有圖時退回 emoji） |

放好後執行 `py -3 generate.py`，`dist/static/images/yellow/` 就會有新圖。
