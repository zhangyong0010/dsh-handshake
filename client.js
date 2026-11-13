window.__ModuleLoader__.load({
  id: '@local/dsh-handshake',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const NS = 'dsh-handshake';
    const PANEL_ID = 'dsh-handshake';

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
      'task.status.unknown':'状态待核实', 'receipt.host-checked':'宿主已校验资料',
      'task.related':'项目内其他接力任务', 'task.brief':'接力简报', 'task.result':'本轮结果',
      'task.changes':'工作区变化', 'task.checks':'执行证据', 'task.remaining':'报告的剩余事项',
      'task.reportMissing':'接收端未返回可解析的结果，请查看运行记录。',
      'task.releaseUnknown':'核对后结束本轮', 'task.releaseUnknownConfirm':'我已检查目标会话，结束本轮',
      'scope.read-only':'只读审查', 'scope.workspace-write':'工作区可写', 'scope.conflict':'执行范围待明确',
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
      'task.status.unknown':'Status unconfirmed', 'receipt.host-checked':'Documents checked by host',
      'task.related':'Other handoffs in this project', 'task.brief':'Handoff brief', 'task.result':'Round result',
      'task.changes':'Workspace changes', 'task.checks':'Execution evidence', 'task.remaining':'Reported remaining work',
      'task.reportMissing':'The receiver returned no structured result. See the run records.',
      'task.releaseUnknown':'Resolve unconfirmed run', 'task.releaseUnknownConfirm':'I checked the target chat. End this run.',
      'scope.read-only':'Read-only review', 'scope.workspace-write':'Workspace write access', 'scope.conflict':'Execution scope needs clarification',
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
    Object.assign(zh, {
      'action.start':'开始接力', 'action.handoff':'接力到 {target}', 'action.switchSource':'切换到 {source} 来源',
      'action.openCodex':'在 Codex 中打开', 'action.addNote':'补一句', 'action.saveNote':'更新本轮简报',
      'master.title':'长期项目规则', 'master.save':'保存长期规则',
      'task.changes':'改了什么', 'task.checks':'验证了什么', 'task.remaining':'还差什么',
      'task.noChanges':'未发现文件变化', 'task.noChecks':'暂无可核实的执行证据', 'task.noRemaining':'未报告剩余事项',
      'task.workspaceUnknown':'无法读取本轮文件变化', 'task.reported':'接收端报告', 'task.nextStep':'建议下一步',
      'task.runningOn':'{target} 正在执行', 'task.localHint':'在 DSH 看进度', 'task.prepare':'正在准备简报…',
      'zone.codexLib':'Codex 待接力', 'zone.dshLib':'DSH 待接力', 'zone.relay':'接力',
      'dialog.workspace':'工作目录', 'dialog.scope':'执行范围',
      'review.section':'独立审查与复验', 'review.action':'启动 Codex 只读审查', 'review.confirm':'确认启动独立审查',
      'review.running':'审查中', 'review.complete':'审查结束', 'review.failed':'审查失败', 'review.unknown':'审查状态待核实',
      'cloud.prepare':'生成云端复验说明', 'cloud.open':'打开 Codex Cloud', 'cloud.hint':'在云端选定仓库后，粘贴说明并补充验收命令。',
    });
    Object.assign(en, {
      'action.start':'Start handoff', 'action.handoff':'Hand off to {target}', 'action.switchSource':'Use {source} as source',
      'action.openCodex':'Open in Codex', 'action.addNote':'Add a note', 'action.saveNote':'Update this brief',
      'master.title':'Project rules', 'master.save':'Save project rules',
      'task.changes':'What changed', 'task.checks':'What was checked', 'task.remaining':'What remains',
      'task.noChanges':'No file changes observed', 'task.noChecks':'No execution evidence available', 'task.noRemaining':'No remaining work reported',
      'task.workspaceUnknown':'File changes could not be read', 'task.reported':'Receiver report', 'task.nextStep':'Suggested next step',
      'task.runningOn':'{target} is running', 'task.localHint':'Follow progress in DSH', 'task.prepare':'Preparing handoff…',
      'zone.codexLib':'Codex sources', 'zone.dshLib':'DSH sources', 'zone.relay':'Handoffs',
      'dialog.workspace':'Working directory', 'dialog.scope':'Execution scope',
      'review.section':'Independent review and verification', 'review.action':'Start read-only Codex review', 'review.confirm':'Confirm independent review',
      'review.running':'Review running', 'review.complete':'Review finished', 'review.failed':'Review failed', 'review.unknown':'Review status unconfirmed',
      'cloud.prepare':'Prepare cloud verification instructions', 'cloud.open':'Open Codex Cloud', 'cloud.hint':'Choose your repository in Cloud, then paste the instructions and provide the verification commands.',
    });

    Object.assign(zh, {
      'board.empty':'选一个项目接力，确认后开始。', 'board.search':'搜索项目或会话', 'board.history':'历史', 'board.hidden':'隐藏项目',
      'board.noResults':'没有匹配的项目。', 'board.noHistory':'还没有归档的接力。', 'board.noHidden':'没有隐藏的项目。',
      'board.showAll':'查看全部（{n}）', 'board.showLess':'收起', 'task.status.awaiting-review':'本轮结束 · 待确认',
      'task.status.done':'已验收', 'task.status.unknown':'待核实', 'task.status.staged':'待启动', 'task.status.executing':'{target} 执行中',
      'action.more':'更多操作', 'action.sessions':'选择来源会话', 'action.otherSessions':'从其他会话接力',
      'action.hide':'隐藏此项目', 'action.restore':'恢复', 'action.undo':'撤销', 'action.archive':'归档此接力',
      'action.finishArchive':'完成并归档', 'action.viewResult':'查看结果', 'action.openSession':'打开 {client} 会话',
      'action.checkAgain':'重新检查', 'action.sourceStopped':'已确认来源停止，开始接力', 'action.replaceTarget':'准备新会话',
      'dialog.newSession':'将在 {client} 的现有项目目录内新建会话。', 'dialog.resumeSession':'将继续原 {client} 会话。',
      'dialog.rules':'本轮约束', 'dialog.acceptance':'待验收', 'dialog.noteScope':'让这条补充随任务继续', 'dialog.technical':'工作区与接力详情', 'dialog.sourceClues':'原会话里的要求线索', 'dialog.latest':'最新要求',
      'task.archived':'接力已归档。', 'task.hidden':'项目已隐藏。', 'task.restored':'已恢复。', 'task.loadingDetail':'正在读取结果…',
      'task.openUnavailable':'尚未找到可打开的关联会话。', 'task.checked':'{n} 项命令已通过', 'task.checkFailed':'{n} 项命令未通过',
      'task.checkObserved':'已记录 {n} 项工具检查', 'task.resultMissing':'接收端未返回结构化结果，可打开会话核对。',
    });
    Object.assign(en, {
      'board.empty':'Choose a project to hand off. It starts after you confirm.', 'board.search':'Search projects or sessions', 'board.history':'History', 'board.hidden':'Hidden projects',
      'board.noResults':'No matching projects.', 'board.noHistory':'No archived handoffs.', 'board.noHidden':'No hidden projects.',
      'board.showAll':'Show all ({n})', 'board.showLess':'Show less', 'task.status.awaiting-review':'Round ended · Review needed',
      'task.status.done':'Accepted', 'task.status.unknown':'Check required', 'task.status.staged':'Ready', 'task.status.executing':'Running in {target}',
      'action.more':'More actions', 'action.sessions':'Choose source session', 'action.otherSessions':'Hand off a different session',
      'action.hide':'Hide this project', 'action.restore':'Restore', 'action.undo':'Undo', 'action.archive':'Archive this handoff',
      'action.finishArchive':'Accept and archive', 'action.viewResult':'View result', 'action.openSession':'Open {client} session',
      'action.checkAgain':'Check again', 'action.sourceStopped':'Source stopped · Start handoff', 'action.replaceTarget':'Prepare a new session',
      'dialog.newSession':'A new {client} session will use the existing project directory.', 'dialog.resumeSession':'The original {client} session will resume.',
      'dialog.rules':'Constraints', 'dialog.acceptance':'Acceptance checks', 'dialog.noteScope':'Carry this note into later rounds', 'dialog.technical':'Workspace and handoff details', 'dialog.sourceClues':'Requirements found in source conversations', 'dialog.latest':'Latest request',
      'task.archived':'Handoff archived.', 'task.hidden':'Project hidden.', 'task.restored':'Restored.', 'task.loadingDetail':'Loading result…',
      'task.openUnavailable':'No linked session is available to open.', 'task.checked':'{n} commands passed', 'task.checkFailed':'{n} commands failed',
      'task.checkObserved':'{n} tool checks recorded', 'task.resultMissing':'No structured result was returned. Open the session to review.',
    });

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
        throw Object.assign(new Error(payload?.error || `HTTP ${response.status}`), {
          code:payload?.code, client:payload?.client, stopToken:payload?.stopToken,
        });
      }
      return payload;
    }

    const CSS = `
.${NS}-wrap { --hs-green:var(--dsw-alias-state-success-primary,#258454); --hs-codex:light-dark(#7044b5,#c7afff); --hs-dsh:light-dark(#2463ad,#91bdff); display:flex; flex-direction:column; gap:12px; padding:0 16px 18px; height:100%; min-width:0; overflow:auto; box-sizing:border-box; color:var(--dsw-alias-label-primary); font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; container-type:inline-size; }
.${NS}-wrap * { box-sizing:border-box; }
.${NS}-wrap .${NS}-wrap { padding:0; height:auto; overflow:visible; }
.${NS}-header { display:flex; align-items:center; gap:12px; }
.${NS}-header h1 { font-size:21px; letter-spacing:-.5px; margin:0; font-weight:650; }
.${NS}-version { font-size:12px; color:var(--dsw-alias-label-secondary); }
.${NS}-h2 { font-size:14px; font-weight:650; margin:0; }
.${NS}-muted { color:var(--dsw-alias-label-secondary); font-size:11px; }
.${NS}-zone-relay { border:1px solid color-mix(in srgb,var(--hs-green) 50%,var(--dsw-alias-border-l1)); background:color-mix(in srgb,var(--hs-green) 4%,var(--dsw-alias-bg-base)); border-radius:14px; padding:10px; display:flex; flex-direction:column; gap:8px; }
.${NS}-section-title { display:flex; align-items:center; gap:9px; font-size:15px; font-weight:650; }
.${NS}-count { font-size:11px; font-weight:600; padding:1px 7px; border-radius:6px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); }
.${NS}-zone-relay > .${NS}-section-title .${NS}-count { color:var(--hs-green); background:color-mix(in srgb,var(--hs-green) 10%,var(--dsw-alias-bg-base)); }
.${NS}-relay-grid,.${NS}-pending-columns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.${NS}-pending { display:flex; flex-direction:column; gap:12px; }
.${NS}-pending-column { --hs-client:var(--hs-codex); min-width:0; padding:8px; border:1px solid color-mix(in srgb,var(--hs-client) 35%,var(--dsw-alias-border-l1)); border-top:3px solid var(--hs-client); border-radius:12px; background:color-mix(in srgb,var(--hs-client) 5%,var(--dsw-alias-bg-base)); display:flex; flex-direction:column; gap:6px; }
.${NS}-pending-column-dsh { --hs-client:var(--hs-dsh); }
.${NS}-pending-columns { gap:22px; position:relative; }
.${NS}-pending-columns::after { content:''; position:absolute; left:50%; top:0; bottom:0; border-left:1px solid var(--dsw-alias-border-l2); pointer-events:none; }
.${NS}-pending-head { display:flex; align-items:center; gap:10px; padding:0 2px 5px; min-height:25px; flex:none; border-bottom:1px solid color-mix(in srgb,var(--hs-client) 25%,var(--dsw-alias-border-l1)); }
.${NS}-pending-head strong { font-size:13px; font-weight:650; color:var(--hs-client); }
.${NS}-pending-head .${NS}-count { margin-left:auto; }
.${NS}-pending-column > .${NS}-card { border-left:3px solid color-mix(in srgb,var(--hs-client) 65%,transparent); }
.${NS}-card-codex { --hs-client:var(--hs-codex); }
.${NS}-card-dsh { --hs-client:var(--hs-dsh); }
.${NS}-pending-column .${NS}-card-fixed .${NS}-btn { color:var(--hs-client); border-color:color-mix(in srgb,var(--hs-client) 40%,var(--dsw-alias-border-l1)); }
.${NS}-task-card[data-open=true] { grid-column:1/-1; }
.${NS}-card { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:11px; padding:7px 9px; display:flex; flex-direction:column; gap:4px; min-width:0; }
.${NS}-task-card { border-left:3px solid var(--hs-green); }
.${NS}-relay-grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); }
.${NS}-card:hover { border-color:var(--dsw-alias-border-l2); }
.${NS}-card .${NS}-proj { font-size:14px; font-weight:650; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-title2 { font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow-wrap:anywhere; }
.${NS}-path { font:10px/16px ui-monospace,SFMono-Regular,monospace; color:var(--dsw-alias-label-secondary); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.${NS}-between { display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:0; }
.${NS}-result { display:grid; grid-template-columns:1fr; gap:9px; }
.${NS}-result > div { min-width:0; padding:8px; border-radius:6px; background:var(--dsw-alias-bg-layer-2); overflow-wrap:anywhere; }
.${NS}-result strong { display:block; font-size:11px; }
.${NS}-note { display:grid; gap:6px; }
.${NS}-note textarea { width:100%; min-height:68px; font:inherit; color:inherit; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l2); border-radius:6px; padding:7px; resize:vertical; }
.${NS}-confirm-cwd { white-space:normal; overflow-wrap:anywhere; }
.${NS}-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:7px; padding:5px 10px; min-height:30px; font-family:inherit; font-size:12px; font-weight:500; line-height:18px; cursor:pointer; transition:background .12s,border-color .12s; }
.${NS}-btn:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-label-secondary); }
.${NS}-btn:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }
.${NS}-btn:disabled { opacity:.5; cursor:default; }
.${NS}-btn-primary { color:var(--hs-green); border-color:color-mix(in srgb,var(--hs-green) 55%,var(--dsw-alias-border-l1)); background:color-mix(in srgb,var(--hs-green) 7%,var(--dsw-alias-bg-layer-1)); }
.${NS}-btn-primary:hover { background:color-mix(in srgb,var(--hs-green) 13%,var(--dsw-alias-bg-layer-1)); border-color:var(--hs-green); }
.${NS}-btn-danger { color:var(--dsw-alias-label-secondary); border-color:transparent; }
.${NS}-btn-danger:hover { color:var(--dsw-alias-state-error-primary); }
.${NS}-badge { display:inline-flex; align-items:center; border-radius:6px; padding:2px 7px; font-size:11px; white-space:nowrap; background:var(--dsw-alias-bg-layer-2); }
.${NS}-b-idle { color:var(--dsw-alias-label-secondary); }
.${NS}-b-ok,.${NS}-b-brand { color:var(--hs-green); background:color-mix(in srgb,var(--hs-green) 9%,var(--dsw-alias-bg-layer-1)); }
.${NS}-b-err { color:var(--dsw-alias-state-error-primary); }
.${NS}-chip { display:inline-flex; align-items:center; gap:5px; border-radius:5px; padding:1px 6px; font-size:10px; font-weight:600; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); white-space:nowrap; }
.${NS}-chip-codex { color:var(--hs-codex); background:color-mix(in srgb,var(--hs-codex) 12%,var(--dsw-alias-bg-layer-1)); }
.${NS}-chip-dsh { color:var(--hs-dsh); background:color-mix(in srgb,var(--hs-dsh) 12%,var(--dsw-alias-bg-layer-1)); }
.${NS}-chip-none { color:var(--dsw-alias-label-secondary); background:transparent; }
.${NS}-modal-backdrop { position:fixed; inset:0; background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent); z-index:120; display:grid; place-items:center; }
.${NS}-modal { max-height:calc(100vh - 32px); overflow:auto; background:var(--dsw-alias-bg-overlay); border:1px solid var(--dsw-alias-border-l2); border-radius:14px; padding:22px; width:480px; max-width:calc(100vw - 32px); display:flex; flex-direction:column; gap:11px; }
.${NS}-timeline { display:flex; flex-direction:column; gap:8px; border-left:1px solid var(--dsw-alias-border-l2); padding-left:10px; }
.${NS}-tl-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--dsw-alias-label-secondary); }
.${NS}-detail { border-top:1px solid var(--dsw-alias-border-l1); padding-top:14px; display:flex; flex-direction:column; gap:10px; }
.${NS}-pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:240px; overflow:auto; font:11px/1.6 ui-monospace,monospace; background:var(--dsw-alias-bg-layer-2); border-radius:7px; padding:12px; margin:0; }
.${NS}-err { color:var(--dsw-alias-state-error-primary); font-size:11px; overflow-wrap:anywhere; }
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
 .${NS}-header h1 { font-size:18px; }
}

.${NS}-toolbar { position:sticky; top:0; z-index:4; display:flex; flex-wrap:wrap; align-items:center; gap:7px; background:var(--dsw-alias-bg-base); padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.${NS}-toolbar .${NS}-header { gap:7px; }
.${NS}-toolbar h1 { font-size:16px; white-space:nowrap; }
.${NS}-search { flex:1 1 150px; min-width:110px; height:30px; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; padding:0 9px; font:inherit; color:inherit; background:var(--dsw-alias-bg-layer-1); }
.${NS}-relay-grid,.${NS}-pending-columns { gap:8px 12px; }
.${NS}-card-fixed { display:flex; min-height:66px; height:auto; justify-content:center; }
.${NS}-card-fixed .${NS}-btn { width:auto; display:inline-block; }
.${NS}-compact { display:flex; align-items:center; gap:7px; min-width:0; }
.${NS}-compact-text { min-width:0; flex:1; }
.${NS}-compact-text .${NS}-proj { display:block; font-size:13px; }
.${NS}-compact-text .${NS}-title2 { display:block; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-compact .${NS}-btn { white-space:nowrap; padding-inline:7px; }
.${NS}-task-card .${NS}-compact { flex-wrap:wrap; }
.${NS}-task-card .${NS}-compact-text { flex-basis:120px; }
.${NS}-menu { position:relative; flex:none; }
.${NS}-menu > summary { display:grid; place-items:center; width:30px; padding:0; list-style:none; font-size:16px; }
.${NS}-menu > summary::-webkit-details-marker { display:none; }
.${NS}-menu[open] > summary { background:var(--dsw-alias-bg-layer-2); }
.${NS}-menu-pop { position:absolute; z-index:3; inset-inline-end:0; top:calc(100% + 4px); min-width:185px; width:max-content; max-width:min(300px,75vw); display:grid; gap:3px; padding:6px; background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base)); border:1px solid var(--dsw-alias-border-l2); border-radius:8px; box-shadow:0 6px 24px #0003; }
.${NS}-menu-pop button { width:100%; text-align:left; white-space:normal; overflow-wrap:anywhere; }
.${NS}-menu-pop details > div { display:grid; max-height:38vh; overflow:auto; gap:3px; }
.${NS}-tabs { display:none; }
.${NS}-detail summary:focus-visible,.${NS}-menu summary:focus-visible,.${NS}-search:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.${NS}-compact-line { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.${NS}-brief { display:grid; gap:8px; min-width:0; overflow-wrap:anywhere; }
.${NS}-brief-row { display:grid; gap:2px; }
.${NS}-brief-row strong { font-size:11px; color:var(--dsw-alias-label-secondary); }
.${NS}-brief-preview { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.${NS}-brief ul { margin:0; padding-inline-start:18px; }
.${NS}-feedback { display:flex; align-items:center; gap:8px; min-width:0; }
@container (max-width:620px) {
 .${NS}-pending-columns { grid-template-columns:minmax(0,1fr); }
 .${NS}-pending-columns::after,.${NS}-pending-column[data-current=false] { display:none; }
 .${NS}-tabs { display:flex; }
 .${NS}-tabs [aria-pressed=true] { border-color:currentColor; }
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

    function ConfirmDialog({ title, message, children, confirmLabel, cancelLabel, onConfirm, onCancel, busy }) {
      const dialogRef = useRef(null);
      const cancelRef = useRef(onCancel);
      cancelRef.current = onCancel;
      useEffect(() => {
        const previous = document.activeElement;
        dialogRef.current?.querySelector('[data-cancel]')?.focus();
        const onKey = (event) => {
          if (event.key === 'Escape') cancelRef.current();
          if (event.key === 'Tab') {
            const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary') ?? [])].filter((item) => item.getClientRects().length);
            if (!controls.length) return;
            const first = controls[0], last = controls[controls.length - 1];
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
          message ? h('div', { className: `${NS}-muted` }, message) : null,
          children,
          h('div', { className: `${NS}-row` },
            h(Btn, { label: confirmLabel, tone: 'primary', onClick: onConfirm, disabled:busy }),
            h('button', { type:'button', 'data-cancel':true, className:`${NS}-btn`, onClick:onCancel }, cancelLabel))));
    }

    function projectName(path) {
      if (!path) return '—';
      const parts = String(path).replace(/\/+$/, '').split('/');
      return parts[parts.length - 1] || String(path);
    }

    function fmtTime(iso) {
      if (!iso) return '—';
      try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
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
    function ProjectEditor({ project, t, disabled, onSave }) {
      const [draft, setDraft] = useState(() => ({
        goal:project.goal || '', constraints:(project.constraints || []).join('\n'),
        decisions:(project.decisions || []).join('\n'), verify:(project.verify || []).join('\n'), notes:project.notes || '',
      }));
      const fields = ['goal','constraints','decisions','verify','notes'];
      const original = { goal: project.goal || '', constraints: (project.constraints || []).join('\n'), decisions: (project.decisions || []).join('\n'), verify: (project.verify || []).join('\n'), notes: project.notes || '' };
      const changes = Object.fromEntries(fields.filter((key) => draft[key] !== original[key]).map((key) => [key, ['constraints','decisions','verify'].includes(key) ? draft[key].split('\n') : draft[key]]));
      return h('div', { className:`${NS}-master` },
        h('div', { className:`${NS}-wide ${NS}-muted` }, t('master.hint')),
        !project.goalConfirmed ? h('div', { className:`${NS}-wide ${NS}-muted` }, t('master.prefill')) : null,
        ...fields.map((key) => h('label', { key, className:key === 'goal' || key === 'notes' ? `${NS}-wide` : '' },
          t(`master.${key}`), h('textarea', { value:draft[key], disabled, 'aria-label':t(`master.${key}`),
            onChange:(event) => setDraft({...draft,[key]:event.target.value}) }))),
        h('div', { className:`${NS}-wide` }, h(Btn, { label:t('master.save'), disabled:disabled || !Object.keys(changes).length, onClick:() => onSave(changes) })));
    }

    const clientName = (kind) => kind === 'codex' ? 'Codex' : 'DSH';
    const otherClient = (kind) => kind === 'codex' ? 'dsh' : 'codex';
    const desktop = () => typeof document !== 'undefined' && new URL(document.baseURI).protocol === 'dsh-app:';
    const sessionKey = (session) => session.kind + ':' + (session.sessionId || session.file);
    const prepareSession = (onPrepare, session) => onPrepare('convert', session.kind === 'codex'
      ? { kind:session.kind, rolloutFile:session.file } : { kind:session.kind, sessionId:session.sessionId });
    const archiveBinding = (task) => ({ taskId:task.id, revision:task.revision, runId:task.runId ?? null });
    const canOpen = (task, kind, openDsh) => kind === 'codex' ? desktop() && task.canOpenCodex : Boolean(openDsh && task.sessions?.dsh);

    async function openSession(task, kind, openDsh, source = false) {
      const response = await call('/api/dsh-handshake/open-'+kind, { taskId:task.id, role:source ? 'source' : undefined });
      if (kind === 'dsh') openDsh(response.sessionId);
    }

    function More({ t, children }) {
      const ref = useRef(null);
      useEffect(() => {
        const close = (event) => { if (!ref.current?.contains(event.target) && ref.current) ref.current.open = false; };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
      }, []);
      return h('details',{ ref, className:'dsh-handshake-menu', onKeyDown:(event) => {
        if (event.key === 'Escape' && ref.current?.open) {
          event.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary')?.focus();
        }
      }},
        h('summary',{className:'dsh-handshake-btn','aria-label':t('action.more'),title:t('action.more')},'⋯'),
        h('div',{className:'dsh-handshake-menu-pop',onClick:(event) => {
          if (event.target.closest('button')) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); }
        }}, children));
    }

    function SessionChoices({ sources, label, t, onSelect }) {
      const sessions = sources.flatMap((source) => source.sessions ?? [source]);
      if (!sessions.length) return null;
      return h('details', { className:'dsh-handshake-history' }, h('summary',null,label),
        h('div',null,...sessions.map((session) => h(Btn, { key:sessionKey(session),
          label:clientName(session.kind) + ' · ' + session.title + (session.lastActivity ? ' · ' + fmtTime(session.lastActivity) : ''),
          title:session.projectDir, onClick:() => onSelect(session) }))));
    }

    function CompactTitle({ name, title }) {
      return h('div',{className:'dsh-handshake-compact-text'},
        h('span',{className:'dsh-handshake-proj',title:name},name),
        h('span',{className:'dsh-handshake-title2',title},title));
    }

    function HandoffBrief({ brief, cwd, revision, t }) {
      if (!brief) return null;
      const constraints = [...new Set([...(brief.explicitRules ?? []), ...(brief.inheritedNotes ?? []).map((item) => item.text), brief.clarification].filter(Boolean))];
      const row = (label,value) => value ? h('div',{className:'dsh-handshake-brief-row'},h('strong',null,label),value) : null;
      const list = (items) => items?.length ? h('ul',null,...items.map((item,index) => h('li',{key:index},item))) : null;
      const preview = (text) => text ? h('span',{className:'dsh-handshake-brief-preview',title:text},text) : null;
      const sourceClues = [...new Set([...(brief.recentConstraints ?? []),...(brief.suggestedAcceptance ?? [])].map((entry)=>entry.text))];
      const currentClues = [...new Set([...(brief.recentConstraints ?? []),...(brief.suggestedAcceptance ?? [])]
        .filter((entry)=>entry.sourceEntry === brief.latestSourceId && !constraints.includes(entry.text) && !brief.acceptance?.includes(entry.text))
        .map((entry)=>entry.text))];
      return h('div', { className:'dsh-handshake-brief' },
        row(t('dialog.latest'), preview(brief.latestRequest || brief.goal)),
        row(t('task.nextStep'), preview(brief.nextStep !== brief.latestRequest && brief.nextStep)),
        row(t('dialog.rules'), preview(constraints.slice(0,3).join(' · '))),
        row(t('dialog.acceptance'), preview(brief.acceptance?.slice(0,3).join(' · '))),
        row(t('dialog.sourceClues'),preview(currentClues.slice(0,2).join(' · '))),
        brief.mode && brief.mode !== 'workspace-write' ? h(Badge,null,t('scope.'+brief.mode)) : null,
        h('details',{className:'dsh-handshake-history'}, h('summary',null,t('dialog.technical')),
          h('div',null,t('round',{n:revision}), ' · ', brief.mode ? t('scope.'+brief.mode) : ''),
          h('div',{className:'dsh-handshake-path dsh-handshake-confirm-cwd'},cwd),
          brief.goal ? h('div',null,brief.goal) : null,
          brief.latestRequest && brief.latestRequest !== brief.goal ? row(t('dialog.latest'),brief.latestRequest) : null,
          row(t('dialog.rules'),list(constraints)), row(t('dialog.acceptance'),list(brief.acceptance)),
          list(brief.remaining),
          row(t('dialog.sourceClues'),list(sourceClues))));
    }

    function StartHandoff({ summary: initial, t, onClose, onChanged, onStarted, openDsh }) {
      const [task, setTask] = useState(initial);
      const [draft, setDraft] = useState(task.brief?.clarification ?? '');
      const [persist, setPersist] = useState(!task.brief?.clarification || task.brief.clarificationScope === 'task');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const changedNote = draft.trim() !== (task.brief?.clarification ?? '') ||
        (Boolean(draft.trim()) && persist !== (task.brief?.clarificationScope === 'task'));
      const binding = { taskId:task.id, expectedRevision:task.revision, expectedDigest:task.packetDigest };
      const resetTask = (next) => {
        setTask(next); setDraft(next.brief?.clarification ?? '');
        setPersist(!next.brief?.clarification || next.brief.clarificationScope === 'task');
      };
      const update = async (route, body) => {
        setBusy(true); setError(null);
        try {
          const result = await call('/api/dsh-handshake/'+route, body);
          if (route === 'execute') { onStarted?.(result.task); onClose(); }
          else resetTask(result.taskSummary);
          await onChanged?.();
        } catch (e) {
          setError(e);
          if (['execute','clarify','check'].includes(route)) {
            try {
              const detail = await call('/api/dsh-handshake/task?id='+encodeURIComponent(task.id));
              if (['staged','failed'].includes(detail.task.status) && detail.task.revision !== task.revision) resetTask(detail.taskSummary);
              else if (['unknown','executing','preparing'].includes(detail.task.status)) {
                onStarted?.(detail.task); onClose();
              }
              await onChanged?.();
            } catch { /* keep the original error */ }
          }
        } finally { setBusy(false); }
      };
      const sourceError = error?.code?.startsWith('source-');
      const targetError = error?.code?.startsWith('target-');
      const canInspect = (sourceError || targetError) && canOpen(task,error.client,openDsh);
      const interrupted = error?.code === 'source-interrupted' && error.stopToken;
      const occupied = task.failureCode === 'codex-session-occupied' && task.targetSession;
      const client = clientName(task.target);
      return h(ConfirmDialog, { title:t('action.handoff',{target:client}),
        message:task.projectName || projectName(task.projectDir),
        confirmLabel:t(interrupted ? 'action.sourceStopped' : 'action.start'), cancelLabel:t('common.no'),
        busy:busy || Boolean(changedNote) || !task.packetDigest || error?.code === 'target-missing',
        onCancel:() => { if (!busy) onClose(); }, onConfirm:() => void update('execute',{ ...binding, stoppedSource:interrupted || undefined }) },
        h('strong',null,t(task.targetSession ? 'dialog.resumeSession' : 'dialog.newSession',{client})),
        h(HandoffBrief, { brief:task.brief ?? { goal:task.title }, cwd:task.projectDir, revision:task.revision, t }),
        h('details', { className:'dsh-handshake-history' }, h('summary',null,t('action.addNote')),
          h('div', { className:'dsh-handshake-note' }, h('textarea',{ value:draft, maxLength:2000, disabled:busy, 'aria-label':t('action.addNote'), onChange:(event)=>setDraft(event.target.value) }),
            h('label',null,h('input',{type:'checkbox',checked:persist,disabled:busy,onChange:(event)=>setPersist(event.target.checked)}),t('dialog.noteScope')),
            h(Btn,{ label:t('action.saveNote'), disabled:busy || !changedNote, onClick:()=>void update('clarify',{...binding,note:draft.trim(),scope:persist ? 'task' : 'round'}) }))),
        error || occupied ? h('div',{className:'dsh-handshake-note'},h('div',{role:'alert',className:'dsh-handshake-err'},error?.message || task.error),
          h('div',{className:'dsh-handshake-row'},
            canInspect ? h(Btn,{label:t('action.openSession',{client:clientName(error.client)}),disabled:busy,onClick:() => void openSession(task,error.client,openDsh,sourceError).catch((reason)=>setError(reason))}) : null,
            h(Btn,{label:t('action.checkAgain'),disabled:busy || changedNote,onClick:()=>void update('check',{taskId:task.id})}),
            error?.code === 'target-missing' || occupied ? h(Btn,{label:t('action.replaceTarget'),disabled:busy || changedNote,onClick:()=>void update('replace-target',binding)}) : null)) : null);
    }

    function observedChecks(result, t) {
      const checks = result?.observed?.checks ?? [];
      const failed = checks.filter((check) => Number.isInteger(check.exitCode) && check.exitCode !== 0).length;
      const passed = checks.filter((check) => check.exitCode === 0).length;
      if (failed || passed) return [passed && t('task.checked',{n:passed}),failed && t('task.checkFailed',{n:failed})].filter(Boolean).join(' · ');
      return checks.length ? t('task.checkObserved',{n:checks.length}) : t('task.noChecks');
    }

    function RoundResult({ result, t }) {
      if (!result) return null;
      const { reported } = result;
      const fields = [
        [t('task.reported'), reported?.completed?.length ? reported.completed.join('、') : t('task.resultMissing')],
        [t('task.checks'), observedChecks(result,t)],
        [t('task.remaining'), reported ? reported.remaining?.join('、') || t('task.noRemaining') : t('task.reportMissing')],
        [t('task.nextStep'), reported?.nextStep],
      ].filter(([,value])=>value);
      return h('div', { className:'dsh-handshake-result' }, ...fields.map(([title,value]) => h('div',{key:title},h('strong',null,title),h('span',null,value))));
    }

    function TaskCard({ task: projectTask, t, onChanged, onPrepare, openDsh, onArchive, archived }) {
      const [selected, setSelected] = useState(null);
      const [open, setOpen] = useState(false);
      const [detail, setDetail] = useState(null);
      const [cloud, setCloud] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const resultRef = useRef(null);
      const detailRequest = useRef(0);
      const task = selected && detail?.taskSummary?.id === selected.id ? detail.taskSummary : selected ?? projectTask;
      const loadDetail = useCallback(async () => {
        const request = ++detailRequest.current;
        try {
          const next = await call('/api/dsh-handshake/task?id='+encodeURIComponent(task.id));
          if (request === detailRequest.current) setDetail(next);
        } catch (e) { if (request === detailRequest.current) setError(e.message); }
      }, [task.id]);
      useEffect(() => {
        if (!open) return undefined;
        let timer, disposed;
        const trackReview = ['starting','running'].includes(detail?.review?.status);
        const tick = async () => {
          await loadDetail();
          if (trackReview && !disposed) timer = setTimeout(tick,5000);
        };
        void tick();
        return () => { disposed = true; detailRequest.current++; clearTimeout(timer); };
      }, [open, projectTask.updatedAt, detail?.review?.status, loadDetail]);
      useEffect(() => { if (open) resultRef.current?.focus(); }, [open]);
      const act = async (fn, refresh = true) => {
        setBusy(true); setError(null);
        try { await fn(); if (refresh) { await onChanged(); if (open) await loadDetail(); } }
        catch (e) { setError(e.message); if (refresh) await onChanged(); }
        finally { setBusy(false); }
      };
      const source = task.sourceKind === 'codex' ? 'codex' : 'dsh';
      const target = task.target ?? otherClient(source);
      const running = ['preparing','executing','unknown'].includes(task.status);
      const ready = ['staged','failed'].includes(task.status);
      const completed = ['awaiting-review','done'].includes(task.status);
      const isArchived = archived || Boolean(task.archivedAt) || task.inHistory;
      const preferred = running ? target : task.lastExecutedBy || source;
      const alternate = otherClient(preferred);
      const label = (kind) => t('action.openSession',{client:clientName(kind)});
      const action = (label,onClick,tone) => h(Btn,{label,onClick,tone,disabled:busy});
      const view = () => setOpen(!open);
      const openClient = (kind) => () => void act(() => openSession(task,kind,openDsh),false);
      const next = () => void act(() => onPrepare('prepare',{taskId:task.id}));
      const archive = (restore) => () => void act(() => onArchive(task,restore),false);
      const retry = () => void act(() => onPrepare('refresh',{taskId:task.id}));
      const canOpenPreferred = canOpen(task,preferred,openDsh);
      const main = isArchived || completed || (task.status === 'failed' && task.result)
        ? action(t(open ? 'board.showLess' : 'action.viewResult'),view,'primary')
        : ready ? action(t(task.status === 'failed' ? 'action.retry' : 'action.handoff',{target:clientName(target)}),retry,'primary')
        : canOpenPreferred ? action(label(preferred),openClient(preferred),'primary')
        : action(t(open ? 'board.showLess' : 'action.details'),view,'primary');
      const menu = h(More,{t},
        canOpenPreferred && (isArchived || completed || ready) ? action(label(preferred),openClient(preferred)) : null,
        canOpen(task,alternate,openDsh) ? action(label(alternate),openClient(alternate)) : null,
        !isArchived && (completed || (task.status === 'failed' && task.result)) && task.lastExecutedBy
          ? action(t('action.handoff',{target:clientName(otherClient(task.lastExecutedBy))}),next) : null,
        !isArchived && ready && task.result ? action(t('action.retry'),retry) : null,
        !(isArchived || completed || task.result) && (ready || canOpenPreferred) ? action(t('action.details'),view) : null,
        !running && !selected && !isArchived ? h(SessionChoices,{sources:projectTask.additionalSources ?? [],label:t('action.otherSessions'),t,
          onSelect:(session)=>void act(() => prepareSession(onPrepare,session))}) : null,
        isArchived ? action(t('action.restore'),archive(true)) : !running && task.status !== 'awaiting-review'
          ? action(t('action.archive'),archive(false)) : null);
      const result = detail?.task.id === task.id ? detail.task.result : null;
      return h('article', { className:'dsh-handshake-card dsh-handshake-task-card', 'data-task-id':task.id, 'data-open':open },
        h('div', { className:'dsh-handshake-compact' },
          h(CompactTitle,{name:task.projectName || projectName(task.projectDir),title:task.title}),
          h(Badge, { tone:STATUS_TONE[task.status] ?? 'idle' }, t('task.status.'+task.status,{target:clientName(target)})),
          main, menu),
        (error || task.error || task.result?.observed?.checks?.length) ? h('div', { className:'dsh-handshake-compact-line '+(error || task.error ? 'dsh-handshake-err' : 'dsh-handshake-muted'),
          title:error || task.error || undefined, role:error ? 'alert' : undefined }, error || task.error || observedChecks(task.result,t)) : null,
        open ? h('div', { className:'dsh-handshake-detail', ref:resultRef, tabIndex:-1, 'aria-label':t('task.result') },
          result ? h(RoundResult,{result,t}) : detail?.task.id !== task.id ? h('span',{role:'status'},t('task.loadingDetail')) : null,
          detail?.task.id === task.id ? h(React.Fragment,null,
            task.status === 'awaiting-review' && !isArchived ? h('div',{className:'dsh-handshake-row'},action(t('action.finishArchive'),archive(false),'primary')) : null,
            task.status === 'unknown' ? h(ConfirmButton,{label:t('task.releaseUnknown'),confirmLabel:t('task.releaseUnknownConfirm'),disabled:busy,
              onConfirm:()=>act(()=>call('/api/dsh-handshake/release-unconfirmed',{taskId:task.id,runId:task.runId ?? null}))}) : null,
            !canOpenPreferred ? h('span',{className:'dsh-handshake-muted'},t('task.openUnavailable')) : null,
            h('details',{className:'dsh-handshake-history'},h('summary',null,t('task.evidence')),
              h('div',{className:'dsh-handshake-row'},h(ClientChip,{client:source}),h('span',null,'→'),h(ClientChip,{client:target})),
              h(HandoffBrief,{brief:task.brief,cwd:task.projectDir,revision:task.revision,t}),
              h('div',{className:'dsh-handshake-path',title:task.projectDir},task.projectDir),
              h('div',{className:'dsh-handshake-facts'},t('receipt.'+(task.reception?.status ?? 'legacy')), ' · ', t(task.preflight?.status === 'passed' ? 'preflight.passed' : 'preflight.pending')),
              result?.observed?.changedFiles?.length ? h('pre',{className:'dsh-handshake-pre'},result.observed.changedFiles.join('\n')) : null,
              result?.observed?.checks?.length ? h('pre',{className:'dsh-handshake-pre'},result.observed.checks.map((check)=>check.command ? check.command+' ('+check.exitCode+')' : check.tool+' ('+check.status+')').join('\n')) : null,
              h(RelayTimeline,{relay:detail.task.relay}),
              h('pre',{className:'dsh-handshake-pre'},detail.promptPreview),
              detail.task.execution?.logFile ? h('div',{className:'dsh-handshake-path'},detail.task.execution.logFile) : null),
            detail.relatedTasks?.length ? h('details',{className:'dsh-handshake-history'},h('summary',null,t('task.related')),
              ...[projectTask,...detail.relatedTasks].filter((related)=>related.id !== task.id)
                .filter((related,index,rows)=>rows.findIndex((entry)=>entry.id===related.id)===index)
                .map((related)=>h(Btn,{key:related.id,label:related.title,disabled:busy,onClick:()=>{ setDetail(null); setSelected(related.id === projectTask.id ? null : related); }}))) : null,
            detail.project ? h('details',{className:'dsh-handshake-history'},h('summary',null,t('master.title')),
              h(ProjectEditor,{key:detail.project.id+':'+(detail.project.masterRevision || 0),project:detail.project,t,disabled:busy || running || isArchived,
                onSave:(patch)=>act(async()=>{await call('/api/dsh-handshake/project',{projectId:detail.project.id,patch}); if(ready) await call('/api/dsh-handshake/refresh',{taskId:task.id});})})) : null,
            result && completed ? h('details',{className:'dsh-handshake-history'},h('summary',null,t('review.section')),
              h('div',{className:'dsh-handshake-row'},
                h(ConfirmButton,{label:t('review.action'),confirmLabel:t('review.confirm'),disabled:busy || detail.review?.status === 'running',onConfirm:()=>act(()=>call('/api/dsh-handshake/review',{taskId:task.id,runId:task.runId}))}),
                action(t('cloud.prepare'),()=>void act(async()=>{const response = await call('/api/dsh-handshake/cloud-plan',{taskId:task.id}); setCloud({runId:task.runId,plan:response.plan});}))),
              detail.review ? h('div',{role:'status'},t('review.'+detail.review.status),detail.review.text ? h('pre',{className:'dsh-handshake-pre'},detail.review.report?.completed.join('\n') || detail.review.text) : null) : null,
              cloud?.runId === task.runId ? h('div',{className:'dsh-handshake-detail'},
                h('pre',{className:'dsh-handshake-pre'},cloud.plan.instructions),h('a',{href:cloud.plan.url,target:'_blank',rel:'noreferrer noopener'},t('cloud.open'))) : null) : null
          ) : null) : null);
    }

    function CandidateCard({ item, t, onPrepare, onHide }) {
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const request = useRef(false);
      const act = async (fn) => {
        if (request.current) return;
        request.current = true; setBusy(true); setError(null);
        try { await fn(); } catch (e) { setError(e.message); }
        finally { request.current = false; setBusy(false); }
      };
      return h('article', { className:'dsh-handshake-card dsh-handshake-card-fixed dsh-handshake-card-'+item.kind, 'data-project-key':item.projectId },
        h('div',{className:'dsh-handshake-compact'},
          h(CompactTitle,{name:item.projectName || projectName(item.projectDir),title:item.title}),
          h(Btn,{label:t('action.handoff',{target:clientName(otherClient(item.kind))}),disabled:busy,onClick:()=>void act(()=>prepareSession(onPrepare,item))}),
          h(More,{t},
            item.sources.reduce((n,source)=>n+source.sessionCount,0)>1
              ? h(SessionChoices,{sources:item.sources,label:t('action.sessions'),t,onSelect:(session)=>void act(()=>prepareSession(onPrepare,session))}) : null,
            h(Btn,{label:t('action.hide'),disabled:busy,onClick:()=>void act(()=>onHide(item.projectId,true))}))),
        error ? h('div',{className:'dsh-handshake-err',role:'alert'},error) : null);
    }

    function Board({ t, openDsh }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [confirmation, setConfirmation] = useState(null);
      const [search, setSearch] = useState('');
      const [view, setView] = useState('board');
      const [tab, setTab] = useState(null);
      const [expanded, setExpanded] = useState({});
      const [feedback, setFeedback] = useState(null);
      const latestRequest = useRef(0);
      const mounted = useRef(true);
      const reload = useCallback(async (refresh = false) => {
        const request = ++latestRequest.current;
        try {
          const next = await call('/api/dsh-handshake/board'+(refresh ? '?refresh=1' : ''));
          if (mounted.current && request === latestRequest.current) { setData(next); setError(null); }
        } catch (e) {
          if (mounted.current && request === latestRequest.current) setError(e.message);
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
      const prepare = async (route, body) => {
        const result = await call('/api/dsh-handshake/'+route, body);
        setConfirmation(result.taskSummary);
        await reload();
      };
      const change = async (route, body, message, undoBody) => {
        await call('/api/dsh-handshake/'+route,body);
        setFeedback({ message, undo:undoBody ? ()=>change(route,undoBody,'task.restored') : null });
        await reload();
      };
      const archive = (task,restore) => change('archive',{...archiveBinding(task),restore},
        restore ? 'task.restored' : 'task.archived', restore ? null : {...archiveBinding(task),restore:true});
      const hide = (projectId,hidden) => change('hide-project',{projectId,hidden},hidden ? 'task.hidden' : 'task.restored',hidden ? {projectId,hidden:false} : null);
      const safely = async (fn) => { try { await fn(); } catch (e) { setError(e.message); } };
      const query = search.trim().toLocaleLowerCase();
      const matches = (...items) => !query || items.some((item)=>String(item ?? '').toLocaleLowerCase().includes(query));
      const tasks = (data?.tasks ?? []).filter((task)=>matches(task.projectName,task.title,...Object.values(task.projectNames ?? {}),
        ...(task.additionalSources ?? []).flatMap((source)=>(source.sessions ?? [source]).map((session)=>session.title))));
      const priority = { unknown:0, failed:0, 'awaiting-review':0, staged:1, preparing:2, executing:2 };
      tasks.sort((a,b)=>(priority[a.status] ?? 3)-(priority[b.status] ?? 3));
      const history = (data?.history ?? []).filter((task)=>matches(task.projectName,task.title));
      const hidden = (data?.hiddenProjects ?? []).filter((project)=>matches(project.name));
      const candidates = { codex:[], dsh:[] };
      for (const item of [...(data?.codexThreads ?? []),...(data?.dshSessions ?? [])]) {
        const sessions = item.sources.flatMap((source)=>source.sessions ?? [source]);
        const session = !query ? item
          : sessions.find((row)=>matches(row.title)) ?? sessions.find((row)=>matches(row.projectName));
        if (session) candidates[session.kind].push({...item,...session,sources:item.sources});
      }
      const { codex, dsh } = candidates;
      const currentTab = query && !codex.length && dsh.length ? 'dsh'
        : query && !dsh.length && codex.length ? 'codex' : tab ?? (codex.length || !dsh.length ? 'codex' : 'dsh');
      const card = (task,archived) => h(TaskCard,{key:task.id,task,t,openDsh,archived,onChanged:reload,onPrepare:prepare,onArchive:archive});
      const toggleView = (name) => setView(view === name ? 'board' : name);
      const management = (name, key) => h('button',{type:'button',className:'dsh-handshake-btn','aria-pressed':view===name,onClick:()=>toggleView(name)},t(key));
      const showMore = (key, total) => !query && total > 4 ? h(Btn,{label:t(expanded[key] ? 'board.showLess' : 'board.showAll',{n:total}),
        onClick:()=>setExpanded({...expanded,[key]:!expanded[key]})}) : null;
      const visible = (key, rows) => query || expanded[key] ? rows : rows.slice(0,4);
      return h('div', { className:'dsh-handshake-wrap' },
        h(Styles),
        h('header', { className:'dsh-handshake-toolbar' },
          h('div',{className:'dsh-handshake-header'},h(Icon,{size:21}),h('h1',null,t('board.title')),h('span',{className:'dsh-handshake-version'},'v0.2')),
          h('input',{type:'search',className:'dsh-handshake-search','aria-label':t('board.search'),placeholder:t('board.search'),value:search,onChange:(e)=>setSearch(e.target.value)}),
          management('history','board.history'), management('hidden','board.hidden'),
          h(Btn,{label:t('board.refresh'),onClick:()=>void reload(true)})),
        feedback ? h('div',{className:'dsh-handshake-feedback'},
          h('span',{role:'status'},t(feedback.message)),
          feedback.undo ? h(Btn,{label:t('action.undo'),onClick:()=>void safely(feedback.undo)}) : null) : null,
        error ? h('div',{className:'dsh-handshake-err',role:'alert'},error) : null,
        !data ? h('div',{className:'dsh-handshake-muted'},t('board.loading')) : null,
        data && view === 'history' ? h('section',{className:'dsh-handshake-zone-relay','aria-label':t('board.history')},
          h('div',{className:'dsh-handshake-section-title'},t('board.history')),
          history.length ? h('div',{className:'dsh-handshake-relay-grid'},...history.map((task)=>card(task,true))) : h('div',{className:'dsh-handshake-muted'},t(query ? 'board.noResults' : 'board.noHistory'))) : null,
        data && view === 'hidden' ? h('section',{className:'dsh-handshake-zone-relay','aria-label':t('board.hidden')},
          h('div',{className:'dsh-handshake-section-title'},t('board.hidden')),
          ...hidden.map((project)=>h('div',{key:project.id,className:'dsh-handshake-between dsh-handshake-card'},h('span',null,project.name),
            h(Btn,{label:t('action.restore'),onClick:()=>void safely(()=>hide(project.id,false))}))),
          !hidden.length ? h('div',{className:'dsh-handshake-muted'},t(query ? 'board.noResults' : 'board.noHidden')) : null) : null,
        data && view === 'board' ? h(React.Fragment,null,
          h('section',{className:'dsh-handshake-zone-relay','aria-label':t('zone.relay')},
            h('div',{className:'dsh-handshake-section-title'},t('zone.relay'),h('span',{className:'dsh-handshake-count'},tasks.length)),
            tasks.length ? h('div',{className:'dsh-handshake-relay-grid'},...visible('relay',tasks).map((task)=>card(task,false)))
              : h('div',{className:'dsh-handshake-muted'},t(query ? 'board.noResults' : 'board.empty')),
            showMore('relay',tasks.length)),
          h('section',{className:'dsh-handshake-pending','aria-label':t('board.pending')},
            h('div',{className:'dsh-handshake-section-title'},t('board.pending')),
            h('div',{className:'dsh-handshake-row dsh-handshake-tabs','aria-label':t('board.pending')},
              ...[['codex',codex],['dsh',dsh]].map(([kind,items])=>h('button',{key:kind,type:'button',className:'dsh-handshake-btn dsh-handshake-card-'+kind,'aria-pressed':currentTab===kind,onClick:()=>setTab(kind)},clientName(kind)+' · '+items.length))),
            h('div',{className:'dsh-handshake-pending-columns'},
              ...[['codex',codex],['dsh',dsh]].map(([kind,items])=>h('section',{
                key:kind,className:'dsh-handshake-pending-column dsh-handshake-pending-column-'+kind,'aria-label':clientName(kind),'data-current':currentTab===kind,
              },h('div',{className:'dsh-handshake-pending-head'},h('strong',null,clientName(kind)),h('span',{className:'dsh-handshake-count'},items.length)),
                ...visible(kind,items).map((item)=>h(CandidateCard,{key:item.projectId,item,t,onPrepare:prepare,onHide:hide})),
                showMore(kind,items.length),
                !items.length ? h('div',{className:'dsh-handshake-muted'},t(query ? 'board.noResults' : kind === 'codex' ? 'board.noThreads' : 'board.noSessions')) : null))))) : null,
        confirmation ? h(StartHandoff,{key:confirmation.id,summary:confirmation,t,openDsh,onClose:()=>setConfirmation(null),onChanged:reload}) : null);
    }

    function SessionRelayView({ sessionId, t, openBoard, openDsh }) {
      const [task, setTask] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [confirmation, setConfirmation] = useState(null);
      const prepare = async () => {
        setBusy(true); setError(null);
        try {
          const detail = await call('/api/dsh-handshake/convert', { kind:'dsh', sessionId });
          setTask(detail.task); setConfirmation(detail.taskSummary);
        } catch (e) { setError(String(e?.message ?? e)); }
        finally { setBusy(false); }
      };
      const running = ['executing','preparing','unknown'].includes(task?.status);
      return h('div',{className:`${NS}-wrap`},
        h(Styles),
        h('div',{className:`${NS}-h2`},t('header.title')),
        error ? h('div',{className:`${NS}-err`,role:'alert'},error) : null,
        h('div',{className:`${NS}-row`},
          running ? h(Badge,{tone:'brand'},t(`task.status.${task.status}`))
            : h(Btn,{label:busy ? t('task.prepare') : t('action.handoff',{target:'Codex'}),tone:'primary',disabled:busy || !sessionId,onClick:()=>void prepare()}),
          h(Btn,{label:t('action.openBoard'),onClick:openBoard})),
        confirmation ? h(StartHandoff,{key:confirmation.id,summary:confirmation,t,openDsh,onClose:()=>setConfirmation(null),onStarted:setTask}) : null);
    }

    function Icon({ size }) {
      return h('svg', { viewBox: '0 0 24 24', width: size || 16, height: size || 16,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'm2 9 3-5 4 2-4 7-3-2m20-2-3-5-4 2 4 7 3-2' }),
        h('path', { d: 'M8.5 7h2.3l1.3-1h2.7l3.4 6.3-4.9 5a2 2 0 0 1-2.6.2L5.8 13' }),
        h('path', { d: 'm12.1 6-3.8 4a1.4 1.4 0 0 0 2 2l1.8-1.8 4.4 3.8M8.5 15l1.7-1.7m.9 3.4 1.6-1.6' }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-handshake: dictionaries');
        const t = ctx.locale.bind(NS);

        let layout, openDsh;
        try {
          ctx.inject(['layout'], (scoped) => { layout = scoped.layout; });
        } catch { /* host without layout: the board button degrades gracefully */ }
        try {
          ctx.inject(['uiWorkspace'], (scoped) => {
            const workspace = scoped.uiWorkspace;
            if (typeof workspace?.openSession !== 'function') return undefined;
            openDsh = (id) => workspace.openSession(id);
            return () => { openDsh = undefined; };
          });
        } catch { /* older hosts do not expose in-app session navigation */ }
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
          }, () => h(Board, { t, openDsh }));
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
            openDsh,
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
