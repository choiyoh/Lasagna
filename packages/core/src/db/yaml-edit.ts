import { t } from '@nopsidian/i18n';
import { parseDocument, stringify, Pair, Scalar, YAMLMap, YAMLSeq } from 'yaml';
import type { Document } from 'yaml';
import { splitFrontmatter } from '../markdown/frontmatter.js';
import type { DbSchema, Property, View } from './schema.js';

/**
 * 프런트매터·`_db.yaml` 을 **서식 보존하며** 고치는 순수 문자열 함수 모음.
 *
 * 외부 편집기에서 쓴 주석·키 순서·따옴표 스타일·줄바꿈·본문 바이트는 건드리지 않고 바꾼 키만 바꾼다.
 * `yaml` 의 Document AST 를 제자리에서 고친 뒤 `toString()` 결과를 원문 골격(맵 앞뒤 주석·꼬리)에
 * 다시 끼워 넣는 방식이다. YAML 이 깨져 있으면 원문을 덮어쓰지 않도록 Error 를 던진다.
 */

/** 최상위 YAML 문서(맵) + 원문 골격. `head` 는 최상위 맵 앞의 주석 등, `tail` 은 뒤의 꼬리. */
interface DbDoc {
  doc: Doc;
  head: string;
  tail: string;
}

/**
 * 문자열 키를 쓰는 맵. 값 타입은 yaml 의 `NodeType<T>` 추론이 `Alias` 까지 포함해 다루기 번거로워
 * 여기서만 `any` 로 둔다(런타임 접근은 `isMap`/`isSeq`/`isCollection` 로 좁혀 쓴다).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type ParsedNodeMap = YAMLMap<Scalar<unknown>, any>;
type ParsedPair = Pair<Scalar<unknown>, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 맵 하나를 담은 Document */
type Doc = Document;

// ── 공통 헬퍼 ─────────────────────────────────────────────────────

/** 파일의 줄바꿈 스타일. 첫 줄바꿈이 CRLF 면 CRLF 로 본다. */
function detectEol(source: string): '\n' | '\r\n' {
  const i = source.indexOf('\n');
  return i > 0 && source[i - 1] === '\r' ? '\r\n' : '\n';
}

/** JSON 값 깊은 비교(원문 노드를 그대로 둘지 판단할 때만 쓴다). Node API 없이. */
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEq(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    return ka.length === kb.length && ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function yamlErrorMessage(doc: Document): string {
  return t('db.issue.yaml', { message: doc.errors[0]?.message ?? t('core.err.unknown') });
}

/**
 * YAML 텍스트에서 **최상위 맵 노드의 원문 구간**만 골라낸다. 선행 주석은 맵 range 밖이라 잘리지만,
 * 그 앞부분을 `head` 로 챙겨 다시 붙이므로 결과에서는 사라지지 않는다.
 * 맵이 없으면(빈 문서·주석만 있는 문서) 빈 문자열을 돌려준다.
 */
function sliceTopMap(text: string): string {
  const doc = parseDocument(text);
  const contents = doc.contents as { range?: [number, number, number] } | null;
  return contents?.range ? text.slice(contents.range[0], contents.range[1]) : '';
}

/** 빈 문서는 빈 맵으로 시작하고, 최상위 맵 노드를 돌려준다(문서가 보장한다). */
function rootMap(doc: Doc): ParsedNodeMap {
  if (!doc.contents) doc.contents = emptyMap(doc) as unknown as Document['contents'];
  return doc.contents as ParsedNodeMap;
}

/** YAML 텍스트를 읽어 최상위 맵 + 골격으로 나눈다. 비었으면 빈 문서, YAML 이 깨졌으면 Error. */
function openDb(yamlText: string): DbDoc {
  const headDoc = parseDocument(yamlText);
  if (headDoc.errors.length > 0) throw new Error(yamlErrorMessage(headDoc));

  const yamlPart = sliceTopMap(yamlText);
  const doc = parseDocument(yamlPart) as Doc;
  if (doc.errors.length > 0) throw new Error(yamlErrorMessage(doc));
  rootMap(doc); // 빈 문서(빈 문자열·주석만·`---` 만)는 빈 맵으로 시작한다.

  const headLen = yamlPart ? yamlText.indexOf(yamlPart) : yamlText.length;
  return { doc, head: yamlText.slice(0, headLen), tail: yamlText.slice(headLen + yamlPart.length) };
}

/**
 * 문서를 골격에 맞춰 다시 쓴다. YAML 부분의 줄바꿈은 골격(맵 앞 주석)의 줄바꿈으로 통일하고,
 * `head`/`tail` 은 그대로 붙인 뒤 끝에 줄바꿈 하나를 보장한다.
 */
function renderDb({ doc, head, tail }: DbDoc): string {
  const eol = detectEol(head.length > 0 ? head : tail);
  const body = doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, '\n').replace(/\n$/, '');
  const headText = head.length > 0 && !/\r?\n$/.test(head) ? head + eol : head;
  const tailText = tail.replace(/\r?\n/g, '\n').replace(/\n/g, eol);
  return headText + body.replace(/\n/g, eol) + eol + tailText;
}

