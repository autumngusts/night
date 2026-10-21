// 我不會唱歌（utau）進階模式的題庫包：讀取 zip、存進這台裝置的 IndexedDB、取出音檔。
// 題庫包由 tools/utau_clips/build_pack.py 製作；音檔不上網（使用者指定：本機題庫包）。
// zip 只支援 STORED（不壓縮）格式：製作工具就是用這個格式輸出，所以不需要外部 unzip 套件。
// 匯入多個題庫包時以歌曲 id 合併（同 id 以新的覆蓋）。
(function () {
  "use strict";

  var DB_NAME = "pritest-utau-pack";
  var PACK_FORMAT = "pritest-utau-pack";
  var dbPromise = null;

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error("ut_err_no_idb")); return; }
        var r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = function () {
          var db = r.result;
          if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
          if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips");
        };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    }
    return dbPromise;
  }

  // ---------------- zip（STORED）讀取 ----------------

  function readBytes(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new DataView(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function decodeName(view, offset, length) {
    var bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    return new TextDecoder("utf-8").decode(bytes);
  }

  // 回傳 { name: { offset, size } }（offset 是資料本體在檔案中的位置）
  function readZipIndex(file) {
    var tailSize = Math.min(file.size, 65557);
    return readBytes(file.slice(file.size - tailSize)).then(function (tail) {
      var eocd = -1;
      for (var i = tail.byteLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error("ut_err_pack_format");
      var count = tail.getUint16(eocd + 10, true);
      var cdSize = tail.getUint32(eocd + 12, true);
      var cdOffset = tail.getUint32(eocd + 16, true);
      return readBytes(file.slice(cdOffset, cdOffset + cdSize)).then(function (cd) {
        var entries = [];
        var p = 0;
        for (var n = 0; n < count; n++) {
          if (cd.getUint32(p, true) !== 0x02014b50) throw new Error("ut_err_pack_format");
          var method = cd.getUint16(p + 10, true);
          var size = cd.getUint32(p + 20, true);
          var nameLen = cd.getUint16(p + 28, true);
          var extraLen = cd.getUint16(p + 30, true);
          var commentLen = cd.getUint16(p + 32, true);
          var local = cd.getUint32(p + 42, true);
          var name = decodeName(cd, p + 46, nameLen);
          if (method !== 0) throw new Error("ut_err_pack_compressed");
          entries.push({ name: name, size: size, local: local });
          p += 46 + nameLen + extraLen + commentLen;
        }
        // 本地檔頭的檔名／extra 長度可能與中央目錄不同，要逐一讀
        return Promise.all(entries.map(function (e) {
          return readBytes(file.slice(e.local, e.local + 30)).then(function (h) {
            if (h.getUint32(0, true) !== 0x04034b50) throw new Error("ut_err_pack_format");
            e.offset = e.local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
            return e;
          });
        })).then(function (list) {
          var index = {};
          list.forEach(function (e) { index[e.name] = { offset: e.offset, size: e.size }; });
          return index;
        });
      });
    });
  }

  // ---------------- 儲存空間 ----------------

  // 剩餘空間要再留一點餘裕：IndexedDB 存 Blob 有額外開銷，estimate() 也只是估計值
  var SPACE_MARGIN = 1.05;
  var SPACE_RESERVE = 20 * 1024 * 1024;

  // 要求瀏覽器不要自動清除這個網站的資料（題庫包）。不支援或被拒絕時回傳 false，不影響匯入。
  function requestPersist() {
    var s = navigator.storage;
    if (!s || !s.persist) return Promise.resolve(false);
    return (s.persisted ? s.persisted() : Promise.resolve(false)).then(function (already) {
      return already || s.persist();
    }).catch(function () { return false; });
  }

  // { usage, quota, persisted }：usage／quota 不支援時為 null
  function storageInfo() {
    var s = navigator.storage;
    var est = s && s.estimate ? s.estimate().catch(function () { return null; }) : Promise.resolve(null);
    var per = s && s.persisted ? s.persisted().catch(function () { return false; }) : Promise.resolve(false);
    return Promise.all([est, per]).then(function (r) {
      var e = r[0];
      var ok = e && typeof e.quota === "number" && e.quota > 0;
      return { usage: ok ? e.usage || 0 : null, quota: ok ? e.quota : null, persisted: !!r[1] };
    });
  }

  // 這個包要新寫入的大小：已經存在的音檔（同一路徑＝同一來源同一版本）會被覆蓋，不算在內
  function bytesNeeded(db, manifest, index) {
    return req(db.transaction("clips").objectStore("clips").getAllKeys()).then(function (keys) {
      var have = {};
      keys.forEach(function (k) { have[k] = true; });
      var need = 0;
      manifest.songs.forEach(function (song) {
        Object.keys(song.clips || {}).forEach(function (variant) {
          var path = song.clips[variant];
          if (index[path] && !have[path]) need += index[path].size;
        });
      });
      return need;
    });
  }

  // 空間不夠就丟出 ut_err_pack_space（帶 need／free 給畫面顯示），不支援 estimate() 時直接放行
  function checkSpace(db, manifest, index) {
    return Promise.all([bytesNeeded(db, manifest, index), storageInfo()]).then(function (r) {
      var need = r[0];
      var info = r[1];
      if (info.quota === null || need === 0) return;
      var free = info.quota - info.usage;
      if (need * SPACE_MARGIN + SPACE_RESERVE > free) {
        var err = new Error("ut_err_pack_space");
        err.params = { need: need, free: Math.max(0, free) };
        throw err;
      }
    });
  }

  // ---------------- 公開 API ----------------

  // 匯入題庫包 zip → { added, total, persisted }
  function importFile(file) {
    var manifest;
    var index;
    var persisted = false;
    return requestPersist().then(function (p) {
      persisted = p;
      return readZipIndex(file);
    }).then(function (idx) {
      index = idx;
      var m = index["manifest.json"];
      if (!m) throw new Error("ut_err_pack_format");
      return file.slice(m.offset, m.offset + m.size).text();
    }).then(function (text) {
      manifest = JSON.parse(text);
      if (!manifest || manifest.format !== PACK_FORMAT || !Array.isArray(manifest.songs)) throw new Error("ut_err_pack_format");
      return openDb();
    }).then(function (db) {
      return checkSpace(db, manifest, index).then(function () { return db; });
    }).then(function (db) {
      var tx = db.transaction(["songs", "clips"], "readwrite");
      var songs = tx.objectStore("songs");
      var clips = tx.objectStore("clips");
      manifest.songs.forEach(function (song) {
        var names = [];
        Object.keys(song.clips || {}).forEach(function (variant) {
          var path = song.clips[variant];
          var entry = index[path];
          if (!entry) return;
          clips.put(file.slice(entry.offset, entry.offset + entry.size, "audio/mp4"), path);
          names.push(variant);
        });
        songs.put({ id: song.id, t: song.t, a: song.a, y: song.y, r: song.r, c: song.c, clips: song.clips, variants: names });
      });
      return txDone(tx);
    }).then(function () {
      return list();
    }).then(function (all) {
      return { added: manifest.songs.length, total: all.length, persisted: persisted };
    });
  }

  // 已匯入的歌曲（不含音檔本體）
  function list() {
    return openDb().then(function (db) {
      return req(db.transaction("songs").objectStore("songs").getAll());
    });
  }

  // 取得某首歌某個版本的音檔 Blob（沒有就 null）
  function getClip(song, variant) {
    var path = song && song.clips ? song.clips[variant] : null;
    if (!path) return Promise.resolve(null);
    return openDb().then(function (db) {
      return req(db.transaction("clips").objectStore("clips").get(path));
    }).then(function (blob) { return blob || null; });
  }

  function clear() {
    return openDb().then(function (db) {
      var tx = db.transaction(["songs", "clips"], "readwrite");
      tx.objectStore("songs").clear();
      tx.objectStore("clips").clear();
      return txDone(tx);
    });
  }

  window.PriTestUtauPack = { importFile: importFile, list: list, getClip: getClip, clear: clear, storageInfo: storageInfo };
})();
