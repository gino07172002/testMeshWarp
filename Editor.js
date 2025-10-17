import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, h } = Vue;
const { compile } = VueCompilerDOM;

export const Editor = defineComponent({
  name: 'Editor',
  setup() {
    const counter = useCounterStore();
    const renderFn = ref(null);

    onMounted(async () => {
      const response = await fetch('./editor.html');
      const html = await response.text();

      console.log('載入模板內容：', html);

      // 1️⃣ 編譯模板 → 得到程式碼字串
      const { code } = compile(html);

      // 2️⃣ 轉成可執行 render 函式
      //    注意：這裡不能包 with(Vue)，因為 compile 已經生成完整函式
      const render = new Function('Vue', `${code}; return render`)(Vue);

      // 3️⃣ 儲存 render 函式
      renderFn.value = render;
    });

    // 4️⃣ 執行 render 函式，傳入 setup 返回的 context
    return () =>
      renderFn.value
        ? renderFn.value({ counter })
        : h('div', '載入中...');
  },
});
