// Home.js

import { useCounterStore } from './mesh.js'
import { globalVars as v } from './globalVars.js'  // 引入全局變數



export const Home = {
  template: `
    <h1>首頁bbb</h1>
    
    <p>Count: {{ store.count }}</p>
    <p>rootCount: {{ testWord }}</p>
    <p>{{testWordQQ}}</p>
   <p>{{v.testWordQQ}}</p>
    <button @click="store.increment()">+1</button>
  `,
  setup() {
    const store = useCounterStore();

    return { store, testWord, testWordQQ: v.testWordQQ, v };  // 直接返回響應式變數
  }
};