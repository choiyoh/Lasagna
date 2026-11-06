import { afterEach, describe, expect, it } from 'vitest'
import { setLocale, t, tPlural } from './index'

/**
 * 복수형·조각 보간으로 바꾼 문구가 base(f7c711f) 의 ko 문장과 글자 단위로 같은지 고정한다.
 * base 템플릿은 당시 소스에서 그대로 옮겨 적었다(문구가 달라지면 여기서 실패한다).
 */
type Case = { name: string; base: (n: number, m: number) => string; render: (n: number, m: number) => string }

const cases: Case[] = [
  {
    name: 'import.doneNotes',
    base: (n) => `노트 ${n}개를 가져왔어요`,
    render: (n) => t(n === 1 ? 'import.doneNotes.one' : 'import.doneNotes.other', { notes: n }),
  },
  {
    name: 'import.doneNotesAssets',
    base: (n, m) => `노트 ${n}개·첨부 ${m}개를 가져왔어요`,
    render: (n, m) => t('import.doneNotesAssets', { notes: tPlural('count.notes', n), assets: tPlural('count.assets', m) }),
  },
  {
    name: 'import.renamed',
    base: (n) => `이름이 겹친 ${n}개는 번호를 붙였어요`,
    render: (n) => t(n === 1 ? 'import.renamed.one' : 'import.renamed.other', { count: n }),
  },
  {
    name: 'import.skipped',
    base: (n) => `건너뜀 ${n}개(a.md, b.md)`,
    render: (n) => t('import.skipped', { count: n, names: 'a.md, b.md' }),
  },
  {
    name: 'import.exportedVault',
    base: (n, m) => `노트 ${n}개·첨부 ${m}개를 내보냈어요: /tmp/out`,
    render: (n, m) =>
      t('import.exportedVault', { notes: tPlural('count.notes', n), assets: tPlural('count.assets', m), dir: '/tmp/out' }),
  },
  {
    name: 'import.notionDone',
    base: (n, m) => `Notion에서 노트 ${n}개·데이터베이스 ${m}개·첨부 ${m}개를 "Inbox" 폴더로 가져왔어요.`,
    render: (n, m) =>
      t('import.notionDone', {
        notes: tPlural('count.notes', n),
        databases: tPlural('count.databases', m),
        assets: tPlural('count.assets', m),
        folder: 'Inbox',
      }),
  },
  {
    name: 'import.notionDoneUnresolved',
    base: (n, m) => `Notion에서 노트 ${n}개·데이터베이스 ${m}개·첨부 ${m}개를 "Inbox" 폴더로 가져왔어요 (연결 못 한 링크 ${m}개).`,
    render: (n, m) =>
      t('import.notionDoneUnresolved', {
        notes: tPlural('count.notes', n),
        databases: tPlural('count.databases', m),
        assets: tPlural('count.assets', m),
        folder: 'Inbox',
        links: tPlural('count.unlinkedLinks', m),
      }),
  },
  { name: 'entry.moved', base: (n) => `${n}개를 옮겼어요`, render: (n) => t('entry.moved', { items: tPlural('count.items', n) }) },
  {
    name: 'entry.movedWithLinks',
    base: (n, m) => `${n}개를 옮겼어요 (링크 ${m}개 갱신)`,
    render: (n, m) => t('entry.movedWithLinks', { items: tPlural('count.items', n), links: tPlural('count.links', m) }),
  },
  {
    name: 'entry.movedPartial',
    base: (n, m) => `${n}개를 옮겼어요 · ${m}개는 같은 이름이 있어 옮기지 못했어요`,
    render: (n, m) =>
      t('entry.movedPartial', { items: tPlural('count.items', n), failed: tPlural('count.items', m) }),
  },
  {
    name: 'entry.movedWithLinksPartial',
    base: (n, m) => `${n}개를 옮겼어요 (링크 ${m}개 갱신) · ${m}개는 같은 이름이 있어 옮기지 못했어요`,
    render: (n, m) =>
      t('entry.movedWithLinksPartial', {
        items: tPlural('count.items', n),
        links: tPlural('count.links', m),
        failed: tPlural('count.items', m),
      }),
  },
  {
    name: 'entry.trashedMany',
    base: (n) => `${n}개를 휴지통으로 옮겼어요`,
    render: (n) => t('entry.trashedMany', { items: tPlural('count.items', n) }),
  },
  {
    name: 'entry.deleteManyTitle',
    base: (n) => `${n}개 항목을 삭제할까요?`,
    render: (n) => t('entry.deleteManyTitle', { items: tPlural('count.items', n) }),
  },
  {
    name: 'entry.renamedWithLinks',
    base: (n) => `이름을 바꾸고 링크 ${n}개를 고쳤어요.`,
    render: (n) => t('entry.renamedWithLinks', { links: tPlural('count.links', n) }),
  },
  {
    name: 'history.diff',
    base: (n) => `현재와 ${n}줄이 달라요 (빨강: 이 버전 / 초록: 현재)`,
    render: (n) => tPlural('history.diff', n),
  },
  { name: 'search.count', base: (n) => `${n}개`, render: (n) => tPlural('search.count', n) },
  {
    name: 'search.count+',
    base: (n) => `${n}+개`,
    render: (n) => tPlural('search.count', n, { n: `${n}+` }),
  },
  { name: 'common.items', base: (n) => `${n}개`, render: (n) => tPlural('common.items', n) },
  { name: 'tree.dragCount', base: (n) => `${n}개 항목`, render: (n) => tPlural('tree.dragCount', n) },
  { name: 'tree.more', base: (n) => `… ${n}개 더 보기`, render: (n) => t('tree.more', { count: n }) },
  { name: 'link.line', base: (n) => `${n}줄`, render: (n) => tPlural('link.line', n) },
  { name: 'comments.resolved', base: (n) => `해결된 댓글 ${n}개`, render: (n) => t('comments.resolved', { count: n }) },
  { name: 'entry.deleteCount', base: (n) => `${n}개 삭제`, render: (n) => t('entry.deleteCount', { count: n }) },
  { name: 'entry.moreCount', base: (n) => `… 외 ${n}개`, render: (n) => t('entry.moreCount', { count: n }) },
  { name: 'sync.last', base: () => `마지막: 어제`, render: () => t('sync.last', { time: '어제' }) },
  { name: 'sync.lastSuccess', base: () => `마지막 성공: 어제`, render: () => t('sync.lastSuccess', { time: '어제' }) },
  { name: 'sync.lastAttempt', base: () => `마지막 시도: 오늘`, render: () => t('sync.lastAttempt', { time: '오늘' }) },
  {
    name: 'sync.changedFiles',
    base: (n) => `이 기기에서 바뀐 파일: ${n}개`,
    render: (n) => t('sync.changedFiles', { value: tPlural('count.files', n) }),
  },
  {
    name: 'diag.pending',
    base: (n) => `이 기기에서 바뀐 파일: ${n}개`,
    render: (n) => t('diag.pending', { value: tPlural('count.files', n) }),
  },
  { name: 'sync.conflictsLabel', base: (n) => `충돌: ${n}건`, render: (n) => t('sync.conflictsLabel', { count: n }) },
  { name: 'diag.conflicts', base: (n) => `충돌: ${n}건`, render: (n) => t('diag.conflicts', { count: n }) },
  { name: 'sync.conflictsHeading', base: (n) => `충돌 ${n}건`, render: (n) => t('sync.conflictsHeading', { count: n }) },
  {
    name: 'sync.resultSummary',
    base: (n, m) => `올림 ${n} · 내려받음 ${m} · 병합 ${m} · 삭제 ${n}`,
    render: (n, m) =>
      t('sync.resultSummary', { pushed: n, pulled: m, merged: m, deleted: n }),
  },
  { name: 'sync.resultFailed', base: (n) => ` · 실패 ${n}`, render: (n) => t('sync.resultFailed', { n }) },
  { name: 'sync.folderId', base: () => ` · ID abc`, render: () => t('sync.folderId', { id: 'abc' }) },
  { name: 'sync.folderCheckedAt', base: () => ` · 어제 확인`, render: () => t('sync.folderCheckedAt', { time: '어제' }) },
  { name: 'sync.tokenValid', base: () => `유효 · 어제까지`, render: () => t('sync.tokenValid', { date: '어제' }) },
  {
    name: 'diag.tokenExpiry',
    base: () => `토큰 만료: 2023-11-14T22:15:00.000Z (유효)`,
    render: () => t('diag.tokenExpiry', { value: '2023-11-14T22:15:00.000Z', state: t('diag.valid') }),
  },
  {
    name: 'diag.failureValue',
    base: () => `인터넷 [NETWORK] @ 2023-11-14T22:13:00.000Z`,
    render: () => t('diag.failureValue', { title: '인터넷', code: 'NETWORK', at: '2023-11-14T22:13:00.000Z' }),
  },
  // L2b: 데이터베이스·그래프 화면
  {
    name: 'db.rows',
    base: (n) => `${n}행`,
    render: (n) => tPlural('count.rows', n),
  },
  {
    name: 'db.rowsFiltered',
    base: (n, m) => `${m} / ${n}행`,
    render: (n, m) => tPlural('db.rowsFiltered', n, { matched: m }),
  },
  {
    name: 'db.selectedCount',
    base: (n) => `${n}개 선택됨`,
    render: (n) => t('db.selectedCount', { count: n }),
  },
  {
    name: 'db.duplicateCount',
    base: (n) => `${n}개 복제`,
    render: (n) => t('db.duplicateCount', { count: n }),
  },
  {
    name: 'db.deleteCount',
    base: (n) => `${n}개 삭제`,
    render: (n) => t('db.deleteCount', { count: n }),
  },
  {
    name: 'db.groupMore',
    base: (n) => `${n}개 더 있음(필터로 좁혀 보세요)`,
    render: (n) => t('db.groupMore', { count: n }),
  },
  {
    name: 'db.rowsDuplicated',
    base: (n) => `${n}개 행을 복제했어요`,
    render: (n) => t('db.rowsDuplicated', { count: n }),
  },
  {
    name: 'db.rowsTrashed',
    base: (n) => `${n}개 행을 휴지통으로 옮겼어요`,
    render: (n) => t('db.rowsTrashed', { count: n }),
  },
  {
    name: 'db.csvSaved',
    base: (n) => `${n}행을 CSV로 저장했어요`,
    render: (n) => tPlural('db.csvSaved', n),
  },
  {
    name: 'db.truncated',
    base: (n, m) => `처음 ${n}행만 보여요(전체 ${m}행). 필터로 좁혀 보세요.`,
    render: (n, m) => t('db.truncated', { shown: n, total: m }),
  },
  {
    name: 'db.yamlIssues',
    base: (n) => `⚠ _db.yaml 문제 ${n}건`,
    render: (n) => tPlural('db.yamlIssues', n),
  },
  {
    name: 'db.calcFor',
    base: (n) => `상태 ${n} 계산`,
    render: (n) => t('db.calcFor', { prop: `상태 ${n}` }),
  },
  {
    name: 'db.renameHint',
    base: (n) => `a${n}.md — 두 번 눌러 이름 바꾸기`,
    render: (n) => t('db.renameHint', { path: `a${n}.md` }),
  },
  {
    name: 'db.rowSelect',
    base: (n) => `노트${n} 선택`,
    render: (n) => t('db.rowSelect', { title: `노트${n}` }),
  },
  {
    name: 'db.cellError',
    base: (n) => `오류: 잘못된 값 ${n}`,
    render: (n) => t('db.cellError', { message: `잘못된 값 ${n}` }),
  },
  {
    name: 'db.deleteViewQuestion',
    base: (n) => `‘보기 ${n}’ 보기를 삭제할까요?`,
    render: (n) => t('db.deleteViewQuestion', { name: `보기 ${n}` }),
  },
  {
    name: 'db.viewNotFound',
    base: (n) => `보기를 찾을 수 없어요: 보기 ${n}`,
    render: (n) => t('db.viewNotFound', { name: `보기 ${n}` }),
  },
  {
    name: 'csv.heading',
    base: (n) => `CSV 가져오기 — a.csv (${n}행)`,
    render: (n) => tPlural('csv.heading', n, { file: 'a.csv' }),
  },
  {
    name: 'csv.done',
    base: (n) => `${n}개 행을 가져왔어요.`,
    render: (n) => tPlural('csv.done', n),
  },
  {
    name: 'csv.addRowsTo',
    base: (n) => `“DB${n}”에 행 추가`,
    render: (n) => t('csv.addRowsTo', { title: `DB${n}` }),
  },
  {
    name: 'csv.propNameAria',
    base: (n) => `열${n} 속성 이름`,
    render: (n) => t('csv.propNameAria', { header: `열${n}` }),
  },
  {
    name: 'calendar.addRowAria',
    base: (n) => `2026-11-0${n} 새 행`,
    render: (n) => t('calendar.addRowAria', { date: `2026-11-0${n}` }),
  },
  {
    name: 'calendar.dateProp',
    base: (n) => `날짜 속성: 날짜${n}`,
    render: (n) => t('calendar.dateProp', { prop: `날짜${n}` }),
  },
  {
    name: 'timeline.undated',
    base: (n, m) => `날짜가 없는 행 ${n}개: a${m} …`,
    render: (n, m) => t('timeline.undated', { count: n, titles: `a${m}`, more: ' …' }),
  },
  {
    name: 'prop.count',
    base: (n) => `속성 ${n}개`,
    render: (n) => tPlural('prop.count', n),
  },
  {
    name: 'prop.deps',
    base: (n) => `쓰는 속성: a${n}, b${n}`,
    render: (n) => t('prop.deps', { list: `a${n}, b${n}` }),
  },
  {
    name: 'prop.formulaAria',
    base: (n) => `점수${n} 수식`,
    render: (n) => t('prop.formulaAria', { name: `점수${n}` }),
  },
  {
    name: 'dbview.viewsOf',
    base: (n) => `“DB${n}”의 보기`,
    render: (n) => t('dbview.viewsOf', { title: `DB${n}` }),
  },
  {
    name: 'rowprops.heading',
    base: (n) => `DB${n} 속성`,
    render: (n) => t('rowprops.heading', { name: `DB${n}` }),
  },
  {
    name: 'dbtemplate.defaultAria',
    base: (n) => `템플릿${n} 기본 템플릿`,
    render: (n) => t('dbtemplate.defaultAria', { title: `템플릿${n}` }),
  },
  // L2b-graph: 그래프 통계·제안 개수 단위
  {
    name: 'graph.stats.nodes',
    base: (n) => `${n}개 노드`,
    render: (n) => tPlural('graph.stats.nodes', n),
  },
  {
    name: 'graph.stats.nodesOf',
    base: (n, m) => `${m} / ${n}개 노드`,
    render: (n, m) => tPlural('graph.stats.nodesOf', n, { matched: m }),
  },
  {
    name: 'graph.stats.links',
    base: (n) => `${n}개 링크`,
    render: (n) => tPlural('graph.stats.links', n),
  },
  {
    name: 'graph.stats.layouting',
    base: () => ' · 배치 중…',
    render: () => t('graph.stats.layouting'),
  },
  {
    name: 'empty.suggestionCount.rows',
    base: (n) => `${n}개`,
    render: (n) => tPlural('empty.suggestionCount.rows', n),
  },
  // L3a: 데이터 기본값·댓글 작성자
  {
    name: 'default.untitled',
    base: () => '제목 없음',
    render: () => t('default.untitled'),
  },
  {
    name: 'default.untitledN',
    base: (n) => `제목 없음 ${n}`,
    render: (n) => t('default.untitledN', { n }),
  },
  {
    name: 'default.csvColumn',
    base: (n) => `열${n}`,
    render: (n) => t('default.csvColumn', { n }),
  },
  {
    name: 'default.dbView',
    base: (n) => `보기 ${n}`,
    render: (n) => t('default.dbView', { n }),
  },
  {
    name: 'default.conflictName',
    base: (n) => `메모 (충돌 2026-11-0${n}).md`,
    render: (n) => t('default.conflictName', { stem: '메모', date: `2026-11-0${n}`, ext: '.md' }),
  },
  {
    name: 'default.conflictNameN',
    base: (n) => `메모 (충돌 2026-11-05 ${n}).md`,
    render: (n) => t('default.conflictNameN', { stem: '메모', date: '2026-11-05', n, ext: '.md' }),
  },
  {
    name: 'comments.me',
    base: () => '나',
    render: () => t('comments.me'),
  },
  {
    name: 'db.groupEmpty',
    base: () => '(없음)',
    render: () => t('db.groupEmpty'),
  },
  // L3b: 편집기(슬래시·블록·날짜·임베드)
  {
    name: 'editor.block.selected',
    base: (n) => `블록 ${n}개 선택됨`,
    render: (n) => t('editor.block.selected', { count: n }),
  },
  {
    name: 'editor.date.daysAfter',
    base: (n) => `${n}일 뒤`,
    render: (n) => t('editor.date.daysAfter', { n }),
  },
  {
    name: 'editor.date.daysBefore',
    base: (n) => `${n}일 전`,
    render: (n) => t('editor.date.daysBefore', { n }),
  },
  {
    name: 'editor.date.thisWeekday',
    base: () => '이번 월요일',
    render: () => t('editor.date.thisWeekday', { weekday: '월요일' }),
  },
  {
    name: 'editor.embed.noteMissing',
    base: (n) => `⚠ 노트를 찾을 수 없어요: 노트${n}`,
    render: (n) => t('editor.embed.noteMissing', { target: `노트${n}` }),
  },
  {
    name: 'editor.footnote.aria',
    base: (n) => `각주 ${n} — 각주: 본문`,
    render: (n) => t('editor.footnote.aria', { label: String(n), suffix: ' — 각주: 본문' }),
  },
  {
    name: 'editor.file.saveFailed',
    base: (n) => `저장하지 못했어요: 파일${n}.pdf (권한 없음)`,
    render: (n) => t('editor.file.saveFailed', { name: `파일${n}.pdf`, message: '권한 없음' }),
  },
  {
    name: 'editor.math.blockPlaceholder',
    base: () => '수식을 입력하세요 (LaTeX)',
    render: () => t('editor.math.blockPlaceholder'),
  },
  {
    name: 'editor.toc.empty',
    base: () => '제목(#)을 쓰면 여기에 목차가 생겨요',
    render: () => t('editor.toc.empty'),
  },
  // L3b: 수식
  {
    name: 'formula.err.unknownName',
    base: (n) => `알 수 없는 이름: 이름${n}`,
    render: (n) => t('formula.err.unknownName', { name: `이름${n}` }),
  },
  {
    name: 'formula.err.unknownNameCallback',
    base: (n) => `알 수 없는 이름: 이름${n} (map·filter 같은 함수 안에서만 쓸 수 있어요)`,
    render: (n) => t('formula.err.unknownNameCallback', { name: `이름${n}` }),
  },
  {
    name: 'formula.err.arityExact',
    base: (n) => `round() 는 인자가 ${n}개 필요해요(지금 ${n}개)`,
    render: (n) => t(n === 1 ? 'formula.err.arityExact.one' : 'formula.err.arityExact.other', { name: 'round', n, count: n }),
  },
  {
    name: 'formula.err.arityAtLeast',
    base: (n) => `concat() 는 인자가 ${n}개 이상개 필요해요(지금 ${n}개)`,
    render: (n) => t(n === 1 ? 'formula.err.arityAtLeast.one' : 'formula.err.arityAtLeast.other', { name: 'concat', min: n, count: n }),
  },
  {
    name: 'formula.err.arityBetween',
    base: (n) => `round() 는 인자가 1~${n}개 필요해요(지금 ${n}개)`,
    render: (n) => t('formula.err.arityBetween.other', { name: 'round', min: 1, max: n, count: n }),
  },
  {
    name: 'formula.err.needsNumber',
    base: (n) => `${n}: 숫자가 필요한데 문자열 이에요`,
    render: (n) => t('formula.err.needsNumber', { what: String(n), type: t('formula.type.string') }),
  },
  {
    name: 'formula.parse.dotCall',
    base: (n) => `\`fn${n}\` 뒤에 ( 가 필요해요 — 속성 접근은 지원하지 않아요`,
    render: (n) => t('formula.parse.dotCall', { name: `fn${n}` }),
  },
  {
    name: 'formula.err.needsList',
    base: (n) => `sort${n}: 목록이 필요한데 날짜 이에요`,
    render: (n) => t('formula.err.needsList', { fn: `sort${n}`, type: t('formula.type.date') }),
  },
  // L4a: MCP 설정
  {
    name: 'mcp.policySaved',
    base: () => '이 설정을 바꾸면 볼트의 .nopsidian/mcp-policy.json 에 저장돼 이미 연결된 에이전트에도 다음 쓰기부터 바로 적용돼요. 쓰기 도구 없이 연결한 에이전트는 다시 연결해야 해요.',
    render: () => t('mcp.policySaved', { file: '.nopsidian/mcp-policy.json' }),
  },
  {
    name: 'mcp.fixFolderFirst',
    base: (n) => `문제${n} 폴더를 고친 뒤 다시 켜 주세요.`,
    render: (n) => t('mcp.fixFolderFirst', { issue: `문제${n}` }),
  },
  {
    name: 'mcp.dailyAllowHint',
    base: (n) => `켜면 일기${n}/ 도 쓰기 허용 폴더에 넣어요. 끄면 append_to_daily_note 가 forbidden-folder 로 거부돼요.`,
    render: (n) => t('mcp.dailyAllowHint', { folder: `일기${n}` }),
  },
  {
    name: 'mcp.dailyNotCovered',
    base: (n) => `오늘의 노트 폴더(일기${n}/)가 허용 폴더에 없어요. 이대로면 오늘의 노트에 쓰기는 forbidden-folder 로 실패해요.`,
    render: (n) => t('mcp.dailyNotCovered', { folder: `일기${n}` }),
  },
  {
    name: 'mcp.reverted.trashed',
    base: (n) => `휴지통으로 옮겼어요: a${n}.md`,
    render: (n) => t('mcp.reverted.trashed', { path: `a${n}.md` }),
  },
  {
    name: 'mcp.noServer',
    base: () => '이 빌드에는 MCP 서버 파일이 없어요. 앱을 다시 설치하거나 개발 중이면 pnpm --filter @nopsidian/mcp build 를 실행하세요.',
    render: () => t('mcp.noServer', { command: 'pnpm --filter @nopsidian/mcp build' }),
  },
  // L4a: MCP 정책 오류(코드+파라미터)
  {
    name: 'mcp.policyErr.unreadable',
    base: () => '정책 파일을 읽을 수 없어요: EACCES',
    render: () => t('mcp.policyErr.unreadable', { message: 'EACCES' }),
  },
  {
    name: 'mcp.policyErr.invalidSchema',
    base: () => '정책 파일 형식이 올바르지 않아요: write Invalid input',
    render: () => t('mcp.policyErr.invalidSchema', { path: 'write', message: 'Invalid input' }),
  },
  {
    // 루트가 배열이면 zod 경로가 빈 문자열 — base 는 ': ' + '' + ' ' + message 라 두 칸이 된다
    name: 'mcp.policyErr.invalidSchema.root',
    base: () => '정책 파일 형식이 올바르지 않아요:  Invalid input',
    render: () => t('mcp.policyErr.invalidSchema', { path: '', message: 'Invalid input' }),
  },
  {
    name: 'mcp.policyErr.badFolder',
    base: () => '정책 파일의 폴더가 올바르지 않아요: 경로가 볼트 밖이에요',
    render: () => t('mcp.policyErr.badFolder', { message: '경로가 볼트 밖이에요' }),
  },
  // L4a: 되돌리기 오류
  {
    name: 'mcp.revertErr.changed',
    base: () => '그 뒤로 노트가 또 바뀌었어요. 더 최근 작업부터 되돌리거나 노트의 버전 기록에서 복원해 주세요',
    render: () => t('mcp.revertErr.changed'),
  },
  {
    name: 'mcp.revertErr.missing',
    base: () => '노트가 지금은 없어요(지웠거나 이름을 바꿨어요)',
    render: () => t('mcp.revertErr.missing'),
  },
  // L4b: 메인·워커
  {
    name: 'main.restoreName',
    base: (n) => `a.md (복원 ${n}).md`,
    render: (n) => t('main.restoreName', { stem: 'a.md', n: ` ${n}`, ext: '.md' }),
  },
  {
    name: 'main.copyName',
    base: () => 'a (사본)',
    render: () => t('main.copyName', { base: 'a' }),
  },
  {
    name: 'main.notionFolder',
    base: (n) => `Notion 가져오기 2026-11-0${n}`,
    render: (n) => t('main.notionFolder', { day: `2026-11-0${n}` }),
  },
  {
    name: 'main.err.tooManyFiles',
    base: (n) => `파일이 너무 많아요(최대 ${n}개)`,
    render: (n) => t('main.err.tooManyFiles', { max: n }),
  },
  {
    name: 'main.err.dbNotFound',
    base: (n) => `데이터베이스를 찾을 수 없어요: DB${n}`,
    render: (n) => t('main.err.dbNotFound', { name: `DB${n}` }),
  },
  {
    name: 'sync.diag.auth.title',
    base: () => 'Google 로그인이 만료됐어요',
    render: () => t('sync.diag.auth.title'),
  },
  {
    name: 'sync.diag.auth.action',
    base: () => 'Google 계정을 다시 연결해 주세요',
    render: () => t('sync.diag.auth.action'),
  },
  // L4c: MCP 서버
  {
    name: 'mcpW.err.headingNotFound',
    base: (n) => `“제목${n}” 제목을 찾을 수 없어요. 있는 제목: # a`,
    render: (n) => t('mcpW.err.headingNotFound', { heading: `제목${n}`, list: '# a' }),
  },
  {
    name: 'mcpW.err.rateLimit',
    base: (n) => `1분에 ${n}번까지만 쓸 수 있어요. 잠시 뒤에 다시 시도하세요`,
    render: (n) => t('mcpW.err.rateLimit', { max: n }),
  },
  {
    name: 'mcpDb.err.noProp',
    base: (n) => `없는 속성: p${n}. 있는 속성: a, b`,
    render: (n) => t('mcpDb.err.noProp', { prop: `p${n}`, props: 'a, b' }),
  },
  {
    name: 'mcpCli.writeAllowed',
    base: (n) => `쓰기 허용: AI${n}, 볼트 전체`,
    render: (n) => t('mcpCli.writeAllowed', { folders: `AI${n}, ${t('mcpCli.wholeVault')}` }),
  },
  {
    name: 'sync.err.nameExists',
    base: (n) => `이미 같은 이름의 파일이 있어요: f${n}.md`,
    render: (n) => t('sync.err.nameExists', { path: `f${n}.md` }),
  },
  {
    name: 'sync.blocked.deleteRatio',
    base: (n) => `파일 ${n}개 중 2개(40%)를 지우려 해요. 의도한 게 맞는지 확인해 주세요.`,
    render: (n) => t('sync.blocked.deleteRatio', { tracked: n, deletes: 2, percent: 40 }),
  },
  {
    name: 'sync.blocked.stopDeleteRatio',
    base: (n) => `동기화를 멈췄어요: 파일 ${n}개 중 2개(40%)를 지우려 해요. 의도한 게 맞는지 확인해 주세요.`,
    render: (n) => t('sync.blocked.stopDeleteRatio', { tracked: n, deletes: 2, percent: 40 }),
  },
  {
    name: 'core.err.commentTooLong',
    base: (n) => `댓글이 너무 길어요(최대 ${n}자)`,
    render: (n) => t('core.err.commentTooLong', { max: n }),
  },
  {
    name: 'core.err.pathEscape',
    base: (n) => `볼트 밖으로 벗어나는 경로: ../${n}.md`,
    render: (n) => t('core.err.pathEscape', { path: `../${n}.md` }),
  },
  {
    name: 'core.err.blockMissing',
    base: (n) => `블록 ${n} 없음`,
    render: (n) => t('core.err.blockMissing', { index: n }),
  },
  {
    name: 'db.csv.unreadable',
    base: (n) => `${n}행 점수: 읽을 수 없는 값 'x'`,
    render: (n) => t('db.csv.unreadable', { row: n, column: '점수', value: 'x' }),
  },
  {
    name: 'default.dbViewName',
    base: () => '보기',
    render: () => t('default.dbViewName'),
  },
  {
    name: 'preload.err.unknownEvent',
    base: (n) => `알 수 없는 이벤트: e${n}`,
    render: (n) => t('preload.err.unknownEvent', { event: `e${n}` }),
  },
]

afterEach(() => setLocale('ko'))

describe('Korean wording is unchanged from the base', () => {
  it('renders every plural or count phrase exactly as base did for 0/1/2/5', () => {
    setLocale('ko')
    const mismatches: string[] = []
    for (const n of [0, 1, 2, 5]) {
      const m = n + 3
      for (const item of cases) {
        const expected = item.base(n, m)
        const actual = item.render(n, m)
        if (actual !== expected) mismatches.push(`${item.name} n=${n}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