function isMap(node: unknown): node is ParsedNodeMap {
  return node instanceof YAMLMap;
}
function isSeq(node: unknown): node is YAMLSeq<unknown> {
  return node instanceof YAMLSeq;
}
function isPair(node: unknown): node is ParsedPair {
  return node instanceof Pair;
}

/** 문서의 스키마를 쓰는 빈 맵/시퀀스(새 컨테이너를 만들 때) */
function emptyMap(doc: Document): ParsedNodeMap {
  const map = new YAMLMap(doc.schema);
  map.items = [];
  return map as unknown as ParsedNodeMap;
}
function emptySeq(doc: Document): YAMLSeq<unknown> {
  const seq = new YAMLSeq(doc.schema);
  seq.items = [];
  return seq;
}

/** 문자열 키 노드 */
function sc(key: string): Scalar<unknown> {
  return new Scalar(key);
}

/** 맵 항목의 키 이름. 키가 문자열이 아니면(=정수 키 등) `undefined`. */
function keyOf(item: unknown): string | undefined {
  if (!isPair(item)) return undefined;
  const key = item.key;
  return key instanceof Scalar && typeof key.value === 'string' ? key.value : undefined;
}

/** 노드가 감싸는 값(플레인 JS). 컬렉션은 그대로. */
function valueOf(node: unknown): unknown {
  return node instanceof Scalar ? node.value : node;
}

/** 노드를 플레인 JS 값으로(맵·시퀀스는 `toJSON()` 이 새 객체를 준다). 비교용. */
function plain(node: unknown): unknown {
  return node !== null && typeof node === 'object' && 'toJSON' in (node as object) ? (node as { toJSON(): unknown }).toJSON() : node;
}

/** 노드가 문자열 스칼라면 그 값, 아니면 `undefined`(맵 접근 결과를 이름과 비교할 때 쓴다). */
function strOf(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  return node instanceof Scalar && typeof node.value === 'string' ? node.value : undefined;
}

/** 맵에서 키의 값 노드를 꺼낸다(스칼라는 Scalar 노드 그대로). */
function getKey(map: ParsedNodeMap, key: string): unknown {
  return map.items.find((it) => keyOf(it) === key)?.value;
}

/** 스칼라 노드의 값만 바꾸고 주석·스타일·앵커는 그대로 둔다. */
function retarget(node: unknown, value: unknown): unknown {
  if (!(node instanceof Scalar)) return node;
  const next = new Scalar(value);
  next.comment = node.comment;
  next.commentBefore = node.commentBefore;
  next.type = node.type;
  next.format = node.format;
  next.anchor = node.anchor;
  return next;
}

/** 흐름 스타일을 쓸 수 있는 컬렉션 노드(YAMLMap·YAMLSeq — `Collection` 은 런타임에 없다). */
function isCollection(node: unknown): node is YAMLMap | YAMLSeq<unknown> {
  return node instanceof YAMLMap || node instanceof YAMLSeq;
}

