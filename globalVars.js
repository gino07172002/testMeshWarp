// globalVars.js
const { ref, shallowRef, triggerRef, isRef } = Vue;
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