// markedオプション設定（テーブル表示等をサポートするため）
window.marked?.setOptions({
    gfm: true,
    breaks: true
});

window.tdnetApp = function () {
    return {
        items: [],
        searchQuery: '',
        match: 'literal', field: 'all', ticker: '', startDate: '', endDate: '', normalize: false,
        searchError: '', loadError: '', results: [], appliedKey: '', appliedQuery: '', appliedOptions: {},

        filterYutai: true, // デフォルトで優待のみ表示
        renderMarkdown: false, // マークダウンレンダリングのオンオフ
        loading: true,
        selected: null,
        theme: localStorage.getItem('theme') || 'dark',
        
        // ページネーション用
        currentPage: 1,
        itemsPerPage: 50,

        async init() {
            this.restoreSearch();
            window.addEventListener('popstate', () => { this.restoreSearch(); this.runSearch(); });
            await this.fetchData();
        },

        toggleTheme() {
            this.theme = this.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', this.theme);
        },

        async fetchData() {
            this.loading = true;
            this.loadError = '';
            try {
                const res = await fetch('export.json');
                if (!res.ok) throw new Error('Failed to fetch data');
                this.items = window.tdnetSearch.validateExport(await res.json());
                this.runSearch();
            } catch {
                this.items = []; this.results = []; this.selected = null;
                this.loadError = '資料を読み込めませんでした。再読込してください。';
            } finally { this.loading = false; }
        },

        restoreSearch() {
            const params = new URLSearchParams(location.search);
            for (const key of ['searchQuery', 'ticker', 'startDate', 'endDate']) this[key] = params.get(key) || '';
            this.match = params.get('match') || 'literal';
            this.field = params.get('field') || 'all';
            this.normalize = params.get('normalize') === '1';
            this.filterYutai = params.get('yutai') !== '0';
            const size = Number(params.get('size'));
            this.itemsPerPage = [20, 50, 100].includes(size) ? size : 50;
            const page = Number(params.get('page'));
            this.currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
        },

        saveSearch() {
            const params = new URLSearchParams();
            for (const key of ['searchQuery', 'match', 'field', 'ticker', 'startDate', 'endDate']) {
                if (this[key]) params.set(key, this[key]);
            }
            params.set('normalize', this.normalize ? '1' : '0');
            params.set('yutai', this.filterYutai ? '1' : '0');
            params.set('page', this.currentPage);
            params.set('size', this.itemsPerPage);
            const url = '?' + params.toString();
            if (url !== location.search) history.pushState(null, '', url);
        },

        criteriaKey() { return JSON.stringify([this.searchQuery, this.match, this.field, this.ticker, this.startDate, this.endDate, this.normalize, this.filterYutai, this.itemsPerPage]); },
        runSearch() {
            this.appliedKey = this.criteriaKey();
            this.searchError = '';
            try {
                this.appliedQuery = this.searchQuery;
            this.appliedOptions = {
                    match: this.match,
                    fields: this.field === 'all' ? undefined : [this.field],
                    normalize: this.normalize ? 'width-case' : undefined,
                    ticker: this.ticker || undefined,
                    startDate: this.startDate || undefined, endDate: this.endDate || undefined,
                };
            this.results = window.tdnetSearch.searchExport(this.items, this.searchQuery, this.appliedOptions).filter(item => !this.filterYutai || item.title.includes('優待') || (item.content || '').includes('優待'));
            } catch {
                this.results = [];
                this.searchError = '検索条件を確認してください。引用符は語全体を囲み、日付は開始日から終了日の順に指定します。';
            }
            this.currentPage = Math.min(this.currentPage, this.totalPages);
            this.selected = this.paginatedItems.find(item => item.id === this.selected?.id) || this.paginatedItems[0] || null;
        },

        applySearch() { this.currentPage = 1; this.runSearch(); this.saveSearch(); },
        goPage(page) {
            // Apply any edited conditions first, so page navigation never saves stale results.
            const changed = this.appliedKey !== this.criteriaKey();
            this.runSearch();
            this.currentPage = changed ? 1 : Math.max(1, Math.min(page, this.totalPages));
            this.selected = this.paginatedItems[0] || null;
            this.saveSearch();
        },
        get filteredItems() { return this.results; },

        get totalPages() {
            return Math.max(1, Math.ceil(this.filteredItems.length / this.itemsPerPage));
        },

        get paginatedItems() {
            const start = (this.currentPage - 1) * this.itemsPerPage;
            const end = start + this.itemsPerPage;
            return this.filteredItems.slice(start, end);
        },

        formatDate(dateStr) {
            const d = new Date(dateStr);
            return d.toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        },

        highlightText(text) {
            const bodySearch = this.appliedOptions.fields === undefined || this.appliedOptions.fields.includes('body');
            return window.tdnetSearch.highlightExport(text || '', bodySearch ? this.appliedQuery : '', this.appliedOptions);
        },
        renderHtml(text) { return text && window.marked ? window.marked.parse(text) : this.highlightText(text); }
    }
}