/** 맵 안의 값들이 흐름 스타일(`{ type: text }`)로 쓰였는지 — 새 항목도 같은 스타일로 맞춘다. */
function usesFlowStyle(map: ParsedNodeMap): boolean {
  // `flow` 는 초기화되지 않는 클래스 필드라 `'flow' in node` 로는 안 잡힌다.
  return map.items.some((it) => isCollection(it.value) && it.value.flow === true);
}

/**
 * 컬렉션 값은 새 노드로 갈아 끼운다. 스칼라는 뒤 인라인 주석을 옮겨 붙이고, 기존 항목이
 * 흐름 스타일이면 새 컬렉션도 흐름 스타일로 써서 `a: { type: text }` 모양을 유지한다.
 */
function replaceValue(doc: Document, pair: ParsedPair, value: unknown): void {
  if (!isCollection(pair.value) && (value === null || typeof value !== 'object')) {
    pair.value = retarget(pair.value, value);
    return;
  }
  // 컬렉션이거나, 스칼라였던 자리에 맵·배열(날짜 기간 `{ start, end }` 등)이 들어오는 경우
  const node = doc.createNode(value);
  if (isCollection(node) && isCollection(pair.value) && pair.value.flow) node.flow = true;
  pair.value = node;
}

/** 맵의 키 값을 교체하고, 없으면 끝에 새로 만든다. */
function setKey(doc: Document, map: ParsedNodeMap, key: string, value: unknown): void {
  const pair = map.items.find((it) => keyOf(it) === key);
  if (pair) {
    replaceValue(doc, pair, value);
    return;
  }
  const node = doc.createNode(value);
  if (isCollection(node) && usesFlowStyle(map)) node.flow = true;
  map.items.push(doc.createPair(sc(key), node));
}

/** 설정할 값이 이미 있는 값과 같은지(같으면 노드를 교체하지 않아 서식이 유지된다). */
function sameValue(current: unknown, next: unknown): boolean {
  return current !== undefined && deepEq(plain(current), next);
}

/** 시퀀스에서 조건에 맞는 항목을 지운다. 지운 개수를 돌려준다. */
function dropItems(seq: YAMLSeq<unknown>, pred: (item: unknown) => boolean): number {
  const kept = seq.items.filter((it) => !pred(it));
  const removed = seq.items.length - kept.length;
  seq.items = kept;
  return removed;
}

/** 주석을 옮겨 붙일 수 있는 노드(키 스칼라·맵 항목·시퀀스 항목). */
interface CommentTarget {
  commentBefore?: string | null;
  key?: CommentTarget | null;
}
function commentTargetOf(item: unknown): CommentTarget | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  const it = item as CommentTarget;
  return it.key ?? it;
}

/** `from` 에 붙은 선행 주석을 `to` 의 앞으로 옮긴다(한 번도 안 옮기면 false). */
function moveComments(from: unknown, to: unknown): boolean {
  const src = commentTargetOf(from);
  const dst = commentTargetOf(to);
  if (!src?.commentBefore || !dst) return false;
  dst.commentBefore = dst.commentBefore ? `${src.commentBefore}\n${dst.commentBefore}` : src.commentBefore;
  src.commentBefore = null;
  return true;
}

/**
 * 컬렉션의 항목을 지운 뒤 주석이 붙을 곳을 잃지 않게 다음 항목으로 옮긴다.
 * (`# 주석` 은 그 다음 키의 `commentBefore` 에 붙어 있어, 그 키를 지우면 함께 사라진다.)
 * 마지막 항목의 주석은 문서 끝 주석(`doc.comment`)으로 넘긴다.
 */
function keepComments(collection: ParsedNodeMap | YAMLSeq<unknown>, doc?: Document): void {
  const items = collection.items;
  for (let i = 0; i < items.length - 1; i++) moveComments(items[i], items[i + 1]);
  const last = items[items.length - 1];
  const orphan = commentTargetOf(last)?.commentBefore;
  if (orphan && doc) {
    doc.comment = doc.comment ? `${orphan}\n${doc.comment}` : orphan;
    commentTargetOf(last)!.commentBefore = null;
  }
}

