/** 링크 대상의 일부를 미리 보여 주려고 에디터가 앱에 요구하는 기능 */
export interface NopsPeekHost {
  /** 대상 노트(·제목·블록)의 발췌. 노트를 못 찾으면 null */
  peek(link: { target: string; heading: string | null; block: string | null }): Promise<{ title: string; text: string; found: boolean } | null>;
}
