/** Handshake v0.1 — native panel, one card per project, user-confirmed execution. */
window.__ModuleLoader__.load({
  id: '@local/dsh-handshake',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const NS = 'dsh-handshake';
    const PANEL_ID = 'dsh-handshake';

    /* ---------------- locale dictionaries (flat keys, {param} slots) ---------------- */
    const en = {
      'nav': 'Handshake',
      'tab.relay': 'Handshake',
      'board.title': 'Handshake board',
      'board.refresh': 'Refresh',
      'board.empty': 'Create a handshake task from a session below. Execution starts after your confirmation.',
      'board.noThreads': 'No recent Codex sessions found.',
      'board.noSessions': 'No pending DSH sessions.',
      'board.home': 'Store',
      'zone.codexLib': 'Codex',
      'zone.relay': 'Handshake tasks',
      'zone.dshLib': 'DSH',
      'task.status.staged': 'Ready to execute',
      'task.status.executing': 'Executing',
      'task.status.awaiting-review': 'Awaiting review',
      'task.status.done': 'Done',
      'task.status.failed': 'Failed',
      'task.owner': 'Batons',
      'task.ownerDsh': 'DSH',
      'task.ownerCodex': 'Codex',
      'task.ownerNone': '—',
      'task.lastEdit': 'Last edit',
      'task.lastEditor': 'Last edited by',
      'task.project': 'Folder',
      'task.relay': 'Handshake history',
      'task.edits': 'Edits by client',
      'task.packet': 'Handoff packet',
      'edits.files': 'files',
      'action.convert': 'Confirm convert',
      'action.execute': 'Confirm execute',
      'action.executing': 'Executing…',
      'action.done': 'Mark done',
      'action.failed': 'Mark failed',
      'action.delete': 'Delete',
      'action.handoff': 'Hand off to Codex',
      'action.handoffDsh': 'Continue in DSH',
      'action.createRelay': 'Create handshake task',
      'action.created': 'Created',
      'action.openBoard': 'Open board',
      'dialog.execute': 'The handoff packet will run on {target} automatically. Confirm execution?',
      'header.button': 'Relay',
      'header.title': 'Hand off this session',
      'header.hint': 'Step 1 converts the session into a handoff packet, step 2 starts Codex automatically.',
      'common.error': 'Failed: {message}',
      'common.no': 'Cancel',
      'board.pending': 'Projects ready for handoff',
      'project.sessions': '{n} sessions',
      'project.latest': 'Latest session: {title}',
      'board.history': 'Completed handoffs',
      'board.loading': 'Loading sessions…',
      'action.details': 'Details',
      'action.retry': 'Retry execution',
    };
    const zh = {
      'nav': '接力',
      'tab.relay': '接力',
      'board.title': '接力看板',
      'board.refresh': '刷新',
      'board.empty': '从下方选择一个会话创建接力任务，确认后即可交接执行。',
      'board.noThreads': '未发现最近的 Codex 会话。',
      'board.noSessions': '暂无待接力的 DSH 会话。',
      'board.home': '存储目录',
      'zone.codexLib': 'Codex',
      'zone.relay': '接力任务',
      'zone.dshLib': 'DSH',
      'task.status.staged': '待执行',
      'task.status.executing': '执行中',
      'task.status.awaiting-review': '待验收',
      'task.status.done': '已完成',
      'task.status.failed': '失败',
      'task.owner': '当前棒位',
      'task.ownerDsh': 'DSH',
      'task.ownerCodex': 'Codex',
      'task.ownerNone': '—',
      'task.lastEdit': '最新编辑',
      'task.lastEditor': '最后编辑',
      'task.project': '归属文件夹',
      'task.relay': '接力记录',
      'task.edits': '各客户端编辑',
      'task.packet': '交接包',
      'edits.files': '个文件',
      'action.convert': '确认转换',
      'action.execute': '确认执行',
      'action.executing': '执行中…',
      'action.done': '标记完成',
      'action.failed': '标记失败',
      'action.delete': '删除',
      'action.handoff': '交接给 Codex',
      'action.handoffDsh': '转到 DSH 续做',
      'action.createRelay': '创建接力任务',
      'action.created': '已创建',
      'action.openBoard': '打开看板',
      'dialog.execute': '交接包将在 {target} 上自动执行，确认执行？',
      'header.button': '接力',
      'header.title': '交接当前会话',
      'header.hint': '第 1 击把会话转换成交接包，第 2 击自动拉起 Codex 执行。',
      'common.error': '失败：{message}',
      'common.no': '取消',
      'board.pending': '待创建接力项目',
      'project.sessions': '{n} 个会话',
      'project.latest': '最近会话：{title}',
      'board.history': '已完成的接力',
      'board.loading': '正在读取会话…',
      'action.details': '查看详情',
      'action.retry': '重试执行',
    };

    Object.assign(zh, {
      'task.status.preparing':'启动检查中', 'action.refreshPacket':'刷新交接资料',
      'action.next':'接力给 {target}', 'round':'第 {n} 轮',
      'receipt.verified':'资料已核对', 'receipt.pending':'资料待核对',
      'receipt.invalid':'资料回执不一致', 'receipt.legacy':'旧资料待刷新',
      'preflight.passed':'代码基线已检查', 'preflight.pending':'执行前检查基线',
      'coverage':'用户原文 {n} 条', 'master.title':'项目共识',
      'master.hint':'维护两个模型共同遵守的目标、约束和验收标准。历史原文保留，后续明确修订优先。每行填写一项。',
      'master.prefill':'目标由初始用户原文预填，可能含历史阶段限制；请整理后保存。', 'master.goal':'项目目标', 'master.constraints':'已确认约束', 'master.decisions':'已确认决策',
      'master.verify':'验收标准', 'master.notes':'补充背景', 'master.save':'保存项目共识',
      'task.evidence':'交接资料与历史', 'receipt.hint':'资料核对不代表任务已完成；请检查改动和测试后验收。',
      'zone.codexHint':'从 Codex 交给 DSH', 'zone.dshHint':'从 DSH 交给 Codex',
      'header.hint':'先创建交接资料，再由你确认执行。完整要求和代码基线随每一轮接力保留。',
      'dialog.execute':'将第 {n} 轮交给 {target} 执行。启动前会重新检查来源与代码状态，确认继续？',
    });
    Object.assign(en, {
      'task.status.preparing':'Checking before launch', 'action.refreshPacket':'Refresh handoff',
      'action.next':'Hand off to {target}', 'round':'Round {n}',
      'receipt.verified':'Documents checked', 'receipt.pending':'Documents pending',
      'receipt.invalid':'Receipt mismatch', 'receipt.legacy':'Refresh legacy packet',
      'preflight.passed':'Workspace checked', 'preflight.pending':'Workspace checked before launch',
      'coverage':'{n} original user messages', 'master.title':'Project agreement',
      'master.hint':'Shared goals, confirmed constraints and acceptance criteria. Original evidence is retained; later explicit amendments take precedence. One item per line.',
      'master.prefill':'Goal prefilled from the initial user request; review historical scope before saving.', 'master.goal':'Goal', 'master.constraints':'Confirmed constraints', 'master.decisions':'Confirmed decisions',
      'master.verify':'Acceptance criteria', 'master.notes':'Background', 'master.save':'Save agreement',
      'task.evidence':'Handoff evidence and history', 'receipt.hint':'A read receipt is not task acceptance. Review actual changes and tests.',
      'zone.codexHint':'Codex to DSH', 'zone.dshHint':'DSH to Codex',
      'header.hint':'Create a handoff, then confirm execution. Each round preserves requirements and workspace evidence.',
      'dialog.execute':'Run round {n} on {target}? Source activity and workspace state will be checked again before launch.',
    });

    /* ---------------- HTTP helper (anchored on the served UI directory) ---------------- */
    function api(path) {
      const relative = String(path).replace(/^\/+/, '');
      if (typeof document === 'undefined') return `/${relative}`;
      return new URL(relative, document.baseURI).href;
    }
    async function call(path, body) {
      const init = body === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
      const response = await fetch(api(path), init);
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok || (payload && payload.ok === false)) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      return payload;
    }

    /* Scoped semantic colors distinguish clients independently of the host brand color. */
    const CSS = `
.${NS}-wrap { --hs-green:var(--dsw-alias-state-success-primary,#258454); --hs-codex:light-dark(#7044b5,#c7afff); --hs-dsh:light-dark(#2463ad,#91bdff); display:flex; flex-direction:column; gap:22px; padding:24px; height:100%; min-width:0; overflow:auto; box-sizing:border-box; color:var(--dsw-alias-label-primary); font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; container-type:inline-size; }
.${NS}-wrap * { box-sizing:border-box; }
.${NS}-wrap .${NS}-wrap { padding:0; height:auto; overflow:visible; }
.${NS}-header { display:flex; align-items:center; gap:12px; }
.${NS}-header h1 { font-size:21px; letter-spacing:-.5px; margin:0; font-weight:650; }
.${NS}-header .${NS}-btn { margin-left:auto; }
.${NS}-version { font-size:12px; color:var(--dsw-alias-label-secondary); }
.${NS}-h2 { font-size:14px; font-weight:650; margin:0; }
.${NS}-muted { color:var(--dsw-alias-label-secondary); font-size:11px; }
.${NS}-zone-relay { border:1px solid color-mix(in srgb,var(--hs-green) 50%,var(--dsw-alias-border-l1)); background:color-mix(in srgb,var(--hs-green) 4%,var(--dsw-alias-bg-base)); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:14px; }
.${NS}-section-title { display:flex; align-items:center; gap:9px; font-size:15px; font-weight:650; }
.${NS}-count { font-size:11px; font-weight:600; padding:1px 7px; border-radius:6px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); }
.${NS}-zone-relay > .${NS}-section-title .${NS}-count { color:var(--hs-green); background:color-mix(in srgb,var(--hs-green) 10%,var(--dsw-alias-bg-base)); }
.${NS}-relay-grid,.${NS}-pending-columns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.${NS}-pending { display:flex; flex-direction:column; gap:12px; }
.${NS}-pending-column { --hs-client:var(--hs-codex); min-width:0; padding:14px; border:1px solid color-mix(in srgb,var(--hs-client) 35%,var(--dsw-alias-border-l1)); border-top:3px solid var(--hs-client); border-radius:12px; background:color-mix(in srgb,var(--hs-client) 5%,var(--dsw-alias-bg-base)); display:flex; flex-direction:column; gap:12px; }
.${NS}-pending-column-dsh { --hs-client:var(--hs-dsh); }
.${NS}-pending-columns { gap:22px; position:relative; }
.${NS}-pending-columns::after { content:''; position:absolute; left:50%; top:0; bottom:0; border-left:1px solid var(--dsw-alias-border-l2); pointer-events:none; }
.${NS}-pending-head { display:flex; align-items:center; gap:10px; padding:0 2px 4px; height:62px; flex:none; border-bottom:1px solid color-mix(in srgb,var(--hs-client) 25%,var(--dsw-alias-border-l1)); padding-bottom:12px; }
.${NS}-pending-head strong { font-size:16px; font-weight:650; }
.${NS}-pending-head .${NS}-count { margin-left:auto; }
.${NS}-mark { display:grid; place-items:center; width:30px; height:30px; border-radius:10px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font-size:15px; font-weight:700; flex:none; }
.${NS}-mark-codex,.${NS}-mark-dsh { color:var(--hs-client); background:color-mix(in srgb,var(--hs-client) 12%,var(--dsw-alias-bg-base)); }
.${NS}-pending-column > .${NS}-card { border-left:3px solid color-mix(in srgb,var(--hs-client) 65%,transparent); }
.${NS}-pending-column .${NS}-card-fixed .${NS}-btn { color:var(--hs-client); border-color:color-mix(in srgb,var(--hs-client) 40%,var(--dsw-alias-border-l1)); }
.${NS}-task-card { border-left:3px solid var(--hs-green); }
.${NS}-task-card[data-open=true] { grid-column:1/-1; }
.${NS}-card { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:11px; padding:16px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.${NS}-task-card { border-left:3px solid var(--hs-green); }
.${NS}-relay-grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); }
.${NS}-card:hover { border-color:var(--dsw-alias-border-l2); }
.${NS}-card-fixed { height:214px; display:grid; grid-template-rows:24px 36px 16px 18px 32px; gap:10px; }
.${NS}-card .${NS}-proj { font-size:14px; font-weight:650; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-title2 { font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow-wrap:anywhere; }
.${NS}-path { font:10px/16px ui-monospace,SFMono-Regular,monospace; color:var(--dsw-alias-label-secondary); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.${NS}-between { display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:0; }
.${NS}-task-meta { padding-top:4px; border-top:1px solid var(--dsw-alias-border-l1); display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.${NS}-task-actions { margin-top:auto; padding-top:4px; }
.${NS}-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:7px; padding:5px 10px; min-height:30px; font-family:inherit; font-size:12px; font-weight:500; line-height:18px; cursor:pointer; transition:background .12s,border-color .12s; }
.${NS}-btn:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-label-secondary); }
.${NS}-btn:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }
.${NS}-btn:disabled { opacity:.5; cursor:default; }
.${NS}-btn-primary { color:var(--hs-green); border-color:color-mix(in srgb,var(--hs-green) 55%,var(--dsw-alias-border-l1)); background:color-mix(in srgb,var(--hs-green) 7%,var(--dsw-alias-bg-layer-1)); }
.${NS}-btn-primary:hover { background:color-mix(in srgb,var(--hs-green) 13%,var(--dsw-alias-bg-layer-1)); border-color:var(--hs-green); }
.${NS}-btn-danger { color:var(--dsw-alias-label-secondary); border-color:transparent; }
.${NS}-btn-danger:hover { color:var(--dsw-alias-state-error-primary); }
.${NS}-card-fixed .${NS}-btn { width:100%; text-align:left; display:flex; align-items:center; justify-content:space-between; }
.${NS}-card-fixed .${NS}-btn::after { content:'→'; color:var(--dsw-alias-label-secondary); }
.${NS}-badge { display:inline-flex; align-items:center; border-radius:6px; padding:2px 7px; font-size:11px; white-space:nowrap; background:var(--dsw-alias-bg-layer-2); }
.${NS}-b-idle { color:var(--dsw-alias-label-secondary); }
.${NS}-b-ok,.${NS}-b-brand { color:var(--hs-green); background:color-mix(in srgb,var(--hs-green) 9%,var(--dsw-alias-bg-layer-1)); }
.${NS}-b-err { color:var(--dsw-alias-state-error-primary); }
.${NS}-chip { display:inline-flex; align-items:center; gap:5px; border-radius:5px; padding:1px 6px; font-size:10px; font-weight:600; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); white-space:nowrap; }
.${NS}-chip-codex { color:var(--hs-codex); background:color-mix(in srgb,var(--hs-codex) 12%,var(--dsw-alias-bg-layer-1)); }
.${NS}-chip-dsh { color:var(--hs-dsh); background:color-mix(in srgb,var(--hs-dsh) 12%,var(--dsw-alias-bg-layer-1)); }
.${NS}-chip-none { color:var(--dsw-alias-label-secondary); background:transparent; }
.${NS}-modal-backdrop { position:fixed; inset:0; background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent); z-index:120; display:grid; place-items:center; }
.${NS}-modal { background:var(--dsw-alias-bg-overlay); border:1px solid var(--dsw-alias-border-l2); border-radius:14px; padding:22px; width:380px; max-width:calc(100vw - 32px); display:flex; flex-direction:column; gap:16px; }
.${NS}-editrow,.${NS}-col { display:flex; flex-direction:column; gap:6px; min-width:0; }
.${NS}-filelist { display:flex; flex-wrap:wrap; gap:4px; }
.${NS}-filechip { font:10px ui-monospace,monospace; background:var(--dsw-alias-bg-layer-2); border-radius:4px; padding:2px 6px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.${NS}-timeline { display:flex; flex-direction:column; gap:8px; border-left:1px solid var(--dsw-alias-border-l2); padding-left:10px; }
.${NS}-tl-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--dsw-alias-label-secondary); }
.${NS}-detail { border-top:1px solid var(--dsw-alias-border-l1); padding-top:14px; display:flex; flex-direction:column; gap:10px; }
.${NS}-pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:240px; overflow:auto; font:11px/1.6 ui-monospace,monospace; background:var(--dsw-alias-bg-layer-2); border-radius:7px; padding:12px; margin:0; }
.${NS}-err { color:var(--dsw-alias-state-error-primary); font-size:11px; overflow-wrap:anywhere; }
.${NS}-candidate-note { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-empty { border:1px dashed var(--dsw-alias-border-l2); border-radius:11px; padding:24px 16px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.${NS}-facts { display:flex; gap:6px 12px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary); font-size:11px; }
.${NS}-master { padding:14px; border:1px solid var(--dsw-alias-border-l2); border-radius:9px; background:var(--dsw-alias-bg-base); display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.${NS}-master label { display:flex; flex-direction:column; gap:5px; min-width:0; font-size:12px; }
.${NS}-master textarea { resize:vertical; min-height:72px; width:100%; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; padding:8px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; font-size:12px; line-height:1.6; }
.${NS}-master .${NS}-wide { grid-column:1/-1; }
.${NS}-history { display:flex; flex-direction:column; gap:12px; }
.${NS}-history summary { cursor:pointer; color:var(--dsw-alias-label-secondary); font-size:12px; padding:6px 0; }
@container (max-width:600px) {
 .${NS}-relay-grid,.${NS}-pending-columns,.${NS}-master { grid-template-columns:minmax(0,1fr); }
 .${NS}-pending-columns::after { display:none; }
 .${NS}-card { padding:12px; }
 .${NS}-card-fixed { height:206px; }
 .${NS}-header h1 { font-size:18px; }
}

`;

    function Styles() { return h('style', null, CSS); }

    function Badge({ tone, children }) {
      return h('span', { className: `${NS}-badge ${NS}-b-${tone ?? 'idle'}` }, children);
    }

    function Btn({ label, onClick, tone, disabled, title }) {
      return h('button', {
        type: 'button',
        className: `${NS}-btn${tone === 'primary' ? ` ${NS}-btn-primary` : ''}${tone === 'danger' ? ` ${NS}-btn-danger` : ''}`,
        onClick,
        disabled: disabled === true,
        title: title ?? undefined,
      }, label);
    }

    function ClientChip({ client }) {
      const kind = client === 'dsh' ? 'dsh' : client === 'codex' ? 'codex' : 'none';
      const cls = `${NS}-chip-${kind}`;
      return h('span', { className: `${NS}-chip ${cls}` }, kind === 'none' ? '—' : kind === 'dsh' ? 'DSH' : 'Codex');
    }

    /* ---------------- modal confirm dialog (the execution gate) ---------------- */
    function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
      const dialogRef = useRef(null);
      const cancelRef = useRef(onCancel);
      cancelRef.current = onCancel;
      useEffect(() => {
        const previous = document.activeElement;
        dialogRef.current?.querySelector('button')?.focus();
        const onKey = (event) => {
          if (event.key === 'Escape') cancelRef.current();
          if (event.key === 'Tab') {
            const buttons = dialogRef.current?.querySelectorAll('button');
            if (!buttons?.length) return;
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
      }, []);
      return h('div', {
        className: `${NS}-modal-backdrop`,
        onClick: (event) => { if (event.target === event.currentTarget) onCancel(); },
      },
        h('div', { ref: dialogRef, className: `${NS}-modal`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: `${NS}-h2` }, title),
          h('div', { className: `${NS}-muted` }, message),
          h('div', { className: `${NS}-row` },
            h(Btn, { label: confirmLabel, tone: 'primary', onClick: onConfirm }),
            h(Btn, { label: cancelLabel, onClick: onCancel }))));
    }

    function projectName(path) {
      if (!path) return '—';
      const parts = String(path).replace(/\/+$/, '').split('/');
      return parts[parts.length - 1] || String(path);
    }

    function shortPath(path) {
      const parts = String(path).replace(/\/+$/, '').split('/');
      return parts.slice(-2).join('/');
    }

    function fmtTime(iso) {
      if (!iso) return '—';
      try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
    }

    function fmtWhen(iso) {
      if (!iso) return '—';
      try {
        const diff = Date.now() - new Date(iso).getTime();
        const minutes = Math.round(diff / 60000);
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes} 分钟前`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours} 小时前`;
        return `${Math.round(hours / 24)} 天前`;
      } catch { return String(iso); }
    }

    const STATUS_TONE = { preparing: 'brand', staged: 'brand', executing: 'ok', 'awaiting-review': 'ok', done: 'ok', failed: 'err' };

    /* ---------------- destructive-only two-click confirm ---------------- */
    function ConfirmButton({ label, confirmLabel, onConfirm, tone, disabled }) {
      const [armed, setArmed] = useState(false);
      useEffect(() => {
        if (!armed) return undefined;
        const timer = setTimeout(() => setArmed(false), 6000);
        return () => clearTimeout(timer);
      }, [armed]);
      if (!armed) return h(Btn, { label, tone, disabled, onClick: () => setArmed(true) });
      return h('span', { className: `${NS}-row` },
        h(Btn, {
          label: confirmLabel,
          tone: tone ?? 'danger',
          disabled,
          onClick: () => { setArmed(false); onConfirm(); },
        }),
        h(Btn, { label: '×', disabled, onClick: () => setArmed(false) }));
    }

    /* ---------------- relay timeline ---------------- */
    function RelayTimeline({ relay }) {
      if (!Array.isArray(relay) || relay.length === 0) return null;
      return h('div', { className: `${NS}-timeline` },
        ...relay.slice().reverse().map((entry, index) => h('div', { key: index, className: `${NS}-tl-row` },
          h('span', null, fmtTime(entry.at)),
          h(ClientChip, { client: entry.from }),
          h('span', null, '→'),
          h(ClientChip, { client: entry.to }),
          h('span', null, String(entry.action ?? '')),
          entry.note ? h('span', { className: `${NS}-muted` }, entry.note) : null)));
    }

    /* ---------------- per-client edit rows ---------------- */
    function EditRow({ client, edit, t }) {
      const count = edit?.files ?? 0;
      const files = edit?.fileList ?? [];
      return h('div', { className: `${NS}-editrow` },
        h('div', { className: `${NS}-row` },
          h(ClientChip, { client }),
          h('span', { className: `${NS}-muted` }, `${count} ${t('edits.files')} · ${fmtTime(edit?.lastAt)}`)),
        files.length > 0
          ? h('div', { className: `${NS}-filelist` },
              ...files.slice(0, 8).map((f) => h('span', { key: f, className: `${NS}-filechip` }, shortPath(f))))
          : null);
    }

    function ProjectEditor({ project, t, disabled, onSave }) {
      const [draft, setDraft] = useState(() => ({
        goal:project.goal || '', constraints:(project.constraints || []).join('\n'),
        decisions:(project.decisions || []).join('\n'), verify:(project.verify || []).join('\n'), notes:project.notes || '',
      }));
      const fields = ['goal','constraints','decisions','verify','notes'];
      return h('div', { className:`${NS}-master` },
        h('div', { className:`${NS}-wide ${NS}-muted` }, t('master.hint')),
        !project.goalConfirmed ? h('div', { className:`${NS}-wide ${NS}-muted` }, t('master.prefill')) : null,
        ...fields.map((key) => h('label', { key, className:key === 'goal' || key === 'notes' ? `${NS}-wide` : '' },
          t(`master.${key}`), h('textarea', { value:draft[key], disabled, 'aria-label':t(`master.${key}`),
            onChange:(event) => setDraft({...draft,[key]:event.target.value}) }))),
        h('div', { className:`${NS}-wide` }, h(Btn, { label:t('master.save'), disabled, onClick:() => onSave({
          ...draft, constraints:draft.constraints.split('\n'), decisions:draft.decisions.split('\n'), verify:draft.verify.split('\n'),
        }) })));
    }

    function TaskCard({ task, t, onChanged }) {
      const [open, setOpen] = useState(false);
      const [detail, setDetail] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [confirming, setConfirming] = useState(false);
      const loadDetail = useCallback(async () => {
        try { setDetail(await call(`/api/dsh-handshake/task?id=${encodeURIComponent(task.id)}`)); }
        catch (e) { setError(String(e?.message ?? e)); }
      }, [task.id]);
      useEffect(() => { if (open) void loadDetail(); }, [open, task.revision, task.status, loadDetail]);
      const act = async (fn) => {
        setBusy(true); setError(null);
        try { await fn(); await onChanged(); if (open) await loadDetail(); }
        catch (e) { setError(String(e?.message ?? e)); await onChanged(); }
        finally { setBusy(false); }
      };
      const source = (task.sourceKind ?? task.source?.kind) === 'codex' ? 'codex' : 'dsh';
      const target = task.target ?? (source === 'codex' ? 'dsh' : 'codex');
      const targetName = target === 'codex' ? 'Codex' : 'DSH';
      const nextTarget = task.lastExecutedBy === 'codex' ? 'DSH' : 'Codex';
      const running = ['preparing','executing'].includes(task.status);
      const ready = ['staged','failed'].includes(task.status);
      const receipt = task.reception?.status ?? 'legacy';
      return h('article', { className:`${NS}-card ${NS}-task-card`, 'data-task-id':task.id, 'data-open':open },
        h('div', { className:`${NS}-between` },
          h('span', { className:`${NS}-proj` }, projectName(task.projectDir)),
          h(Badge, { tone:STATUS_TONE[task.status] ?? 'idle' }, t(`task.status.${task.status}`))),
        h('div', { className:`${NS}-title2` }, task.title),
        h('div', { className:`${NS}-path`, title:task.projectDir }, task.projectDir || '—'),
        h('div', { className:`${NS}-task-meta` },
          h(ClientChip, { client:source }), h('span', null, '→'), h(ClientChip, { client:target }),
          h('span', { className:`${NS}-muted` }, t('round',{n:task.revision || 1}))),
        h('div', { className:`${NS}-facts` },
          h('span', null, t(`receipt.${receipt}`)),
          h('span', null, t(task.preflight?.status === 'passed' ? 'preflight.passed' : 'preflight.pending')),
          task.contextCoverage ? h('span', null, t('coverage',{n:task.contextCoverage.userMessages})) : null),
        (error || task.error) ? h('div', { className:`${NS}-err`, role:'alert' }, error || task.error) : null,
        h('div', { className:`${NS}-row ${NS}-task-actions` },
          ready ? h(Btn, { label:t(task.status === 'failed' ? 'action.retry' : 'action.execute'), tone:'primary', disabled:busy, onClick:() => setConfirming(true) }) : null,
          ready ? h(Btn, { label:t('action.refreshPacket'), disabled:busy, onClick:() => act(() => call('/api/dsh-handshake/refresh',{taskId:task.id})) }) : null,
          running ? h(Btn, { label:t('action.executing'), disabled:true }) : null,
          ['awaiting-review','done'].includes(task.status) && task.lastExecutedBy ? h(Btn, {
            label:t('action.next',{target:nextTarget}), tone:'primary', disabled:busy,
            onClick:() => act(() => call('/api/dsh-handshake/prepare',{taskId:task.id})),
          }) : null,
          task.status === 'awaiting-review' ? h(Btn, { label:t('action.done'), disabled:busy,
            onClick:() => act(() => call('/api/dsh-handshake/update',{taskId:task.id,patch:{status:'done'}})) }) : null,
          h(Btn, { label:t('action.details'), disabled:busy, onClick:() => setOpen(!open) }),
          !running ? h(ConfirmButton, { label:t('action.delete'), confirmLabel:t('action.delete'), tone:'danger', disabled:busy,
            onConfirm:() => act(() => call('/api/dsh-handshake/delete',{taskId:task.id})) }) : null),
        open && detail ? h('div', { className:`${NS}-detail` },
          h('div', { className:`${NS}-h2` }, t('master.title')),
          h(ProjectEditor, { key:`${detail.project.id}:${detail.project.masterRevision || 0}`, project:detail.project, t, disabled:busy || running,
            onSave:(patch) => act(async () => {
              await call('/api/dsh-handshake/project',{projectId:detail.project.id,patch});
              if (ready) await call('/api/dsh-handshake/refresh',{taskId:task.id});
            }) }),
          h('div', { className:`${NS}-muted` }, t('receipt.hint')),
          h('details', { className:`${NS}-history` },
            h('summary', null, t('task.evidence')),
            h(RelayTimeline,{relay:detail.task.relay}),
            h('pre', { className:`${NS}-pre` },detail.promptPreview || '(empty)'),
            detail.task.execution?.logFile ? h('div',{className:`${NS}-path`},detail.task.execution.logFile) : null)) : null,
        confirming ? h(ConfirmDialog, { title:t('action.execute'), message:t('dialog.execute',{target:targetName,n:task.revision || 1}),
          confirmLabel:t('action.execute'),cancelLabel:t('common.no'),onCancel:() => setConfirming(false),
          onConfirm:() => { setConfirming(false); void act(() => call('/api/dsh-handshake/execute',{taskId:task.id,expectedRevision:task.revision ?? 0})); },
        }) : null);
    }

    /* One shared candidate component gives both columns identical geometry. */
    function CandidateCard({ item, kind, t, onChanged }) {
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const request = useRef(false);
      const id = item.sessionId || item.file;
      const create = async () => {
        if (request.current) return;
        request.current = true; setBusy(true); setError(null);
        try {
          await call('/api/dsh-handshake/convert', kind === 'codex'
            ? { kind, rolloutFile: item.file }
            : { kind, sessionId: item.sessionId });
          await onChanged();
        } catch (e) { setError(String(e?.message ?? e)); }
        request.current = false; setBusy(false);
      };
      return h('article', { className: `${NS}-card ${NS}-card-fixed ${NS}-card-${kind}`, 'data-session-id': `${kind}:${id}`, 'data-project-key': `${kind}:${item.projectId || item.projectKey || item.projectDir}` },
        h('div', { className: `${NS}-between` },
          h('span', { className: `${NS}-proj`, title: item.projectDir }, projectName(item.projectDir)),
          h(ClientChip, { client: kind })),
        h('div', { className: `${NS}-title2`, title: t('project.latest', { title: item.title }) }, t('project.latest', { title: item.title })),
        h('div', { className: `${NS}-path`, title: item.projectDir }, item.projectDir || '—'),
        h('div', { className: `${NS}-between ${NS}-candidate-note` },
          error ? h('span', { className: `${NS}-err`, title: error, role: 'alert' }, error)
            : h('span', { className: `${NS}-muted` }, fmtTime(item.lastActivity)),
          h('span', { className: `${NS}-path`, title: id }, t('project.sessions', { n: item.sessionCount || 1 }))),
        h(Btn, { label: t('action.createRelay'), disabled: busy, onClick: () => void create() }));
    }

    function Board({ t }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const latestRequest = useRef(0);
      const mounted = useRef(true);
      const reload = useCallback(async () => {
        const request = ++latestRequest.current;
        try {
          const next = await call('/api/dsh-handshake/board');
          if (mounted.current && request === latestRequest.current) { setData(next); setError(null); }
        } catch (e) {
          if (mounted.current && request === latestRequest.current) setError(String(e?.message ?? e));
        }
      }, []);
      useEffect(() => {
        mounted.current = true;
        let timer;
        const tick = async () => {
          await reload();
          if (mounted.current) timer = setTimeout(tick, 5000);
        };
        void tick();
        return () => { mounted.current = false; clearTimeout(timer); };
      }, [reload]);
      const tasks = data?.tasks ?? [];
      const active = tasks.filter((task) => task.status !== 'done');
      const completed = tasks.filter((task) => task.status === 'done');
      const codex = data?.codexThreads ?? [];
      const dsh = data?.dshSessions ?? [];
      const heading = (kind, label, count) => h('div', { className: `${NS}-pending-head` },
        h('span', { className: `${NS}-mark ${NS}-mark-${kind}`, 'aria-hidden': true }, kind === 'codex' ? 'C' : 'D'),
        h('div', null, h('strong', null, label), h('div', { className: `${NS}-muted` }, t(`zone.${kind}Hint`))),
        h('span', { className: `${NS}-count` }, count));
      return h('div', { className: `${NS}-wrap` },
        h(Styles),
        h('header', { className: `${NS}-header` },
          h(Icon, { size: 26 }), h('h1', null, t('board.title')), h('span', { className: `${NS}-version` }, 'v0.1'),
          h(Btn, { label: t('board.refresh'), onClick: () => void reload() })),
        error ? h('div', { className: `${NS}-err`, role: 'alert' }, error) : null,
        !data ? h('div', { className: `${NS}-muted` }, t('board.loading')) : null,
        h('section', { className: `${NS}-zone-relay`, 'aria-label': t('zone.relay') },
          h('div', { className: `${NS}-section-title` }, t('zone.relay'), h('span', { className: `${NS}-count` }, active.length)),
          active.length ? h('div', { className: `${NS}-relay-grid` }, ...active.map((task) => h(TaskCard, { key: task.id, task, t, onChanged: reload })))
            : h('div', { className: `${NS}-muted` }, t('board.empty')),
          completed.length ? h('details', { className: `${NS}-history` },
            h('summary', null, `${t('board.history')} · ${completed.length}`),
            h('div', { className: `${NS}-relay-grid` }, ...completed.map((task) => h(TaskCard, { key: task.id, task, t, onChanged: reload })))) : null),
        h('section', { className:`${NS}-pending`, 'aria-label':t('board.pending') },
          h('div',{className:`${NS}-section-title`},t('board.pending')),
          h('div',{className:`${NS}-pending-columns`},
            ...[['codex',codex],['dsh',dsh]].map(([kind,items]) => h('section',{
              key:kind,className:`${NS}-pending-column ${NS}-pending-column-${kind}`,'aria-label':kind === 'codex' ? 'Codex' : 'DSH',
            },heading(kind,t(kind === 'codex' ? 'zone.codexLib' : 'zone.dshLib'),items.length),
              ...items.map((item) => h(CandidateCard,{key:item.projectId || item.projectId || item.projectKey || item.projectDir,item,kind,t,onChanged:reload})),
              !items.length ? h('div',{className:`${NS}-empty`},t(kind === 'codex' ? 'board.noThreads' : 'board.noSessions')) : null)))),
        data?.home ? h('div', { className: `${NS}-path`, title: data.home }, `${t('board.home')}: ${data.home}`) : null);
    }

    /* ---------------- session view tab (beside 对话/轨迹): two-click flow ---------------- */
    function SessionRelayView({ sessionId, t, openBoard }) {
      const [task, setTask] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [confirming, setConfirming] = useState(false);

      const convert = async () => {
        setBusy(true); setError(null);
        try {
          const result = await call('/api/dsh-handshake/convert', { kind: 'dsh', sessionId });
          setTask(result.task);
        } catch (e) { setError(String(e?.message ?? e)); }
        setBusy(false);
      };
      const execute = async () => {
        setBusy(true); setError(null);
        try {
          const result = await call('/api/dsh-handshake/execute', { taskId: task.id, expectedRevision: task.revision ?? 0 });
          setTask(result.task);
        } catch (e) { setError(String(e?.message ?? e)); }
        setBusy(false);
      };

      return h('div', { className: `${NS}-wrap` },
        h(Styles),
        h('div', { className: `${NS}-h2` }, t('header.title')),
        h('div', { className: `${NS}-muted` }, t('header.hint')),
        error !== null ? h('div', { className: `${NS}-err` }, t('common.error', { message: error })) : null,
        h('div', { className: `${NS}-card ${NS}-card-dsh` },
          h('div', { className: `${NS}-row` },
            h(ClientChip, { client: 'dsh' }),
            h('span', { className: `${NS}-muted` }, sessionId || '')),
          task === null
            ? h(Btn, {
                label: t('action.createRelay'),
                tone: 'primary',
                disabled: busy || !sessionId,
                onClick: () => void convert(),
              })
            : h('div', { className: `${NS}-row` },
                h(Badge, { tone: task.status === 'executing' ? 'warn' : 'brand' }, t(`task.status.${task.status}`)),
                h('span', { className: `${NS}-proj` }, projectName(task.projectDir)),
                task.status === 'staged'
                  ? h(Btn, {
                      label: t('action.execute'),
                      tone: 'primary',
                      disabled: busy,
                      onClick: () => setConfirming(true),
                    })
                  : null,
                h(Btn, {
                  label: t('action.openBoard'),
                  onClick: () => { if (typeof openBoard === 'function') openBoard(); },
                }))),
        confirming
          ? h(ConfirmDialog, {
              title: t('action.execute'),
              message: t('dialog.execute', { target: task?.target === 'dsh' ? 'DSH' : 'Codex', n:task?.revision || 1 }),
              confirmLabel: t('action.execute'),
              cancelLabel: t('common.no'),
              onConfirm: () => { setConfirming(false); void execute(); },
              onCancel: () => setConfirming(false),
            })
          : null);
    }

    /* Optical 24px handshake: two sleeves and an open central clasp; no tiny finger mesh. */
    function Icon({ size }) {
      return h('svg', { viewBox: '0 0 24 24', width: size || 16, height: size || 16,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'm2 9 3-5 4 2-4 7-3-2m20-2-3-5-4 2 4 7 3-2' }),
        h('path', { d: 'M8.5 7h2.3l1.3-1h2.7l3.4 6.3-4.9 5a2 2 0 0 1-2.6.2L5.8 13' }),
        h('path', { d: 'm12.1 6-3.8 4a1.4 1.4 0 0 0 2 2l1.8-1.8 4.4 3.8M8.5 15l1.7-1.7m.9 3.4 1.6-1.6' }));
    }

    /* ---------------- module entry ---------------- */
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-handshake: dictionaries');
        const t = ctx.locale.bind(NS);

        let layout;
        try {
          ctx.inject(['layout'], (scoped) => { layout = scoped.layout; });
        } catch { /* host without layout: the board button degrades gracefully */ }
        const openBoard = () => {
          try { layout?.selectPanel?.(PANEL_ID); } catch { /* ignore */ }
        };

        const offs = [];
        offs.push(ctx.slots.inject('sidebar.panellist', () => {
          const offPanel = ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ t }),
          }, () => h(Board, { t }));
          const offRow = ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 60,
            label: () => t('nav'),
            locale: NS,
          }, (owner) => h(Icon, { size: owner && owner.size ? owner.size : 16 }));
          return () => {
            try { if (typeof offPanel === 'function') offPanel(); } catch { /* ignore */ }
            try { if (typeof offRow === 'function') offRow(); } catch { /* ignore */ }
          };
        }));
        offs.push(ctx.slots.inject('conversation.view', () =>
          ctx.slots.register({
            name: 'conversation.view',
            id: 'dsh-handshake',
            order: 40,
            locale: NS,
            label: () => t('tab.relay'),
          }, (props) => h(SessionRelayView, {
            sessionId: (props && (props.sessionId ?? (props.session && props.session.id))) || '',
            t,
            openBoard,
          }))));

        ctx.effect(() => () => {
          for (const off of offs) {
            try { if (typeof off === 'function') off(); } catch { /* ignore */ }
          }
        }, 'dsh-handshake: slot registrations');
      },
    };
  },
});
