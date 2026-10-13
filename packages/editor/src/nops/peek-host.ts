/** 링크 대상의 일부를 미리 보여 주려고 에디터가 앱에 요구하는 기능 */
export interface NopsPeekHost {
  /** 대상 노트(·제목·블록)의 발췌. 노트를 못 찾으면 null */
  peek(link: { target: string; heading: string | null; block: string | null }): Promise<{ title: string; text: string; found: boolean } | null>;

  /** 블록 임베드(`![[노트#^id]]`)를 그 자리에서 고치려고 원본 블록의 마크다운 원문을 돌려준다(`^id` 제외). 편집 불가면 null */
  source?(link: { target: string; heading: string | null; block: string | null }): Promise<string | null>;
  /** 고친 마크다운으로 원본 노트의 그 블록을 바꾼다. 성공하면 true */
  save?(link: { target: string; heading: string | null; block: string | null }, markdown: string): Promise<boolean>;
  /** 어떤 노트든 바뀌면 부른다(임베드 갱신용). 구독 해제 함수를 돌려준다 */
  onChange?(cb: () => void): () => void;
}
