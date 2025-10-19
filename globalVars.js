// globalVars.js
const { ref, shallowRef, triggerRef, isRef, unref, toRaw, isReactive } = Vue;
const { compile } = VueCompilerDOM;

export const globalVars = {
  testWordQQ: ref("Hello QQ"),
  counter: ref(0),
  userName: ref("Alice"),
  glsInstance: shallowRef(null), // 使用 shallowRef
  someDebug: ref(0),
  _refreshKey: ref(0),

  add() {
    this.someDebug.value++;
  },

  // 強制更新 glsInstance 的響應
  forceUpdateGls() {
    triggerRef(this.glsInstance);
  },
  // 強制更新所有 shallowRef 響應式變數
  forceUpdateAllShallowRefs() {
    Object.keys(this).forEach(key => {
      const value = this[key];
      // 檢查是否為 ref (包含 shallowRef)
      if (isRef(value) && !key.startsWith('_') && typeof value !== 'function') {
        triggerRef(value);
      }
    });
    console.log('All shallowRefs triggered');
  },
};

export function triggerRefresh() {
  console.log("Triggering manual refresh");
  console.log("check glsInstace's layers length:", globalVars.glsInstance.value ? globalVars.glsInstance.value.layers.length : 'glsInstance is null');

  // 強制觸發更新
  globalVars.forceUpdateGls();
  globalVars._refreshKey.value++;
}

globalVars.triggerRefresh = triggerRefresh;


//common function for loading html page with cache


// 模組級別的快取
const cache = new Map();

/**
 * 動態載入並編譯 HTML 頁面
 * @param url - HTML 檔案路徑
 * @returns 編譯後的 render 函數
 */
/*
export async function loadHtmlPage(url) {
  try {
    // 🎯 發送 HEAD 請求檢查檔案資訊
    const headResponse = await fetch(url, { method: 'HEAD' });
    const contentLength = headResponse.headers.get('Content-Length');
    const lastModified = headResponse.headers.get('Last-Modified');
    
    // 組合版本標識
    const version = `${contentLength}-${lastModified}`;
    const cacheKey = `${url}:${version}`;
    
    // 檢查快取
    if (cache.has(cacheKey)) {
      console.log(`✅ 快取命中: ${url}`);
      return cache.get(cacheKey);
    }
    
    // 快取未命中,下載並編譯
    console.log(`🔄 編譯新版本: ${url} (版本: ${version})`);
    const response = await fetch(url);
    const html = await response.text();
    
    const { code } = compile(html);
    const render = new Function('Vue', `${code}; return render`)(Vue);
    
    // 清除此 URL 的所有舊版本快取
    for (const key of cache.keys()) {
      if (key.startsWith(`${url}:`)) {
        cache.delete(key);
      }
    }
    
    // 儲存新版本到快取
    cache.set(cacheKey, render);
    return render;
    
  } catch (error) {
    console.error(`❌ 載入失敗: ${url}`, error);
    throw error;
  }
}
  */

export async function loadHtmlPage(url) {
  try {
    if (cache.has(url)) {
      console.log(`✅ 快取命中: ${url}`);
      return cache.get(url);
    }

    console.log(`🔄 載入並編譯: ${url}`);
    const response = await fetch(url);
    const html = await response.text();

    const { code } = compile(html);
    const compiledRender = new Function('Vue', `${code}; return render`)(Vue);

    const renderFn = function (ctx) {
      // 🔥 創建深度 Proxy,自動解開多層嵌套的 ref
      const proxyCtx = createDeepProxy(ctx);

      // 🐛 Debug: 看看解開後的結果
      console.log('proxyCtx:', proxyCtx);
      console.log('proxyCtx.v:', proxyCtx.v);
      console.log('proxyCtx.v.glsInstance:', proxyCtx.v?.glsInstance);
      console.log('proxyCtx.v.glsInstance.layers:', proxyCtx.v?.glsInstance?.layers);

      return compiledRender.call(this, proxyCtx);
    };

    cache.set(url, renderFn);
    return renderFn;
  } catch (error) {
    console.error(`❌ 載入失敗: ${url}`, error);
    throw error;
  }
}

// 🔧 改進的深度 Proxy
function createDeepProxy(obj, seen = new WeakSet()) {
  // 處理 null 或 undefined
  if (obj == null) {
    return obj;
  }

  // 防止循環引用
  if (seen.has(obj)) {
    return obj;
  }

  // 解開 ref
  let unwrapped = obj;
  while (isRef(unwrapped)) {
    unwrapped = unwrapped.value;
  }

  // 如果不是物件,直接返回
  if (typeof unwrapped !== 'object' || unwrapped === null) {
    return unwrapped;
  }

  // 標記為已訪問
  seen.add(obj);

  // 嘗試轉換 reactive 為原始物件
  try {
    const raw = toRaw(unwrapped);
    if (raw !== unwrapped) {
      unwrapped = raw;
    }
  } catch (e) {
    // 忽略錯誤
  }

  // 創建 Proxy
  return new Proxy(unwrapped, {
    get(target, prop, receiver) {
      // 特殊處理 Symbol
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }

      const value = Reflect.get(target, prop, receiver);

      // 🔥 關鍵:持續解開 ref
      let unwrappedValue = value;
      while (isRef(unwrappedValue)) {
        unwrappedValue = unwrappedValue.value;
      }

      // 如果是物件,遞歸創建 Proxy
      if (unwrappedValue != null && typeof unwrappedValue === 'object') {
        return createDeepProxy(unwrappedValue, seen);
      }

      return unwrappedValue;
    },

    has(target, prop) {
      return Reflect.has(target, prop);
    },

    ownKeys(target) {
      return Reflect.ownKeys(target);
    },

    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (desc) {
        desc.configurable = true;
      }
      return desc;
    }
  });
}


/**
 * 清除特定 URL 的快取
 * @param url - 要清除的 URL (可選,不傳則清除所有)
 */
export function clearCache(url) {
  if (url) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${url}:`)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}

/**
 * 取得快取統計資訊
 */

export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys())
  };
}