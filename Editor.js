// Editor.js


import { useCounterStore } from './mesh.js'
export const Editor = {
  template: /*html*/ `
    <h1>編輯器QQDD</h1>
    <p>Count: {{ store.count }}</p>
    <button @click="store.increment()">+1</button>
  `,
  setup() {
    const store = useCounterStore();
    return { store };
  }
};
