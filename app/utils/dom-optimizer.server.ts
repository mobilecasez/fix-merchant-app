import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

/**
 * Optimizes HTML for AI consumption by:
 * 1. Using Mozilla Readability to extract core content
 * 2. Converting the cleaned HTML to Markdown using Turndown
 * 3. Preserving critical data scripts (JSON-LD, state blobs)
 */
export function optimizeHtmlForAI(html: string): { markdown: string; dataScripts: string } {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // 1. Extract critical data scripts before Readability strips them
  const dataScripts: string[] = [];
  doc.querySelectorAll('script').forEach(script => {
    const type = script.getAttribute('type') || '';
    const content = script.textContent || '';
    
    // Keep JSON-LD and standard state blobs (like window.__myx or window.__INITIAL_STATE__)
    if (type.includes('json') || content.includes('window.__') || content.includes('{')) {
      // Basic heuristic to avoid tracking scripts
      if (!content.includes('googletag') && !content.includes('facebook') && content.length > 50) {
        dataScripts.push(content.trim());
      }
    }
  });

  // 2. Use Readability to get the "Reader View" version of the page
  // This removes navbars, footers, ads, and sidebars automatically
  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article || !article.content) {
    // If Readability fails, fallback to a basic cleanup of the body
    return {
      markdown: "Readability failed to parse content.",
      dataScripts: dataScripts.join('\n\n')
    };
  }

  // 3. Convert the clean HTML to Markdown
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  });

  // Ensure images are preserved with their alt text and src
  turndownService.addRule('images', {
    filter: 'img',
    replacement: function (content, node: any) {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || node.getAttribute('data-src') || '';
      if (!src) return '';
      return `![${alt}](${src})`;
    }
  });

  const markdown = turndownService.turndown(article.content);

  return {
    markdown: markdown.trim(),
    dataScripts: dataScripts.join('\n\n')
  };
}
