/** 맥이면 ⌘⌥⇧ 기호를 그대로, 아니면 Ctrl+ / Alt+ / Shift+ 로 바꿔 보인다(윈도우·리눅스). */
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

export function keys(text: string, mac = isMac): string {
  if (mac) return text;
  return text.replace(/[⌘⌥⇧]+(?=\S)/g, (mods) => {
    const out: string[] = [];
    if (mods.includes('⌘')) out.push('Ctrl');
    if (mods.includes('⇧')) out.push('Shift');
    if (mods.includes('⌥')) out.push('Alt');
    return `${out.join('+')}+`;
  });
}