/** 맵에서 키를 지우면서 그 키에 붙은 선행 주석은 다음 항목(또는 문서 끝)으로 넘긴다. */
function deleteKey(map: ParsedNodeMap, key: string, doc?: Document): boolean {
  const idx = map.items.findIndex((it) => keyOf(it) === key);
  if (idx < 0) return false;
  const pair = map.items[idx]!;
  if (idx + 1 < map.items.length) moveComments(pair, map.items[idx + 1]);
  else if (doc) {
    const orphan = commentTargetOf(pair)?.commentBefore;
    if (orphan) doc.comment = doc.comment ? `${orphan}\n${doc.comment}` : orphan;
  }
  map.items = map.items.filter((_, i) => i !== idx);
  return true;
}

/** 필터 트리에서 `prop` 이 `name` 인 조건을 지우거나(`to` 생략) 이름을 바꾼다. */
function mapFilter(seq: YAMLSeq<unknown>, name: string, to?: string): number {
  let n = 0;
  for (const node of [...seq.items]) {
    if (!isMap(node)) continue;
    const prop = strOf(node.get('prop'));
    if (prop !== undefined) {
      if (prop !== name) continue;
      if (to === undefined) {
        seq.items = seq.items.filter((it) => it !== node);
      } else {
        node.set(sc('prop'), to);
      }
      n++;
      continue;
    }
    for (const field of ['and', 'or'] as const) {
      const sub = node.get(field, true);
      if (isSeq(sub)) n += mapFilter(sub, name, to);
    }
  }
  return n;
}

/** 뷰 안에서 `name` 참조를 지운다. 지운 개수를 돌려준다. */
function dropViewRefs(view: ParsedNodeMap, name: string): number {
  let n = 0;
  for (const field of ['columns', 'sort'] as const) {
    const seq = view.get(field, true);
    if (!isSeq(seq)) continue;
    n += dropItems(seq, (it) => (field === 'sort' ? isMap(it) && strOf(it.get('prop')) === name : valueOf(it) === name));
  }
  for (const field of ['groupBy', 'subGroupBy', 'dateProp', 'cover'] as const) {
    if (strOf(view.get(field)) === name) {
      view.delete(sc(field));
      n++;
    }
  }
  // `calc`·`widths` 는 속성 이름을 키로 쓰는 맵이다.
  for (const field of ['calc', 'widths'] as const) {
    const obj = view.get(field, true);
    if (!isMap(obj)) continue;
    const pair = obj.items.find((it) => keyOf(it) === name);
    if (!pair) continue;
    obj.items = obj.items.filter((it) => it !== pair);
    if (obj.items.length === 0) view.delete(sc(field));
    n++;
  }

  const filter = view.get('filter', true);
  if (!isMap(filter)) return n;
  if (strOf(filter.get('prop')) === name) {
    view.delete(sc('filter'));
    return n + 1;
  }
  for (const field of ['and', 'or'] as const) {
    const sub = filter.get(field, true);
    if (!isSeq(sub)) continue;
    n += mapFilter(sub, name);
    // 비게 된 and/or 묶음은 지운다(빈 조건 묶음은 잔재일 뿐이다).
    if (sub.items.length === 0) filter.items = filter.items.filter((it) => !isPair(it) || it.value !== sub);
  }
  if (filter.items.length === 0) view.delete(sc('filter'));
  return n;
}

/** 뷰의 속성 참조를 `from` → `to` 로 바꾼다. 바꾼 개수를 돌려준다. */
function renameViewRefs(view: ParsedNodeMap, from: string, to: string): number {
  let n = 0;
  const columns = view.get('columns', true);
  if (isSeq(columns)) {
    for (let i = 0; i < columns.items.length; i++) {
      if (valueOf(columns.items[i]) !== from) continue;
      columns.items[i] = retarget(columns.items[i], to);
      n++;
    }
  }
  const sort = view.get('sort', true);
  if (isSeq(sort)) {
    for (const rule of sort.items) {
      if (isMap(rule) && strOf(rule.get('prop')) === from) {
        rule.set(sc('prop'), to);
        n++;
      }
    }
  }
  const filter = view.get('filter', true);
  if (isMap(filter)) {
    if (strOf(filter.get('prop')) === from) {
      filter.set(sc('prop'), to);
      n++;
    }
    for (const field of ['and', 'or'] as const) {
      const sub = filter.get(field, true);
      if (isSeq(sub)) n += mapFilter(sub, from, to);
    }
  }
  for (const field of ['groupBy', 'subGroupBy', 'dateProp', 'cover'] as const) {
    if (strOf(view.get(field)) === from) {
      view.set(sc(field), to);
      n++;
    }
  }
  for (const field of ['calc', 'widths'] as const) {
    const obj = view.get(field, true);
    if (!isMap(obj)) continue;
    const keyPair = obj.items.find((it) => keyOf(it) === from);
    if (keyPair) {
      keyPair.key = sc(to);
      n++;
    }
  }
  return n;
}

