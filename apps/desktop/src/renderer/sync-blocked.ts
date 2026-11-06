import { t } from '@nopsidian/i18n';

export interface BlockedPlan {
  blocked: string | null;
  blockedCode?: 'deleteRatio';
  blockedParams?: { tracked: number; deletes: number; percent: number };
}

/** 사유가 남은 자리표시자({name})를 품고 있으면 일반 문구로 폴백한다. */
const hasPlaceholder = (text: string): boolean => /\{[a-zA-Z_][\w]*\}/.test(text);

/**
 * 계획이 멈춘 사유 문구. 코드가 있으면 **그릴 때마다** 지금 언어로 만들고,
 * 값이 없거나 자리표시자가 남으면 일반 문구로 안전하게 떨어진다(레거시 `blocked` 문자열은 마지막 수단).
 */
export function blockedPlanText(plan: BlockedPlan): string {
  if (!plan.blockedCode) return plan.blocked ?? '';
  const text = plan.blockedParams ? t('sync.blocked.deleteRatio', plan.blockedParams) : t('sync.blocked.stop');
  return hasPlaceholder(text) ? t('sync.blocked.stop') : text;
}
