// globalVars.js
const { ref, shallowRef, triggerRef, isRef, unref, toRaw, isReactive } = Vue;
const { compile } = VueCompilerDOM;
import { useCounterStore, Mesh2D } from './mesh.js';


export const selectedLayers = ref([]);
export const currentChosedLayer = ref(0); // 控制選擇(單選) 
export const selectedGroups = ref([]); // 控制選擇的頂點群組
export const mousePressed = ref(); // e event of mouse down , ex: 0:left, 2:right
export const isShiftPressed = ref(false);
export const initGlAlready = ref(false);
export const refreshKey = ref(0);
export const wholeImageWidth = ref(0);;
export const wholeImageHeight = ref(0);;
export const lastLoadedImageType = ref('png'); // 'png' or 'psd'
export const meshs = ref([]); // array of Mesh2D
export const globalVars = {
  testWordQQ: ref("Hello QQ"),
  counter: ref(0),
  userName: ref("Alice"),
  glsInstance: shallowRef(null), // 使用 shallowRef
  bonesInstance: shallowRef(null),
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
export const forceUpdate = () => {
  refreshKey.value++;
};
export const convertToNDC = (e, canvas) => {
  const rect = canvas.getBoundingClientRect();

  // 考慮 devicePixelRatio
  const dpr = window.devicePixelRatio || 1;

  // 取得在 canvas 內的相對位置 (CSS 像素)
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 換算成 canvas 實際像素
  const canvasX = x * (canvas.width / rect.width);
  const canvasY = y * (canvas.height / rect.height);

  return {
    x: (canvasX / canvas.width) * 2 - 1, // NDC X
    y: 1 - (canvasY / canvas.height) * 2 // NDC Y
  };
};
export const getRawXY = (e, canvas) => {
  const rect = canvas.getBoundingClientRect();

  // 考慮 devicePixelRatio
  const dpr = window.devicePixelRatio || 1;

  // 取得在 canvas 內的相對位置 (CSS 像素)
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const canvasX = x * (canvas.width / rect.width);
  const canvasY = y * (canvas.height / rect.height);



  return {
    x: (canvasX / canvas.width) * wholeImageWidth.value,
    y: (canvasY / canvas.height) * wholeImageHeight.value
  };
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

    /*
    const renderFn = function (ctx) {
      // 🔥 創建深度 Proxy,自動解開多層嵌套的 ref
      const proxyCtx = createDeepProxy(ctx);

      return compiledRender.call(this, proxyCtx);
    };
    */
    const renderFn = function (ctx) {
      const proxyCtx = new Proxy(ctx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          // 🔥 只解開一層 ref，不遞迴、不覆蓋 Proxy 結構
          return isRef(value) ? value.value : value
        }
      })

      return compiledRender.call(this, proxyCtx)
    }

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