/** `properties` 맵(없으면 만든다). */
function propertiesOf(doc: Doc): ParsedNodeMap {
  const cur = getKey(rootMap(doc), 'properties');
  if (isMap(cur)) return cur;
  const created = emptyMap(doc);
  rootMap(doc).set(sc('properties'), created);
  return created;
}

/** `views` 시퀀스(없으면 만든다). */
function viewsOf(doc: Doc): YAMLSeq<unknown> {
  const cur = getKey(rootMap(doc), 'views');
  if (isSeq(cur)) return cur;
  const created = emptySeq(doc);
  rootMap(doc).set(sc('views'), created);
  return created;
}

// ── 프런트매터 ────────────────────────────────────────────────────

/**
 * 노트 원문에서 프런트매터의 키를 설정/삭제한다. `changes` 의 값이 `undefined` 면 키 삭제,
 * 그 외는 설정(없는 키는 맵 끝에 추가). 프런트매터가 없으면 맨 앞에 새로 만든다
 * (이미 본문이 있으면 그 앞에 `---\n…\n---\n`). **본문은 한 바이트도 바꾸지 않는다.**
 * YAML 이 깨져 있으면 Error 를 던진다(원문을 덮어쓰지 않기 위해). 변경이 없으면 입력과 같은 문자열.
 */
export function setFrontmatter(content: string, changes: Record<string, unknown>): string {
  const parts = splitFrontmatter(content);
  if (parts?.error) throw new Error(t('db.issue.yaml', { message: parts.error }));

  const closing = parts ? parts.raw.lastIndexOf('---') : 0;
  const eol = parts ? (parts.raw.startsWith('---\r\n') ? '\r\n' : '\n') : detectEol(content);
  const oldYaml = parts ? parts.raw.slice(parts.raw.indexOf('\n') + 1, closing) : '';

  // 최상위 맵 노드의 원문 구간만 다시 읽고 고친다(맵 앞 선행 주석은 headText 로 따로 보존).
  const yamlPart = parts ? sliceTopMap(oldYaml) : '';
  const headText = oldYaml.slice(0, yamlPart ? oldYaml.indexOf(yamlPart) : 0);
  const doc = parseDocument(yamlPart) as Doc;
  if (doc.errors.length > 0) throw new Error(yamlErrorMessage(doc));
  const map = rootMap(doc);

  let changed = false;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      // 이미 있는 키만 지운다(없는 키 삭제는 무변경).
      if (deleteKey(map, key, doc)) changed = true;
      continue;
    }
    if (sameValue(map.get(key, true), value)) continue; // 같은 값이면 원문 노드를 그대로 둔다
    setKey(doc, map, key, value);
    // 날짜 기간 같은 작은 맵은 한 줄(`{ start: …, end: … }`)로 쓴다
    const written = map.items.find((it) => keyOf(it) === key);
    if (written && written.value instanceof YAMLMap) written.value.flow = true;
    changed = true;
  }
  if (!changed) return content;
  keepComments(map, doc);

  const yamlText = (headText + doc.toString({ lineWidth: 0 })).replace(/\r?\n/g, '\n').replace(/\n$/, '');
  const frontmatter = `---${eol}${yamlText.replace(/\n/g, eol)}${eol}---${eol}`;
  return frontmatter + (parts ? content.slice(parts.end) : content);
}

