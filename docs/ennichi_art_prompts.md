# 緣日樂園：新角色立繪提示詞（2026-11-12）

> 樣本頁的新角色立繪目前是 SVG 向量暫代（`tools/ennichi_model/build_portraits.py`）。
> 正式版請用與時間管理大師（jikan）**相同的生成工具與風格**生成，再放到 `static_src/images/ennichi/`。
> 規格見 `docs/ennichi_rules.md` §8.2。

## 共通規格

| 用途 | 尺寸 | 檔名 | 構圖 |
|---|---|---|---|
| 頭像（murmur 氣泡、牆、卡片） | 256×256 webp | `portrait_<id>.webp` | 胸上特寫、臉在畫面中央偏上、白底或淺色底（與 jikan 相同） |
| 對話立繪（正式版劇情用） | 768×1024 png（去背） | `stand_<id>.png` | 膝上、正面略斜、雙手可見 |

共通提示詞（每張都加在前面）：

```
anime style illustration, beautiful detailed eyes, soft cel shading, clean line art,
bust-up portrait, facing viewer, simple white background, high quality, same art style as a visual novel
```

負面提示詞：

```
nsfw, cleavage, revealing clothes, extra fingers, deformed hands, text, watermark, signature, blurry
```

> jikan 有部分頭像較為暴露；緣日樂園是全年齡的樂園經營，立繪一律**不暴露**（負面提示詞已加入）。

## 角色

### 小夜（sayo）— 神社巫女、青梅竹馬
```
1girl, shrine maiden (miko), long straight black hair, low ponytail tied with white paper ribbon (takenaga),
red and white mizuhiki hair ornament, gentle smile, red-brown eyes,
white kimono top (kosode) with red collar underlayer, red hakama, warm lantern light at night shrine
```

### 鐵子（tetsuko）— 老師傅的孫女、機械宅
```
1girl, short messy orange-brown hair with ahoge, green eyes, big confident grin,
orange-lens goggles on head, navy blue mechanic jumpsuit with rolled sleeves, tool belt,
small grease smudge on cheek, holding a wrench, workshop background softly blurred
```

### 蓮華（renge）— 和菓子店看板娘
```
1girl, light brown hair in a neat bun, cherry blossom kanzashi hairpin with dangling ornaments,
purple eyes, closed-eye happy smile, pink kimono with sakura pattern, white kappogi apron,
holding a tray of sakura mochi
```

### 之後追加（規格 §3.1 標 ❓ 的角色）

| id | 角色 | 提示詞重點 |
|---|---|---|
| yuzu | 柚・美術系大學生 | 短鮑伯、貝雷帽、沾到顏料的圍裙、素描本 |
| wakana | 若菜・縣府觀光課職員 | 黑長髮低馬尾、眼鏡、套裝、識別證、資料夾 |
| erika | 艾莉卡・外國網紅 | 金色雙馬尾、藍眼、穿浴衣自拍、手機 |

## 匯入

1. 生成的圖放到 `photo/tmp/ennichi/`（不進 Git 的原圖區）。
2. 裁成 256×256，轉 webp（品質 85）→ `static_src/images/ennichi/portrait_<id>.webp`。
3. `static_src/ennichi_lab.js` 的 `PORTRAITS` 把 `.svg` 改成 `.webp`。
