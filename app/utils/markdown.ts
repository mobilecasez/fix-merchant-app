import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

export async function convertMarkdownToHtml(markdown: string): Promise<string> {
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window as any);
  const dirtyHtml = await marked.parse(markdown);
  const cleanHtml = DOMPurify.sanitize(dirtyHtml);
  return cleanHtml;
}
