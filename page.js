// page.js
import { useCounterStore } from './mesh.js'

export const Page = () => {
  return fetch('./page.html')
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load template: ${response.statusText}`);
      }
      return response.text();
    })
    .then(template => ({
      template,
      setup() {
        const testWord = window.testWord;
        const store = useCounterStore();
        return { store, testWord };
      }
    }))
    .catch(error => {
      console.error('Error loading template:', error);
      // Fallback to original template or handle error as needed
      return {
        template: `
          <h1>首頁bbb (Fallback)</h1>
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
    });
};