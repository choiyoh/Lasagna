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
    render: (n) => t('db.csvSaved', { count: n }),
  },
  {
    name: 'db.truncated',
    base: (n, m) => `처음 ${n}행만 보여요(전체 ${m}행). 필터로 좁혀 보세요.`,
    render: (n, m) => t('db.truncated', { shown: n, total: m }),
  },
  {
    name: 'db.yamlIssues',
    base: (n) => `⚠ _db.yaml 문제 ${n}건`,
    render: (n) => t('db.yamlIssues', { count: n }),
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
    render: (n) => t('csv.heading', { file: 'a.csv', count: n }),
  },
  {
    name: 'csv.done',
    base: (n) => `${n}개 행을 가져왔어요.`,
    render: (n) => t('csv.done', { count: n }),
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
    render: (n) => t('prop.count', { count: n }),
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
