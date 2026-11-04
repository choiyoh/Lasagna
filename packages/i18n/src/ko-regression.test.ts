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
