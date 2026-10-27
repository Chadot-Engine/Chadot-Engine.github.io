(function() {
    'use strict';

    // Configuration
    var PAGE_SIZE = 15;
    var DATA_SOURCE = 'registry-data.json';

    // Icon List
    var ICON_COPY = '<i class="fa-regular fa-copy" aria-hidden="true"></i>';
    var ICON_CHECK = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    var ICON_DB_OFF = '<i class="fa-solid fa-database" aria-hidden="true"></i>';
    var ICON_NO_MATCH = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
    var ICON_SHIELD_OK = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>';
    var ICON_SHIELD_NO = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>';
    var ICON_REFRESH = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';

    // States & Shit
    var state = {
        entries: [],
        filtered: [],
        page: 1,
        query: '',
        ready: false
    };
    var el = {};
    var searchTimer = null;

    // Utilities
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function(ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } [ch];
        });
    }
    function badge(flag) {
        return flag ? '<span class="badge badge--yes"><span class="badge-dot"></span>Allowed</span>' : '<span class="badge badge--no"><span class="badge-dot"></span>Not allowed</span>';
    }
    function setStatus(mode, text) {
        el.status.className = 'status-chip' + (mode === 'live' ? ' is-live' : '') + (mode === 'error' ? ' is-error' : '') + (mode === 'loading' ? ' is-loading' : '');
        el.statusText.textContent = text;
    }
    function normalizePlatform(value) {
        if (value == null) return 'Unknown';
        var lower = String(value).trim().toLowerCase();
        if (lower === 'windows' || lower === 'win') return 'Windows';
        if (lower === 'linux') return 'Linux';
        if (lower === 'macos' || lower === 'mac os' || lower === 'osx' || lower === 'mac') return 'MacOS';
        return 'Unknown';
    }
    function platformIcon(platform) {
        if (platform === 'Windows') return 'fa-brands fa-windows';
        if (platform === 'Linux') return 'fa-brands fa-linux';
        if (platform === 'MacOS') return 'fa-brands fa-apple';
        return 'fa-solid fa-triangle-exclamation';
    }
    function platformSlug(platform) {
        if (platform === 'Windows') return 'windows';
        if (platform === 'Linux') return 'linux';
        if (platform === 'MacOS') return 'macos';
        return 'unknown';
    }
    function versionHtml(version) {
        var str = String(version);
        var idx = str.indexOf(' ');
        if (idx === -1) return escapeHtml(str);
        return escapeHtml(str.slice(0, idx)) + ' <span class="version-name">' + escapeHtml(str.slice(idx + 1)) + '</span>';
    }

    // Data Handling
    function normalize(payload) {
        var raw = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.entries) ? payload.entries : []);

        return raw
            .filter(function(item) {
                return item && typeof item === 'object' && typeof item.binary_hash === 'string' && item.binary_hash.trim().length > 0;
            })
            .map(function(item) {
                return {
                    binary_hash: item.binary_hash.trim().toLowerCase(),
                    release_id: (item.release_id === undefined || item.release_id === null) ? '—' : item.release_id,
                    release_version: (item.release_version === undefined || item.release_version === null) ? '—' : item.release_version,
                    platform: normalizePlatform(item.platform),
                    personal_use: Boolean(item.personal_use),
                    commercial_use: Boolean(item.commercial_use)
                };
            });
    }
    function loadRegistry() {
        setStatus('loading', 'Connecting…');

        fetch(DATA_SOURCE, {
                cache: 'no-store'
            })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function(payload) {
                var entries = normalize(payload);
                if (!entries.length) throw new Error('Registry Contains No Valid Entries');

                state.entries = entries;
                state.ready = true;

                setStatus('live', entries.length + (entries.length === 1 ? ' Registry Entry Indexed' : ' Registry Entries Indexed'));
                applyFilter();
            })
            .catch(function(error) {
                state.entries = [];
                state.filtered = [];
                state.ready = false;

                setStatus('error', 'Database Unavailable');
                renderNoDatabase(error && error.message ? error.message : 'Unknown Error');
            });
    }

    // Filtering
    function applyFilter() {
        var q = state.query.trim().toLowerCase();
        state.filtered = q ? state.entries.filter(function(entry) {
            return entry.binary_hash.indexOf(q) !== -1 || String(entry.platform).toLowerCase().indexOf(q) !== -1;
        }) : state.entries.slice();
        state.page = 1;
        render();
        updateVerdict();
    }
    function render() {
        if (!state.ready) return;

        var total = state.filtered.length;
        var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

        if (state.page > totalPages) state.page = totalPages;

        if (total === 0) {
            el.head.hidden = true;
            el.foot.hidden = true;
            el.resultCount.textContent = '0 Matches';
            el.body.innerHTML =
                '<div class="empty">' +
                '<div class="empty-icon">' + ICON_NO_MATCH + '</div>' +
                '<h2 class="empty-title">No Matching Hashes</h2>' +
                '<p class="empty-text">No registry entry contains that hash fragment.<br>' +
                'Verify the hash and try again.</p>' +
                '<button class="btn js-clear-search" type="button">Clear Search</button>' +
                '</div>';
            bindClearButtons();
            return;
        }

        var start = (state.page - 1) * PAGE_SIZE;
        var slice = state.filtered.slice(start, start + PAGE_SIZE);

        el.head.hidden = false;
        el.foot.hidden = false;

        el.body.innerHTML = slice.map(rowHtml).join('');
        el.pageInfo.textContent = 'Showing ' + (start + 1) + '–' + (start + slice.length) + ' of ' + total;
        el.resultCount.textContent = state.query.trim() ? total + (total === 1 ? ' Match' : ' Matches') : total + (total === 1 ? ' Entry Found in Registry' : ' Entries Found in Registry');

        renderPager(totalPages);
    }
    function rowHtml(entry) {
        return '' +
            '<div class="row">' +
            '<div class="cell cell--hash" data-label="Hash">' +
            '<div class="hash-cell">' +
            '<code class="hash" title="' + escapeHtml(entry.binary_hash) + '">' + escapeHtml(entry.binary_hash) + '</code>' +
            '<button class="copy-btn" type="button" data-hash="' + escapeHtml(entry.binary_hash) + '" ' +
            'title="Copy Hash" aria-label="Copy Hash">' + ICON_COPY + '</button>' +
            '</div>' +
            '</div>' +
            '<div class="cell" data-label="Release ID">' +
            '<span class="mono">' + escapeHtml(entry.release_id) + '</span>' +
            '</div>' +
            '<div class="cell" data-label="Version">' +
            '<span class="mono">' + versionHtml(entry.release_version) + '</span>' +
            '</div>' +
            '<div class="cell" data-label="Platform">' +
            '<span class="platform platform--' + platformSlug(entry.platform) + '">' +
            '<i class="' + platformIcon(entry.platform) + '" aria-hidden="true"></i>' +
            escapeHtml(entry.platform) +
            '</span>' +
            '</div>' +
            '<div class="cell" data-label="Personal use">' + badge(entry.personal_use) + '</div>' +
            '<div class="cell" data-label="Commercial use">' + badge(entry.commercial_use) + '</div>' +
            '</div>';
    }

    // Pagination
    function pageList(current, total) {
        var wanted = [1, total, current - 1, current, current + 1];
        var pages = [];

        wanted
            .filter(function(p) {
                return p >= 1 && p <= total;
            })
            .sort(function(a, b) {
                return a - b;
            })
            .forEach(function(p) {
                if (pages.indexOf(p) === -1) pages.push(p);
            });

        var out = [];
        var previous = 0;

        pages.forEach(function(p) {
            if (previous && p - previous > 1) out.push('…');
            out.push(p);
            previous = p;
        });

        return out;
    }
    function pageButton(label, target, disabled, variant) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'page-btn' + (variant === 'active' ? ' is-active' : '');
        btn.textContent = label;
        btn.disabled = disabled;

        if (variant === 'active') {
            btn.setAttribute('aria-current', 'page');
        } else {
            btn.addEventListener('click', function() {
                state.page = target;
                render();
            });
        }

        return btn;
    }
    function renderPager(totalPages) {
        el.pager.innerHTML = '';
        if (totalPages <= 1) return;

        el.pager.appendChild(pageButton('Prev', state.page - 1, state.page === 1));

        pageList(state.page, totalPages).forEach(function(item) {
            if (item === '…') {
                var gap = document.createElement('span');
                gap.className = 'page-ellipsis';
                gap.textContent = '…';
                el.pager.appendChild(gap);
            } else {
                el.pager.appendChild(
                    pageButton(String(item), item, false, item === state.page ? 'active' : '')
                );
            }
        });

        el.pager.appendChild(pageButton('Next', state.page + 1, state.page === totalPages));
    }

    // Verdict Panel
    function updateVerdict() {
        var q = state.query.trim().toLowerCase();

        if (!state.ready || !/^[a-f0-9]{64}$/.test(q)) {
            el.verdict.hidden = true;
            el.verdict.innerHTML = '';
            return;
        }

        var hit = null;
        for (var i = 0; i < state.entries.length; i++) {
            if (state.entries[i].binary_hash === q) {
                hit = state.entries[i];
                break;
            }
        }

        if (hit) {
            el.verdict.className = 'verdict is-valid';
            el.verdict.innerHTML =
                '<div class="verdict-head">' +
                '<span class="verdict-icon">' + ICON_SHIELD_OK + '</span>' +
                '<div>' +
                '<h2 class="verdict-title">Legitimate Release</h2>' +
                '<p class="verdict-sub">Official Release</p>' +
                '</div>' +
                '</div>' +
                '<div class="verdict-grid">' +
                '<div><span class="verdict-key">Release ID</span>' +
                '<span class="verdict-val">' + escapeHtml(hit.release_id) + '</span></div>' +
                '<div><span class="verdict-key">Version</span>' +
                '<span class="verdict-val">' + versionHtml(hit.release_version) + '</span></div>' +
                '<div><span class="verdict-key">Platform</span>' +
                '<span class="verdict-val">' +
                '<span class="platform platform--' + platformSlug(hit.platform) + '">' +
                '<i class="' + platformIcon(hit.platform) + '" aria-hidden="true"></i>' +
                escapeHtml(hit.platform) +
                '</span>' +
                '</span></div>' +
                '<div><span class="verdict-key">Personal Use</span>' +
                '<span class="verdict-val">' + badge(hit.personal_use) + '</span></div>' +
                '<div><span class="verdict-key">Commercial Use</span>' +
                '<span class="verdict-val">' + badge(hit.commercial_use) + '</span></div>' +
                '</div>';
        } else {
            el.verdict.className = 'verdict is-invalid';
            el.verdict.innerHTML =
                '<div class="verdict-head">' +
                '<span class="verdict-icon">' + ICON_SHIELD_NO + '</span>' +
                '<div>' +
                '<h2 class="verdict-title">Invalid Release</h2>' +
                '<p class="verdict-sub">' +
                    '<i class="fa-solid fa-triangle-exclamation verdict-sub-icon" aria-hidden="true"></i> ' +
                    'Using This Binary Violates The License!' +
                '</p>' +
                '</div>' +
                '</div>';
        }

        el.verdict.hidden = false;
    }

    // Empty State
    function renderNoDatabase(reason) {
        el.head.hidden = true;
        el.foot.hidden = true;
        el.verdict.hidden = true;
        el.verdict.innerHTML = '';
        el.resultCount.textContent = 'No Registry Loaded';

        el.body.innerHTML =
            '<div class="empty">' +
            '<div class="empty-icon">' + ICON_DB_OFF + '</div>' +
            '<h2 class="empty-title">No Database Found</h2>' +
            '<p class="empty-text">' +
            'The registry could not be loaded at the moment.<br>' +
            'Try again later.' +
            '</p>' +
            '<button class="btn js-retry" type="button">' + ICON_REFRESH + 'Retry</button>' +
            '</div>';

        var retry = el.body.querySelector('.js-retry');
        if (retry) {
            retry.addEventListener('click', function() {
                el.body.innerHTML = '<div class="empty"><p class="empty-text">Loading Registry…</p></div>';
                loadRegistry();
            });
        }

        if (reason) console.warn('[Registry] ' + reason);
    }
    function bindClearButtons() {
        Array.prototype.forEach.call(el.body.querySelectorAll('.js-clear-search'), function(btn) {
            btn.addEventListener('click', clearSearch);
        });
    }

    // Search
    function clearSearch() {
        window.clearTimeout(searchTimer);
        el.search.value = '';
        el.clear.hidden = true;
        state.query = '';
        applyFilter();
        el.search.focus();
    }
    function onSearchInput() {
        var value = el.search.value;
        el.clear.hidden = value.length === 0;

        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(function() {
            state.query = value;
            applyFilter();
        }, 120);
    }

    // Handling Clipborad
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise(function(resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '-1000px';
            document.body.appendChild(area);
            area.select();

            try {
                document.execCommand('copy') ? resolve() : reject(new Error('Copy failed'));
            } catch (err) {
                reject(err);
            } finally {
                document.body.removeChild(area);
            }
        });
    }
    function onRegistryClick(event) {
        var btn = event.target.closest ? event.target.closest('.copy-btn') : null;
        if (!btn) return;

        var hash = btn.getAttribute('data-hash');
        if (!hash) return;

        copyText(hash)
            .then(function() {
                btn.classList.add('is-copied');
                btn.innerHTML = ICON_CHECK;
                window.setTimeout(function() { btn.classList.remove('is-copied'); btn.innerHTML = ICON_COPY; }, 1400);
            })
            .catch(function() { /* Silently Ignores */ });
    }

    // Bootstrap
    function cacheElements() {
        el.body = document.getElementById('registryBody');
        el.head = document.getElementById('tableHead');
        el.foot = document.getElementById('panelFoot');
        el.pageInfo = document.getElementById('pageInfo');
        el.pager = document.getElementById('pager');
        el.search = document.getElementById('searchInput');
        el.clear = document.getElementById('clearSearch');
        el.resultCount = document.getElementById('resultCount');
        el.verdict = document.getElementById('verdict');
        el.status = document.getElementById('dbStatus');
        el.statusText = document.getElementById('dbStatusText');
    }
    function bindEvents() {
        el.search.addEventListener('input', onSearchInput);
        el.clear.addEventListener('click', clearSearch);
        el.body.addEventListener('click', onRegistryClick);

        document.addEventListener('keydown', function(event) {
            var isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

            if (event.key === '/' && !isTyping) {
                event.preventDefault();
                el.search.focus();
                el.search.select();
            }

            if (event.key === 'Escape' && document.activeElement === el.search) {
                clearSearch();
            }
        });
    }
    document.addEventListener('DOMContentLoaded', function() {
        cacheElements();
        bindEvents();
        loadRegistry();
    });

})();