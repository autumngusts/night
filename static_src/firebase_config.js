// クラウド保存（雲端保存）用のFirebaseプロジェクト設定。
// ローカル専用ゲームではこの値は一切参照されず、Firebase SDKもロードされない。
window.PRITEST_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCxmE5qaQe1KArJ1DDOsqIzyx2mLmhMb9s",
  authDomain: "elden-ring-nightreign.firebaseapp.com",
  databaseURL: "https://elden-ring-nightreign-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "elden-ring-nightreign",
  storageBucket: "elden-ring-nightreign.firebasestorage.app",
  messagingSenderId: "1075826921550",
  appId: "1:1075826921550:web:638b9129212e2cdde7f31f",
};

// App Check（reCAPTCHA v3）のsite key。Firebase主控台 → App Check → 這個Web app →
// reCAPTCHA v3 provider發行的site key（公開值，不是secret key，可安心寫在前端）。
// 尚未設定時留空字串，game_storage.jsのensureSdkLoadedはこの場合App Checkの有効化をskipする。
window.PRITEST_APPCHECK_SITE_KEY = "6LeiInotAAAAAFsJW8vh11TdYpc22gXzMmwueqxe";

