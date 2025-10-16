// Home.js

import { useCounterStore } from './mesh.js'
export const Home = {
  template: `
    <h1>首頁AAQQ</h1>
    
     <p>Count: {{store.count }}</p>
     <p>Count: {{ rootCount }}</p>
    <button @click="store.increment()">+1</button>
  `,
  setup() {
    const store = useCounterStore();
    return { store };
  }
};
