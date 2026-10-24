// Start Alpine only after the local search modules are ready.
const fail = () => { document.getElementById('startup-error').textContent = '画面を起動できませんでした。再読み込みしてください。'; };
import('./search/search-browser.js').then(search => {
    window.tdnetSearch = search;
    const alpine = document.createElement('script');
    alpine.src = 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js';
    alpine.onerror = fail;
    document.head.append(alpine);
}).catch(fail);
