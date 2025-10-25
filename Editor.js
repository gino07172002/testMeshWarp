//Editor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, h, unref } = Vue;
import { globalVars as v, triggerRefresh, loadHtmlPage } from './globalVars.js'  // 引入全局變數

// Editor.js
export const Editor = defineComponent({
  name: 'meshEditor',
  setup() {
    const counter = useCounterStore();
    const renderFn = ref(null);
    onMounted(async () => {
     
      renderFn.value = await loadHtmlPage('./Editor.html');
    });

    return () => {
      if (!renderFn.value) {
        return h('div', '載入中...');
      }

      // 🔥 測試:手動解開所有 ref 再傳入
      const unwrappedV = {
        _refreshKey: unref(v._refreshKey),
        testWordQQ: unref(v.testWordQQ),
        someDebug: unref(v.someDebug),
        glsInstance: unref(v.glsInstance), // 這裡會得到實際物件
        forceUpdateAllShallowRefs: v.forceUpdateAllShallowRefs,
        add: v.add
      };

      
      return renderFn.value({
        counter,
        v: unwrappedV,
        triggerRefresh
      });
    };
  },
});