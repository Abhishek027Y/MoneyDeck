/**
 * MoneyDeck — shared page shell for new (non-Stitch) pages.
 * Renders the same fixed sidebar + utility header + breadcrumb used by the
 * original Stitch screens, so new pages are visually indistinguishable.
 *
 * Usage on a page:
 *   <body onload="MDShell.init({ role:'college', page:'My FDR Records', icon:'receipt_long' })">
 */
'use strict';
window.MDShell = {
  ROLE_LINKS: {
    college: [
      { group: 'Overview', items: [{ label: 'Dashboard', icon: 'dashboard', href: '/college_portal_institutional_fdr_management_dashboard/code.html' }] },
      { group: 'FDR Management', items: [
        { label: 'My FDR Records', icon: 'receipt_long', href: '/app/college/fdr-records.html' },
        { label: 'Submit New FDR', icon: 'upload_file', href: '/college_portal_submit_new_fdr_batch_submission_gateway/code.html' },
        { label: 'Renew FDR', icon: 'autorenew', href: '/app/college/renewals.html' },
        { label: 'Release Requests', icon: 'outbox', href: '/app/college/releases.html' },
      ] },
      { group: 'Communication', items: [
        { label: 'Officer Comments', icon: 'comment', href: '/app/college/comments.html', badge: '2', badgeClass: 'bg-amber-500' },
        { label: 'Alerts & Notices', icon: 'notifications', href: '/app/college/alerts.html', badge: '3', badgeClass: 'bg-rose-500' },
      ] },
      { group: 'Settings', items: [
        { label: 'Institution Details', icon: 'account_balance', href: '/app/college/institution.html' },
        { label: 'Language Prefs', icon: 'translate', href: '/app/college/comments.html#comments-language-widget' },
        { label: 'Notification Config', icon: 'tune', href: '/app/college/notification-config.html#notifications' },
      ] },
    ],
    officer: [
      { group: 'Overview', items: [{ label: 'Dashboard', icon: 'dashboard', href: '/aicte_officer_executive_fdr_overview_dashboard/code.html' }] },
      { group: 'Verification', items: [
        { label: 'Colleges & FDRs', icon: 'school', href: '/app/officer/colleges.html' },
        { label: 'Verification Workspace', icon: 'fact_check', href: '/aicte_officer_fdr_verification_workspace_ai_engine/code.html' },
        { label: 'Problem Reports', icon: 'report', href: '/app/officer/problems.html' },
        { label: 'Release Requests', icon: 'outbox', href: '/app/officer/releases.html' },
      ] },
      { group: 'Monitoring', items: [
        { label: 'Renewal Monitoring', icon: 'event_repeat', href: '/app/officer/renewals.html' },
        { label: 'Audit Log', icon: 'history', href: '/app/officer/audit.html' },
      ] },
      { group: 'Settings', items: [{ label: 'Settings', icon: 'tune', href: '/app/officer/settings.html' }] },
    ],
  },

  async init(opts) {
    await MD.guard(opts.role).then((me) => { this.me = me; });
    if (!this.me) return;
    this.role = opts.role;
    const root = document.createElement('div');
    root.innerHTML = `
      <aside class="fixed left-0 top-0 h-full w-[240px] bg-[#142D4E] text-white z-50 flex flex-col justify-between overflow-y-auto shadow-lg">
        <div class="flex flex-col">
          <div class="h-14 px-4 border-b border-[#25426B] flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <img src="/app/assets/moneydeck-logo.png" alt="MoneyDeck Logo" class="brand-logo-img w-8 h-8 object-contain shrink-0 rounded-md" />
              <div class="flex flex-col"><span class="font-bold text-slate-900 tracking-tight text-base leading-none">MoneyDeck</span><span class="text-xs font-medium text-slate-500">Institutional FDR</span></div>
            </div>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#214A7D] text-[#90CAF9] border border-[#2B5D9B]">${opts.role === 'college' ? 'COLLEGE' : 'AICTE'}</span>
          </div>
          <div class="p-3" id="mdshell-nav"></div>
        </div>
        ${MDShell.profileFooter(opts)}
      </aside>
      <div class="pl-[240px] min-h-screen bg-[#F5F7FA]">
        <header class="fixed top-0 left-[240px] right-0 h-14 bg-white border-b border-[#E2E7ED] z-40 flex items-center justify-between px-6">
          <div class="flex items-center gap-3 min-w-0">
            ${opts.role === 'college'
              ? '<span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200 whitespace-nowrap">College / Institution</span>'
              : '<span class="font-semibold text-[#142D4E]">AICTE Regional Directorate</span>'}
          </div>
          <div class="flex items-center gap-3">
            <div class="relative">
              <button id="notifBellBtn" aria-label="Notifications" aria-expanded="false" aria-controls="notifDropdown" class="relative p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors" type="button">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                </svg>
                <span id="mdshell-notif-badge" class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">0</span>
              </button>
              <div class="hidden absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden" id="notifDropdown">
                <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-900">Notifications</span>
                  <span class="text-[10px] font-semibold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full" id="mdshell-notif-count">0 New</span>
                  <button type="button" class="text-[10px] font-medium text-slate-600 hover:text-slate-900" id="mdshell-mark-all">Mark all read</button>
                </div>
                <div class="divide-y divide-slate-100 max-h-72 overflow-y-auto text-xs" id="mdshell-notif-list"></div>
                ${opts.role === 'college' ? '<div class="p-2 bg-slate-50 border-t border-slate-100 text-center"><a href="/app/college/alerts.html" class="text-[11px] font-semibold text-slate-700 hover:text-slate-900">View All Alerts &amp; Notices &rarr;</a></div>' : ''}
              </div>
            </div>
            <div class="mdshell-college-divider h-5 w-px bg-slate-200"></div>
            ${opts.role === 'college'
              ? '<div class="flex items-center gap-2 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm">College</div>'
              : `<div class="flex items-center gap-2 pl-1">
                  <div class="w-8 h-8 rounded-full bg-[#142D4E] text-white flex items-center justify-center text-xs font-bold ring-1 ring-slate-300">${MDShell.initials}</div>
                  <div class="flex flex-col text-left">
                    <span class="text-xs font-semibold text-slate-800 leading-tight">${MD.escapeHtml(this.me.designation || this.me.roleName || '')}</span>
                    <span class="text-[11px] text-slate-500 leading-tight">${MD.escapeHtml(this.me.email || '')}</span>
                  </div>
                </div>`}
          </div>
        </header>
        <div class="fixed top-14 left-[240px] right-0 h-7 bg-[#EEF2F6] border-b border-[#E2E7ED] z-30 px-6 flex items-center justify-between text-xs text-slate-600 font-medium">
          <div class="flex items-center gap-2 text-[11px]">
            <span class="text-[#94A3B8]">${MD.escapeHtml(this.role === 'college' ? 'FDR Management' : 'AICTE Workspace')}</span><span class="text-slate-300">/</span><span class="font-semibold text-[#202B38]">${MD.escapeHtml(opts.page)}</span>
          </div>
          <div class="font-tabular-num text-[11px] text-slate-500">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        </div>
        <main class="w-full pt-24 pb-12 px-8"><div class="max-w-7xl mx-auto flex flex-col gap-6" id="mdshell-content"></div></main>
      </div>`;

    document.body.innerHTML = '';
    document.body.appendChild(root);
    document.body.appendChild(MDShell.toastHost());

    // nav
    const nav = document.getElementById('mdshell-nav');
    for (const grp of MDShell.ROLE_LINKS[opts.role]) {
      const g = document.createElement('div');
      g.innerHTML = `<div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1">${grp.group}</div>`;
      for (const item of grp.items) {
        const active = item.label === opts.page;
        const a = document.createElement('a');
        a.href = item.href;
        a.className = `flex items-center ${item.badge ? 'justify-between' : 'gap-2.5'} px-2.5 py-1.5 rounded font-medium text-[13px] transition-colors ${active ? 'bg-[#224A7D] text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-[#1B3A63]'}`;
        a.innerHTML = `<span class="flex items-center gap-2.5"><span class="material-symbols-outlined text-[18px]${active ? ' text-white' : ''}">${item.icon}</span>${item.label}</span>${item.badge ? `<span id="${item.label === 'Officer Comments' ? 'sidebarCommentsBadge' : 'sidebarAlertsBadge'}" class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white ${item.badgeClass}">${item.badge}</span>` : ''}`;
        if (active) a.setAttribute('aria-current', 'page');
        g.appendChild(a);
      }
      nav.appendChild(g);
    }

    document.getElementById('mdshell-signout').addEventListener('click', () => MD.logout());
    document.getElementById('notifBellBtn').addEventListener('click', () => MDShell.toggleDrawer());
    document.addEventListener('click', (event) => {
      const drawer = document.getElementById('notifDropdown');
      const button = document.getElementById('notifBellBtn');
      if (drawer && !drawer.classList.contains('hidden') && !drawer.contains(event.target) && !button.contains(event.target)) {
        MDShell.closeDrawer();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') MDShell.closeDrawer();
    });
    MDShell.fillNotifications();
    MDShell.titleFor(opts);
  },

  profileFooter(opts) {
    if (opts.role === 'college') {
      return `
        <div class="pt-4 border-t border-slate-200 mt-auto">
          <div class="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">CI</div>
              <div class="flex flex-col text-left">
                <span class="text-xs font-semibold text-slate-900 tracking-tight leading-none">College / Institution</span>
                <span class="text-[10px] text-slate-500 font-medium mt-0.5">Authorised Institutional Desk</span>
              </div>
            </div>
          </div>
          <a href="javascript:void 0" id="mdshell-signout" class="flex items-center gap-2 px-2 py-1.5 mt-1 text-xs text-slate-500 hover:text-red-600 transition-colors font-medium">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
            </svg>
            Sign Out
          </a>
        </div>`;
    }

    if (opts.role === 'officer') {
      return `
        <div class="pt-4 border-t border-slate-200 mt-auto">
          <div class="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">AO</div>
              <div class="flex flex-col text-left">
                <span class="text-xs font-semibold text-slate-900 tracking-tight leading-none">AICTE Officer</span>
                <span class="text-[10px] text-slate-500 font-medium mt-0.5">Desk Clearance Officer</span>
              </div>
            </div>
            <div class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
              </svg>
            </div>
          </div>
          <a href="javascript:void 0" id="mdshell-signout" class="flex items-center gap-2 px-2 py-1.5 mt-1 text-xs text-slate-500 hover:text-red-600 transition-colors font-medium">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
            </svg>
            Sign Out
          </a>
        </div>`;
    }

    return `
      <div class="p-3 border-t border-[#25426B] bg-[#0E2038]">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-[#204574] text-white flex items-center justify-center font-bold text-xs shrink-0">${(this.me.display_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div class="flex flex-col min-w-0 flex-1">
            <span class="text-[12px] font-semibold text-white truncate leading-tight">${MD.escapeHtml(this.me.display_name || '')}</span>
            <span class="text-[10px] text-slate-400 font-tabular-num leading-tight truncate">PID: ${MD.escapeHtml(this.me.aictePid || '')}</span>
          </div>
        </div>
        <a href="javascript:void 0" id="mdshell-signout" class="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-red-400 mt-2 transition-colors px-0.5"><span class="material-symbols-outlined text-[14px]">logout</span>Sign Out</a>
      </div>`;
  },

  get initials() {
    return (MDShell.me?.display_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  },

  async fillNotifications() {
    if (this.role === 'college') {
      MD.notifications.refresh();
      return;
    }
    try {
      const { data } = await MD.api('GET', '/notifications');
      const notes = data.notifications || [];
      const unread = notes.filter((n) => !n.read_at).length;
      const badge = document.getElementById('mdshell-notif-badge');
      const count = document.getElementById('mdshell-notif-count');
      if (badge) { badge.textContent = String(unread); badge.style.display = 'flex'; }
      if (count) count.textContent = `${unread} New`;
      this.renderNotifList(notes);
    } catch (error) {
      MD.toast(`Notifications could not be loaded: ${error.message}`, true);
    }
  },

  toggleDrawer() {
    const drawer = document.getElementById('notifDropdown');
    const button = document.getElementById('notifBellBtn');
    if (!drawer || !button) return;
    if (drawer.classList.contains('hidden')) {
      drawer.classList.remove('hidden');
      button.setAttribute('aria-expanded', 'true');
      if (this.role === 'college') MD.notifications.refresh();
      else this.renderNotifList();
      requestAnimationFrame(() => drawer.classList.add('notif-visible'));
    } else {
      MDShell.closeDrawer();
    }
  },

  closeDrawer() {
    const drawer = document.getElementById('notifDropdown');
    const button = document.getElementById('notifBellBtn');
    if (!drawer || drawer.classList.contains('hidden')) return;
    drawer.classList.remove('notif-visible');
    button?.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => drawer.classList.add('hidden'), 160);
  },

  renderNotifList(notes = []) {
    const list = document.getElementById('mdshell-notif-list');
    if (!list) return;
    try {
      list.innerHTML = notes.slice(0, 8).map((n) => {
        const href = typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//')
          ? n.link
          : this.role === 'college' && (n.category === 'comment' || String(n.title).toLowerCase().includes('comment'))
            ? '/app/college/comments.html'
            : this.role === 'college'
              ? '/app/college/alerts.html'
              : '/app/officer/audit.html';
        return `<a href="${MD.escapeHtml(href)}" class="block p-3 hover:bg-slate-50 transition-colors ${n.read_at ? 'opacity-60' : ''}" data-nid="${n.id}">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-2 h-2 rounded-full ${n.category === 'comment' ? 'bg-amber-500' : 'bg-rose-500'}"></span>
            <span class="font-semibold text-slate-800">${MD.escapeHtml(n.title)}</span>
          </div>
          <p class="text-slate-500 text-[11px] truncate">${MD.escapeHtml(n.body)}</p>
        </a>`;
      }).join('') || '<div class="p-3 text-xs text-slate-500">No notifications right now.</div>';
      list.querySelectorAll('[data-nid]').forEach((el) => {
        el.addEventListener('click', async (event) => {
          if (el.classList.contains('opacity-60')) return;
          event.preventDefault();
          try {
            await MD.api('POST', `/notifications/${el.dataset.nid}/read`, {});
            window.location.href = el.href;
          } catch (error) {
            MD.toast(`Notification could not be marked read: ${error.message}`, true);
          }
        });
      });
      const markAll = document.getElementById('mdshell-mark-all');
      if (markAll) markAll.onclick = async () => {
        if (this.role === 'college') {
          MD.notifications.markAllAsRead();
          return;
        }
        try {
          await MD.api('POST', '/notifications/read-all', {});
          MDShell.fillNotifications();
          MD.toast('Marked all visible alerts as read.');
        } catch (error) {
          MD.toast(`Notifications could not be marked read: ${error.message}`, true);
        }
      };
    } catch (error) {
      list.innerHTML = `<div class="p-3 text-xs text-red-600">${MD.escapeHtml(error.message)}</div>`;
    }
  },

  titleFor(opts) {
    document.title = `${opts.page} — MoneyDeck`;
    if (opts.heading) {
      document.getElementById('mdshell-content').insertAdjacentHTML('afterbegin', `
        <div class="bg-white rounded-lg border border-[#E2E7ED] p-5 shadow-sm flex items-center justify-between gap-4">
          <div><h1 class="text-xl font-bold text-[#142D4E] tracking-tight">${MD.escapeHtml(opts.heading)}</h1>
          <p class="text-xs text-slate-600 mt-1">${MD.escapeHtml(opts.subheading || '')}</p></div>
          <div class="flex items-center gap-2" id="mdshell-title-actions"></div>
        </div>`);
    }
  },

  toastHost() {
    const holder = document.createElement('div');
    holder.id = 'md-toast';
    holder.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end';
    return holder;
  },
};
