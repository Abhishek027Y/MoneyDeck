/**
 * MoneyDeck — shared frontend client (vanilla JS, no build step).
 *
 * Pages include this file after their own scripts. It provides:
 *   MD.api        — fetch wrapper (CSRF + JSON errors)
 *   MD.guard      — session guard: redirects to login if not signed in
 *   MD.login      — POST /api/auth/login and remember CSRF token
 *   MD.logout     — POST /api/auth/logout then redirect
 *   MD.rewireSidebar — point existing Stitch sidebar/nav links at the real app pages
 *   MD.wireNotifications — replaces static alert drawer content with live data
 *   helpers: fmtMoney, fmtDate, statusBadge classes
 *
 * Session lives in an HttpOnly cookie; only the CSRF token is kept in
 * sessionStorage (it is not a secret and is bound to the cookie session).
 */
'use strict';
window.MD = (function () {
  const CSRF_KEY = 'md_csrf';
  const NOTIFICATION_STORAGE_KEY = 'moneydeck_notifications';
  const DEFAULT_NOTIFICATIONS = {
    comments: [
      { id: 'comm_1', text: 'Discrepancy found in FDR joint name. Please re-upload certificate.', unread: true },
      { id: 'comm_2', text: 'Bank seal signature is blurred on folio page 2.', unread: true },
    ],
    alerts: [
      { id: 'alert_1', text: 'Mandatory annual tripartite compliance verification due Nov 15.', unread: true },
      { id: 'alert_2', text: 'Core banking API sync completed for active lien registers.', unread: true },
      { id: 'alert_3', text: 'Resubmit FDR renewal dossier within 48 hours.', unread: true },
    ],
  };
  let notificationRequest = null;

  function getNotificationState() {
    const saved = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (!saved) {
      const initial = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATIONS));
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }

    function loginRedirect() {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
    }

    try {
      const state = JSON.parse(saved);
      const valid = state && ['comments', 'alerts'].every((type) =>
        Array.isArray(state[type]) && state[type].every((item) =>
          item && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.unread === 'boolean'
        )
      );
      if (valid) return state;
      throw new TypeError('Stored notification state has an invalid shape.');
    } catch (error) {
      console.warn('[moneydeck] Resetting invalid local notification state:', error.message);
      const initial = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATIONS));
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
  }

  function updateNotificationBadges() {
    const state = getNotificationState();
    const unreadComments = state.comments.filter((item) => item.unread).length;
    const unreadAlerts = state.alerts.filter((item) => item.unread).length;
    const totalUnread = unreadComments + unreadAlerts;

    const commentLinks = [...document.querySelectorAll('aside a[href*="/comments.html"]')]
      .filter((link) => /Officer Comments/i.test(link.textContent));
    const alertLinks = [...document.querySelectorAll('aside a')]
      .filter((link) => /Alerts\s*&?\s*Notices/i.test(link.textContent));
    commentLinks.forEach((link) => {
      const badge = ensureCommunicationBadge(link, 'comments', 'bg-amber-500');
      badge.textContent = String(unreadComments);
      badge.style.display = unreadComments ? 'inline-flex' : 'none';
    });
    alertLinks.forEach((link) => {
      const badge = ensureCommunicationBadge(link, 'alerts', 'bg-rose-500');
      badge.textContent = String(unreadAlerts);
      badge.style.display = unreadAlerts ? 'inline-flex' : 'none';
    });

    document.querySelectorAll('#mdshell-notif-badge, #notifBadgeCount').forEach((badge) => {
      badge.textContent = String(totalUnread);
      badge.style.display = totalUnread ? 'flex' : 'none';
    });
    document.querySelectorAll('#mdshell-notif-count, #notifDropdownCount').forEach((count) => {
      count.textContent = `${totalUnread} New`;
    });

    const items = [
      ...state.comments.map((item) => ({ ...item, type: 'comments' })),
      ...state.alerts.map((item) => ({ ...item, type: 'alerts' })),
    ];
    const dropdowns = document.querySelectorAll('#notifDropdown, #notif-dropdown, #notifications-drawer, .notification-drawer');
    dropdowns.forEach((dropdown) => {
      const list = dropdown.querySelector('#mdshell-notif-list, .divide-y') || dropdown;
      list.innerHTML = items.map((item) => {
        const href = item.type === 'comments' ? '/app/college/comments.html' : '/app/college/alerts.html';
        const categoryLabel = item.type === 'comments' ? 'Officer Comment' : 'Alert';
        return `<a href="${href}" data-local-notification-type="${item.type}" data-local-notification-id="${item.id}" class="block p-3 hover:bg-slate-50 transition-colors ${item.unread ? '' : 'opacity-60'}">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-2 h-2 rounded-full ${item.unread ? (item.type === 'comments' ? 'bg-amber-500' : 'bg-rose-500') : 'bg-slate-300'}"></span>
            <span class="font-semibold text-slate-800">${categoryLabel}</span>
            ${item.unread ? '<span class="ml-auto text-[9px] uppercase tracking-wide text-rose-600 font-bold">Unread</span>' : '<span class="ml-auto text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Read</span>'}
          </div>
          <p class="text-slate-500 text-[11px]">${escapeHtml(item.text)}</p>
        </a>`;
      }).join('');
      list.querySelectorAll('[data-local-notification-id]').forEach((link) => {
        link.addEventListener('click', () => markAsRead(link.dataset.localNotificationType, link.dataset.localNotificationId));
      });
      const markAll = [...dropdown.querySelectorAll('button, a, span')].find((control) =>
        control.textContent.trim() === 'Mark all read'
      );
      if (markAll && !markAll.dataset.mdLocalMarkAllWired) {
        markAll.dataset.mdLocalMarkAllWired = 'true';
        markAll.addEventListener('click', (event) => {
          event.preventDefault();
          markAllAsRead();
        });
      }
    });
  }

  function saveNotificationState(state) {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state));
    updateNotificationBadges();
  }

  function markAsRead(type, id) {
    if (!['comments', 'alerts'].includes(type)) return;
    const state = getNotificationState();
    const item = state[type].find((notification) => notification.id === id);
    if (item?.unread) {
      item.unread = false;
      saveNotificationState(state);
    }
  }

  function markAllAsRead(type) {
    const state = getNotificationState();
    const types = type ? [type] : ['comments', 'alerts'];
    types.filter((itemType) => ['comments', 'alerts'].includes(itemType)).forEach((itemType) => {
      state[itemType].forEach((item) => { item.unread = false; });
    });
    saveNotificationState(state);
  }

  function refreshNotificationState() {
    if (!document.body.classList.contains('college-page')) return;
    getNotificationState();
    updateNotificationBadges();
  }

  window.addEventListener('storage', (event) => {
    if (event.key === NOTIFICATION_STORAGE_KEY && document.body.classList.contains('college-page')) {
      refreshNotificationState();
    }
  });

  async function api(method, path, body, opts = {}) {
    const headers = {};
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
    }
    const csrf = sessionStorage.getItem(CSRF_KEY);
    if (csrf) headers['X-MD-CSRF'] = csrf;
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined
        : (body instanceof FormData || body instanceof Blob ? body : JSON.stringify(body)),
    });
    if (res.status === 401 && !opts.allow401 && !opts.noRedirectOn401) {
      loginRedirect();
      throw new Error('Please sign in again.');
    }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok && !opts.noThrow) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { res, data };
  }

  async function guard(expectedRole) {
    if (!sessionStorage.getItem(CSRF_KEY) && !window.location.href.includes('login')) {
      // We may still have a valid cookie session; refresh CSRF token silently.
      try { await api('GET', '/auth/csrf', undefined, { noThrow: true }); } catch { /* handled below */ }
    }
    let me = null;
    try {
      me = (await api('GET', '/auth/me', undefined, { noThrow: true })).data;
    } catch { me = null; }
    if (!me || !me.user) {
      loginRedirect();
      return null;
    }
    if (expectedRole && me.user.role !== expectedRole) {
      window.location.href = me.user.role === 'officer'
        ? '/aicte_officer_executive_fdr_overview_dashboard/code.html'
        : '/college_portal_institutional_fdr_management_dashboard/code.html';
      return null;
    }
    me = me.user;
    document.documentElement.dataset.mdUser = me.display_name || '';
    document.body.dataset.role = me.role;
    document.body.classList.toggle('officer-page', me.role === 'officer');
    document.body.classList.toggle('college-page', me.role === 'college');
    return me;
  }

  async function login(email, password, captchaOk) {
    if (!captchaOk) throw new Error('Verification input does not match the displayed code.');
    const csrfResponse = await api('GET', '/auth/csrf', undefined, { allow401: true, noThrow: true });
    if (csrfResponse.data && csrfResponse.data.csrfToken) {
      sessionStorage.setItem(CSRF_KEY, csrfResponse.data.csrfToken);
    }
    const { data } = await api('POST', '/auth/login', { email, password }, { noRedirectOn401: true, noThrow: false });
    // cookie is set by the response; persist CSRF (sessionStorage only)
    sessionStorage.setItem(CSRF_KEY, data.csrfToken);
    return data.user;
  }

  async function logout() {
    try { await api('POST', '/auth/logout', {}); } catch { /* session may be gone */ }
    sessionStorage.removeItem(CSRF_KEY);
    window.location.href = '/moneydeck_institutional_access_secure_login/code.html';
  }

  /** Point the Stitch sidebar/nav Sign Out + page links to the app pages. */
  function rewireSidebar(role, me) {
    document.body.dataset.role = role;
    document.body.classList.toggle('officer-page', role === 'officer');
    document.body.classList.toggle('college-page', role === 'college');
    // Active session chip
    if (me) {
      document.querySelectorAll('aside span.text-\\[12px\\].font-semibold').forEach((el) => {
        if (el.textContent.includes('Apex Inst.')) el.textContent = me.institutionName || el.textContent;
      });
      const pid = document.querySelectorAll('aside span.font-tabular-num');
      pid.forEach((el) => { if (/PID:/.test(el.textContent)) el.textContent = `PID: ${me.aictePid || ''}`; });
    }
    const SIGNOUT_HREF = '/moneydeck_institutional_access_secure_login/code.html';
    document.querySelectorAll('aside a').forEach((a) => {
      // Sign Out button does real logout via centralized handler later; keep href
      if (a.getAttribute('href') === SIGNOUT_HREF) {
        a.setAttribute('href', 'javascript:void 0');
        a.setAttribute('data-md-signout', '1');
        a.addEventListener('click', (e) => { e.preventDefault(); MD.logout(); });
      }
    });

    const linkMap = role === 'college' ? {
      'Submit New FDR': '/college_portal_submit_new_fdr_batch_submission_gateway/code.html',
      'My FDR Records': '/app/college/fdr-records.html',
      'Renew FDR': '/app/college/renewals.html',
      'Release Requests': '/app/college/releases.html',
      'Officer Comments': '/app/college/comments.html',
      'Alerts & Notices': '/app/college/alerts.html',
      'Alerts &amp; Notices': '/app/college/alerts.html',
      'Institution Details': '/app/college/institution.html',
      'Language Prefs': '/app/college/comments.html#comments-language-widget',
      'Notification Config': '/app/college/notification-config.html#notifications',
      'Dashboard': '/college_portal_institutional_fdr_management_dashboard/code.html',
    } : {
      'Dashboard': '/aicte_officer_executive_fdr_overview_dashboard/code.html',
      'Verification Workspace': '/aicte_officer_fdr_verification_workspace_ai_engine/code.html',
      'Colleges & FDRs': '/app/officer/colleges.html',
      'Verification Queue': '/aicte_officer_fdr_verification_workspace_ai_engine/code.html',
      'Problem Reports': '/app/officer/problems.html',
      'Release Requests': '/app/officer/releases.html',
      'Renewal Monitoring': '/app/officer/renewals.html',
      'Audit Log': '/app/officer/audit.html',
      'Settings': '/app/officer/settings.html',
    };
    const collegeOnlyLabels = new Set([
      'College Dashboard', 'Submit New FDR', 'My FDR Records', 'Renew FDR',
      'Multilingual Notices', 'College Settings',
    ]);
    const officerOnlyLabels = new Set([
      'Overview Dashboard', 'Colleges & FDRs', 'Verification Workspace',
      'Problem Reports', 'Audit Log', 'Audit Log & Security', 'Officer Settings',
      'Governance Console',
    ]);
    document.querySelectorAll('aside nav a').forEach((a) => {
      const label = (a.innerText || a.textContent).trim()
        .replace(/^[^\s]+\s+/, '').replace(/[0-9]+\s*$/, '').trim();
      if (linkMap[label]) a.setAttribute('href', linkMap[label]);

      const href = a.getAttribute('href') || '';
      const section = a.closest('nav')?.parentElement;
      if (role === 'officer' && (
        href.includes('college_portal_') || href.startsWith('/app/college/') || collegeOnlyLabels.has(label)
      )) {
        section?.classList.add('college-nav-group', 'college-section');
      }
      if (role === 'college' && (
        href.includes('aicte_officer') || href.startsWith('/app/officer/') || officerOnlyLabels.has(label)
      )) {
        section?.classList.add('officer-nav-group');
        a.hidden = true;
      }
    });
    // officer workspaces may also have plain top links
    if (role === 'officer') {
      document.querySelectorAll('a, button').forEach((el) => {
        const label = (el.textContent || '').trim();
        if (el.getAttribute('href') === '#reset' && label) { /* leave */ }
      });
    }
  }

  const STATUS_TEXT = {
    submitted: 'Submitted', under_review: 'Under Review', correction_requested: 'Correction Requested',
    correction_escalated: 'Escalated to AICTE', rejected: 'Rejected', verified: 'Verified',
    bank_confirmed: 'Bank Confirmed', released: 'Released',
    pending_bank_confirmation: 'Pending Bank Confirmation', bank_unconfirmed: 'Bank Not Confirmed',
    pending_verification: 'Pending Verification', in_review: 'In Review',
  };
  const STATUS_CLASS = {
    submitted: ['bg-[#EFF4FE]', 'border-[#1D4ED855]', 'text-blue-800'],
    under_review: ['bg-[#EFF4FE]', 'border-[#1D4ED855]', 'text-blue-800'],
    in_review: ['bg-[#EFF4FE]', 'border-[#1D4ED855]', 'text-blue-800'],
    verified: ['bg-[#EAF6ED]', 'border-[#1E7E3455]', 'text-[#1E7E34]'],
    bank_confirmed: ['bg-[#EAF6ED]', 'border-[#1E7E3455]', 'text-[#1E7E34]'],
    released: ['bg-[#F3F4F6]', 'border-[#4B556355]', 'text-[#4B5563]'],
    rejected: ['bg-[#FEF2F2]', 'border-[#DC262655]', 'text-[#DC2626]'],
    correction_requested: ['bg-[#FEF7EC]', 'border-[#D9770655]', 'text-[#D97706]'],
    correction_escalated: ['bg-[#FBEAEA]', 'border-[#991B1B55]', 'text-[#991B1B]'],
    pending_verification: ['bg-[#FEF7EC]', 'border-[#D9770655]', 'text-[#D97706]'],
    pending_bank_confirmation: ['bg-[#FEF7EC]', 'border-[#D9770655]', 'text-[#D97706]'],
    bank_unconfirmed: ['bg-[#FEF2F2]', 'border-[#DC262655]', 'text-[#DC2626]'],
  };

  function badge(status) {
    const cls = STATUS_CLASS[status] || STATUS_CLASS.submitted;
    const text = STATUS_TEXT[status] || (status || '').replace(/_/g, ' ');
    return `<span class="px-2 py-0.5 text-[11px] font-semibold rounded border uppercase tracking-wide ${cls.join(' ')}">${text}</span>`;
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || n === '') return '—';
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    return '₹' + n.toLocaleString('en-IN');
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Wire a notifications drawer / dropdown to live data, replacing mock items. */
  async function wireNotifications() {
    if (document.body.classList.contains('college-page')) {
      refreshNotificationState();
      return;
    }
    if (notificationRequest) return notificationRequest;
    notificationRequest = (async () => {
      try {
        const { data } = await api('GET', '/notifications');
        const notes = (data && data.notifications) || [];
        const unread = notes.filter((n) => !n.read_at).length;
        const drawers = document.querySelectorAll('#notifDropdown, #notif-dropdown, #notifications-drawer, .notification-drawer');
        const badges = document.querySelectorAll('#mdshell-notif-badge, #notif-badge, #notifBadge, button[aria-controls="notifDropdown"] span.absolute, button[onclick*="toggleNotificationsDrawer"] span.absolute');
        badges.forEach((badge) => {
          badge.textContent = String(unread);
          badge.style.display = 'flex';
        });
        document.querySelectorAll('#mdshell-notif-count, #notifDropdownCount').forEach((count) => {
          count.textContent = `${unread} New`;
        });

        const items = notes.slice(0, 8).map((n) => {
          const href = typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//')
            ? n.link
            : n.category === 'comment' || String(n.title).toLowerCase().includes('comment')
              ? '/app/college/comments.html'
              : '/app/college/alerts.html';
          return `<a href="${escapeHtml(href)}" class="block p-3 hover:bg-slate-50 transition-colors ${n.read_at ? 'opacity-60' : ''}" data-note-id="${n.id}">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full ${n.category === 'comment' ? 'bg-amber-500' : 'bg-rose-500'}"></span>
              <span class="font-semibold text-slate-800">${escapeHtml(n.title)}</span>
            </div>
            <p class="text-slate-500 text-[11px] truncate">${escapeHtml(n.body)}</p>
            <p class="text-[10px] text-slate-400 mt-1">${fmtDate(n.created_at)}</p>
          </a>`;
        }).join('') || '<div class="p-3 text-xs text-slate-500">No notifications right now.</div>';

        drawers.forEach((drawer) => {
          const list = drawer.querySelector('#mdshell-notif-list, .divide-y') || drawer;
          list.innerHTML = items;
          drawer.querySelectorAll('[data-note-id]').forEach((item) => {
            item.addEventListener('click', async (event) => {
              if (item.classList.contains('opacity-60')) return;
              event.preventDefault();
              try {
                await api('POST', `/notifications/${item.dataset.noteId}/read`, {});
                window.location.href = item.href;
              } catch (error) {
                toast(`Notification could not be marked read: ${error.message}`, true);
              }
            });
          });
          const markAll = [...drawer.querySelectorAll('button, a, span')].find((control) =>
            control.textContent.trim() === 'Mark all read'
          );
          if (markAll && !markAll.dataset.mdMarkAllWired) {
            markAll.dataset.mdMarkAllWired = 'true';
            markAll.addEventListener('click', async (event) => {
              event.preventDefault();
              try {
                await api('POST', '/notifications/read-all', {});
                await wireNotifications();
              } catch (error) {
                toast(`Notifications could not be marked read: ${error.message}`, true);
              }
            });
          }
        });

      } catch (error) {
        toast(`Notifications could not be loaded: ${error.message}`, true);
      } finally {
        notificationRequest = null;
      }
    })();
    return notificationRequest;
  }

  function ensureCommunicationBadge(link, type, colorClass) {
    const badgeText = type === 'comments'
      ? String(getNotificationState().comments.filter((item) => item.unread).length)
      : String(getNotificationState().alerts.filter((item) => item.unread).length);
    link.href = type === 'comments' ? '/app/college/comments.html' : '/app/college/alerts.html';
    if (type === 'alerts') link.removeAttribute('onclick');
    link.classList.add('justify-between');
    let badge = [...link.children].reverse().find((child) =>
      child.tagName === 'SPAN' && !child.querySelector('.material-symbols-outlined')
    );
    if (!badge) {
      badge = document.createElement('span');
      link.appendChild(badge);
    }
    badge.id = type === 'comments' ? 'sidebarCommentsBadge' : 'sidebarAlertsBadge';
    badge.className = `inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white ${colorClass}`;
    badge.textContent = badgeText;
    badge.style.display = Number(badgeText) ? 'inline-flex' : 'none';
    return badge;
  }

  function wireStitchCollegeNotifications() {
    if (!document.body.classList.contains('college-page') || document.getElementById('mdshell-nav')) return;
    const buttons = [...document.querySelectorAll('button[onclick*="toggleNotificationsDrawer"], #notifBellBtn')];
    const drawers = [...document.querySelectorAll('#notifDropdown, #notif-dropdown, #notifications-drawer, .notification-drawer')];

    buttons.forEach((button) => {
      button.id = 'notifBellBtn';
      button.setAttribute('aria-label', 'Notifications');
      button.setAttribute('aria-controls', 'notifDropdown');
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('onclick');
      const icon = button.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.outerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>';
      }
      button.className = 'relative p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors';
      let badge = button.querySelector('span.absolute');
      if (!badge) {
        badge = document.createElement('span');
        button.appendChild(badge);
      }
      badge.id = 'mdshell-notif-badge';
      badge.className = 'absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white';
      button.addEventListener('click', () => toggleStitchNotificationDrawer(button, drawers));
    });

    drawers.forEach((drawer) => {
      drawer.id = 'notifDropdown';
      drawer.classList.add('rounded-xl', 'shadow-xl', 'border', 'border-slate-200', 'overflow-hidden');
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-label', 'Notifications');
      const header = drawer.querySelector('.border-b');
      if (header) {
        const title = header.querySelector('span');
        if (title) title.textContent = 'Notifications';
        const count = document.createElement('span');
        count.id = 'mdshell-notif-count';
        count.className = 'text-[10px] font-semibold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full';
        count.textContent = '0 New';
        header.appendChild(count);
      }
      let footer = drawer.querySelector('[data-md-notif-footer]');
      if (!footer) {
        footer = document.createElement('div');
        footer.dataset.mdNotifFooter = '';
        footer.className = 'p-2 bg-slate-50 border-t border-slate-100 text-center';
        footer.innerHTML = '<a href="/app/college/alerts.html" class="text-[11px] font-semibold text-slate-700 hover:text-slate-900">View All Alerts &amp; Notices &rarr;</a>';
        drawer.appendChild(footer);
      }
    });

    document.addEventListener('click', (event) => {
      if (event.target.closest('#notifBellBtn, #notifDropdown')) return;
      const button = document.getElementById('notifBellBtn');
      if (button && drawers.some((drawer) => !drawer.classList.contains('hidden'))) closeStitchNotificationDrawer(button, drawers);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const button = document.getElementById('notifBellBtn');
        if (button) closeStitchNotificationDrawer(button, drawers);
      }
    });
    refreshNotificationState();
  }

  function toggleStitchNotificationDrawer(button, drawers) {
    const drawer = drawers[0];
    if (!drawer) return;
    if (!drawer.classList.contains('hidden')) {
      closeStitchNotificationDrawer(button, drawers);
      return;
    }
    drawer.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => drawer.classList.add('notif-visible'));
  }

  function closeStitchNotificationDrawer(button, drawers) {
    drawers.forEach((drawer) => {
      if (drawer.classList.contains('hidden')) return;
      drawer.classList.remove('notif-visible');
      window.setTimeout(() => drawer.classList.add('hidden'), 160);
    });
    button.setAttribute('aria-expanded', 'false');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireStitchCollegeNotifications, { once: true });
  } else {
    wireStitchCollegeNotifications();
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function toast(message, isError) {
    let holder = document.getElementById('md-toast');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'md-toast';
      holder.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end';
      document.body.appendChild(holder);
    }
    const t = document.createElement('div');
    t.className = `px-4 py-2 rounded border shadow-lg text-xs font-semibold ${isError ? 'bg-[#FEF2F2] border-red-300 text-red-800' : 'bg-white border-emerald-300 text-emerald-800'}`;
    t.textContent = message;
    holder.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  const notifications = {
    getState: getNotificationState,
    save: saveNotificationState,
    markAsRead,
    markAllAsRead,
    updateBadges: updateNotificationBadges,
    refresh: refreshNotificationState,
  };

  return { api, guard, login, logout, rewireSidebar, wireNotifications, notifications, badge, fmtMoney, fmtDate, escapeHtml, qs, toast, STATUS_TEXT };
})();
