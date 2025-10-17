// Home.js

import { useCounterStore } from './mesh.js'
export const Home = {
  template: `
    <h1>首頁bbb</h1>
    
     <p>Count: {{ store.count }}</p>
     <p>rootCount: {{ testWord }}</p>
    <button @click="store.increment()">+1</button>
  `,
  setup() {
    const testWord = window.testWord;
    const store = useCounterStore();
    return { store, testWord };
  }
};