/**
 * 프런트매터 키 이름을 바꾼다(값·위치·주석 유지). `from` 이 없으면 입력 그대로,
 * `to` 가 이미 있으면 Error. 본문은 한 바이트도 바꾸지 않는다.
 */
export function renameFrontmatterKey(content: string, from: string, to: string): string {
  if (from === to) return content;
  const parts = splitFrontmatter(content);
  if (parts?.error) throw new Error(t('db.issue.yaml', { message: parts.error }));
  if (!parts) return content;

  const oldYaml = parts.raw.slice(parts.raw.indexOf('\n') + 1, parts.raw.lastIndexOf('---'));
  const yamlPart = sliceTopMap(oldYaml);
  const doc = parseDocument(yamlPart);
  if (doc.errors.length > 0) throw new Error(yamlErrorMessage(doc));
  if (!doc.contents) return content;
  const map = doc.contents as ParsedNodeMap;

  const pair = map.items.find((it) => keyOf(it) === from);
  if (!pair) return content;
  if (map.items.some((it) => keyOf(it) === to)) throw new Error(t('core.err.keyExists', { key: to }));
  pair.key = sc(to);

  const eol = parts.raw.startsWith('---\r\n') ? '\r\n' : '\n';
  const headText = oldYaml.slice(0, oldYaml.indexOf(yamlPart));
  const yamlText = (headText + doc.toString({ lineWidth: 0 })).replace(/\r?\n/g, '\n').replace(/\n$/, '');
  return `---${eol}${yamlText.replace(/\n/g, eol)}${eol}---${eol}` + content.slice(parts.end);
}

/**
 * 새 행 노트 내용 만들기: 프런트매터(값이 `undefined` 가 아닌 키만, 주어진 순서) + 빈 줄 + `body`.
 * `body` 는 기본 ''. 값이 하나도 없으면 프런트매터 없이 `body` 만.
 */
export function buildRowNote(values: Record<string, unknown>, body = ''): string {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return body;
  return `---\n${stringify(Object.fromEntries(entries), { lineWidth: 0 })}---\n\n${body}`;
}

// ── `_db.yaml` ────────────────────────────────────────────────────

/** `properties.<name>` 을 설정한다(없으면 추가). 기존 항목은 같은 위치에서 값만 교체한다. */
export function setDbProperty(yamlText: string, name: string, def: Property): string {
  const opened = openDb(yamlText);
  const map = propertiesOf(opened.doc);
  const pair = map.items.find((it) => keyOf(it) === name);
  if (sameValue(pair?.value, def)) return yamlText;
  setKey(opened.doc, map, name, def);
  return renderDb(opened);
}

/**
 * 속성을 지운다. 모든 뷰의 `columns`/`sort`/`groupBy`/`subGroupBy`/`dateProp`/`cover`/`calc`/`widths`
 * 참조도 함께 지우고, 필터(and/or 포함)에서 그 이름을 쓰는 조건도 제거한다. 없는 속성이면 입력 그대로.
 */
export function removeDbProperty(yamlText: string, name: string): string {
  const opened = openDb(yamlText);
  const map = getKey(rootMap(opened.doc), 'properties');
  let changed = false;
  if (isMap(map)) {
    if (deleteKey(map, name, opened.doc)) {
      // 마지막 속성을 지웠으면 빈 `properties` 컨테이너도 치운다.
      if (map.items.length === 0) rootMap(opened.doc).delete(sc('properties'));
      changed = true;
    }
  }

  const views = viewsOf(opened.doc);
  for (const view of views.items) {
    if (!isMap(view)) continue;
    changed = dropViewRefs(view, name) > 0 || changed;
  }
  if (changed) keepComments(views);
  return changed ? renderDb(opened) : yamlText;
}

/**
 * `properties` 키 이름을 바꾼다(위치 유지). 뷰의 모든 참조(`columns`, `sort[].prop`, `groupBy`,
 * `subGroupBy`, `dateProp`, `cover`, `calc`/`widths` 키, 필터 조건의 `prop`)와 롤업의
 * `relation`/`property`, 관계의 `reverse` 참조도 함께 바꾼다. 없는 속성이면 입력 그대로.
 */
