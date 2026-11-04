import { getLocale, t, type Locale } from './index'

const toDate = (value: number | string | Date): Date => (value instanceof Date ? value : new Date(value))

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * 날짜+시각. ko 는 지금까지 쓰던 `toLocaleString('ko-KR')` 출력과 같다.
 * 영어는 앱 전체가 한 규칙이다: 24시간·초 없음("Nov 4, 2026, 23:39").
 */
export function formatDateTime(value: number | string | Date, locale: Locale = getLocale(), withSeconds = true): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  if (locale === 'ko') {
    return withSeconds
      ? date.toLocaleString('ko-KR')
      : date.toLocaleString('ko-KR', {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 짧은 날짜+시각. ko 는 `M/D HH:mm`(초는 옵션) 그대로, en 은 `Nov 4, 15:12` 형태. */
export function formatShortDateTime(
  value: number | string | Date,
  options: { seconds?: boolean } = {},
  locale: Locale = getLocale(),
): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  if (locale === 'ko') {
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}${options.seconds ? `:${pad(date.getSeconds())}` : ''}`
    return `${date.getMonth() + 1}/${date.getDate()} ${clock}`
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' } : {}),
    hour12: false,
  })
}

/** "방금"·"N분 전"·날짜. 타임스탬프가 없으면 "없음". */
export function formatRelativeTime(timestamp: number | null, now = Date.now(), locale: Locale = getLocale()): string {
  if (timestamp === null) return t('time.never')
  const sec = Math.round((now - timestamp) / 1000)
  if (sec < 60) return t('time.justNow')
  if (sec < 3600) return t('time.minutesAgo', { n: Math.round(sec / 60) })
  return formatDateTime(timestamp, locale)
}

/** 휴지통·파일 시각: ko 는 지금까지의 'YYYY-MM-DD HH:mm' 그대로, en 은 로캘 서식. */
export function formatCompactDateTime(value: number | string | Date, locale: Locale = getLocale()): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  if (locale === 'ko') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return formatDateTime(date, 'en')
}
