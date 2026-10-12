/** 에디터가 첨부(이미지·파일·미디어)를 다루려고 앱에 요구하는 기능 */
export interface NopsAssetHost {
  /** 노트 안의 첨부 대상(`a.png`, `attachments/a.png`) → 볼트 안 경로. 없으면 undefined */
  resolve(target: string): string | undefined;
  /** 볼트 경로 → 화면에 불러올 수 있는 URL */
  url(vaultPath: string): string;
  /** 파일을 볼트에 저장하고 볼트 경로를 돌려준다 */
  save(file: File): Promise<string>;
  /** 이미지 마크다운 링크 `![](…)`에 쓸 경로(현재 노트 기준 상대 경로) */
  imageSrc(vaultPath: string): string;
  /** `![[…]]` 임베드에 쓸 이름(파일명이 볼트에서 유일하면 파일명, 아니면 경로) */
  embedTarget(vaultPath: string): string;
  /** 첨부를 기본 앱으로 열거나 위치를 보여 준다 */
  open(vaultPath: string): void;
  onError?(message: string): void;
}

/** 마크다운 이미지 src(상대 경로·퍼센트 인코딩 포함)를 화면용 URL로 바꾼다. 해석할 수 없으면 그대로 돌려준다. */
export function resolveImageSrc(host: NopsAssetHost, src: string): string {
  if (/^(https?:|data:|blob:|vault:|app:)/i.test(src)) return src;
  const candidates = [src];
  try {
    candidates.push(decodeURIComponent(src));
  } catch {
    // 잘못된 인코딩이면 원문만 시도한다
  }
  for (const c of candidates) {
    const path = host.resolve(c);
    if (path) return host.url(path);
  }
  return src;
}
