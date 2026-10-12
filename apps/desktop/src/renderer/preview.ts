import DOMPurify from 'dompurify';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkRehype) // allowDangerousHtml 미사용: 원문 HTML은 버린다
  .use(rehypeStringify);

/** 읽기 전용 미리보기. 1단계에서 자체 파서로 대체된다. 결과는 항상 DOMPurify를 거친다. */
export async function renderMarkdownPreview(md: string): Promise<string> {
  const html = String(await processor.process(md));
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