export function renameDbProperty(yamlText: string, from: string, to: string): string {
  if (from === to) return yamlText;
  const opened = openDb(yamlText);
  const map = propertiesOf(opened.doc);
  const pair = map.items.find((it) => keyOf(it) === from);
  if (!pair) return yamlText;
  pair.key = sc(to);

  let changed = false;
  for (const view of viewsOf(opened.doc).items) {
    if (!isMap(view)) continue;
    changed = renameViewRefs(view, from, to) > 0 || changed;
  }
  for (const item of map.items) {
    if (!isMap(item.value)) continue;
    const def = item.value;
    if (strOf(def.get('type')) === 'rollup') {
      for (const field of ['relation', 'property'] as const) {
        if (strOf(def.get(field)) === from) {
          def.set(sc(field), to);
          changed = true;
        }
      }
    } else if (strOf(def.get('type')) === 'relation' && strOf(def.get('reverse')) === from) {
      def.set(sc('reverse'), to);
      changed = true;
    }
  }
  return renderDb(opened);
}

/** `views` 에서 `id` 가 같은 항목을 교체하고, 없으면 끝에 추가한다. `views` 키가 없으면 만든다. */
export function upsertDbView(yamlText: string, view: View): string {
  const opened = openDb(yamlText);
  const seq = viewsOf(opened.doc);
  const idx = seq.items.findIndex((it) => isMap(it) && it.get('id') === view.id);
  const node = opened.doc.createNode(view);
  if (idx >= 0) seq.items[idx] = node;
  else seq.items.push(node);
  return renderDb(opened);
}

/** `views` 에서 `id` 가 같은 항목을 지운다. 없는 id 면 입력 그대로. */
export function removeDbView(yamlText: string, id: string): string {
  const opened = openDb(yamlText);
  const seq = viewsOf(opened.doc);
  if (dropItems(seq, (it) => isMap(it) && it.get('id') === id) === 0) return yamlText;
  keepComments(seq);
  return renderDb(opened);
}

/** `views` 항목의 순서를 `toIndex` 로 옮긴다(범위는 클램프). 그 id 가 없으면 입력 그대로. */
export function moveDbView(yamlText: string, id: string, toIndex: number): string {
  const opened = openDb(yamlText);
  const seq = viewsOf(opened.doc);
  const from = seq.items.findIndex((it) => isMap(it) && it.get('id') === id);
  if (from < 0) return yamlText;
  const to = Math.max(0, Math.min(seq.items.length - 1, Math.trunc(toIndex)));
  if (to === from) return yamlText;
  const [node] = seq.items.splice(from, 1);
  seq.items.splice(to, 0, node);
  return renderDb(opened);
}

/**
 * 최상위 스칼라 키를 설정/삭제한다. `undefined` 는 삭제이고, `title`·`rowsFolder` 는 빈 문자열도
 * 삭제로 본다(빈 제목·빈 폴더는 의미가 없다). `templates` 는 배열 그대로 쓴다.
 */
export function setDbMeta(
  yamlText: string,
  changes: { title?: string; rowsFolder?: string; defaultTemplate?: string | undefined; templates?: string[] },
): string {
  const opened = openDb(yamlText);
  let changed = false;
  for (const [key, value] of Object.entries(changes) as [string, string | string[] | undefined][]) {
    const remove = value === undefined || (typeof value === 'string' && value.length === 0);
    if (remove) {
      changed = deleteKey(rootMap(opened.doc), key, opened.doc) || changed;
    } else {
      setKey(opened.doc, rootMap(opened.doc), key, value);
      changed = true;
    }
  }
  if (changed) keepComments(rootMap(opened.doc));
  return changed ? renderDb(opened) : yamlText;
}

/** 새 데이터베이스 파일 내용: `version: 1`, `title`, `properties: {}`, 뷰 하나(id `v1`, `표`, `table`). */
export function newDbYaml(title: string): string {
  const schema: DbSchema = {
    version: 1,
    title,
    rowsFolder: '.',
    properties: {},
    views: [{ id: 'v1', name: t('db.view.table'), type: 'table', sort: [] }],
    templates: [],
  };
  return stringify(schema, { lineWidth: 0 });
}
